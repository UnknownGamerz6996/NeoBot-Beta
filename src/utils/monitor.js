const { EmbedBuilder } = require('discord.js');
const cron = require('node-cron');
const config = require('../../config');
const logger = require('./logger');
const database = require('./database');
const neoprotect = require('./neoprotect');

class MonitoringSystem {
    constructor(client) {
        this.client = client;
        this.isRunning = false;
        this.monitorInterval = null;
        this.cleanupInterval = null;
        this.lastAlerts = new Map(); // For alert cooldowns
        this.alertQueue = [];
        this.isProcessingAlerts = false;
        
        // Performance metrics
        this.metrics = {
            totalChecks: 0,
            alertsSent: 0,
            errors: 0,
            lastCheckDuration: 0,
            avgCheckDuration: 0
        };
    }

    start() {
        if (this.isRunning) {
            logger.warn('Monitoring system is already running');
            return;
        }

        this.isRunning = true;
        
        // Start main monitoring loop
        this.monitorInterval = setInterval(async () => {
            await this.performMonitoringCheck();
        }, config.monitoring.interval);

        // Start cleanup task (runs every hour)
        this.cleanupInterval = setInterval(async () => {
            await this.performCleanup();
        }, 3600000);

        // Schedule daily maintenance
        if (config.features.autoBackup) {
            cron.schedule('0 2 * * *', async () => {
                await this.performDailyMaintenance();
            });
        }

        logger.startup('Monitoring system started');
        this.recordMetric('monitoring_started', 1);
    }

    stop() {
        if (!this.isRunning) return;

        this.isRunning = false;
        
        if (this.monitorInterval) {
            clearInterval(this.monitorInterval);
            this.monitorInterval = null;
        }

        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        logger.shutdown('Monitoring system stopped');
        this.recordMetric('monitoring_stopped', 1);
    }

    async performMonitoringCheck() {
        if (!this.isRunning) return;

        const startTime = Date.now();
        
        try {
            logger.debug('Starting monitoring check');
            this.metrics.totalChecks++;

            // Get all active monitors from database
            const monitors = await this.getAllActiveMonitors();
            
            if (monitors.length === 0) {
                logger.debug('No active monitors found');
                return;
            }

            logger.debug(`Checking ${monitors.length} monitored IPs`);

            // Get latest attacks from NeoProtect API
            const attacks = await neoprotect.getAttacks({
                limit: 100,
                status: 'active'
            });

            // Process each monitor
            for (const monitor of monitors) {
                await this.processMonitor(monitor, attacks);
            }

            // Process alert queue
            await this.processAlertQueue();

        } catch (error) {
            this.metrics.errors++;
            logger.error('Error in monitoring check', error);
            await this.recordMetric('monitoring_errors', 1, { error: error.message });
        } finally {
            const duration = Date.now() - startTime;
            this.metrics.lastCheckDuration = duration;
            this.metrics.avgCheckDuration = (this.metrics.avgCheckDuration + duration) / 2;
            
            logger.performance('monitoring_check_duration', duration, 10000);
            await this.recordMetric('monitoring_check_duration', duration);
        }
    }

    async getAllActiveMonitors() {
        try {
            // Get all monitored IPs from all guilds
            const query = `
                SELECT m.*, g.name as guild_name 
                FROM monitored_ips m
                JOIN guilds g ON m.guild_id = g.id
                WHERE m.is_active = TRUE
                ORDER BY m.created_at DESC
            `;
            
            return await database.all(query);
        } catch (error) {
            logger.error('Failed to get active monitors', error);
            return [];
        }
    }

    async processMonitor(monitor, attacks) {
        try {
            // Find attacks for this IP
            const ipAttacks = attacks.filter(attack => 
                attack.dstAddress?.ipv4 === monitor.ip_address
            );

            if (ipAttacks.length === 0) {
                logger.debug(`No attacks found for ${monitor.ip_address}`);
                return;
            }

            // Sort by start time (newest first)
            ipAttacks.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
            const latestAttack = ipAttacks[0];

            // Check if this is a new attack
            if (latestAttack.id !== monitor.last_attack_id) {
                logger.attack(latestAttack);
                logger.monitor('new_attack_detected', monitor.ip_address, {
                    attackId: latestAttack.id,
                    guildId: monitor.guild_id
                });

                // Update last attack ID in database
                await database.updateLastAttackId(
                    monitor.guild_id,
                    monitor.ip_address,
                    latestAttack.id
                );

                // Check alert cooldown
                if (this.shouldSendAlert(monitor, latestAttack)) {
                    await this.queueAlert(monitor, latestAttack);
                }
            }

        } catch (error) {
            logger.error(`Error processing monitor for ${monitor.ip_address}`, error);
        }
    }

