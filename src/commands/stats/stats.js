const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stats')
        .setDescription('View various statistics and metrics')
        .addSubcommand(subcommand =>
            subcommand
                .setName('bot')
                .setDescription('Show bot statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('monitoring')
                .setDescription('Show monitoring system statistics')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('attacks')
                .setDescription('Show attack statistics')
                .addStringOption(option =>
                    option.setName('timeframe')
                        .setDescription('Time period for statistics')
                        .addChoices(
                            { name: 'Last hour', value: '1h' },
                            { name: 'Last 6 hours', value: '6h' },
                            { name: 'Last 24 hours', value: '24h' },
                            { name: 'Last 7 days', value: '7d' },
                            { name: 'Last 30 days', value: '30d' }
                        )
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('api')
                .setDescription('Show API usage statistics')
        ),
    guildOnly: true,
    cooldown: 10,
    category: 'stats',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'bot':
                await this.handleBotStats(interaction);
                break;
            case 'monitoring':
                await this.handleMonitoringStats(interaction);
                break;
            case 'attacks':
                await this.handleAttackStats(interaction);
                break;
            case 'api':
                await this.handleApiStats(interaction);
                break;
        }
    },

    async handleBotStats(interaction) {
        await interaction.deferReply();

        try {
            const botStats = interaction.client.getStats();
            const uptime = this.formatUptime(botStats.uptime);
            const memoryUsage = botStats.memoryUsage.toFixed(2);

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.primary)
                .setTitle(`${config.ui.emojis.stats} Bot Statistics`)
                .setDescription('Current bot performance and usage statistics')
                .addFields([
                    {
                        name: '🤖 Bot Information',
                        value: [
                            `**Status:** ${botStats.isReady ? '🟢 Online' : '🔴 Offline'}`,
                            `**Uptime:** ${uptime}`,
                            `**Ping:** ${botStats.ping}ms`,
                            `**Memory Usage:** ${memoryUsage}MB`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Discord Stats',
                        value: [
                            `**Guilds:** ${botStats.guilds.toLocaleString()}`,
                            `**Users:** ${botStats.users.toLocaleString()}`,
                            `**Channels:** ${botStats.channels.toLocaleString()}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⚡ Commands',
                        value: [
                            `**Total Commands:** ${botStats.commands.totalCommands || 0}`,
                            `**Categories:** ${botStats.commands.categories || 0}`,
                            `**Active Cooldowns:** ${botStats.commands.activeCooldowns || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎭 Events',
                        value: [
                            `**Total Events:** ${botStats.events.totalEvents || 0}`,
                            `**Once Events:** ${botStats.events.onceEvents || 0}`,
                            `**Normal Events:** ${botStats.events.normalEvents || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👁️ Monitoring',
                        value: [
                            `**System Status:** ${botStats.monitoring.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Alert Queue:** ${botStats.monitoring.alertQueue || 0}`,
                            `**Active Cooldowns:** ${botStats.monitoring.activeCooldowns || 0}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🔗 NeoProtect API',
                        value: [
                            `**Status:** ${botStats.monitoring.neoprotectHealth?.isHealthy ? '🟢 Healthy' : '🔴 Unhealthy'}`,
                            `**Cache Size:** ${botStats.monitoring.neoprotectHealth?.cacheSize || 0}`,
                            `**Queue Length:** ${botStats.monitoring.neoprotectHealth?.queueLength || 0}`
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
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve bot statistics')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleMonitoringStats(interaction) {
        await interaction.deferReply();

        try {
            const monitoringStats = interaction.client.monitoring.getSystemStats();
            const guildMonitors = await interaction.client.database.getMonitoredIPs(interaction.guildId);
            
            // Get recent metrics
            const recentAlerts = await interaction.client.database.getMetrics('alerts_sent', 24);
            const recentErrors = await interaction.client.database.getMetrics('monitoring_errors', 24);
            const checkDurations = await interaction.client.database.getMetrics('monitoring_check_duration', 1);

            const avgCheckDuration = checkDurations.length > 0 ? 
                checkDurations.reduce((sum, m) => sum + m.metric_value, 0) / checkDurations.length : 0;

            const embed = new EmbedBuilder()
                .setColor(monitoringStats.isRunning ? config.ui.colors.success : config.ui.colors.error)
                .setTitle(`${config.ui.emojis.monitor} Monitoring Statistics`)
                .setDescription('Real-time monitoring system performance')
                .addFields([
                    {
                        name: '🟢 System Status',
                        value: [
                            `**Status:** ${monitoringStats.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Total Checks:** ${monitoringStats.metrics.totalChecks.toLocaleString()}`,
                            `**Alerts Sent:** ${monitoringStats.metrics.alertsSent.toLocaleString()}`,
                            `**Error Count:** ${monitoringStats.metrics.errors.toLocaleString()}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '⚡ Performance',
                        value: [
                            `**Avg Check Time:** ${monitoringStats.metrics.avgCheckDuration.toFixed(0)}ms`,
                            `**Last Check Time:** ${monitoringStats.metrics.lastCheckDuration}ms`,
                            `**Current Avg:** ${avgCheckDuration.toFixed(0)}ms`,
                            `**Alert Queue:** ${monitoringStats.alertQueue}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📋 This Server',
                        value: [
                            `**Monitored IPs:** ${guildMonitors.length}`,
                            `**Active Monitors:** ${guildMonitors.filter(m => m.is_active).length}`,
                            `**Active Cooldowns:** ${monitoringStats.activeCooldowns}`,
                            `**Max Allowed:** ${config.monitoring.maxMonitorsPerGuild}`
                        ].join('\n'),
                        inline: true
                    }
                ])
                .setTimestamp();

            // Add recent activity
            if (recentAlerts.length > 0 || recentErrors.length > 0) {
                const alertsLast24h = recentAlerts.length;
                const errorsLast24h = recentErrors.length;

                embed.addFields({
                    name: '📈 Last 24 Hours',
                    value: [
                        `**Alerts Sent:** ${alertsLast24h}`,
                        `**Errors:** ${errorsLast24h}`,
                        `**Success Rate:** ${errorsLast24h > 0 ? ((alertsLast24h / (alertsLast24h + errorsLast24h)) * 100).toFixed(1) : '100.0'}%`
                    ].join('\n'),
                    inline: true
                });
            }

            // Add configuration info
            embed.addFields({
                name: '⚙️ Configuration',
                value: [
                    `**Check Interval:** ${config.monitoring.interval / 1000}s`,
                    `**Alert Cooldown:** ${config.monitoring.alertCooldown / 60000}m`,
                    `**Cache Timeout:** ${config.monitoring.cacheTimeout / 60000}m`
                ].join('\n'),
                inline: true
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve monitoring statistics')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleAttackStats(interaction) {
        const timeframe = interaction.options.getString('timeframe') || '24h';

        await interaction.deferReply();

        try {
            const attacks = await interaction.client.neoprotect.getAttacks({ limit: 1000 });
            
            // Filter by timeframe
            const timeframeMs = this.parseTimeframe(timeframe);
            const cutoffTime = new Date(Date.now() - timeframeMs);
            const filteredAttacks = attacks.filter(attack => 
                new Date(attack.startedAt) > cutoffTime
            );

            if (filteredAttacks.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.success)
                    .setTitle(`${config.ui.emojis.success} No Attacks`)
                    .setDescription(`No attacks detected in the ${timeframe}`)
                    .addFields([
                        { name: '🛡️ All Clear', value: 'No DDoS attacks have been detected in the specified timeframe.', inline: false }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // Calculate statistics
            const totalAttacks = filteredAttacks.length;
            const ongoingAttacks = filteredAttacks.filter(a => !a.endedAt).length;
            const uniqueTargets = new Set(filteredAttacks.map(a => a.dstAddress?.ipv4)).size;
            
            const bpsValues = filteredAttacks.map(a => a.signatures?.[0]?.bpsPeak || 0);
            const ppsValues = filteredAttacks.map(a => a.signatures?.[0]?.ppsPeak || 0);
            
            const maxBPS = Math.max(...bpsValues);
            const avgBPS = bpsValues.reduce((sum, val) => sum + val, 0) / bpsValues.length;
            const maxPPS = Math.max(...ppsValues);
            const avgPPS = ppsValues.reduce((sum, val) => sum + val, 0) / ppsValues.length;

            // Attack types distribution
            const attackTypes = {};
            filteredAttacks.forEach(attack => {
                const type = attack.signatures?.[0]?.name || 'Unknown';
                attackTypes[type] = (attackTypes[type] || 0) + 1;
            });

            const topAttackTypes = Object.entries(attackTypes)
                .sort(([,a], [,b]) => b - a)
                .slice(0, 5)
                .map(([type, count]) => `**${type}:** ${count}`)
                .join('\n');

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.warning)
                .setTitle(`${config.ui.emojis.attack} Attack Statistics`)
                .setDescription(`Attack analysis for the ${timeframe}`)
                .addFields([
                    {
                        name: '📊 Overview',
                        value: [
                            `**Total Attacks:** ${totalAttacks}`,
                            `**Ongoing:** ${ongoingAttacks}`,
                            `**Unique Targets:** ${uniqueTargets}`,
                            `**Attacks/Hour:** ${(totalAttacks / (timeframeMs / 3600000)).toFixed(1)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📈 Traffic Volume',
                        value: [
                            `**Max BPS:** ${interaction.client.neoprotect.formatBytes(maxBPS)}`,
                            `**Avg BPS:** ${interaction.client.neoprotect.formatBytes(avgBPS)}`,
                            `**Max PPS:** ${interaction.client.neoprotect.formatNumber(maxPPS)}`,
                            `**Avg PPS:** ${interaction.client.neoprotect.formatNumber(avgPPS)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎯 Top Attack Types',
                        value: topAttackTypes || 'No data',
                        inline: false
                    }
                ])
                .setTimestamp();

            // Add severity distribution
            const severities = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
            filteredAttacks.forEach(attack => {
                const severity = this.calculateSeverity(attack);
                severities[severity]++;
            });

            const severityText = [
                `🟢 **Minimal:** ${severities[1]}`,
                `🟡 **Low:** ${severities[2]}`,
                `🟠 **Medium:** ${severities[3]}`,
                `🔴 **High:** ${severities[4]}`,
                `🟣 **Critical:** ${severities[5]}`
            ].join('\n');

            embed.addFields({
                name: '⚠️ Severity Distribution',
                value: severityText,
                inline: true
            });

            // Add timeline info
            if (filteredAttacks.length > 0) {
                const firstAttack = filteredAttacks.reduce((min, attack) => 
                    new Date(attack.startedAt) < new Date(min.startedAt) ? attack : min
                );
                const lastAttack = filteredAttacks.reduce((max, attack) => 
                    new Date(attack.startedAt) > new Date(max.startedAt) ? attack : max
                );

                embed.addFields({
                    name: '⏰ Timeline',
                    value: [
                        `**First Attack:** <t:${Math.floor(new Date(firstAttack.startedAt).getTime() / 1000)}:R>`,
                        `**Latest Attack:** <t:${Math.floor(new Date(lastAttack.startedAt).getTime() / 1000)}:R>`,
                        `**Timeframe:** ${timeframe}`
                    ].join('\n'),
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve attack statistics')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleApiStats(interaction) {
        await interaction.deferReply();

        try {
            const apiStats = await interaction.client.neoprotect.getApiStats();
            const neoHealth = interaction.client.neoprotect.getHealthStatus();

            const embed = new EmbedBuilder()
                .setColor(neoHealth.isHealthy ? config.ui.colors.success : config.ui.colors.error)
                .setTitle(`${config.ui.emojis.stats} API Statistics`)
                .setDescription('NeoProtect API usage and performance metrics')
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
                        name: '📊 Usage (24h)',
                        value: apiStats.length > 0 ? 
                            apiStats.map(stat => 
                                `**${stat.endpoint}:** ${stat.requests} req (${stat.avg_response_time.toFixed(0)}ms avg)`
                            ).slice(0, 5).join('\n') :
                            'No recent usage data',
                        inline: false
                    }
                ])
                .setTimestamp();

            if (apiStats.length > 0) {
                const totalRequests = apiStats.reduce((sum, stat) => sum + stat.requests, 0);
                const totalErrors = apiStats.reduce((sum, stat) => sum + stat.errors, 0);
                const avgResponseTime = apiStats.reduce((sum, stat) => sum + stat.avg_response_time, 0) / apiStats.length;

                embed.addFields({
                    name: '📈 Summary',
                    value: [
                        `**Total Requests:** ${totalRequests}`,
                        `**Total Errors:** ${totalErrors}`,
                        `**Success Rate:** ${((totalRequests - totalErrors) / totalRequests * 100).toFixed(1)}%`,
                        `**Avg Response:** ${avgResponseTime.toFixed(0)}ms`
                    ].join('\n'),
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve API statistics')
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
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    },

    parseTimeframe(timeframe) {
        const timeframes = {
            '1h': 3600000,
            '6h': 21600000,
            '24h': 86400000,
            '7d': 604800000,
            '30d': 2592000000
        };
        return timeframes[timeframe] || timeframes['24h'];
    },

    calculateSeverity(attack) {
        const bps = attack.signatures?.[0]?.bpsPeak || 0;
        const pps = attack.signatures?.[0]?.ppsPeak || 0;
        
        if (bps > 50000000000 || pps > 5000000) return 5;
        if (bps > 10000000000 || pps > 1000000) return 4;
        if (bps > 1000000000 || pps > 100000) return 3;
        if (bps > 100000000 || pps > 10000) return 2;
        return 1;
    }
};