const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('admin')
        .setDescription('Administrative bot management commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('reload')
                .setDescription('Reload bot components')
                .addStringOption(option =>
                    option.setName('component')
                        .setDescription('Component to reload')
                        .addChoices(
                            { name: 'Commands', value: 'commands' },
                            { name: 'Events', value: 'events' },
                            { name: 'All', value: 'all' }
                        )
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('backup')
                .setDescription('Create a database backup')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('health')
                .setDescription('Detailed system health check')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('cache')
                .setDescription('Manage bot cache')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Cache action to perform')
                        .addChoices(
                            { name: 'Clear', value: 'clear' },
                            { name: 'Stats', value: 'stats' },
                            { name: 'Cleanup', value: 'cleanup' }
                        )
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('monitoring')
                .setDescription('Control monitoring system')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Monitoring action')
                        .addChoices(
                            { name: 'Start', value: 'start' },
                            { name: 'Stop', value: 'stop' },
                            { name: 'Restart', value: 'restart' },
                            { name: 'Status', value: 'status' }
                        )
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('database')
                .setDescription('Database management')
                .addStringOption(option =>
                    option.setName('action')
                        .setDescription('Database action')
                        .addChoices(
                            { name: 'Vacuum', value: 'vacuum' },
                            { name: 'Stats', value: 'stats' },
                            { name: 'Cleanup', value: 'cleanup' }
                        )
                        .setRequired(true))
        ),
    permissions: [PermissionFlagsBits.Administrator],
    customPermissions: ['admin'],
    guildOnly: true,
    cooldown: 30,
    category: 'admin',

    async execute(interaction) {
        // Additional admin check
        if (!config.security.adminUserIds.includes(interaction.user.id)) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Access Denied`)
                .setDescription('You do not have permission to use administrative commands.')
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'reload':
                await this.handleReload(interaction);
                break;
            case 'backup':
                await this.handleBackup(interaction);
                break;
            case 'health':
                await this.handleHealth(interaction);
                break;
            case 'cache':
                await this.handleCache(interaction);
                break;
            case 'monitoring':
                await this.handleMonitoring(interaction);
                break;
            case 'database':
                await this.handleDatabase(interaction);
                break;
        }
    },

    async handleReload(interaction) {
        const component = interaction.options.getString('component');

        await interaction.deferReply();

        try {
            let reloadedComponents = [];

            if (component === 'commands' || component === 'all') {
                await interaction.client.reloadCommands();
                reloadedComponents.push('Commands');
            }

            if (component === 'events' || component === 'all') {
                await interaction.client.reloadEvents();
                reloadedComponents.push('Events');
            }

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Reload Successful`)
                .setDescription(`Successfully reloaded: **${reloadedComponents.join(', ')}**`)
                .addFields([
                    { 
                        name: '⚡ Status', 
                        value: 'All components have been reloaded and are functioning normally.',
                        inline: false 
                    },
                    {
                        name: '🔄 Next Steps',
                        value: '• Test commands to ensure they work properly\n• Monitor logs for any errors\n• Check system status with `/status`',
                        inline: false
                    }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Reload Failed`)
                .setDescription('Failed to reload components')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleBackup(interaction) {
        await interaction.deferReply();

        try {
            const backupPath = await interaction.client.database.createBackup();
            const stats = await interaction.client.database.getTableSizes();

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Backup Created`)
                .setDescription('Database backup completed successfully')
                .addFields([
                    { 
                        name: '📁 Backup Location', 
                        value: `\`${backupPath}\``,
                        inline: false 
                    },
                    {
                        name: '📊 Database Statistics',
                        value: Object.entries(stats)
                            .map(([table, count]) => `**${table}:** ${count.toLocaleString()} records`)
                            .join('\n'),
                        inline: false
                    },
                    {
                        name: '⏰ Backup Time',
                        value: `<t:${Math.floor(Date.now() / 1000)}:f>`,
                        inline: true
                    }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Backup Failed`)
                .setDescription('Failed to create database backup')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleHealth(interaction) {
        await interaction.deferReply();

        try {
            const healthCheck = await interaction.client.getHealthCheck();
            const botStats = interaction.client.getStats();
            const monitoringStats = interaction.client.monitoring.getSystemStats();
            const neoHealth = interaction.client.neoprotect.getHealthStatus();

            // Determine overall health color
            let healthColor = config.ui.colors.success;
            if (healthCheck.status === 'unhealthy') {
                healthColor = config.ui.colors.error;
            } else if (healthCheck.status === 'degraded') {
                healthColor = config.ui.colors.warning;
            }

            const embed = new EmbedBuilder()
                .setColor(healthColor)
                .setTitle(`${config.ui.emojis.stats} Detailed Health Check`)
                .setDescription(`**Overall Status:** ${healthCheck.status.toUpperCase()}`)
                .addFields([
                    {
                        name: '🤖 Bot Health',
                        value: [
                            `**Status:** ${botStats.isReady ? '🟢 Ready' : '🔴 Not Ready'}`,
                            `**Uptime:** ${this.formatUptime(botStats.uptime)}`,
                            `**Memory:** ${botStats.memoryUsage.toFixed(2)}MB / ${config.performance.memoryThreshold}MB`,
                            `**Ping:** ${botStats.ping}ms`,
                            `**Guilds:** ${botStats.guilds}`,
                            `**Commands:** ${botStats.commands.totalCommands || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🔗 External Services',
                        value: [
                            `**Discord API:** ${healthCheck.services.discord?.status === 'healthy' ? '🟢' : '🔴'} (${healthCheck.services.discord?.ping}ms)`,
                            `**Database:** ${healthCheck.services.database?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.database?.status}`,
                            `**NeoProtect API:** ${healthCheck.services.neoprotect?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.neoprotect?.status}`,
                            `**Cache Size:** ${neoHealth.cacheSize} items`,
                            `**Queue Length:** ${neoHealth.queueLength} requests`,
                            `**Last API Check:** ${neoHealth.lastHealthCheck ? `<t:${Math.floor(neoHealth.lastHealthCheck.getTime() / 1000)}:R>` : 'Never'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👁️ Monitoring System',
                        value: [
                            `**Status:** ${monitoringStats.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Total Checks:** ${monitoringStats.metrics.totalChecks.toLocaleString()}`,
                            `**Alerts Sent:** ${monitoringStats.metrics.alertsSent.toLocaleString()}`,
                            `**Errors:** ${monitoringStats.metrics.errors.toLocaleString()}`,
                            `**Success Rate:** ${monitoringStats.metrics.totalChecks > 0 ? (((monitoringStats.metrics.totalChecks - monitoringStats.metrics.errors) / monitoringStats.metrics.totalChecks) * 100).toFixed(1) : '100.0'}%`,
                            `**Avg Check Time:** ${monitoringStats.metrics.avgCheckDuration.toFixed(0)}ms`,
                            `**Alert Queue:** ${monitoringStats.alertQueue} pending`
                        ].join('\n'),
                        inline: false
                    }
                ])
                .setTimestamp();

            // Add performance warnings
            const warnings = [];
            if (botStats.memoryUsage > config.performance.memoryThreshold * 0.8) {
                warnings.push(`Memory usage approaching limit: ${botStats.memoryUsage.toFixed(2)}MB`);
            }
            if (botStats.ping > 1000) {
                warnings.push(`High Discord API latency: ${botStats.ping}ms`);
            }
            if (monitoringStats.metrics.errors > 5) {
                warnings.push(`Monitoring errors detected: ${monitoringStats.metrics.errors}`);
            }
            if (!neoHealth.isHealthy) {
                warnings.push('NeoProtect API is unhealthy');
            }

            if (warnings.length > 0) {
                embed.addFields({
                    name: '⚠️ Health Warnings',
                    value: warnings.map(w => `• ${w}`).join('\n'),
                    inline: false
                });
            }

            // Add recommendations
            const recommendations = [];
            if (botStats.memoryUsage > config.performance.memoryThreshold * 0.9) {
                recommendations.push('Consider restarting the bot to free memory');
            }
            if (monitoringStats.metrics.errors > 10) {
                recommendations.push('Check monitoring system configuration');
            }
            if (!neoHealth.isHealthy) {
                recommendations.push('Verify NeoProtect API credentials and connectivity');
            }

            if (recommendations.length > 0) {
                embed.addFields({
                    name: '💡 Recommendations',
                    value: recommendations.map(r => `• ${r}`).join('\n'),
                    inline: false
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Health Check Failed`)
                .setDescription('Failed to perform detailed health check')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleCache(interaction) {
        const action = interaction.options.getString('action');

        await interaction.deferReply();

        try {
            switch (action) {
                case 'clear':
                    interaction.client.neoprotect.clearCache();
                    await interaction.client.database.clearExpiredCache();
                    
                    const embed = new EmbedBuilder()
                        .setColor(config.ui.colors.success)
                        .setTitle(`${config.ui.emojis.success} Cache Cleared`)
                        .setDescription('All caches have been cleared successfully')
                        .addFields([
                            { name: '🗑️ Actions Performed', value: '• NeoProtect API cache cleared\n• Database cache cleaned\n• Expired entries removed', inline: false }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [embed] });
                    break;

                case 'stats':
                    const neoHealth = interaction.client.neoprotect.getHealthStatus();
                    const cacheStats = await interaction.client.database.all('SELECT COUNT(*) as count FROM settings_cache');
                    
                    const statsEmbed = new EmbedBuilder()
                        .setColor(config.ui.colors.info)
                        .setTitle(`${config.ui.emojis.stats} Cache Statistics`)
                        .setDescription('Current cache usage and performance')
                        .addFields([
                            {
                                name: '📊 Cache Sizes',
                                value: [
                                    `**NeoProtect API:** ${neoHealth.cacheSize} items`,
                                    `**Database Cache:** ${cacheStats[0]?.count || 0} items`,
                                    `**Request Queue:** ${neoHealth.queueLength} pending`
                                ].join('\n'),
                                inline: true
                            },
                            {
                                name: '⚙️ Configuration',
                                value: [
                                    `**Cache Timeout:** ${config.monitoring.cacheTimeout / 60000}m`,
                                    `**Max Concurrent:** ${config.performance.maxConcurrentRequests}`,
                                    `**Auto Cleanup:** ${config.features.autoBackup ? 'Enabled' : 'Disabled'}`
                                ].join('\n'),
                                inline: true
                            }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [statsEmbed] });
                    break;

                case 'cleanup':
                    await interaction.client.database.clearExpiredCache();
                    
                    const cleanupEmbed = new EmbedBuilder()
                        .setColor(config.ui.colors.success)
                        .setTitle(`${config.ui.emojis.success} Cache Cleanup Complete`)
                        .setDescription('Expired cache entries have been removed')
                        .setTimestamp();

                    await interaction.editReply({ embeds: [cleanupEmbed] });
                    break;
            }

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Cache Operation Failed`)
                .setDescription(`Failed to ${action} cache`)
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleMonitoring(interaction) {
        const action = interaction.options.getString('action');

        await interaction.deferReply();

        try {
            const monitoring = interaction.client.monitoring;
            
            switch (action) {
                case 'start':
                    if (monitoring.getSystemStats().isRunning) {
                        throw new Error('Monitoring system is already running');
                    }
                    monitoring.start();
                    break;

                case 'stop':
                    if (!monitoring.getSystemStats().isRunning) {
                        throw new Error('Monitoring system is already stopped');
                    }
                    monitoring.stop();
                    break;

                case 'restart':
                    monitoring.stop();
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
                    monitoring.start();
                    break;

                case 'status':
                    const stats = monitoring.getSystemStats();
                    const statusEmbed = new EmbedBuilder()
                        .setColor(stats.isRunning ? config.ui.colors.success : config.ui.colors.error)
                        .setTitle(`${config.ui.emojis.monitor} Monitoring System Status`)
                        .setDescription(`**Status:** ${stats.isRunning ? '🟢 Running' : '🔴 Stopped'}`)
                        .addFields([
                            {
                                name: '📊 Metrics',
                                value: [
                                    `**Total Checks:** ${stats.metrics.totalChecks.toLocaleString()}`,
                                    `**Alerts Sent:** ${stats.metrics.alertsSent.toLocaleString()}`,
                                    `**Errors:** ${stats.metrics.errors.toLocaleString()}`,
                                    `**Avg Check Time:** ${stats.metrics.avgCheckDuration.toFixed(0)}ms`
                                ].join('\n'),
                                inline: true
                            },
                            {
                                name: '🔄 Current State',
                                value: [
                                    `**Alert Queue:** ${stats.alertQueue}`,
                                    `**Active Cooldowns:** ${stats.activeCooldowns}`,
                                    `**Last Check:** ${stats.metrics.lastCheckDuration}ms`,
                                    `**API Health:** ${stats.neoprotectHealth?.isHealthy ? '🟢' : '🔴'}`
                                ].join('\n'),
                                inline: true
                            }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [statusEmbed] });
                    return;
            }

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Monitoring ${action.charAt(0).toUpperCase() + action.slice(1)}ed`)
                .setDescription(`Monitoring system has been ${action}ed successfully`)
                .addFields([
                    { 
                        name: '📊 Current Status', 
                        value: `**Running:** ${monitoring.getSystemStats().isRunning ? 'Yes' : 'No'}`,
                        inline: true 
                    }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Monitoring Operation Failed`)
                .setDescription(`Failed to ${action} monitoring system`)
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleDatabase(interaction) {
        const action = interaction.options.getString('action');

        await interaction.deferReply();

        try {
            switch (action) {
                case 'vacuum':
                    await interaction.client.database.vacuum();
                    
                    const vacuumEmbed = new EmbedBuilder()
                        .setColor(config.ui.colors.success)
                        .setTitle(`${config.ui.emojis.success} Database Vacuumed`)
                        .setDescription('Database has been optimized successfully')
                        .addFields([
                            { name: '🔧 Operation', value: 'VACUUM command executed to optimize database storage and performance', inline: false }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [vacuumEmbed] });
                    break;

                case 'stats':
                    const tableSizes = await interaction.client.database.getTableSizes();
                    
                    const statsEmbed = new EmbedBuilder()
                        .setColor(config.ui.colors.info)
                        .setTitle(`${config.ui.emojis.stats} Database Statistics`)
                        .setDescription('Current database size and record counts')
                        .addFields([
                            {
                                name: '📊 Table Sizes',
                                value: Object.entries(tableSizes)
                                    .map(([table, count]) => `**${table}:** ${count.toLocaleString()} records`)
                                    .join('\n'),
                                inline: false
                            },
                            {
                                name: '💾 Storage Info',
                                value: [
                                    `**Database Path:** \`${config.database.path}\``,
                                    `**Auto Backup:** ${config.features.autoBackup ? 'Enabled' : 'Disabled'}`,
                                    `**Total Records:** ${Object.values(tableSizes).reduce((sum, count) => sum + count, 0).toLocaleString()}`
                                ].join('\n'),
                                inline: false
                            }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [statsEmbed] });
                    break;

                case 'cleanup':
                    // Perform database cleanup
                    await interaction.client.database.run('DELETE FROM api_usage WHERE timestamp < datetime(\'now\', \'-30 days\')');
                    await interaction.client.database.run('DELETE FROM alert_logs WHERE sent_at < datetime(\'now\', \'-90 days\')');
                    await interaction.client.database.run('DELETE FROM bot_stats WHERE timestamp < datetime(\'now\', \'-7 days\')');
                    await interaction.client.database.clearExpiredCache();
                    
                    const cleanupEmbed = new EmbedBuilder()
                        .setColor(config.ui.colors.success)
                        .setTitle(`${config.ui.emojis.success} Database Cleanup Complete`)
                        .setDescription('Old records have been cleaned up')
                        .addFields([
                            {
                                name: '🗑️ Cleanup Actions',
                                value: [
                                    '• Removed API usage logs older than 30 days',
                                    '• Removed alert logs older than 90 days',
                                    '• Removed bot stats older than 7 days',
                                    '• Cleared expired cache entries'
                                ].join('\n'),
                                inline: false
                            }
                        ])
                        .setTimestamp();

                    await interaction.editReply({ embeds: [cleanupEmbed] });
                    break;
            }

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Database Operation Failed`)
                .setDescription(`Failed to ${action} database`)
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    formatUptime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);

        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
};