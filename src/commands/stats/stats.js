const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View bot and system statistics')
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Type of statistics to view')
                .setRequired(false)
                .addChoices(
                    { name: 'Bot Statistics', value: 'bot' },
                    { name: 'API Statistics', value: 'api' },
                    { name: 'Monitoring Statistics', value: 'monitoring' },
                    { name: 'Attack Statistics', value: 'attacks' }
                )
        )
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Timeframe for statistics')
                .setRequired(false)
                .addChoices(
                    { name: 'Last 1 Hour', value: '1h' },
                    { name: 'Last 24 Hours', value: '24h' },
                    { name: 'Last 7 Days', value: '7d' },
                    { name: 'Last 30 Days', value: '30d' }
                )
        ),
    cooldown: 10,
    category: 'stats',

    async execute(interaction) {
        const type = interaction.options.getString('type') || 'bot';
        const timeframe = interaction.options.getString('timeframe') || '24h';

        await interaction.deferReply();

        try {
            switch (type) {
                case 'bot':
                    await this.handleBotStats(interaction, timeframe);
                    break;
                case 'api':
                    await this.handleApiStats(interaction, timeframe);
                    break;
                case 'monitoring':
                    await this.handleMonitoringStats(interaction, timeframe);
                    break;
                case 'attacks':
                    await this.handleAttackStats(interaction, timeframe);
                    break;
                default:
                    await this.handleBotStats(interaction, timeframe);
            }
        } catch (error) {
            console.error('Stats command error:', error);
            
            const errorEmbed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve statistics')
                .addFields([
                    { name: 'Error Details', value: error.message || 'Unknown error', inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [errorEmbed] });
        }
    },

    async handleBotStats(interaction, timeframe) {
        try {
            const client = interaction.client;
            const uptime = process.uptime() * 1000;
            const memoryUsage = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);

            // Get command handler stats if available
            const commandStats = client.commandHandler?.getStats() || {
                totalCommands: 0,
                commandNames: []
            };

            // Get event handler stats if available  
            const eventStats = client.eventHandler?.getStats() || {
                totalEvents: 0,
                onceEvents: 0,
                normalEvents: 0
            };

            // Get monitoring stats if available
            const monitoringStats = client.monitoring?.getSystemStats() || {
                isRunning: false,
                alertQueue: 0,
                activeCooldowns: 0
            };

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.stats} Bot Statistics`)
                .setDescription(`System performance and usage metrics (${timeframe})`)
                .addFields([
                    {
                        name: '🤖 Bot Status',
                        value: [
                            `**Status:** 🟢 Online`,
                            `**Uptime:** ${this.formatUptime(uptime)}`,
                            `**Ping:** ${client.ws.ping}ms`,
                            `**Memory Usage:** ${memoryUsage}MB`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Discord Stats',
                        value: [
                            `**Guilds:** ${client.guilds.cache.size.toLocaleString()}`,
                            `**Users:** ${client.users.cache.size.toLocaleString()}`,
                            `**Channels:** ${client.channels.cache.size.toLocaleString()}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⚡ Commands',
                        value: [
                            `**Total Commands:** ${commandStats.totalCommands}`,
                            `**Available:** ${commandStats.commandNames.length}`,
                            `**Categories:** ${this.getUniqueCategories(commandStats.commandNames).length}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎭 Events',
                        value: [
                            `**Total Events:** ${eventStats.totalEvents}`,
                            `**Once Events:** ${eventStats.onceEvents}`,
                            `**Normal Events:** ${eventStats.normalEvents}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👁️ Monitoring',
                        value: [
                            `**Status:** ${monitoringStats.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Alert Queue:** ${monitoringStats.alertQueue || 0}`,
                            `**Active Monitors:** ${await this.getActiveMonitorsCount(client)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '💾 Database',
                        value: [
                            `**Type:** MongoDB`,
                            `**Status:** ${await this.getDatabaseStatus(client)}`,
                            `**Collections:** ${await this.getCollectionCount(client)}`
                        ].join('\n'),
                        inline: true
                    }
                ])
                .setTimestamp()
                .setFooter({ 
                    text: `Requested by ${interaction.user.username}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            throw new Error(`Failed to get bot statistics: ${error.message}`);
        }
    },

    async handleApiStats(interaction, timeframe) {
        try {
            const client = interaction.client;
            const hoursBack = this.getHoursFromTimeframe(timeframe);
            
            // Get API stats from database
            let apiStats = [];
            let summaryStats = {
                totalRequests: 0,
                totalErrors: 0,
                successRate: 100
            };

            try {
                if (client.database && typeof client.database.getApiStats === 'function') {
                    apiStats = await client.database.getApiStats(hoursBack);
                }
                
                if (client.database && typeof client.database.getSummaryStats === 'function') {
                    summaryStats = await client.database.getSummaryStats();
                }
            } catch (dbError) {
                console.warn('Could not get API stats from database:', dbError.message);
            }

            // Get NeoProtect health status
            let neoHealth = {
                isHealthy: false,
                lastHealthCheck: null,
                cacheSize: 0,
                queueLength: 0
            };

            try {
                if (client.neoprotect && typeof client.neoprotect.getHealthStatus === 'function') {
                    neoHealth = client.neoprotect.getHealthStatus();
                }
            } catch (neoError) {
                console.warn('Could not get NeoProtect health status:', neoError.message);
            }

            const embed = new EmbedBuilder()
                .setColor(neoHealth.isHealthy ? config.ui.colors.success : config.ui.colors.error)
                .setTitle(`${config.ui.emojis.stats} API Statistics`)
                .setDescription(`NeoProtect API usage and performance metrics (${timeframe})`)
                .addFields([
                    {
                        name: '🔗 Connection Status',
                        value: [
                            `**Status:** ${neoHealth.isHealthy ? '🟢 Healthy' : '🔴 Unhealthy'}`,
                            `**Last Check:** ${neoHealth.lastHealthCheck ? `<t:${Math.floor(neoHealth.lastHealthCheck.getTime() / 1000)}:R>` : 'Never'}`,
                            `**Cache Size:** ${neoHealth.cacheSize}`,
                            `**Queue Length:** ${neoHealth.queueLength}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: `📊 Usage (${timeframe})`,
                        value: apiStats.length > 0 ? 
                            apiStats.slice(0, 5).map(stat => 
                                `**${stat._id}:** ${stat.totalRequests} req (${stat.errors} errors)`
                            ).join('\n') || 'No API usage data available' :
                            'No API usage data available',
                        inline: true
                    },
                    {
                        name: '📈 Summary',
                        value: [
                            `**Total Requests:** ${summaryStats.totalRequests.toLocaleString()}`,
                            `**Total Errors:** ${summaryStats.totalErrors.toLocaleString()}`,
                            `**Success Rate:** ${summaryStats.successRate}%`,
                            `**Avg Response:** ${this.getAverageResponseTime(apiStats)}ms`
                        ].join('\n'),
                        inline: false
                    }
                ])
                .setTimestamp()
                .setFooter({ 
                    text: `Requested by ${interaction.user.username} • ${timeframe}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            throw new Error(`Failed to get API statistics: ${error.message}`);
        }
    },

    async handleMonitoringStats(interaction, timeframe) {
        try {
            const client = interaction.client;
            const hoursBack = this.getHoursFromTimeframe(timeframe);

            // Get monitoring system stats
            const monitoringStats = client.monitoring?.getSystemStats() || {
                isRunning: false,
                metrics: {
                    totalChecks: 0,
                    alertsSent: 0,
                    errors: 0,
                    avgCheckDuration: 0
                }
            };

            // Get guild monitors
            const guildMonitors = await this.getGuildMonitors(client, interaction.guildId);
            
            // Get recent metrics from database
            let recentAlerts = [];
            let recentErrors = [];
            
            try {
                if (client.database) {
                    recentAlerts = await client.database.getMetrics('alerts_sent', hoursBack) || [];
                    recentErrors = await client.database.getMetrics('monitoring_errors', hoursBack) || [];
                }
            } catch (dbError) {
                console.warn('Could not get metrics from database:', dbError.message);
            }

            const embed = new EmbedBuilder()
                .setColor(monitoringStats.isRunning ? config.ui.colors.success : config.ui.colors.error)
                .setTitle(`${config.ui.emojis.monitor} Monitoring Statistics`)
                .setDescription(`Real-time monitoring system performance (${timeframe})`)
                .addFields([
                    {
                        name: '🟢 System Status',
                        value: [
                            `**Status:** ${monitoringStats.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Total Checks:** ${monitoringStats.metrics.totalChecks.toLocaleString()}`,
                            `**Alerts Sent:** ${monitoringStats.metrics.alertsSent.toLocaleString()}`,
                            `**Errors:** ${monitoringStats.metrics.errors.toLocaleString()}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Performance',
                        value: [
                            `**Avg Check Time:** ${monitoringStats.metrics.avgCheckDuration.toFixed(0)}ms`,
                            `**Success Rate:** ${this.calculateSuccessRate(monitoringStats.metrics)}%`,
                            `**Queue Length:** ${monitoringStats.alertQueue || 0}`,
                            `**Active Cooldowns:** ${monitoringStats.activeCooldowns || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: `📈 Recent Activity (${timeframe})`,
                        value: [
                            `**Recent Alerts:** ${recentAlerts.length}`,
                            `**Recent Errors:** ${recentErrors.length}`,
                            `**Guild Monitors:** ${guildMonitors.length}`,
                            `**Total Active:** ${await this.getActiveMonitorsCount(client)}`
                        ].join('\n'),
                        inline: false
                    }
                ])
                .setTimestamp()
                .setFooter({ 
                    text: `Requested by ${interaction.user.username} • ${timeframe}`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            throw new Error(`Failed to get monitoring statistics: ${error.message}`);
        }
    },

    async handleAttackStats(interaction, timeframe) {
        try {
            const client = interaction.client;
            const hoursBack = this.getHoursFromTimeframe(timeframe);

            // Get attack history from database
            let attackHistory = [];
            
            try {
                if (client.database && typeof client.database.getMetrics === 'function') {
                    // This is a simplified version - you might want to create a specific method for attack stats
                    attackHistory = await client.database.getMetrics('attacks_detected', hoursBack) || [];
                }
            } catch (dbError) {
                console.warn('Could not get attack history from database:', dbError.message);
            }

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.warning)
                .setTitle(`${config.ui.emojis.attack} Attack Statistics`)
                .setDescription(`DDoS attack analytics and trends (${timeframe})`)
                .addFields([
                    {
                        name: '🚨 Attack Summary',
                        value: [
                            `**Total Attacks:** ${attackHistory.length}`,
                            `**Unique Targets:** N/A`,
                            `**Avg Duration:** N/A`,
                            `**Peak Intensity:** N/A`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Attack Types',
                        value: [
                            `**UDP Flood:** 0`,
                            `**TCP SYN:** 0`,
                            `**HTTP Flood:** 0`,
                            `**Other:** 0`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⚠️ Severity Distribution',
                        value: [
                            `🟢 **Low:** 0`,
                            `🟡 **Medium:** 0`,
                            `🟠 **High:** 0`,
                            `🔴 **Critical:** 0`
                        ].join('\n'),
                        inline: false
                    }
                ])
                .setTimestamp()
                .setFooter({ 
                    text: `Requested by ${interaction.user.username} • ${timeframe} • Limited data available`,
                    iconURL: interaction.user.displayAvatarURL()
                });

            // Add note about limited data
            embed.setDescription(embed.data.description + '\n\n*Note: Attack statistics are limited without historical attack data.*');

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            throw new Error(`Failed to get attack statistics: ${error.message}`);
        }
    },

    // Helper methods
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

    getHoursFromTimeframe(timeframe) {
        const map = {
            '1h': 1,
            '24h': 24,
            '7d': 168,
            '30d': 720
        };
        return map[timeframe] || 24;
    },

    getUniqueCategories(commandNames) {
        // This is a simplified version - you might want to track categories properly
        return ['general', 'monitoring', 'stats', 'admin'];
    },

    async getActiveMonitorsCount(client) {
        try {
            if (client.database && typeof client.database.getAllActiveMonitors === 'function') {
                const monitors = await client.database.getAllActiveMonitors();
                return monitors.length;
            }
        } catch (error) {
            console.warn('Could not get active monitors count:', error.message);
        }
        return 0;
    },

    async getGuildMonitors(client, guildId) {
        try {
            if (client.database && typeof client.database.getMonitoredIPs === 'function') {
                return await client.database.getMonitoredIPs(guildId);
            }
        } catch (error) {
            console.warn('Could not get guild monitors:', error.message);
        }
        return [];
    },

    async getDatabaseStatus(client) {
        try {
            if (client.database && typeof client.database.testConnection === 'function') {
                await client.database.testConnection();
                return '🟢 Connected';
            }
        } catch (error) {
            return '🔴 Error';
        }
        return '⚪ Unknown';
    },

    async getCollectionCount(client) {
        try {
            if (client.database && typeof client.database.getTableSizes === 'function') {
                const sizes = await client.database.getTableSizes();
                return Object.keys(sizes).length;
            }
        } catch (error) {
            console.warn('Could not get collection count:', error.message);
        }
        return 0;
    },

    getAverageResponseTime(apiStats) {
        if (!apiStats || apiStats.length === 0) return 0;
        const totalTime = apiStats.reduce((sum, stat) => sum + (stat.avgResponseTime || 0), 0);
        return (totalTime / apiStats.length).toFixed(0);
    },

    calculateSuccessRate(metrics) {
        const total = metrics.totalChecks || 0;
        const errors = metrics.errors || 0;
        if (total === 0) return 100;
        return ((total - errors) / total * 100).toFixed(1);
    }
};