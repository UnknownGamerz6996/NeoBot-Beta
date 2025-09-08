const { Collection } = require('discord.js');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const database = require('../utils/database');
const config = require('../../config');

class CommandHandler {
    constructor(client) {
        this.client = client;
        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.rateLimits = new Map();
        this.loadCommands();
    }

    loadCommands() {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            fs.mkdirSync(commandsPath, { recursive: true });
            logger.warn('Commands directory created');
            return;
        }

        const commandFolders = fs.readdirSync(commandsPath).filter(folder => 
            fs.statSync(path.join(commandsPath, folder)).isDirectory()
        );

        for (const folder of commandFolders) {
            const folderPath = path.join(commandsPath, folder);
            const commandFiles = fs.readdirSync(folderPath).filter(file => 
                file.endsWith('.js')
            );

            for (const file of commandFiles) {
                const filePath = path.join(folderPath, file);
                
                try {
                    delete require.cache[require.resolve(filePath)];
                    const command = require(filePath);
                    
                    if (this.validateCommand(command)) {
                        command.category = folder;
                        this.commands.set(command.data.name, command);
                        logger.debug(`Loaded command: ${command.data.name} from ${folder}`);
                    } else {
                        logger.warn(`Invalid command structure: ${file}`);
                    }
                } catch (error) {
                    logger.error(`Failed to load command ${file}`, error);
                }
            }
        }