    shouldSendAlert(monitor, attack) {
        const alertKey = `${monitor.guild_id}_${monitor.ip_address}`;
        const now = Date.now();
        const lastAlert = this.lastAlerts.get(alertKey);
        
        // Check cooldown
        if (lastAlert && now - lastAlert < config.monitoring.alertCooldown) {
            logger.debug(`Alert cooldown active for ${monitor.ip_address}`);
            return false;
        }

        // Parse alert settings
        let alertSettings = {};
        try {
            alertSettings = JSON.parse(monitor.alert_settings || '{}');
        } catch (error) {
            logger.warn(`Invalid alert settings for monitor ${monitor.id}`);
        }

        // Check severity threshold
        if (alertSettings.minSeverity) {
            const attackSeverity = this.calculateAttackSeverity(attack);
            if (attackSeverity < alertSettings.minSeverity) {
                logger.debug(`Attack severity ${attackSeverity} below threshold ${alertSettings.minSeverity}`);
                return false;
            }
        }

        return true;
    }

    calculateAttackSeverity(attack) {
        const bps = attack.signatures?.[0]?.bpsPeak || 0;
        const pps = attack.signatures?.[0]?.ppsPeak || 0;
        
        // Simple severity calculation based on traffic volume
        if (bps > 10000000000 || pps > 1000000) return 5; // Critical
        if (bps > 1000000000 || pps > 100000) return 4;   // High
        if (bps > 100000000 || pps > 10000) return 3;     // Medium
        if (bps > 10000000 || pps > 1000) return 2;       // Low
        return 1; // Minimal
    }

    async queueAlert(monitor, attack) {
        this.alertQueue.push({
            monitor,
            attack,
            timestamp: Date.now()
        });

        logger.debug(`Alert queued for ${monitor.ip_address}`);
    }

    async processAlertQueue() {
        if (this.isProcessingAlerts || this.alertQueue.length === 0) {
            return;
        }

        this.isProcessingAlerts = true;

        try {
            while (this.alertQueue.length > 0) {
                const alertData = this.alertQueue.shift();
                await this.sendAlert(alertData.monitor, alertData.attack);
                
                // Small delay to prevent rate limiting
                await this.delay(500);
            }
        } catch (error) {
            logger.error('Error processing alert queue', error);
        } finally {
            this.isProcessingAlerts = false;
        }
    }

    async sendAlert(monitor, attack) {
        try {
            const channel = await this.client.channels.fetch(monitor.channel_id);
            if (!channel) {
                logger.warn(`Channel ${monitor.channel_id} not found for monitor ${monitor.id}`);
                return;
            }

            const embed = await this.createAttackAlertEmbed(monitor, attack);
            const message = await channel.send({ embeds: [embed] });

            // Log the alert
            await database.logAlert(
                monitor.guild_id,
                monitor.channel_id,
                monitor.ip_address,
                attack.id,
                message.id,
                'attack_detected'
            );

            // Update alert cooldown
            const alertKey = `${monitor.guild_id}_${monitor.ip_address}`;
            this.lastAlerts.set(alertKey, Date.now());

            this.metrics.alertsSent++;
            logger.monitor('alert_sent', monitor.ip_address, {
                attackId: attack.id,
                channelId: monitor.channel_id,
                messageId: message.id
            });

            await this.recordMetric('alerts_sent', 1, {
                guildId: monitor.guild_id,
                ipAddress: monitor.ip_address,
                attackType: attack.signatures?.[0]?.name
            });

        } catch (error) {
            logger.error(`Failed to send alert for ${monitor.ip_address}`, error);
            await this.recordMetric('alert_errors', 1, {
                error: error.message,
                ipAddress: monitor.ip_address
            });
        }
    }

