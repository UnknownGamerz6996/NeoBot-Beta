const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('attacks')
        .setDescription('View recent DDoS attacks')
        .addStringOption(option =>
            option.setName('ip')
                .setDescription('Filter by specific IP address')
                .setRequired(false))
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of attacks to show (1-25)')
                .setMinValue(1)
                .setMaxValue(25)
                .setRequired(false))
        .addStringOption(option =>
            option.setName('type')
                .setDescription('Filter by attack type')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('timeframe')
                .setDescription('Time period to search')
                .addChoices(
                    { name: 'Last hour', value: '1h' },
                    { name: 'Last 6 hours', value: '6h' },
                    { name: 'Last 24 hours', value: '24h' },
                    { name: 'Last 7 days', value: '7d' },
                    { name: 'Last 30 days', value: '30d' }
                )
                .setRequired(false)),
    guildOnly: true,
    cooldown: 10,
    category: 'attacks',

    async execute(interaction) {
        const ip = interaction.options.getString('ip');
        const limit = interaction.options.getInteger('limit') || 10;
        const attackType = interaction.options.getString('type');
        const timeframe = interaction.options.getString('timeframe') || '24h';

        await interaction.deferReply();

        try {
            let attacks;
            
            if (ip) {
                // Validate IP format
                if (!interaction.client.neoprotect.isValidIP(ip)) {
                    throw new Error('Invalid IP address format. Please provide a valid IPv4 or IPv6 address.');
                }
                attacks = await interaction.client.neoprotect.getAttacksByIP(ip, { limit: 100 });
            } else {
                attacks = await interaction.client.neoprotect.getAttacks({ limit: 100 });
            }

            if (!attacks || attacks.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.success)
                    .setTitle(`${config.ui.emojis.success} No Attacks Found`)
                    .setDescription(ip ? 
                        `No recent attacks found for IP address **${ip}**` : 
                        'No recent attacks found')
                    .addFields([
                        { 
                            name: '🛡️ Good News!', 
                            value: 'No DDoS attacks have been detected recently.',
                            inline: false 
                        }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // Filter by attack type if specified
            if (attackType) {
                attacks = attacks.filter(attack => 
                    attack.signatures?.[0]?.name?.toLowerCase().includes(attackType.toLowerCase())
                );
            }

            // Filter by timeframe
            const timeframeMs = this.parseTimeframe(timeframe);
            const cutoffTime = new Date(Date.now() - timeframeMs);
            attacks = attacks.filter(attack => 
                new Date(attack.startedAt) > cutoffTime
            );

            // Sort by start time (newest first) and limit
            attacks = attacks
                .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))
                .slice(0, limit);

            if (attacks.length === 0) {
                const embed = new EmbedBuilder()
                    .setColor(config.ui.colors.info)
                    .setTitle(`${config.ui.emojis.info} No Matching Attacks`)
                    .setDescription('No attacks found matching your search criteria')
                    .addFields([
                        { name: 'Search Criteria', value: this.formatSearchCriteria(ip, attackType, timeframe), inline: false }
                    ])
                    .setTimestamp();

                await interaction.editReply({ embeds: [embed] });
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.warning)
                .setTitle(`${config.ui.emojis.attack} Recent DDoS Attacks`)
                .setDescription(`Found **${attacks.length}** attack(s) ${ip ? `for ${ip}` : ''} in the ${timeframe}`)
                .setTimestamp();

            // Add search criteria if filters are applied
            if (ip || attackType || timeframe !== '24h') {
                embed.addFields({
                    name: '🔍 Search Criteria',
                    value: this.formatSearchCriteria(ip, attackType, timeframe),
                    inline: false
                });
            }

            // Add attack details
            for (let i = 0; i < Math.min(attacks.length, 5); i++) {
                const attack = attacks[i];
                const startTime = Math.floor(new Date(attack.startedAt).getTime() / 1000);
                const duration = attack.endedAt ? 
                    interaction.client.neoprotect.formatDuration(attack.startedAt, attack.endedAt) : 
                    'Ongoing';

                embed.addFields({
                    name: `🚨 Attack #${i + 1}`,
                    value: [
                        `**ID:** \`${attack.id}\``,
                        `**Target:** ${attack.dstAddress?.ipv4 || 'Unknown'}`,
                        `**Type:** ${attack.signatures?.[0]?.name || 'Unknown'}`,
                        `**Peak BPS:** ${interaction.client.neoprotect.formatBytes(attack.signatures?.[0]?.bpsPeak || 0)}`,
                        `**Peak PPS:** ${interaction.client.neoprotect.formatNumber(attack.signatures?.[0]?.ppsPeak || 0)}`,
                        `**Started:** <t:${startTime}:R>`,
                        `**Duration:** ${duration}`
                    ].join('\n'),
                    inline: false
                });
            }

            if (attacks.length > 5) {
                embed.addFields({
                    name: '📊 Additional Info',
                    value: `Showing first 5 of ${attacks.length} attacks. Use \`/attack-info\` to view details of a specific attack.`,
                    inline: false
                });
            }

            // Add statistics
            const totalBPS = attacks.reduce((sum, attack) => sum + (attack.signatures?.[0]?.bpsPeak || 0), 0);
            const avgBPS = attacks.length > 0 ? totalBPS / attacks.length : 0;
            const uniqueTargets = new Set(attacks.map(attack => attack.dstAddress?.ipv4)).size;

            embed.addFields({
                name: '📈 Statistics',
                value: [
                    `**Total Attacks:** ${attacks.length}`,
                    `**Unique Targets:** ${uniqueTargets}`,
                    `**Average Peak BPS:** ${interaction.client.neoprotect.formatBytes(avgBPS)}`,
                    `**Largest Attack:** ${interaction.client.neoprotect.formatBytes(Math.max(...attacks.map(a => a.signatures?.[0]?.bpsPeak || 0)))}`
                ].join('\n'),
                inline: false
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Error`)
                .setDescription('Failed to retrieve attack information')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    parseTimeframe(timeframe) {
        const timeframes = {
            '1h': 3600000,      // 1 hour
            '6h': 21600000,     // 6 hours
            '24h': 86400000,    // 24 hours
            '7d': 604800000,    // 7 days
            '30d': 2592000000   // 30 days
        };
        return timeframes[timeframe] || timeframes['24h'];
    },

    formatSearchCriteria(ip, attackType, timeframe) {
        const criteria = [];
        if (ip) criteria.push(`**IP:** ${ip}`);
        if (attackType) criteria.push(`**Type:** ${attackType}`);
        if (timeframe) criteria.push(`**Timeframe:** ${timeframe}`);
        return criteria.join(' • ') || 'No filters applied';
    }
};