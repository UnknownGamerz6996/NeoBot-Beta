const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const config = require('../../config');
const logger = require('./logger');
const database = require('./database');
const neoprotect = require('./neoprotect');
const ErrorHandler = require('../handlers/errorHandler');

class MonitoringSystem {
    constructor(client) {
        this.client = client;
        this.isRunning = false;
        this.monitorInterval = null;
        this.cleanupInterval = null;
        this.healthCheckInterval = null;
        this.lastAlerts = new Map(); // For alert cooldowns
        this.alertQueue = [];
        this.isProcessingAlerts = false;
        this.consecutiveFailures = 0;
        this.maxConsecutiveFailures = 5;
        
        // Performance metrics
        this.metrics = {
            totalChecks: 0,
            alertsSent: 0,
            errors: 0,
            lastCheckDuration: 0,
            avgCheckDuration: 0,
            lastCheckTime: null,
            systemHealth: 'unknown'
        };

        // Circuit breaker for API failures
        this.circuitBreaker = {
            isOpen: false,
            failureCount: 0,
            lastFailureTime: null,
            resetTimeout: 300000 // 5 minutes
        };
    }

    async start() {
        if (this.isRunning) {
            logger.warn('Monitoring system is already running');
            return false;
        }

        try {
            this.isRunning = true;
            
            // Start main monitoring loop
            this.monitorInterval = setInterval(async () => {
                await this.performMonitoringCheck();
            }, config.monitoring.interval);

            // Start cleanup task (runs every hour)
            this.cleanupInterval = setInterval(async () => {
                await this.performCleanup();
            }, config.monitoring.cleanupInterval);

            // Start health check interval
            this.healthCheckInterval = setInterval(async () => {
                await this.performHealthCheck();
            }, config.monitoring.healthCheckInterval);

            // Schedule daily maintenance
            if (config.features.autoBackup) {
                cron.schedule('0 2 * * *', async () => {
                    await this.performDailyMaintenance();
                });
            }

            logger.startup('Monitoring system started successfully');
            await this.recordMetric('monitoring_started', 1);
            this.metrics.systemHealth = 'healthy';
            
            return true;

        } catch (error) {
            this.isRunning = false;
            const errorId = await ErrorHandler.handleApiError('monitoring', 'start', error);
            logger.error('Failed to start monitoring system', error, { errorId });
            return false;
        }
    }