    async createAttackAlertEmbed(monitor, attack) {
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.error)
            .setTitle(`${config.ui.emojis.attack} DDoS Attack Detected`)
            .setDescription('A new DDoS attack has been detected and mitigation is in progress.')
            .addFields([
                {
                    name: `${config.ui.emojis.target} Target`,
                    value: monitor.alias || monitor.ip_address,
                    inline: true
                },
                {
                    name: '🆔 Attack ID',
                    value: attack.id,
                    inline: true
                },
                {
                    name: '💥 Attack Type',
                    value: attack.signatures?.[0]?.name || 'Unknown',
                    inline: false
                },
                {
                    name: '📊 Peak Traffic',
                    value: `**BPS:** ${neoprotect.formatBytes(attack.signatures?.[0]?.bpsPeak || 0)}\n**PPS:** ${neoprotect.formatNumber(attack.signatures?.[0]?.ppsPeak || 0)}`,
                    inline: true
                },
                {
                    name: '🕒 Started At',
                    value: `<t:${Math.floor(new Date(attack.startedAt).getTime() / 1000)}:f>`,
                    inline: true
                },
                {
                    name: '⚡ Severity',
                    value: this.getSeverityEmoji(this.calculateAttackSeverity(attack)),
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({
                text: 'NeoProtect Monitoring System',
                iconURL: this.client.user?.displayAvatarURL()
            });

        // Add duration if attack has ended
        if (attack.endedAt) {
            const duration = neoprotect.formatDuration(attack.startedAt, attack.endedAt);
            embed.addFields({
                name: '⏱️ Duration',
                value: duration,
                inline: true
            });
        }

        return embed;
    }

    getSeverityEmoji(severity) {
        const emojis = ['🟢', '🟡', '🟠', '🔴', '🟣'];
        const labels = ['Minimal', 'Low', 'Medium', 'High', 'Critical'];
        return `${emojis[severity - 1] || '⚪'} ${labels[severity - 1] || 'Unknown'}`;
    }

    async performCleanup() {
        try {
            logger.debug('Starting monitoring cleanup');

            // Clean expired cache
            await database.clearExpiredCache();

            // Clean old API usage logs (keep 30 days)
            await database.run(
                'DELETE FROM api_usage WHERE timestamp < datetime(\'now\', \'-30 days\')'
            );

            // Clean old alert logs (keep 90 days)
            await database.run(
                'DELETE FROM alert_logs WHERE sent_at < datetime(\'now\', \'-90 days\')'
            );

            // Clean old bot stats (keep 7 days for detailed metrics)
            await database.run(
                'DELETE FROM bot_stats WHERE timestamp < datetime(\'now\', \'-7 days\')'
            );

            // Clean old attack history (keep 30 days)
            await database.run(
                'DELETE FROM attack_history WHERE created_at < datetime(\'now\', \'-30 days\')'
            );

            // Clear old alert cooldowns
            const now = Date.now();
            for (const [key, timestamp] of this.lastAlerts.entries()) {
                if (now - timestamp > config.monitoring.alertCooldown * 2) {
                    this.lastAlerts.delete(key);
                }
            }

            logger.debug('Monitoring cleanup completed');
            await this.recordMetric('cleanup_completed', 1);

        } catch (error) {
            logger.error('Error during monitoring cleanup', error);
        }
    }

    async performDailyMaintenance() {
        try {
            logger.info('Starting daily maintenance');

            // Create database backup
            if (config.features.autoBackup) {
                await database.createBackup();
            }

            // Vacuum database
            await database.vacuum();

            // Clear API cache
            neoprotect.clearCache();

            // Generate daily metrics report
            await this.generateDailyReport();

            logger.info('Daily maintenance completed');
            await this.recordMetric('daily_maintenance', 1);

        } catch (error) {
            logger.error('Error during daily maintenance', error);
        }
    }

    async generateDailyReport() {
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);

            const metrics = {
                totalChecks: this.metrics.totalChecks,
                alertsSent: this.metrics.alertsSent,
                errors: this.metrics.errors,
                avgCheckDuration: this.metrics.avgCheckDuration,
                activeMonitors: (await this.getAllActiveMonitors()).length,
                apiStats: await neoprotect.getApiStats(),
                tableSizes: await database.getTableSizes()
            };

            logger.info('Daily metrics report', metrics);
            await this.recordMetric('daily_report', 1, metrics);

        } catch (error) {
            logger.error('Failed to generate daily report', error);
        }
    }

