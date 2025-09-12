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
        
        await interaction.deferReply();
        
        const responseTime = Date.now() - startTime;
        const apiLatency = Math.round(interaction.client.ws.ping);
        
        // Test database response time
        const dbStart = Date.now();
        let dbLatency = 'N/A';
        let dbStatus = '🔴 Error';
        
        try {
            if (interaction.client.database) {
                await interaction.client.database.testConnection();
                dbLatency = `${Date.now() - dbStart}ms`;
                dbStatus = '🟢 Connected';
            }
        } catch (error) {
            dbLatency = `${Date.now() - dbStart}ms (Error)`;
        }

        // Test NeoProtect API response time
        const apiStart = Date.now();
        let apiResponseTime = 'N/A';
        let apiStatus = '🔴 Error';
        
        try {
            if (interaction.client.neoprotect) {
                await interaction.client.neoprotect.testConnection();
                apiResponseTime = `${Date.now() - apiStart}ms`;
                apiStatus = '🟢 Connected';
            }
        } catch (error) {
            apiResponseTime = `${Date.now() - apiStart}ms (Error)`;
        }

        // Measure event loop lag properly
        const eventLoopLag = await this.measureEventLoopLag();

        // Get memory usage
        const memUsage = process.memoryUsage();
        const memoryMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);

        const embed = new EmbedBuilder()
            .setColor(this.getStatusColor(responseTime, apiLatency, eventLoopLag))
            .setTitle(`${config.ui.emojis.info} Pong! 🏓`)
            .setDescription('Bot responsiveness and system status')
            .addFields([
                {
                    name: '⚡ Response Times',
                    value: [
                        `**Bot Response:** ${responseTime}ms`,
                        `**Discord API:** ${apiLatency}ms`,
                        `**Database:** ${dbLatency}`,
                        `**NeoProtect API:** ${apiResponseTime}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🔗 Service Status',
                    value: [
                        `**Discord:** 🟢 Connected`,
                        `**Database:** ${dbStatus}`,
                        `**NeoProtect API:** ${apiStatus}`,
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
        const warnings = this.getPerformanceWarnings(responseTime, apiLatency, eventLoopLag, memoryMB);
        if (warnings.length > 0) {
            embed.addFields({
                name: '⚠️ Performance Warnings',
                value: warnings.join('\n'),
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
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
            if (client.monitoring && client.monitoring.isRunning) {
                return '🟢 Running';
            } else if (client.monitoring) {
                return '🔴 Stopped';
            } else {
                return '⚪ Not Available';
            }
        } catch (error) {
            return '🔴 Error';
        }
    },

    // Determine status color based on performance metrics
    getStatusColor(responseTime, apiLatency, eventLoopLag) {
        const lagMs = parseFloat(eventLoopLag);
        
        // Red if any critical performance issues
        if (responseTime > 3000 || apiLatency > 1000 || lagMs > 100) {
            return config.ui.colors.error;
        }
        
        // Yellow if moderate performance issues
        if (responseTime > 1500 || apiLatency > 500 || lagMs > 50) {
            return config.ui.colors.warning;
        }
        
        // Green if everything looks good
        return config.ui.colors.success;
    },

    // Get performance warnings
    getPerformanceWarnings(responseTime, apiLatency, eventLoopLag, memoryMB) {
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
        
        return warnings;
    }
};