        logger.info(`Loaded ${this.commands.size} commands from ${commandFolders.length} categories`);
    }

    validateCommand(command) {
        return command 
            && typeof command.execute === 'function'
            && command.data 
            && command.data.name
            && command.data.description;
    }

    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName);
        if (!command) {
            logger.warn(`Unknown command: ${interaction.commandName}`);
            return;
        }

        try {
            // Permission checks
            const hasPermission = await this.checkPermissions(interaction, command);
            if (!hasPermission) return;

            // Rate limiting
            const rateLimited = await this.checkRateLimit(interaction, command);
            if (rateLimited) return;

            // Cooldown checks
            const onCooldown = this.checkCooldown(interaction, command);
            if (onCooldown) return;

            // Guild-only command check
            if (command.guildOnly && !interaction.guild) {
                await interaction.reply({
                    content: '❌ This command can only be used in a server!',
                    ephemeral: true
                });
                return;
            }

            // Premium command check
            if (command.premium && !await this.isPremiumGuild(interaction.guildId)) {
                await interaction.reply({
                    content: '⭐ This is a premium feature! Upgrade your server to access advanced commands.',
                    ephemeral: true
                });
                return;
            }

            // Log command usage
            logger.command(
                command.data.name,
                interaction.user.id,
                interaction.guildId,
                this.getCommandArgs(interaction)
            );

            // Record usage metric
            await database.recordMetric('command_usage', 1, {
                command: command.data.name,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                category: command.category
            });

            // Execute command
            await command.execute(interaction);

            // Set cooldown
            this.setCooldown(interaction, command);

        } catch (error) {
            logger.error(`Error executing command ${command.data.name}`, error, {
                userId: interaction.user.id,
                guildId: interaction.guildId,
                commandName: command.data.name
            });

            const errorMessage = this.getErrorMessage(error);
            
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    content: errorMessage,
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    content: errorMessage,
                    ephemeral: true
                });
            }

            // Record error metric
            await database.recordMetric('command_errors', 1, {
                command: command.data.name,
                error: error.message,
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
        }
    }

    async checkPermissions(interaction, command) {
        // Admin override
        if (config.security.adminUserIds.includes(interaction.user.id)) {
            return true;
        }

        // Check required permissions
        if (command.permissions && command.permissions.length > 0) {
            const member = interaction.member;
            if (!member) return false;

            const hasPermissions = command.permissions.every(permission => 
                member.permissions.has(permission)
            );

            if (!hasPermissions) {
                await interaction.reply({
                    content: `❌ You need the following permissions to use this command: ${command.permissions.join(', ')}`,
                    ephemeral: true
                });
                return false;
            }
        }

        // Check custom permissions from database
        if (command.customPermissions) {
            const userPermissions = await database.getUserPermissions(
                interaction.guildId,
                interaction.user.id
            );

            const hasCustomPermission = command.customPermissions.some(permission =>
                userPermissions.includes(permission)
            );

            if (!hasCustomPermission) {
                await interaction.reply({
                    content: '❌ You don\'t have permission to use this command.',
                    ephemeral: true
                });
                return false;
            }
        }

        return true;
    }

    async checkRateLimit(interaction, command) {
        const rateLimitKey = `${interaction.user.id}_${command.data.name}`;
        const now = Date.now();
        const windowMs = config.security.rateLimit.windowMs;
        const maxRequests = command.rateLimit || config.security.rateLimit.max;

        if (!this.rateLimits.has(rateLimitKey)) {
            this.rateLimits.set(rateLimitKey, []);
        }

        const requests = this.rateLimits.get(rateLimitKey);
        
        // Remove old requests outside the window
        const validRequests = requests.filter(timestamp => now - timestamp < windowMs);
        this.rateLimits.set(rateLimitKey, validRequests);

        if (validRequests.length >= maxRequests) {
            const remainingTime = Math.ceil((validRequests[0] + windowMs - now) / 1000);
            
            await interaction.reply({
                content: `⏰ Rate limit exceeded! Please wait ${remainingTime} seconds before using this command again.`,
                ephemeral: true
            });

            logger.rateLimit(interaction.user.id, command.data.name, maxRequests - validRequests.length);
            return true;
        }

        // Add current request
        validRequests.push(now);
        this.rateLimits.set(rateLimitKey, validRequests);

        return false;
    }

    checkCooldown(interaction, command) {
        if (!command.cooldown) return false;

        const cooldownKey = `${interaction.user.id}_${command.data.name}`;
        const now = Date.now();
        const cooldownAmount = command.cooldown * 1000;

        if (this.cooldowns.has(cooldownKey)) {
            const expirationTime = this.cooldowns.get(cooldownKey) + cooldownAmount;

            if (now < expirationTime) {
                const timeLeft = (expirationTime - now) / 1000;
                interaction.reply({
                    content: `⏰ Please wait ${timeLeft.toFixed(1)} more seconds before using \`${command.data.name}\` again.`,
                    ephemeral: true
                });
                return true;
            }
        }

        return false;
    }

    setCooldown(interaction, command) {
        if (!command.cooldown) return;

        const cooldownKey = `${interaction.user.id}_${command.data.name}`;
        this.cooldowns.set(cooldownKey, Date.now());

        // Auto-remove cooldown after expiration
        setTimeout(() => {
            this.cooldowns.delete(cooldownKey);
        }, command.cooldown * 1000);
    }

    async isPremiumGuild(guildId) {
        if (!guildId) return false;
        
        try {
            const guild = await database.getGuild(guildId);
            return guild?.premium || false;
        } catch (error) {
            logger.error('Failed to check premium status', error);
            return false;
        }
    }

    getCommandArgs(interaction) {
        const args = {};
        
        if (interaction.options) {
            for (const option of interaction.options.data) {
                args[option.name] = option.value;
            }
        }
        
        return args;
    }

    getErrorMessage(error) {
        if (error.code === 'INTERACTION_TIMEOUT') {
            return '⏰ The command took too long to respond. Please try again.';
        }
        
        if (error.code === 'MISSING_PERMISSIONS') {
            return '❌ I don\'t have the required permissions to execute this command.';
        }
        
        if (error.message.includes('Unknown interaction')) {
            return '❌ This interaction has expired. Please try the command again.';
        }
        
        if (config.isDevelopment) {
            return `❌ An error occurred: ${error.message}`;
        }
        
        return '❌ An unexpected error occurred. Please try again later.';
    }

    // Command management methods
    reloadCommand(commandName) {
        const command = this.commands.get(commandName);
        if (!command) return false;

        const commandPath = path.join(__dirname, '../commands', command.category, `${commandName}.js`);
        
        try {
            delete require.cache[require.resolve(commandPath)];
            const newCommand = require(commandPath);
            
            if (this.validateCommand(newCommand)) {
                newCommand.category = command.category;
                this.commands.set(commandName, newCommand);
                logger.info(`Reloaded command: ${commandName}`);
                return true;
            }
        } catch (error) {
            logger.error(`Failed to reload command ${commandName}`, error);
        }
        
        return false;
    }

    reloadAllCommands() {
        this.commands.clear();
        this.loadCommands();
        logger.info('All commands reloaded');
    }

    getCommandsByCategory() {
        const categories = {};
        
        for (const [name, command] of this.commands) {
            if (!categories[command.category]) {
                categories[command.category] = [];
            }
            categories[command.category].push(command);
        }
        
        return categories;
    }

    getCommandStats() {
        return {
            totalCommands: this.commands.size,
            categories: Object.keys(this.getCommandsByCategory()).length,
            activeCooldowns: this.cooldowns.size,
            activeRateLimits: this.rateLimits.size
        };
    }

    // Cleanup methods
    clearCooldowns() {
        this.cooldowns.clear();
        logger.debug('All cooldowns cleared');
    }

    clearRateLimits() {
        this.rateLimits.clear();
        logger.debug('All rate limits cleared');
    }

    // Utility methods for commands
    async createStandardEmbed(interaction, options = {}) {
        const { EmbedBuilder } = require('discord.js');
        
        return new EmbedBuilder()
            .setColor(options.color || config.ui.colors.primary)
            .setTimestamp()
            .setFooter({
                text: `Requested by ${interaction.user.username}`,
                iconURL: interaction.user.displayAvatarURL()
            });
    }

    async createErrorEmbed(message, details = null) {
        const { EmbedBuilder } = require('discord.js');
        
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.error)
            .setTitle(`${config.ui.emojis.error} Error`)
            .setDescription(message)
            .setTimestamp();
            
        if (details) {
            embed.addFields({ name: 'Details', value: details, inline: false });
        }
        
        return embed;
    }

    async createSuccessEmbed(message, details = null) {
        const { EmbedBuilder } = require('discord.js');
        
        const embed = new EmbedBuilder()
            .setColor(config.ui.colors.success)
            .setTitle(`${config.ui.emojis.success} Success`)
            .setDescription(message)
            .setTimestamp();
            
        if (details) {
            embed.addFields({ name: 'Details', value: details, inline: false });
        }
        
        return embed;
    }
}

module.exports = CommandHandler;