    async recordMetric(name, value, metadata = {}) {
        try {
            await database.recordMetric(name, value, metadata);
        } catch (error) {
            logger.error('Failed to record metric', error);
        }
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Public API methods
    async addMonitor(guildId, channelId, ipAddress, alias, createdBy, alertSettings = {}) {
        try {
            // Validate IP address
            if (!neoprotect.isValidIP(ipAddress)) {
                throw new Error('Invalid IP address format');
            }

            // Check monitor limits
            const existingMonitors = await database.getMonitoredIPs(guildId);
            if (existingMonitors.length >= config.monitoring.maxMonitorsPerGuild) {
                throw new Error(`Maximum of ${config.monitoring.maxMonitorsPerGuild} monitors allowed per server`);
            }

            // Check if IP is already monitored
            const existing = await database.getMonitoredIP(guildId, ipAddress);
            if (existing) {
                throw new Error('This IP address is already being monitored');
            }

            // Add to database
            const result = await database.addMonitoredIP(
                guildId,
                channelId,
                ipAddress,
                alias,
                createdBy,
                alertSettings
            );

            logger.monitor('monitor_added', ipAddress, {
                guildId,
                channelId,
                createdBy,
                alias
            });

            await this.recordMetric('monitors_added', 1, {
                guildId,
                ipAddress,
                createdBy
            });

            return result;

        } catch (error) {
            logger.error(`Failed to add monitor for ${ipAddress}`, error);
            throw error;
        }
    }

    async removeMonitor(guildId, ipAddress) {
        try {
            const existing = await database.getMonitoredIP(guildId, ipAddress);
            if (!existing) {
                throw new Error('Monitor not found');
            }

            await database.removeMonitoredIP(guildId, ipAddress);

            // Remove from alert cooldowns
            const alertKey = `${guildId}_${ipAddress}`;
            this.lastAlerts.delete(alertKey);

            logger.monitor('monitor_removed', ipAddress, { guildId });

            await this.recordMetric('monitors_removed', 1, {
                guildId,
                ipAddress
            });

            return true;

        } catch (error) {
            logger.error(`Failed to remove monitor for ${ipAddress}`, error);
            throw error;
        }
    }

    async getMonitorStatus(guildId, ipAddress) {
        try {
            const monitor = await database.getMonitoredIP(guildId, ipAddress);
            if (!monitor) return null;

            const alertKey = `${guildId}_${ipAddress}`;
            const lastAlert = this.lastAlerts.get(alertKey);
            const cooldownRemaining = lastAlert ? 
                Math.max(0, config.monitoring.alertCooldown - (Date.now() - lastAlert)) : 0;

            return {
                ...monitor,
                isOnCooldown: cooldownRemaining > 0,
                cooldownRemaining,
                lastAlertTime: lastAlert ? new Date(lastAlert) : null
            };

        } catch (error) {
            logger.error(`Failed to get monitor status for ${ipAddress}`, error);
            throw error;
        }
    }

    getSystemStats() {
        return {
            isRunning: this.isRunning,
            metrics: { ...this.metrics },
            alertQueue: this.alertQueue.length,
            activeCooldowns: this.lastAlerts.size,
            neoprotectHealth: neoprotect.getHealthStatus()
        };
    }

    async testAlert(guildId, channelId, ipAddress) {
        try {
            const monitor = await database.getMonitoredIP(guildId, ipAddress);
            if (!monitor) {
                throw new Error('Monitor not found');
            }

            // Create test attack data
            const testAttack = {
                id: `TEST-${Date.now()}`,
                dstAddress: { ipv4: ipAddress },
                signatures: [{
                    name: 'Test Attack (Simulation)',
                    bpsPeak: 1000000000,
                    ppsPeak: 100000
                }],
                startedAt: new Date().toISOString()
            };

            const channel = await this.client.channels.fetch(channelId);
            if (!channel) {
                throw new Error('Channel not found');
            }

            const embed = await this.createTestAlertEmbed(monitor, testAttack);
            const message = await channel.send({ embeds: [embed] });

            logger.monitor('test_alert_sent', ipAddress, {
                guildId,
                channelId,
                messageId: message.id
            });

            return message;

        } catch (error) {
            logger.error(`Failed to send test alert for ${ipAddress}`, error);
            throw error;
        }
    }

    async createTestAlertEmbed(monitor, testAttack) {
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.warning)
            .setTitle(`${config.ui.emojis.warning} Test Alert`)
            .setDescription('This is a test alert to verify your monitoring configuration.')
            .addFields([
                {
                    name: `${config.ui.emojis.target} Target`,
                    value: monitor.alias || monitor.ip_address,
                    inline: true
                },
                {
                    name: '🆔 Test ID',
                    value: testAttack.id,
                    inline: true
                },
                {
                    name: '💥 Simulated Attack',
                    value: testAttack.signatures[0].name,
                    inline: false
                },
                {
                    name: '📊 Simulated Traffic',
                    value: `**BPS:** ${neoprotect.formatBytes(testAttack.signatures[0].bpsPeak)}\n**PPS:** ${neoprotect.formatNumber(testAttack.signatures[0].ppsPeak)}`,
                    inline: true
                },
                {
                    name: '🕒 Test Time',
                    value: `<t:${Math.floor(new Date(testAttack.startedAt).getTime() / 1000)}:f>`,
                    inline: true
                },
                {
                    name: '✅ Status',
                    value: 'Monitor is working correctly',
                    inline: true
                }
            ])
            .setTimestamp()
            .setFooter({
                text: 'NeoProtect Monitoring System - Test Mode',
                iconURL: this.client.user?.displayAvatarURL()
            });

        return embed;
    }

    // Graceful shutdown
    async shutdown() {
        logger.info('Shutting down monitoring system...');
        
        this.stop();
        
        // Wait for any pending alerts to be processed
        let attempts = 0;
        while (this.isProcessingAlerts && attempts < 30) {
            await this.delay(1000);
            attempts++;
        }
        
        if (this.isProcessingAlerts) {
            logger.warn('Forced shutdown with pending alerts');
        }
        
        logger.info('Monitoring system shutdown complete');
    }
}

module.exports = MonitoringSystem;