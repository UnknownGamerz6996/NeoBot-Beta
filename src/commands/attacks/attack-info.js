const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('attack-info')
        .setDescription('Get detailed information about a specific attack')
        .addStringOption(option =>
            option.setName('id')
                .setDescription('Attack ID to look up')
                .setRequired(true)),
    guildOnly: true,
    cooldown: 5,
    category: 'attacks',

    async execute(interaction) {
        const attackId = interaction.options.getString('id');

        await interaction.deferReply();

        try {
            // First try to get from database (faster)
            let attack = await interaction.client.database.getAttackById(attackId);
            
            if (attack && attack.raw_data) {
                attack = JSON.parse(attack.raw_data);
            } else {
                // If not in database, try API
                try {
                    attack = await interaction.client.neoprotect.getAttackById(attackId);
                } catch (apiError) {
                    // Try searching in recent attacks
                    const recentAttacks = await interaction.client.neoprotect.getAttacks({ limit: 1000 });
                    attack = recentAttacks.find(a => a.id === attackId);
                }
            }

            if (!attack) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.warning)
                    .setTitle(`${config.ui.emojis.warning} Attack Not Found`)
                    .setDescription(`No attack found with ID: \`${attackId}\``)
                    .addFields([
                        { 
                            name: '💡 Tips', 
                            value: [
                                '• Check that the attack ID is correct',
                                '• The attack might be too old to retrieve',
                                '• Use `/attacks` to see recent attacks'
                            ].join('\n'),
                            inline: false 
                        }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const startTime = new Date(attack.startedAt);
            const endTime = attack.endedAt ? new Date(attack.endedAt) : null;
            const duration = endTime ? 
                interaction.client.neoprotect.formatDuration(attack.startedAt, attack.endedAt) : 
                'Ongoing';

            // Determine attack severity for color
            const severity = this.calculateSeverity(attack);
            const color = this.getSeverityColor(severity);

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`${config.ui.emojis.attack} Attack Details`)
                .setDescription(`Detailed information for attack \`${attackId}\``)
                .addFields([
                    {
                        name: '🆔 Attack Information',
                        value: [
                            `**ID:** \`${attack.id}\``,
                            `**Status:** ${endTime ? '🔴 Ended' : '🟡 Ongoing'}`,
                            `**Severity:** ${this.getSeverityEmoji(severity)} ${this.getSeverityLabel(severity)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🎯 Target Information',
                        value: [
                            `**IP:** ${attack.dstAddress?.ipv4 || 'Unknown'}`,
                            `**Port:** ${attack.dstAddress?.port || 'Multiple/Unknown'}`,
                            `**Protocol:** ${attack.dstAddress?.protocol || 'Unknown'}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '💥 Attack Details',
                        value: [
                            `**Type:** ${attack.signatures?.[0]?.name || 'Unknown'}`,
                            `**Pattern:** ${attack.signatures?.[0]?.pattern || 'Unknown'}`,
                            `**Confidence:** ${attack.signatures?.[0]?.confidence || 'Unknown'}`
                        ].join('\n'),
                        inline: false
                    },
                    {
                        name: '📊 Traffic Statistics',
                        value: [
                            `**Peak BPS:** ${interaction.client.neoprotect.formatBytes(attack.signatures?.[0]?.bpsPeak || 0)}`,
                            `**Peak PPS:** ${interaction.client.neoprotect.formatNumber(attack.signatures?.[0]?.ppsPeak || 0)}`,
                            `**Avg BPS:** ${interaction.client.neoprotect.formatBytes(attack.signatures?.[0]?.bpsAvg || 0)}`,
                            `**Avg PPS:** ${interaction.client.neoprotect.formatNumber(attack.signatures?.[0]?.ppsAvg || 0)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '🕒 Timeline',
                        value: [
                            `**Started:** <t:${Math.floor(startTime.getTime() / 1000)}:f>`,
                            `**Started:** <t:${Math.floor(startTime.getTime() / 1000)}:R>`,
                            endTime ? `**Ended:** <t:${Math.floor(endTime.getTime() / 1000)}:f>` : '**Status:** Still ongoing',
                            `**Duration:** ${duration}`
                        ].join('\n'),
                        inline: true
                    }
                ])
                .setTimestamp();

            // Add source information if available
            if (attack.srcAddress && attack.srcAddress.length > 0) {
                const sources = attack.srcAddress.slice(0, 5); // Show first 5 sources
                const sourceList = sources.map(src => 
                    `${src.ipv4 || 'Unknown'}${src.country ? ` (${src.country})` : ''}`
                ).join('\n');

                embed.addFields({
                    name: `🌍 Attack Sources (${attack.srcAddress.length} total)`,
                    value: sourceList + (attack.srcAddress.length > 5 ? '\n*...and more*' : ''),
                    inline: false
                });
            }

            // Add mitigation information if available
            if (attack.mitigation) {
                embed.addFields({
                    name: '🛡️ Mitigation Status',
                    value: [
                        `**Status:** ${attack.mitigation.status || 'Unknown'}`,
                        `**Method:** ${attack.mitigation.method || 'Unknown'}`,
                        `**Effectiveness:** ${attack.mitigation.effectiveness || 'Unknown'}%`
                    ].join('\n'),
                    inline: true
                });
            }

            // Add additional metrics if available
            if (attack.metrics) {
                const metrics = [];
                if (attack.metrics.packetCount) metrics.push(`**Total Packets:** ${interaction.client.neoprotect.formatNumber(attack.metrics.packetCount)}`);
                if (attack.metrics.byteCount) metrics.push(`**Total Bytes:** ${interaction.client.neoprotect.formatBytes(attack.metrics.byteCount)}`);
                if (attack.metrics.connectionCount) metrics.push(`**Connections:** ${interaction.client.neoprotect.formatNumber(attack.metrics.connectionCount)}`);

                if (metrics.length > 0) {
                    embed.addFields({
                        name: '📈 Additional Metrics',
                        value: metrics.join('\n'),
                        inline: true
                    });
                }
            }

            // Add geolocation data if available
            if (attack.geoData) {
                embed.addFields({
                    name: '🌐 Geographic Data',
                    value: [
                        `**Primary Region:** ${attack.geoData.primaryRegion || 'Unknown'}`,
                        `**Countries:** ${attack.geoData.countries || 'Unknown'}`,
                        `**ASNs:** ${attack.geoData.asns || 'Unknown'}`
                    ].join('\n'),
                    inline: false
                });
            }

            // Check if this IP is being monitored in this guild
            const isMonitored = await interaction.client.database.getMonitoredIP(
                interaction.guildId, 
                attack.dstAddress?.ipv4
            );

            if (isMonitored) {
                embed.addFields({
                    name: '👁️ Monitoring Status',
                    value: `This IP is being monitored in <#${isMonitored.channel_id}>`,
                    inline: false
                });
            }

            embed.setFooter({ 
                text: `Attack ID: ${attackId} • Data from NeoProtect API`,
                iconURL: interaction.client.user?.displayAvatarURL()
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve attack information')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false },
                    { name: 'Attack ID', value: `\`${attackId}\``, inline: true }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    calculateSeverity(attack) {
        const bps = attack.signatures?.[0]?.bpsPeak || 0;
        const pps = attack.signatures?.[0]?.ppsPeak || 0;
        
        // Severity based on traffic volume
        if (bps > 50000000000 || pps > 5000000) return 5; // Critical
        if (bps > 10000000000 || pps > 1000000) return 4; // High
        if (bps > 1000000000 || pps > 100000) return 3;   // Medium
        if (bps > 100000000 || pps > 10000) return 2;     // Low
        return 1; // Minimal
    },

    getSeverityColor(severity) {
        const colors = [
            config.ui.colors.success,  // 1 - Minimal (green)
            config.ui.colors.warning,  // 2 - Low (yellow)  
            0xFF8C00,                  // 3 - Medium (orange)
            config.ui.colors.error,    // 4 - High (red)
            0x8B0000                   // 5 - Critical (dark red)
        ];
        return colors[severity - 1] || config.ui.colors.primary;
    },

    getSeverityEmoji(severity) {
        const emojis = ['🟢', '🟡', '🟠', '🔴', '🟣'];
        return emojis[severity - 1] || '⚪';
    },

    getSeverityLabel(severity) {
        const labels = ['Minimal', 'Low', 'Medium', 'High', 'Critical'];
        return labels[severity - 1] || 'Unknown';
    }
};