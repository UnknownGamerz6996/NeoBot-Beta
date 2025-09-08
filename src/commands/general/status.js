const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check overall system status and health'),
    cooldown: 10,
    category: 'general',

    async execute(interaction) {
        await interaction.deferReply();

        try {
            // Get comprehensive health check
            const healthCheck = await interaction.client.getHealthCheck();
            const botStats = interaction.client.getStats();
            const monitoringStats = interaction.client.monitoring.getSystemStats();

            // Determine overall status color
            let statusColor = config.ui.colors.success;
            let statusText = 'All Systems Operational';
            let statusEmoji = '🟢';

            if (healthCheck.status === 'unhealthy') {
                statusColor = config.ui.colors.error;
                statusText = 'System Issues Detected';
                statusEmoji = '🔴';
            } else if (healthCheck.status === 'degraded') {
                statusColor = config.ui.colors.warning;
                statusText = 'Degraded Performance';
                statusEmoji = '🟡';
            }

            const embed = new EmbedBuilder()
                .setColor(statusColor)
                .setTitle(`${statusEmoji} System Status`)
                .setDescription(`**${statusText}**\n${healthCheck.timestamp}`)
                .addFields([
                    {
                        name: '🤖 Bot Status',
                        value: [
                            `**Status:** ${botStats.isReady ? '🟢 Online' : '🔴 Offline'}`,
                            `**Guilds:** ${botStats.guilds}`,
                            `**Uptime:** ${this.formatUptime(botStats.uptime)}`,
                            `**Memory:** ${botStats.memoryUsage.toFixed(1)}MB`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '👁️ Monitoring System',
                        value: [
                            `**Status:** ${monitoringStats.isRunning ? '🟢 Running' : '🔴 Stopped'}`,
                            `**Total Checks:** ${monitoringStats.metrics.totalChecks.toLocaleString()}`,
                            `**Alerts Sent:** ${monitoringStats.metrics.alertsSent.toLocaleString()}`,
                            `**Queue:** ${monitoringStats.alertQueue} pending`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🔗 External Services',
                        value: [
                            `**Discord API:** ${healthCheck.services.discord?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.discord?.ping || 0}ms`,
                            `**Database:** ${healthCheck.services.database?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.database?.status}`,
                            `**NeoProtect API:** ${healthCheck.services.neoprotect?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.neoprotect?.status}`,
                            `**Monitoring:** ${healthCheck.services.monitoring?.status === 'healthy' ? '🟢' : '🔴'} ${healthCheck.services.monitoring?.status}`
                        ].join('\n'),
                        inline: false
                    }
                ])
                .setTimestamp();

            // Add performance metrics
            const performanceWarnings = [];
            
            if (botStats.memoryUsage > config.performance.memoryThreshold) {
                performanceWarnings.push(`High memory usage: ${botStats.memoryUsage.toFixed(1)}MB`);
            }
            
            if (botStats.ping > 1000) {
                performanceWarnings.push(`High Discord API latency: ${botStats.ping}ms`);
            }
            
            if (monitoringStats.metrics.errors > 10) {
                performanceWarnings.push(`Monitoring errors detected: ${monitoringStats.metrics.errors}`);
            }

            if (performanceWarnings.length > 0) {
                embed.addFields({
                    name: '⚠️ Performance Warnings',
                    value: performanceWarnings.map(w => `• ${w}`).join('\n'),
                    inline: false
                });
            }

            // Add recent activity summary
            try {
                const recentAttacks = await interaction.client.neoprotect.getAttacks({ limit: 100 });
                const last24h = recentAttacks.filter(attack => 
                    new Date(attack.startedAt) > new Date(Date.now() - 86400000)
                ).length;

                const monitorsCount = await interaction.client.database.all(
                    'SELECT COUNT(*) as count FROM monitored_ips WHERE is_active = TRUE'
                );
                const totalMonitors = monitorsCount[0]?.count || 0;

                embed.addFields({
                    name: '📊 Activity Summary (24h)',
                    value: [
                        `**Attacks Detected:** ${last24h}`,
                        `**Active Monitors:** ${totalMonitors}`,
                        `**Alerts Sent:** ${monitoringStats.metrics.alertsSent}`,
                        `**Commands Used:** ${botStats.commands.totalCommands || 0}`
                    ].join('\n'),
                    inline: true
                });
            } catch (error) {
                // Don't fail the entire command if activity summary fails
                embed.addFields({
                    name: '📊 Activity Summary',
                    value: 'Unable to retrieve activity data',
                    inline: true
                });
            }

            // Add version and build info
            embed.addFields({
                name: '📋 System Information',
                value: [
                    `**Bot Version:** 2.0.0`,
                    `**Node.js:** ${process.version}`,
                    `**Discord.js:** ${require('discord.js').version}`,
                    `**Platform:** ${process.platform} ${process.arch}`
                ].join('\n'),
                inline: true
            });

            // Add quick actions info
            embed.addFields({
                name: '🚀 Quick Actions',
                value: [
                    '• Use `/help` for command assistance',
                    '• Use `/monitor add` to start monitoring',
                    '• Use `/attacks` to view recent activity',
                    '• Use `/stats` for detailed metrics'
                ].join('\n'),
                inline: false
            });

            embed.setFooter({ 
                text: `Health check completed • Requested by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Status Check Failed`)
                .setDescription('Unable to retrieve complete system status')
                .addFields([
                    { name: 'Error', value: error.message, inline: false },
                    { name: 'Basic Status', value: `Bot is ${interaction.client.isReady ? 'online' : 'offline'}`, inline: false }
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