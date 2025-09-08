const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('monitor')
        .setDescription('Manage IP monitoring')
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add an IP address to monitor')
                .addStringOption(option =>
                    option.setName('ip')
                        .setDescription('IP address to monitor')
                        .setRequired(true))
                .addStringOption(option =>
                    option.setName('alias')
                        .setDescription('Friendly name for this IP')
                        .setRequired(false))
                .addChannelOption(option =>
                    option.setName('channel')
                        .setDescription('Channel for alerts (defaults to current)')
                        .setRequired(false))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('remove')
                .setDescription('Stop monitoring an IP address')
                .addStringOption(option =>
                    option.setName('ip')
                        .setDescription('IP address to stop monitoring')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('List all monitored IPs')
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('test')
                .setDescription('Send a test alert for an IP')
                .addStringOption(option =>
                    option.setName('ip')
                        .setDescription('IP address to test')
                        .setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('status')
                .setDescription('Check monitoring status for an IP')
                .addStringOption(option =>
                    option.setName('ip')
                        .setDescription('IP address to check')
                        .setRequired(true))
        ),
    permissions: [PermissionFlagsBits.ManageChannels],
    guildOnly: true,
    cooldown: 5,
    category: 'monitoring',

    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        
        switch (subcommand) {
            case 'add':
                await this.handleAdd(interaction);
                break;
            case 'remove':
                await this.handleRemove(interaction);
                break;
            case 'list':
                await this.handleList(interaction);
                break;
            case 'test':
                await this.handleTest(interaction);
                break;
            case 'status':
                await this.handleStatus(interaction);
                break;
        }
    },

    async handleAdd(interaction) {
        const ip = interaction.options.getString('ip');
        const alias = interaction.options.getString('alias');
        const channel = interaction.options.getChannel('channel') || interaction.channel;

        await interaction.deferReply();

        try {
            // Validate IP format
            if (!interaction.client.neoprotect.isValidIP(ip)) {
                throw new Error('Invalid IP address format. Please provide a valid IPv4 or IPv6 address.');
            }

            // Check if bot has permissions in the target channel
            if (!channel.permissionsFor(interaction.guild.members.me).has([PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) {
                throw new Error(`I don't have permission to send messages in ${channel}. Please ensure I have Send Messages and Embed Links permissions.`);
            }

            await interaction.client.monitoring.addMonitor(
                interaction.guildId,
                channel.id,
                ip,
                alias,
                interaction.user.id
            );

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Monitor Added`)
                .setDescription(`Successfully added IP monitoring for **${alias || ip}**`)
                .addFields([
                    { name: '🎯 IP Address', value: `\`${ip}\``, inline: true },
                    { name: '📺 Alert Channel', value: channel.toString(), inline: true },
                    { name: '👤 Added By', value: interaction.user.toString(), inline: true },
                    { name: '🔄 Check Interval', value: `${config.monitoring.interval / 1000} seconds`, inline: true },
                    { name: '⏰ Alert Cooldown', value: `${config.monitoring.alertCooldown / 60000} minutes`, inline: true },
                    { name: '📋 Alias', value: alias || 'None', inline: true }
                ])
                .setTimestamp()
                .setFooter({ text: 'Monitoring will begin immediately' });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Failed to Add Monitor`)
                .setDescription(error.message)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleRemove(interaction) {
        const ip = interaction.options.getString('ip');

        await interaction.deferReply();

        try {
            await interaction.client.monitoring.removeMonitor(interaction.guildId, ip);

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Monitor Removed`)
                .setDescription(`Successfully removed monitoring for **${ip}**`)
                .addFields([
                    { name: '🎯 IP Address', value: `\`${ip}\``, inline: true },
                    { name: '👤 Removed By', value: interaction.user.toString(), inline: true }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Failed to Remove Monitor`)
                .setDescription(error.message)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleList(interaction) {
        await interaction.deferReply();

        try {
            const monitors = await interaction.client.database.getMonitoredIPs(interaction.guildId);

            if (monitors.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.info)
                    .setTitle(`${config.ui.emojis.info} No Monitors`)
                    .setDescription('No IP addresses are currently being monitored in this server.')
                    .addFields([
                        { 
                            name: '🚀 Get Started', 
                            value: 'Use `/monitor add` to start monitoring your first IP address!',
                            inline: false 
                        }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.primary)
                .setTitle(`${config.ui.emojis.monitor} Monitored IPs`)
                .setDescription(`Monitoring **${monitors.length}** IP address(es) in this server`)
                .setTimestamp();

            for (let i = 0; i < Math.min(monitors.length, 10); i++) {
                const monitor = monitors[i];
                const status = await interaction.client.monitoring.getMonitorStatus(interaction.guildId, monitor.ip_address);
                const createdAt = new Date(monitor.created_at);
                
                let statusText = '✅ Active';
                if (status.isOnCooldown) {
                    const remainingMinutes = Math.ceil(status.cooldownRemaining / 60000);
                    statusText = `⏰ Cooldown (${remainingMinutes}m)`;
                }

                embed.addFields({
                    name: `${monitor.alias ? `${monitor.alias} (${monitor.ip_address})` : monitor.ip_address}`,
                    value: `**Channel:** <#${monitor.channel_id}>\n**Status:** ${statusText}\n**Added:** <t:${Math.floor(createdAt.getTime() / 1000)}:R>`,
                    inline: true
                });
            }

            if (monitors.length > 10) {
                embed.setFooter({ text: `Showing first 10 of ${monitors.length} monitors` });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve monitored IPs')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleTest(interaction) {
        const ip = interaction.options.getString('ip');

        await interaction.deferReply();

        try {
            await interaction.client.monitoring.testAlert(
                interaction.guildId,
                interaction.channelId,
                ip
            );

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.success)
                .setTitle(`${config.ui.emojis.success} Test Alert Sent`)
                .setDescription(`Test alert sent for **${ip}**`)
                .addFields([
                    { name: '🎯 IP Address', value: `\`${ip}\``, inline: true },
                    { name: '📺 Channel', value: interaction.channel.toString(), inline: true },
                    { name: '⚠️ Note', value: 'This was a test alert - no actual attack was detected', inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Test Failed`)
                .setDescription(error.message)
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    async handleStatus(interaction) {
        const ip = interaction.options.getString('ip');

        await interaction.deferReply();

        try {
            const status = await interaction.client.monitoring.getMonitorStatus(interaction.guildId, ip);
            
            if (!status) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.warning)
                    .setTitle(`${config.ui.emojis.warning} Monitor Not Found`)
                    .setDescription(`No monitor found for IP address **${ip}**`)
                    .addFields([
                        { name: '💡 Tip', value: 'Use `/monitor add` to start monitoring this IP', inline: false }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(status.isOnCooldown ? config.ui.colors.warning : config.ui.colors.success)
                .setTitle(`${config.ui.emojis.stats} Monitor Status`)
                .setDescription(`Status information for **${status.alias || ip}**`)
                .addFields([
                    { name: '🎯 IP Address', value: `\`${status.ip_address}\``, inline: true },
                    { name: '📺 Channel', value: `<#${status.channel_id}>`, inline: true },
                    { name: '📋 Alias', value: status.alias || 'None', inline: true },
                    { name: '🟢 Active', value: status.is_active ? 'Yes' : 'No', inline: true },
                    { name: '⏰ On Cooldown', value: status.isOnCooldown ? `Yes (${Math.ceil(status.cooldownRemaining / 60000)}m remaining)` : 'No', inline: true },
                    { name: '🚨 Last Attack ID', value: status.last_attack_id || 'None', inline: true },
                    { name: '👤 Created By', value: `<@${status.created_by}>`, inline: true },
                    { name: '📅 Created At', value: `<t:${Math.floor(new Date(status.created_at).getTime() / 1000)}:f>`, inline: true },
                    { name: '🔄 Last Updated', value: `<t:${Math.floor(new Date(status.updated_at).getTime() / 1000)}:R>`, inline: true }
                ])
                .setTimestamp();

            if (status.lastAlertTime) {
                embed.addFields({
                    name: '📢 Last Alert',
                    value: `<t:${Math.floor(status.lastAlertTime.getTime() / 1000)}:R>`,
                    inline: true
                });
            }

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve monitor status')
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    }
};