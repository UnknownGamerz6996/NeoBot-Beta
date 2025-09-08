const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ip-info')
        .setDescription('Get information about an IP address')
        .addStringOption(option =>
            option.setName('ip')
                .setDescription('IP address to look up')
                .setRequired(true)),
    guildOnly: true,
    cooldown: 10,
    category: 'attacks',

    async execute(interaction) {
        const ipAddress = interaction.options.getString('ip');

        await interaction.deferReply();

        try {
            // Validate IP format
            if (!interaction.client.neoprotect.isValidIP(ipAddress)) {
                throw new Error('Invalid IP address format. Please provide a valid IPv4 or IPv6 address.');
            }

            // Get IP information from NeoProtect API
            let ipInfo = null;
            try {
                ipInfo = await interaction.client.neoprotect.getIPInfo(ipAddress);
            } catch (error) {
                // If direct IP info fails, we'll still show what we can
                console.log('IP info lookup failed, continuing with attack data only');
            }

            // Get recent attacks for this IP
            const recentAttacks = await interaction.client.neoprotect.getAttacksByIP(ipAddress, { limit: 10 });

            // Get protection status if available
            let protectionStatus = null;
            try {
                protectionStatus = await interaction.client.neoprotect.getProtectionStatus(ipAddress);
            } catch (error) {
                // Protection status might not be available for all IPs
                console.log('Protection status lookup failed');
            }

            // Check if this IP is being monitored in this guild
            const monitorStatus = await interaction.client.database.getMonitoredIP(interaction.guildId, ipAddress);

            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.info)
                .setTitle(`${config.ui.emojis.target} IP Information`)
                .setDescription(`Information for IP address **${ipAddress}**`)
                .addFields([
                    {
                        name: '🌐 Basic Information',
                        value: [
                            `**IP Address:** \`${ipAddress}\``,
                            `**Type:** ${this.getIPType(ipAddress)}`,
                            `**Format:** ${this.getIPVersion(ipAddress)}`
                        ].join('\n'),
                        inline: true
                    },
                    {
                        name: '📊 Attack History',
                        value: [
                            `**Total Attacks:** ${recentAttacks.length}`,
                            `**Last 24h:** ${this.getAttacksInTimeframe(recentAttacks, 24)}`,
                            `**Last 7d:** ${this.getAttacksInTimeframe(recentAttacks, 168)}`,
                            `**Status:** ${recentAttacks.length > 0 ? (this.hasRecentAttacks(recentAttacks) ? '🔴 Under Attack' : '🟡 Previous Attacks') : '🟢 Clean'}`
                        ].join('\n'),
                        inline: true
                    }
                ])
                .setTimestamp();

            // Add NeoProtect specific information if available
            if (ipInfo) {
                const additionalInfo = [];
                if (ipInfo.organization) additionalInfo.push(`**Organization:** ${ipInfo.organization}`);
                if (ipInfo.country) additionalInfo.push(`**Country:** ${ipInfo.country}`);
                if (ipInfo.asn) additionalInfo.push(`**ASN:** ${ipInfo.asn}`);
                if (ipInfo.isp) additionalInfo.push(`**ISP:** ${ipInfo.isp}`);

                if (additionalInfo.length > 0) {
                    embed.addFields({
                        name: '🏢 Network Information',
                        value: additionalInfo.join('\n'),
                        inline: false
                    });
                }
            }

            // Add protection status if available
            if (protectionStatus) {
                embed.addFields({
                    name: '🛡️ Protection Status',
                    value: [
                        `**Status:** ${protectionStatus.enabled ? '🟢 Protected' : '🔴 Unprotected'}`,
                        `**Method:** ${protectionStatus.method || 'Unknown'}`,
                        `**Last Updated:** ${protectionStatus.lastUpdated ? `<t:${Math.floor(new Date(protectionStatus.lastUpdated).getTime() / 1000)}:R>` : 'Unknown'}`
                    ].join('\n'),
                    inline: true
                });
            }

            // Add monitoring status
            embed.addFields({
                name: '👁️ Monitoring Status',
                value: monitorStatus ? 
                    [
                        `**Status:** 🟢 Monitored`,
                        `**Alias:** ${monitorStatus.alias || 'None'}`,
                        `**Channel:** <#${monitorStatus.channel_id}>`,
                        `**Since:** <t:${Math.floor(new Date(monitorStatus.created_at).getTime() / 1000)}:R>`
                    ].join('\n') :
                    '🔴 Not monitored in this server',
                inline: true
            });

            // Add recent attacks summary if any
            if (recentAttacks.length > 0) {
                const latestAttack = recentAttacks[0];
                const attackTypes = [...new Set(recentAttacks.map(attack => attack.signatures?.[0]?.name || 'Unknown'))];
                const maxBPS = Math.max(...recentAttacks.map(attack => attack.signatures?.[0]?.bpsPeak || 0));

                embed.addFields({
                    name: '🚨 Recent Attack Summary',
                    value: [
                        `**Latest Attack:** <t:${Math.floor(new Date(latestAttack.startedAt).getTime() / 1000)}:R>`,
                        `**Attack Types:** ${attackTypes.slice(0, 3).join(', ')}${attackTypes.length > 3 ? '...' : ''}`,
                        `**Peak Traffic:** ${interaction.client.neoprotect.formatBytes(maxBPS)}`,
                        `**Threat Level:** ${this.calculateThreatLevel(recentAttacks)}`
                    ].join('\n'),
                    inline: false
                });
            }

            // Add recommended actions
            const recommendations = this.getRecommendations(recentAttacks, monitorStatus, protectionStatus);
            if (recommendations.length > 0) {
                embed.addFields({
                    name: '💡 Recommendations',
                    value: recommendations.map(r => `• ${r}`).join('\n'),
                    inline: false
                });
            }

            embed.setFooter({ 
                text: `IP Lookup • Requested by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            });

            await interaction.editReply({ embeds: [embed] });

        } catch (error) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.error)
                .setTitle(`${config.ui.emojis.error} Lookup Failed`)
                .setDescription('Failed to retrieve IP information')
                .addFields([
                    { name: 'Error Details', value: error.message, inline: false },
                    { name: 'IP Address', value: `\`${ipAddress}\``, inline: true }
                ])
                .setTimestamp();

            await interaction.editReply({ embeds: [embed] });
        }
    },

    getIPType(ip) {
        if (ip.includes(':')) return 'IPv6';
        
        const parts = ip.split('.');
        if (parts.length !== 4) return 'Invalid';
        
        const firstOctet = parseInt(parts[0]);
        
        // Check for private ranges
        if (firstOctet === 10) return 'Private (Class A)';
        if (firstOctet === 172 && parseInt(parts[1]) >= 16 && parseInt(parts[1]) <= 31) return 'Private (Class B)';
        if (firstOctet === 192 && parseInt(parts[1]) === 168) return 'Private (Class C)';
        if (firstOctet === 127) return 'Loopback';
        if (firstOctet >= 224) return 'Multicast/Reserved';
        
        return 'Public';
    },

    getIPVersion(ip) {
        return ip.includes(':') ? 'IPv6' : 'IPv4';
    },

    getAttacksInTimeframe(attacks, hours) {
        const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
        return attacks.filter(attack => new Date(attack.startedAt) > cutoff).length;
    },

    hasRecentAttacks(attacks, hours = 1) {
        const cutoff = new Date(Date.now() - (hours * 60 * 60 * 1000));
        return attacks.some(attack => new Date(attack.startedAt) > cutoff && !attack.endedAt);
    },

    calculateThreatLevel(attacks) {
        if (attacks.length === 0) return '🟢 None';
        
        const recentAttacks = attacks.filter(attack => 
            new Date(attack.startedAt) > new Date(Date.now() - 24 * 60 * 60 * 1000)
        );
        
        if (recentAttacks.length === 0) return '🟡 Low';
        if (recentAttacks.length >= 5) return '🔴 Critical';
        if (recentAttacks.length >= 3) return '🟠 High';
        return '🟡 Medium';
    },

    getRecommendations(attacks, monitorStatus, protectionStatus) {
        const recommendations = [];
        
        if (!monitorStatus) {
            recommendations.push('Consider adding this IP to monitoring with `/monitor add`');
        }
        
        if (attacks.length > 0) {
            recommendations.push('Review recent attack patterns and consider additional protection');
            
            if (attacks.some(attack => !attack.endedAt)) {
                recommendations.push('Active attacks detected - monitor closely');
            }
        }
        
        if (protectionStatus && !protectionStatus.enabled) {
            recommendations.push('Enable DDoS protection for this IP address');
        }
        
        if (attacks.length >= 5) {
            recommendations.push('This IP is frequently targeted - consider advanced protection');
        }
        
        return recommendations;
    }
};