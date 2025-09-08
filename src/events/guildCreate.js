const { EmbedBuilder } = require('discord.js');
const logger = require('../utils/logger');
const config = require('../../config');

module.exports = {
    name: 'guildCreate',
    once: false,
    async execute(guild, client) {
        logger.info(`Joined new guild: ${guild.name} (${guild.id}) with ${guild.memberCount} members`);

        try {
            // Initialize guild in database
            await client.database.createGuild(guild.id, guild.name);

            // Try to send welcome message to the first available text channel
            const channel = guild.channels.cache
                .filter(ch => ch.type === 0 && ch.permissionsFor(guild.members.me).has(['SendMessages', 'EmbedLinks']))
                .first();

            if (channel) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.primary)
                    .setTitle(`${config.ui.emojis.shield} Welcome to NeoProtect Bot!`)
                    .setDescription('Thank you for adding the NeoProtect Discord Bot to your server!')
                    .addFields([
                        {
                            name: '🚀 Getting Started',
                            value: [
                                '• Use `/help` to see all available commands',
                                '• Use `/monitor add` to start monitoring your first IP',
                                '• Use `/status` to check system health',
                                '• Set up proper permissions for your team'
                            ].join('\n'),
                            inline: false
                        },
                        {
                            name: '🔧 Permissions Needed',
                            value: [
                                '• **Send Messages** - To send alerts and responses',
                                '• **Embed Links** - To display rich embeds',
                                '• **Use Slash Commands** - For command functionality',
                                '• **Manage Channels** - For monitoring commands (optional)'
                            ].join('\n'),
                            inline: true
                        },
                        {
                            name: '📊 Features',
                            value: [
                                '• **Real-time monitoring** - Get instant DDoS alerts',
                                '• **Multiple IP tracking** - Monitor up to 10 IPs per server',
                                '• **Detailed analytics** - View attack statistics and trends',
                                '• **Customizable alerts** - Configure when and how you get notified'
                            ].join('\n'),
                            inline: true
                        },
                        {
                            name: '🆘 Need Help?',
                            value: [
                                '• Use `/help` for command assistance',
                                '• Check our documentation',
                                '• Contact server administrators',
                                '• Join our support server'
                            ].join('\n'),
                            inline: false
                        }
                    ])
                    .setThumbnail(client.user.displayAvatarURL())
                    .setTimestamp()
                    .setFooter({ 
                        text: 'NeoProtect Bot - Advanced DDoS Monitoring',
                        iconURL: client.user.displayAvatarURL()
                    });

                try {
                    await channel.send({ embeds: [embed] });
                    logger.info(`Sent welcome message to ${guild.name} in #${channel.name}`);
                } catch (error) {
                    logger.warn(`Failed to send welcome message to ${guild.name}`, error);
                }
            } else {
                logger.warn(`No suitable channel found for welcome message in ${guild.name}`);
            }

            // Record guild join metric
            await client.database.recordMetric('guild_joined', 1, {
                guildId: guild.id,
                guildName: guild.name,
                memberCount: guild.memberCount
            });

        } catch (error) {
            logger.error(`Failed to initialize new guild ${guild.id}`, error);
        }
    }
};