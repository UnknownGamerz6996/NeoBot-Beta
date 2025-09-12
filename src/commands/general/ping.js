const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot responsiveness and system status'),
    
    permissions: [],
    guildOnly: false,
    cooldown: 5,
    category: 'general',

    async execute(interaction) {
        const startTime = Date.now();
        
        // Respond immediately to avoid timeout
        await interaction.reply({ content: '🏓 Testing...', ephemeral: true });
        
        const responseTime = Date.now() - startTime;
        const apiLatency = Math.round(interaction.client.ws.ping);
        
        // Test connections with timeout protection
        const dbResult = await this.testDatabaseWithTimeout(interaction.client, 2000);
        const apiResult = await this.testNeoProtectWithTimeout(interaction.client, 2000);
        const eventLoopLag = await this.measureEventLoopLag();

        // Get memory usage
        const memUsage = process.memoryUsage();
        const memoryMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

        const embed = new EmbedBuilder()
            .setColor(this.getStatusColor(responseTime, apiLatency, eventLoopLag, dbResult, apiResult))
            .setTitle(`${config.ui.emojis.info} Pong! 🏓`)
            .setDescription('Bot responsiveness and system status')
            .addFields([
                {
                    name: '⚡ Response Times',
                    value: [
                        `**Bot Response:** ${responseTime}ms`,
                        `**Discord API:** ${apiLatency}ms`,
                        `**Database:** ${dbResult.latency}`,
                        `**NeoProtect API:** ${apiResult.latency}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🔗 Service Status',
                    value: [
                        `**Discord:** 🟢 Connected`,
                        `**Database:** ${dbResult.status}`,
                        `**NeoProtect API:** ${apiResult.status}`,
                        `**Monitoring:** ${this.getMonitoringStatus(interaction.client)}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 Performance',
                    value: [
                        `**Memory Usage:** ${memoryMB}MB`,
                        `**Uptime:** ${this.formatUptime(process.uptime() * 1000)}`,
                        `**Event Loop Lag:** ${eventLoopLag}ms`,
                        `**Load Average:** ${this.getLoadAverage()}`
                    ].join('\n'),
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ 
                text: `Requested by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            });

        // Add performance warning if needed
        const warnings = this.getPerformanceWarnings(responseTime, apiLatency, eventLoopLag, memoryMB, dbResult, apiResult);
        if (warnings.length > 0) {
            embed.addFields({
                name: '⚠️ Performance Warnings',
                value: warnings.join('\n'),
                inline: false
            });
        }

        // Edit the original response
        try {
            await interaction.editReply({ content: null, embeds: [embed] });
        } catch (editError) {
            console.error('Failed to edit ping response:', editError.message);
            // If edit fails, try to follow up (though this might also fail if too much time has passed)
            try {
                await interaction.followUp({ embeds: [embed], ephemeral: true });
            } catch (followUpError) {
                console.error('Failed to follow up ping response:', followUpError.message);
            }
        }
    },

    // Test database with timeout protection
    async testDatabaseWithTimeout(client, timeoutMs = 2000) {
        const startTime = Date.now();
        
        try {
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Database test timeout')), timeoutMs);
            });

            // Create the database test promise
            const testPromise = this.testDatabase(client);

            // Race between test and timeout
            await Promise.race([testPromise, timeoutPromise]);

            const latency = Date.now() - startTime;
            return {
                status: '🟢 Connected',
                latency: `${latency}ms`,
                error: null
            };

        } catch (error) {
            const latency = Date.now() - startTime;
            
            let status = '🔴 Error';
            if (error.message.includes('timeout')) {
                status = '🟡 Timeout';
            } else if (error.message.includes('not connected')) {
                status = '🔴 Disconnected';
            }
            
            return {
                status: status,
                latency: `${latency}ms`,
                error: error.message
            };
        }
    },

    // Test NeoProtect API with timeout protection
    async testNeoProtectWithTimeout(client, timeoutMs = 2000) {
        const startTime = Date.now();
        
        try {
            // Create a timeout promise
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('NeoProtect API test timeout')), timeoutMs);
            });

            // Create the API test promise
            const testPromise = this.testNeoProtectAPI(client);

            // Race between test and timeout
            await Promise.race([testPromise, timeoutPromise]);

            const latency = Date.now() - startTime;
            return {
                status: '🟢 Connected',
                latency: `${latency}ms`,
                error: null
            };

        } catch (error) {
            const latency = Date.now() - startTime;
            
            let status = '🔴 Error';
            if (error.message.includes('timeout')) {
                status = '🟡 Timeout';
            } else if (error.message.includes('not available')) {
                status = '⚪ Not Available';
            }
            
            return {
                status: status,
                latency: `${latency}ms`,
                error: error.message
            };
        }
    },

    // Simple database test
    async testDatabase(client) {
        if (!client.database) {
            throw new Error('Database module not available');
        }

        if (!client.database.isConnected) {
            throw new Error('Database not connected');
        }

        // Simple ping test
        if (typeof client.database.testConnection === 'function') {
            await client.database.testConnection();
        } else {
            // Fallback test
            await client.database.db.admin().ping();
        }
    },

    // Simple NeoProtect API test
    async testNeoProtectAPI(client) {
        if (!client.neoprotect) {
            throw new Error('NeoProtect module not available');
        }

        // Try to get health status
        if (typeof client.neoprotect.getHealthStatus === 'function') {
            const health = client.neoprotect.getHealthStatus();
            if (!health.isHealthy) {
                throw new Error('NeoProtect API reports unhealthy status');
            }
        } else {
            throw new Error('NeoProtect health check not available');
        }
    },

    // Properly measure event loop lag
    async measureEventLoopLag() {
        return new Promise((resolve) => {
            const start = process.hrtime.bigint();
            setImmediate(() => {
                const lag = Number(process.hrtime.bigint() - start) / 1000000;
                resolve(lag.toFixed(2));
            });
        });
    },

    // Format uptime in a readable way
    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    },

    // Get load average (Unix systems)
    getLoadAverage() {
        try {
            const loadAvg = require('os').loadavg();
            return loadAvg[0].toFixed(2);
        } catch (error) {
            return 'N/A';
        }
    },

    // Get monitoring system status
    getMonitoringStatus(client) {
        try {
            if (client.monitoring && typeof client.monitoring.getSystemStats === 'function') {
                const stats = client.monitoring.getSystemStats();
                return stats.isRunning ? '🟢 Running' : '🔴 Stopped';
            } else if (client.monitoring && client.monitoring.isRunning !== undefined) {
                return client.monitoring.isRunning ? '🟢 Running' : '🔴 Stopped';
            } else {
                return '⚪ Not Available';
            }
        } catch (error) {
            return '🔴 Error';
        }
    },

    // Determine status color based on performance metrics
    getStatusColor(responseTime, apiLatency, eventLoopLag, dbResult, apiResult) {
        const lagMs = parseFloat(eventLoopLag);
        
        // Red if any critical performance issues or service failures
        if (responseTime > 3000 || 
            apiLatency > 1000 || 
            lagMs > 100 ||
            dbResult.status.includes('🔴') ||
            apiResult.status.includes('🔴')) {
            return config.ui.colors.error;
        }
        
        // Yellow if moderate performance issues or warnings
        if (responseTime > 1500 || 
            apiLatency > 500 || 
            lagMs > 50 ||
            dbResult.status.includes('🟡') ||
            apiResult.status.includes('🟡')) {
            return config.ui.colors.warning;
        }
        
        // Green if everything looks good
        return config.ui.colors.success;
    },

    // Get performance warnings
    getPerformanceWarnings(responseTime, apiLatency, eventLoopLag, memoryMB, dbResult, apiResult) {
        const warnings = [];
        const lagMs = parseFloat(eventLoopLag);
        const memoryThreshold = config.performance?.memoryThreshold || 512;
        
        if (responseTime > 2000) {
            warnings.push('• High bot response time detected');
        }
        
        if (apiLatency > 500) {
            warnings.push('• High Discord API latency detected');
        }
        
        if (lagMs > 50) {
            warnings.push('• High event loop lag detected');
        }
        
        if (parseFloat(memoryMB) > memoryThreshold * 0.8) {
            warnings.push('• Memory usage approaching threshold');
        }
        
        if (dbResult.status.includes('🔴') || dbResult.status.includes('🟡')) {
            warnings.push(`• Database issue: ${dbResult.error || 'Connection problem'}`);
        }
        
        if (apiResult.status.includes('🔴') || apiResult.status.includes('🟡')) {
            warnings.push(`• NeoProtect API issue: ${apiResult.error || 'Connection problem'}`);
        }
        
        return warnings;
    }
};