    async stop() {
        if (!this.isRunning) {
            logger.warn('Monitoring system is not running');
            return false;
        }

        try {
            this.isRunning = false;

            // Clear intervals
            if (this.monitorInterval) {
                clearInterval(this.monitorInterval);
                this.monitorInterval = null;
            }

            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }

            if (this.healthCheckInterval) {
                clearInterval(this.healthCheckInterval);
                this.healthCheckInterval = null;
            }

            // Process any remaining alerts
            if (this.alertQueue.length > 0) {
                logger.info(`Processing ${this.alertQueue.length} remaining alerts before shutdown`);
                await this.processAlertQueue();
            }

            logger.shutdown('Monitoring system stopped');
            await this.recordMetric('monitoring_stopped', 1);
            this.metrics.systemHealth = 'stopped';
            
            return true;

        } catch (error) {
            const errorId = await ErrorHandler.handleApiError('monitoring', 'stop', error);
            logger.error('Error stopping monitoring system', error, { errorId });
            return false;
        }
    }

    async restart() {
        logger.info('Restarting monitoring system...');
        await this.stop();
        await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
        return await this.start();
    }

    async performMonitoringCheck() {
        if (!this.isRunning) return;

        const startTime = Date.now();
        
        try {
            // Check circuit breaker
            if (this.isCircuitBreakerOpen()) {
                logger.debug('Circuit breaker is open, skipping monitoring check');
                return;
            }

            this.metrics.totalChecks++;
            this.metrics.lastCheckTime = new Date().toISOString();

            // Get all active monitors
            const monitors = await this.getAllActiveMonitors();
            
            if (monitors.length === 0) {
                logger.debug('No active monitors found');
                return;
            }

            logger.debug(`Checking ${monitors.length} monitored IPs`);

            // Get attacks from NeoProtect API with retry logic
            const attacks = await this.getAttacksWithRetry();

            // Process each monitor
            await this.processMonitors(monitors, attacks);

            // Reset consecutive failures on success
            this.consecutiveFailures = 0;
            this.closeCircuitBreaker();

        } catch (error) {
            await this.handleMonitoringError(error);
        } finally {
            const duration = Date.now() - startTime;
            this.updateMetrics(duration);
        }
    }

    async getAttacksWithRetry(maxRetries = 3) {
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const attacks = await neoprotect.getAttacks();
                return attacks || [];
            } catch (error) {
                lastError = error;
                
                if (attempt < maxRetries) {
                    const delay = Math.pow(2, attempt) * 1000; // Exponential backoff
                    logger.warn(`API call failed (attempt ${attempt}/${maxRetries}), retrying in ${delay}ms`, {
                        error: error.message
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    logger.error(`API call failed after ${maxRetries} attempts`, error);
                }
            }
        }
        
        throw lastError;
    }

    async processMonitors(monitors, attacks) {
        const batchSize = config.monitoring.maxConcurrentChecks || 5;
        
        for (let i = 0; i < monitors.length; i += batchSize) {
            const batch = monitors.slice(i, i + batchSize);
            
            const promises = batch.map(monitor => 
                this.processMonitor(monitor, attacks).catch(error => {
                    logger.error(`Failed to process monitor ${monitor.ip_address}`, error);
                })
            );
            
            await Promise.all(promises);
        }
    }

    async processMonitor(monitor, attacks) {
        try {
            // Find attacks for this IP
            const ipAttacks = attacks.filter(attack => 
                attack.dstAddress?.ipv4 === monitor.ip_address ||
                attack.target?.ip === monitor.ip_address
            );

            if (ipAttacks.length === 0) {
                logger.debug(`No attacks found for ${monitor.ip_address}`);
                return;
            }

            // Sort by start time (newest first)
            ipAttacks.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
            const latestAttack = ipAttacks[0];

            // Check if this is a new attack we haven't alerted about
            const shouldAlert = await this.shouldSendAlert(monitor, latestAttack);
            
            if (shouldAlert) {
                await this.queueAlert(monitor, latestAttack);
                
                // Update monitor with latest attack info
                await this.updateMonitorAttackInfo(monitor, latestAttack);
                
                logger.attack(latestAttack);
                logger.monitor('new_attack_detected', monitor.ip_address, {
                    attackId: latestAttack.id,
                    guildId: monitor.guild_id
                });
            }

        } catch (error) {
            await ErrorHandler.handleApiError('monitoring', 'processMonitor', error, {
                monitorId: monitor.id,
                ipAddress: monitor.ip_address
            });
        }
    }

    async shouldSendAlert(monitor, attack) {
        // Check if we've already alerted about this attack
        if (monitor.last_attack_id === attack.id) {
            return false;
        }

        // Check cooldown periods
        const alertKey = `${monitor.guild_id}:${monitor.ip_address}`;
        const lastAlertTime = this.lastAlerts.get(alertKey);
        const now = Date.now();

        // Global cooldown check
        if (lastAlertTime && (now - lastAlertTime) < config.notifications.cooldowns.sameIP) {
            logger.debug(`Alert cooldown active for ${monitor.ip_address}`);
            return false;
        }

        // Check if attack is recent enough to be relevant
        const attackTime = new Date(attack.startedAt).getTime();
        const maxAge = 3600000; // 1 hour
        
        if (now - attackTime > maxAge) {
            logger.debug(`Attack too old for ${monitor.ip_address}, skipping alert`);
            return false;
        }

        return true;
    }

    async queueAlert(monitor, attack) {
        this.alertQueue.push({
            monitor,
            attack,
            timestamp: Date.now(),
            retries: 0
        });

        // Process alerts if not already processing
        if (!this.isProcessingAlerts) {
            setImmediate(() => this.processAlertQueue());
        }
    }

    async processAlertQueue() {
        if (this.isProcessingAlerts || this.alertQueue.length === 0) {
            return;
        }

        this.isProcessingAlerts = true;

        try {
            while (this.alertQueue.length > 0) {
                const alertData = this.alertQueue.shift();
                await this.sendAlert(alertData);
                
                // Small delay between alerts to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        } catch (error) {
            logger.error('Error processing alert queue', error);
        } finally {
            this.isProcessingAlerts = false;
        }
    }

    async sendAlert(alertData) {
        const { monitor, attack, retries } = alertData;
        const maxRetries = 3;

        try {
            const guild = this.client.guilds.cache.get(monitor.guild_id);
            if (!guild) {
                logger.warn(`Guild not found for monitor: ${monitor.guild_id}`);
                return;
            }

            const channel = guild.channels.cache.get(monitor.alert_channel_id);
            if (!channel) {
                logger.warn(`Alert channel not found: ${monitor.alert_channel_id}`);
                return;
            }

            const embed = this.createAttackEmbed(monitor, attack);
            
            await channel.send({ embeds: [embed] });

            // Record successful alert
            this.metrics.alertsSent++;
            await this.recordMetric('alert_sent', 1, {
                guildId: monitor.guild_id,
                ipAddress: monitor.ip_address,
                attackId: attack.id
            });

            // Update last alert time
            const alertKey = `${monitor.guild_id}:${monitor.ip_address}`;
            this.lastAlerts.set(alertKey, Date.now());

            logger.info(`Alert sent for attack on ${monitor.ip_address}`, {
                guildId: monitor.guild_id,
                attackId: attack.id
            });

        } catch (error) {
            if (retries < maxRetries) {
                // Retry the alert
                alertData.retries = retries + 1;
                this.alertQueue.unshift(alertData);
                
                logger.warn(`Alert failed, retrying (${retries + 1}/${maxRetries})`, {
                    error: error.message,
                    ipAddress: monitor.ip_address
                });
            } else {
                logger.error('Alert failed after max retries', error, {
                    ipAddress: monitor.ip_address,
                    attackId: attack.id
                });
                
                this.metrics.errors++;
                await this.recordMetric('alert_error', 1, {
                    error: error.message,
                    ipAddress: monitor.ip_address
                });
            }
        }
    }

    createAttackEmbed(monitor, attack) {
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.error)
            .setTitle(`${config.ui.emojis.attack} DDoS Attack Detected`)
            .setDescription(`Attack detected on monitored IP address`)
            .addFields([
                {
                    name: '🎯 Target Information',
                    value: [
                        `**IP Address:** \`${monitor.ip_address}\``,
                        `**Alias:** ${monitor.alias || 'None'}`,
                        `**Monitor ID:** \`${monitor.id}\``
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🚨 Attack Details',
                    value: [
                        `**Attack ID:** \`${attack.id}\``,
                        `**Started:** <t:${Math.floor(new Date(attack.startedAt).getTime() / 1000)}:R>`,
                        `**Type:** ${attack.type || 'Unknown'}`,
                        `**Status:** ${attack.status || 'Active'}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 Attack Statistics',
                    value: [
                        `**Peak PPS:** ${attack.peakPps?.toLocaleString() || 'N/A'}`,
                        `**Peak Bandwidth:** ${this.formatBandwidth(attack.peakBandwidth)}`,
                        `**Duration:** ${this.formatDuration(attack.startedAt)}`,
                        `**Severity:** ${this.getAttackSeverity(attack)}`
                    ].join('\n'),
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ 
                text: `NeoProtect Monitoring • Attack ID: ${attack.id}`,
                iconURL: this.client.user?.displayAvatarURL()
            });

        // Add source information if available
        if (attack.sourceCountries && attack.sourceCountries.length > 0) {
            embed.addFields({
                name: '🌍 Source Information',
                value: attack.sourceCountries.slice(0, 5).map(country => 
                    `• ${country.name} (${country.percentage}%)`
                ).join('\n'),
                inline: true
            });
        }

        return embed;
    }

    formatBandwidth(bandwidth) {
        if (!bandwidth) return 'N/A';
        
        if (bandwidth >= 1000000000) {
            return `${(bandwidth / 1000000000).toFixed(2)} Gbps`;
        } else if (bandwidth >= 1000000) {
            return `${(bandwidth / 1000000).toFixed(2)} Mbps`;
        } else if (bandwidth >= 1000) {
            return `${(bandwidth / 1000).toFixed(2)} Kbps`;
        }
        return `${bandwidth} bps`;
    }

    formatDuration(startTime) {
        const now = new Date();
        const start = new Date(startTime);
        const durationMs = now - start;
        
        const minutes = Math.floor(durationMs / 60000);
        const seconds = Math.floor((durationMs % 60000) / 1000);
        
        if (minutes > 0) {
            return `${minutes}m ${seconds}s`;
        }
        return `${seconds}s`;
    }

    getAttackSeverity(attack) {
        const pps = attack.peakPps || 0;
        const bandwidth = attack.peakBandwidth || 0;
        
        if (pps > 1000000 || bandwidth > 10000000000) { // 1M PPS or 10 Gbps
            return '🔴 Critical';
        } else if (pps > 100000 || bandwidth > 1000000000) { // 100K PPS or 1 Gbps
            return '🟠 High';
        } else if (pps > 10000 || bandwidth > 100000000) { // 10K PPS or 100 Mbps
            return '🟡 Medium';
        }
        return '🟢 Low';
    }

    async updateMonitorAttackInfo(monitor, attack) {
        try {
            await database.updateMonitor(monitor.id, {
                last_attack_id: attack.id,
                last_attack_time: new Date(attack.startedAt).toISOString(),
                total_attacks: (monitor.total_attacks || 0) + 1
            });
        } catch (error) {
            logger.error('Failed to update monitor attack info', error, {
                monitorId: monitor.id,
                attackId: attack.id
            });
        }
    }

    async getAllActiveMonitors() {
        try {
            const query = `
                SELECT m.*, g.name as guild_name 
                FROM monitored_ips m
                LEFT JOIN guilds g ON m.guild_id = g.id
                WHERE m.is_active = TRUE
                ORDER BY m.created_at DESC
            `;
            
            return await database.all(query) || [];
        } catch (error) {
            await ErrorHandler.handleDatabaseError('getAllActiveMonitors', error);
            return [];
        }
    }

    async handleMonitoringError(error) {
        this.consecutiveFailures++;
        this.metrics.errors++;

        await ErrorHandler.handleApiError('monitoring', 'performMonitoringCheck', error, {
            consecutiveFailures: this.consecutiveFailures
        });

        // Open circuit breaker if too many consecutive failures
        if (this.consecutiveFailures >= this.maxConsecutiveFailures) {
            this.openCircuitBreaker();
        }

        await this.recordMetric('monitoring_error', 1, {
            error: error.message,
            consecutiveFailures: this.consecutiveFailures
        });
    }

    openCircuitBreaker() {
        this.circuitBreaker.isOpen = true;
        this.circuitBreaker.lastFailureTime = Date.now();
        this.metrics.systemHealth = 'degraded';
        
        logger.warn('Circuit breaker opened due to consecutive failures', {
            consecutiveFailures: this.consecutiveFailures,
            maxFailures: this.maxConsecutiveFailures
        });
    }

    closeCircuitBreaker() {
        if (this.circuitBreaker.isOpen) {
            this.circuitBreaker.isOpen = false;
            this.circuitBreaker.failureCount = 0;
            this.circuitBreaker.lastFailureTime = null;
            this.metrics.systemHealth = 'healthy';
            
            logger.info('Circuit breaker closed, monitoring resumed normally');
        }
    }

    isCircuitBreakerOpen() {
        if (!this.circuitBreaker.isOpen) return false;

        // Check if enough time has passed to attempt reset
        const timeSinceFailure = Date.now() - this.circuitBreaker.lastFailureTime;
        if (timeSinceFailure > this.circuitBreaker.resetTimeout) {
            logger.info('Attempting to reset circuit breaker...');
            this.circuitBreaker.isOpen = false;
            return false;
        }

        return true;
    }

    async performHealthCheck() {
        try {
            // Check API connectivity
            const apiHealthy = await this.checkApiHealth();
            
            // Check database connectivity
            const dbHealthy = await this.checkDatabaseHealth();
            
            // Check system resources
            const resourcesHealthy = this.checkSystemResources();
            
            const overallHealth = apiHealthy && dbHealthy && resourcesHealthy;
            
            this.metrics.systemHealth = overallHealth ? 'healthy' : 'unhealthy';
            
            logger.health('monitoring_system', this.metrics.systemHealth, null, {
                apiHealthy,
                dbHealthy,
                resourcesHealthy
            });

        } catch (error) {
            this.metrics.systemHealth = 'error';
            logger.error('Health check failed', error);
        }
    }

    async checkApiHealth() {
        try {
            await neoprotect.testConnection();
            return true;
        } catch (error) {
            logger.warn('API health check failed', { error: error.message });
            return false;
        }
    }

    async checkDatabaseHealth() {
        try {
            await database.testConnection();
            return true;
        } catch (error) {
            logger.warn('Database health check failed', { error: error.message });
            return false;
        }
    }

    checkSystemResources() {
        const memUsage = process.memoryUsage();
        const memMB = memUsage.heapUsed / 1024 / 1024;
        const memThreshold = config.performance.memoryThreshold;
        
        if (memMB > memThreshold) {
            logger.warn('High memory usage detected', { 
                current: memMB, 
                threshold: memThreshold 
            });
            return false;
        }
        
        return true;
    }

    async performCleanup() {
        try {
            logger.debug('Starting monitoring system cleanup...');
            
            // Clean up old alert cooldowns
            const now = Date.now();
            const maxAge = config.notifications.cooldowns.sameIP * 2;
            
            for (const [key, timestamp] of this.lastAlerts.entries()) {
                if (now - timestamp > maxAge) {
                    this.lastAlerts.delete(key);
                }
            }
            
            // Clean up old metrics
            await database.cleanupOldMetrics(30); // Keep 30 days of metrics
            
            // Clean up old logs if configured
            if (config.features.autoBackup) {
                await this.cleanupOldLogs();
            }
            
            logger.debug('Monitoring system cleanup completed');
            
        } catch (error) {
            logger.error('Cleanup task failed', error);
        }
    }

    async cleanupOldLogs() {
        // Implementation for log cleanup
        // This would remove old log files based on configuration
    }

    async performDailyMaintenance() {
        try {
            logger.info('Starting daily maintenance...');
            
            // Create database backup
            await database.createBackup();
            
            // Generate daily report
            await this.generateDailyReport();
            
            // Reset daily metrics
            this.resetDailyMetrics();
            
            logger.info('Daily maintenance completed');
            
        } catch (error) {
            logger.error('Daily maintenance failed', error);
        }
    }

    async generateDailyReport() {
        try {
            const stats = this.getSystemStats();
            const last24h = await database.getMetrics('alert_sent', 24);
            
            logger.info('Daily monitoring report', {
                totalChecks: stats.metrics.totalChecks,
                alertsSent: last24h.length,
                errors: stats.metrics.errors,
                systemHealth: stats.metrics.systemHealth,
                activeMonitors: stats.activeMonitors || 0
            });
            
        } catch (error) {
            logger.error('Failed to generate daily report', error);
        }
    }

    resetDailyMetrics() {
        // Reset daily counters while preserving important data
        const importantMetrics = {
            lastCheckTime: this.metrics.lastCheckTime,
            systemHealth: this.metrics.systemHealth,
            avgCheckDuration: this.metrics.avgCheckDuration
        };
        
        this.metrics = {
            totalChecks: 0,
            alertsSent: 0,
            errors: 0,
            lastCheckDuration: 0,
            ...importantMetrics
        };
    }

    updateMetrics(duration) {
        this.metrics.lastCheckDuration = duration;
        this.metrics.avgCheckDuration = this.metrics.totalChecks > 0 ? 
            (this.metrics.avgCheckDuration + duration) / 2 : duration;
            
        logger.performance('monitoring_check_duration', duration, 10000);
        this.recordMetric('monitoring_check_duration', duration);
    }

    async recordMetric(name, value, metadata = {}) {
        try {
            await database.recordMetric(name, value, {
                ...metadata,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            // Don't throw database errors when recording metrics
            logger.warn('Failed to record metric', { name, value, error: error.message });
        }
    }

    getSystemStats() {
        return {
            isRunning: this.isRunning,
            metrics: { ...this.metrics },
            alertQueue: this.alertQueue.length,
            activeCooldowns: this.lastAlerts.size,
            circuitBreaker: { ...this.circuitBreaker },
            consecutiveFailures: this.consecutiveFailures
        };
    }

    // Test method for sending a test alert
    async sendTestAlert(monitor) {
        const testAttack = {
            id: `test-${Date.now()}`,
            startedAt: new Date().toISOString(),
            type: 'UDP Flood',
            status: 'Active',
            peakPps: 50000,
            peakBandwidth: 500000000, // 500 Mbps
            sourceCountries: [
                { name: 'Test Country', percentage: 100 }
            ]
        };

        await this.queueAlert({
            monitor,
            attack: testAttack,
            timestamp: Date.now(),
            retries: 0
        });
    }
}

module.exports = MonitoringSystem;