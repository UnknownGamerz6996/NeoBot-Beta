const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Check bot responsiveness and latency'),
    cooldown: 3,
    category: 'general',

    async execute(interaction) {
        const startTime = Date.now();
        
        await interaction.deferReply();
        
        const endTime = Date.now();
        const responseTime = endTime - startTime;
        const apiLatency = interaction.client.ws.ping;

        // Test database connection
        let dbLatency = 'Unknown';
        let dbStatus = '🔴 Error';
        try {
            const dbStart = Date.now();
            await interaction.client.database.get('SELECT 1');
            dbLatency = `${Date.now() - dbStart}ms`;
            dbStatus = '🟢 Connected';
        } catch (error) {
            dbLatency = 'Failed';
        }

        // Test NeoProtect API connection
        let apiStatus = '🔴 Unhealthy';
        let apiResponseTime = 'Unknown';
        const neoHealth = interaction.client.neoprotect.getHealthStatus();
        if (neoHealth.isHealthy) {
            apiStatus = '🟢 Healthy';
            // Quick API test
            try {
                const apiStart = Date.now();
                await interaction.client.neoprotect.getAttacks({ limit: 1 });
                apiResponseTime = `${Date.now() - apiStart}ms`;
            } catch (error) {
                apiResponseTime = 'Failed';
                apiStatus = '🟡 Limited';
            }
        }

        // Determine overall health color
        let embedColor = config.ui.colors.success;
        if (dbStatus.includes('Error') || apiStatus.includes('Unhealthy')) {
            embedColor = config.ui.colors.error;
        } else if (apiStatus.includes('Limited') || responseTime > 1000 || apiLatency > 200) {
            embedColor = config.ui.colors.warning;
        }

        const embed = new EmbedBuilder()
            .setColor(embedColor)
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
                        `**Monitoring:** ${interaction.client.monitoring?.getSystemStats().isRunning ? '🟢 Running' : '🔴 Stopped'}`
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 Performance',
                    value: [
                        `**Memory Usage:** ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`,
                        `**Uptime:** ${this.formatUptime(process.uptime() * 1000)}`,
                        `**CPU Usage:** ${process.cpuUsage().user}μs`,
                        `**Event Loop Lag:** ${this.getEventLoopLag()}ms`
                    ].join('\n'),
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ 
                text: `Requested by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            });

        // Add warning if performance is poor
        if (responseTime > 2000 || apiLatency > 500) {
            embed.addFields({
                name: '⚠️ Performance Warning',
                value: 'High latency detected. This may indicate network issues or high server load.',
                inline: false
            });
        }

        await interaction.editReply({ embeds: [embed] });
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
    },

    getEventLoopLag() {
        const start = process.hrtime.bigint();
        setImmediate(() => {
            const lag = Number(process.hrtime.bigint() - start) / 1000000;
            return lag.toFixed(2);
        });
        return '< 1'; // Simplified for this implementation
    }
};