const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const config = require('../../../config');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('help')
        .setDescription('Get help with bot commands and features')
        .addStringOption(option =>
            option.setName('category')
                .setDescription('Get help for a specific category')
                .addChoices(
                    { name: 'Monitoring', value: 'monitoring' },
                    { name: 'Attacks', value: 'attacks' },
                    { name: 'Statistics', value: 'stats' },
                    { name: 'General', value: 'general' },
                    { name: 'Admin', value: 'admin' }
                )
                .setRequired(false))
        .addStringOption(option =>
            option.setName('command')
                .setDescription('Get help for a specific command')
                .setRequired(false)),
    cooldown: 5,
    category: 'general',

    async execute(interaction) {
        const category = interaction.options.getString('category');
        const commandName = interaction.options.getString('command');

        if (commandName) {
            await this.showCommandHelp(interaction, commandName);
        } else if (category) {
            await this.showCategoryHelp(interaction, category);
        } else {
            await this.showMainHelp(interaction);
        }
    },

    async showMainHelp(interaction) {
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.primary)
            .setTitle(`${config.ui.emojis.shield} NeoProtect Discord Bot`)
            .setDescription('Advanced DDoS monitoring and alerting system integrated with NeoProtect API')
            .addFields([
                {
                    name: '👁️ **Monitoring Commands**',
                    value: [
                        '`/monitor add` - Add IP to monitoring',
                        '`/monitor remove` - Remove IP from monitoring', 
                        '`/monitor list` - List monitored IPs',
                        '`/monitor test` - Send test alert'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🚨 **Attack Commands**',
                    value: [
                        '`/attacks` - View recent attacks',
                        '`/attack-info` - Detailed attack info',
                        '`/ip-info` - IP information lookup'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '📊 **Statistics Commands**',
                    value: [
                        '`/stats bot` - Bot statistics',
                        '`/stats monitoring` - Monitoring stats',
                        '`/stats attacks` - Attack statistics',
                        '`/stats api` - API usage stats'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '⚙️ **General Commands**',
                    value: [
                        '`/help` - Show this help message',
                        '`/ping` - Check bot responsiveness',
                        '`/status` - System status check'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🔧 **Admin Commands**',
                    value: [
                        '`/admin reload` - Reload commands/events',
                        '`/admin backup` - Create database backup',
                        '`/admin health` - Detailed health check'
                    ].join('\n'),
                    inline: true
                },
                {
                    name: '🆘 **Need More Help?**',
                    value: [
                        '• Use `/help <category>` for category details',
                        '• Use `/help command:<name>` for command help',
                        '• Check the server permissions',
                        '• Contact server administrators'
                    ].join('\n'),
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ 
                text: `Requested by ${interaction.user.username} • Use the menu below for quick navigation`,
                iconURL: interaction.user.displayAvatarURL()
            });

        // Create category selection menu
        const selectMenu = new StringSelectMenuBuilder()
            .setCustomId('help_category_select')
            .setPlaceholder('Select a category for detailed help')
            .addOptions([
                {
                    label: 'Monitoring',
                    value: 'monitoring',
                    description: 'IP monitoring and alert management',
                    emoji: '👁️'
                },
                {
                    label: 'Attacks',
                    value: 'attacks',
                    description: 'View and analyze DDoS attacks',
                    emoji: '🚨'
                },
                {
                    label: 'Statistics',
                    value: 'stats',
                    description: 'Bot and system statistics',
                    emoji: '📊'
                },
                {
                    label: 'General',
                    value: 'general',
                    description: 'Basic bot commands and utilities',
                    emoji: '⚙️'
                },
                {
                    label: 'Admin',
                    value: 'admin',
                    description: 'Administrative commands',
                    emoji: '🔧'
                }
            ]);

        const row = new ActionRowBuilder().addComponents(selectMenu);

        await interaction.reply({ embeds: [embed], components: [row] });
    },

    async showCategoryHelp(interaction, category) {
        const commands = interaction.client.commandHandler.getCommandsByCategory();
        const categoryCommands = commands[category] || [];

        if (categoryCommands.length === 0) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.warning)
                .setTitle(`${config.ui.emojis.warning} Category Not Found`)
                .setDescription(`No commands found in category: **${category}**`)
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const categoryInfo = this.getCategoryInfo(category);
        
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.info)
            .setTitle(`${categoryInfo.emoji} ${categoryInfo.name} Commands`)
            .setDescription(categoryInfo.description)
            .setTimestamp();

        categoryCommands.forEach(command => {
            const commandData = command.data;
            let value = commandData.description;
            
            // Add subcommands if they exist
            if (commandData.options && commandData.options.some(opt => opt.type === 1)) {
                const subcommands = commandData.options
                    .filter(opt => opt.type === 1)
                    .map(sub => `• \`${commandData.name} ${sub.name}\` - ${sub.description}`)
                    .join('\n');
                value += `\n${subcommands}`;
            }

            // Add usage restrictions
            const restrictions = [];
            if (command.guildOnly) restrictions.push('Server only');
            if (command.permissions) restrictions.push('Requires permissions');
            if (command.premium) restrictions.push('Premium feature');
            if (command.cooldown) restrictions.push(`${command.cooldown}s cooldown`);
            
            if (restrictions.length > 0) {
                value += `\n*${restrictions.join(' • ')}*`;
            }

            embed.addFields({
                name: `\`/${commandData.name}\``,
                value: value,
                inline: false
            });
        });

        await interaction.reply({ embeds: [embed] });
    },

    async showCommandHelp(interaction, commandName) {
        const command = interaction.client.commandHandler.commands.get(commandName);

        if (!command) {
            const embed = new EmbedBuilder()
                .setColor(config.ui.colors.warning)
                .setTitle(`${config.ui.emojis.warning} Command Not Found`)
                .setDescription(`No command found with name: **${commandName}**`)
                .addFields([
                    {
                        name: '💡 Suggestions',
                        value: '• Check the spelling\n• Use `/help` to see all commands\n• Use `/help category:<category>` to browse by category',
                        inline: false
                    }
                ])
                .setTimestamp();

            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const commandData = command.data;
        
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.info)
            .setTitle(`${config.ui.emojis.info} Command: /${commandData.name}`)
            .setDescription(commandData.description)
            .addFields([
                {
                    name: '📋 Basic Information',
                    value: [
                        `**Category:** ${command.category || 'Unknown'}`,
                        `**Guild Only:** ${command.guildOnly ? 'Yes' : 'No'}`,
                        `**Cooldown:** ${command.cooldown ? `${command.cooldown} seconds` : 'None'}`,
                        `**Premium:** ${command.premium ? 'Yes' : 'No'}`
                    ].join('\n'),
                    inline: true
                }
            ])
            .setTimestamp();

        // Add permissions if any
        if (command.permissions && command.permissions.length > 0) {
            embed.addFields({
                name: '🔒 Required Permissions',
                value: command.permissions.map(p => `• ${p}`).join('\n'),
                inline: true
            });
        }

        // Add subcommands if any
        if (commandData.options && commandData.options.some(opt => opt.type === 1)) {
            const subcommands = commandData.options
                .filter(opt => opt.type === 1)
                .map(sub => `**${sub.name}** - ${sub.description}`)
                .join('\n');
            
            embed.addFields({
                name: '🔧 Subcommands',
                value: subcommands,
                inline: false
            });
        }

        // Add options if any (non-subcommand options)
        const options = commandData.options?.filter(opt => opt.type !== 1) || [];
        if (options.length > 0) {
            const optionList = options.map(opt => {
                let optStr = `**${opt.name}** (${this.getOptionTypeName(opt.type)})`;
                if (opt.required) optStr += ' *required*';
                optStr += ` - ${opt.description}`;
                
                if (opt.choices && opt.choices.length > 0) {
                    optStr += `\n  Choices: ${opt.choices.map(c => `\`${c.value}\``).join(', ')}`;
                }
                
                return optStr;
            }).join('\n\n');

            embed.addFields({
                name: '⚙️ Options',
                value: optionList,
                inline: false
            });
        }

        // Add usage examples
        const examples = this.getCommandExamples(commandName);
        if (examples.length > 0) {
            embed.addFields({
                name: '💡 Examples',
                value: examples.join('\n'),
                inline: false
            });
        }

        await interaction.reply({ embeds: [embed] });
    },

    getCategoryInfo(category) {
        const categories = {
            monitoring: {
                name: 'Monitoring',
                emoji: '👁️',
                description: 'Commands for managing IP monitoring and alerts. Add IPs to watch, configure alerts, and test your monitoring setup.'
            },
            attacks: {
                name: 'Attacks',
                emoji: '🚨',
                description: 'Commands for viewing and analyzing DDoS attacks. Search recent attacks, get detailed information, and view attack statistics.'
            },
            stats: {
                name: 'Statistics',
                emoji: '📊',
                description: 'Commands for viewing bot, monitoring, and API statistics. Monitor performance and usage metrics.'
            },
            general: {
                name: 'General',
                emoji: '⚙️',
                description: 'Basic bot commands and utilities. Get help, check status, and perform general bot operations.'
            },
            admin: {
                name: 'Admin',
                emoji: '🔧',
                description: 'Administrative commands for bot management. Requires special permissions. Use with caution.'
            }
        };

        return categories[category] || { name: 'Unknown', emoji: '❓', description: 'Unknown category' };
    },

    getOptionTypeName(type) {
        const types = {
            1: 'Subcommand',
            2: 'Subcommand Group',
            3: 'String',
            4: 'Integer',
            5: 'Boolean',
            6: 'User',
            7: 'Channel',
            8: 'Role',
            9: 'Mentionable',
            10: 'Number',
            11: 'Attachment'
        };
        return types[type] || 'Unknown';
    },

    getCommandExamples(commandName) {
        const examples = {
            monitor: [
                '`/monitor add ip:192.168.1.100 alias:Web Server`',
                '`/monitor remove ip:192.168.1.100`',
                '`/monitor list`',
                '`/monitor test ip:192.168.1.100`'
            ],
            attacks: [
                '`/attacks limit:10`',
                '`/attacks ip:192.168.1.100 timeframe:24h`',
                '`/attacks type:UDP timeframe:7d`'
            ],
            'attack-info': [
                '`/attack-info id:attack_12345`'
            ],
            stats: [
                '`/stats bot`',
                '`/stats monitoring`',
                '`/stats attacks timeframe:7d`',
                '`/stats api`'
            ],
            help: [
                '`/help`',
                '`/help category:monitoring`',
                '`/help command:monitor`'
            ]
        };

        return examples[commandName] || [];
    }
};