const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');
const config = require('../../config');
const logger = require('../utils/logger');
const database = require('../utils/database');
const ErrorHandler = require('./errorHandler');

class CommandHandler {
    constructor(client) {
        this.client = client;
        this.commands = new Collection();
        this.cooldowns = new Collection();
        this.rateLimits = new Collection();
        this.commandStats = new Map();
        
        this.loadCommands();
        this.setupCleanupInterval();
    }

    async loadCommands() {
        const commandsPath = path.join(__dirname, '../commands');
        
        if (!fs.existsSync(commandsPath)) {
            logger.warn('Commands directory not found, creating...');
            fs.mkdirSync(commandsPath, { recursive: true });
            return;
        }

        let loadedCount = 0;
        const categories = fs.readdirSync(commandsPath);

        for (const category of categories) {
            const categoryPath = path.join(commandsPath, category);
            
            if (!fs.statSync(categoryPath).isDirectory()) continue;

            const commandFiles = fs.readdirSync(categoryPath).filter(file => 
                file.endsWith('.js')
            );

            for (const file of commandFiles) {
                const filePath = path.join(categoryPath, file);
                
                try {
                    // Clear require cache to allow hot reloading
                    delete require.cache[require.resolve(filePath)];
                    const command = require(filePath);
                    
                    if (this.validateCommand(command)) {
                        command.category = category;
                        this.commands.set(command.data.name, command);
                        loadedCount++;
                        
                        logger.debug(`Loaded command: ${command.data.name} (${category})`);
                    } else {
                        logger.warn(`Invalid command structure: ${file}`);
                    }
                } catch (error) {
                    logger.error(`Failed to load command ${file}`, error);
                }
            }
        }

        logger.info(`Loaded ${loadedCount} commands from ${categories.length} categories`);
    }

    validateCommand(command) {
        return command 
            && command.data 
            && command.data.name 
            && command.data.description
            && typeof command.execute === 'function';
    }

    async handleInteraction(interaction) {
        if (!interaction.isChatInputCommand()) return;

        const command = this.commands.get(interaction.commandName);
        
        if (!command) {
            logger.warn(`Unknown command: ${interaction.commandName}`, {
                userId: interaction.user.id,
                guildId: interaction.guildId
            });
            return;
        }

        try {
            // Pre-execution checks
            const checkResult = await this.performPreExecutionChecks(interaction, command);
            if (!checkResult.canExecute) {
                if (checkResult.response) {
                    await interaction.reply(checkResult.response);
                }
                return;
            }

            // Record command usage
            await this.recordCommandUsage(interaction, command);

            // Execute command with timeout
            const executionPromise = this.executeWithTimeout(command, interaction);
            await executionPromise;

            // Record successful execution
            await this.recordCommandSuccess(interaction, command);

        } catch (error) {
            // Handle command error
            const errorId = await ErrorHandler.handleCommandError(interaction, command, error);
            await this.recordCommandError(interaction, command, error, errorId);
        }
    }

    async performPreExecutionChecks(interaction, command) {
        // Check if bot has necessary permissions
        const botPermissionsCheck = await this.checkBotPermissions(interaction, command);
        if (!botPermissionsCheck.hasPermissions) {
            return {
                canExecute: false,
                response: {
                    content: `❌ I don't have the required permissions: ${botPermissionsCheck.missing.join(', ')}`,
                    ephemeral: true
                }
            };
        }

        // Check user permissions
        const userPermissionsCheck = await this.checkUserPermissions(interaction, command);
        if (!userPermissionsCheck.hasPermissions) {
            return {
                canExecute: false,
                response: {
                    content: `❌ You don't have permission to use this command. Required: ${userPermissionsCheck.missing.join(', ')}`,
                    ephemeral: true
                }
            };
        }

        // Check if command can be used in this context
        if (command.guildOnly && !interaction.guildId) {
            return {
                canExecute: false,
                response: {
                    content: '❌ This command can only be used in servers.',
                    ephemeral: true
                }
            };
        }

        // Check cooldowns
        const cooldownCheck = this.checkCooldown(interaction, command);
        if (!cooldownCheck.canExecute) {
            return {
                canExecute: false,
                response: {
                    content: `⏰ Command is on cooldown. Try again in ${Math.ceil(cooldownCheck.timeLeft / 1000)} seconds.`,
                    ephemeral: true
                }
            };
        }

        // Check rate limits
        const rateLimitCheck = this.checkRateLimit(interaction);
        if (!rateLimitCheck.canExecute) {
            return {
                canExecute: false,
                response: {
                    content: `🚦 You're being rate limited. Try again in ${Math.ceil(rateLimitCheck.timeLeft / 1000)} seconds.`,
                    ephemeral: true
                }
            };
        }

        return { canExecute: true };
    }

    async checkBotPermissions(interaction, command) {
        if (!interaction.guild || !command.botPermissions) {
            return { hasPermissions: true };
        }

        const botMember = interaction.guild.members.me;
        const missing = command.botPermissions.filter(permission => 
            !botMember.permissions.has(permission)
        );

        return {
            hasPermissions: missing.length === 0,
            missing
        };
    }

    async checkUserPermissions(interaction, command) {
        // Admin override
        if (config.security.adminUserIds.includes(interaction.user.id)) {
            return { hasPermissions: true };
        }

        let missing = [];

        // Check Discord permissions
        if (command.permissions && interaction.member) {
            const discordMissing = command.permissions.filter(permission => 
                !interaction.member.permissions.has(permission)
            );
            missing = missing.concat(discordMissing);
        }

        // Check custom permissions
        if (command.customPermissions && interaction.guildId) {
            try {
                const userPermissions = await database.getUserPermissions(
                    interaction.guildId,
                    interaction.user.id
                );

                const customMissing = command.customPermissions.filter(permission =>
                    !userPermissions.includes(permission)
                );
                missing = missing.concat(customMissing);
            } catch (error) {
                logger.error('Failed to check custom permissions', error);
                // Allow execution if we can't check permissions
            }
        }

        return {
            hasPermissions: missing.length === 0,
            missing
        };
    }

    checkCooldown(interaction, command) {
        if (!command.cooldown || command.cooldown <= 0) {
            return { canExecute: true };
        }

        const userId = interaction.user.id;
        const commandName = command.data.name;
        const key = `${userId}:${commandName}`;

        if (!this.cooldowns.has(key)) {
            this.cooldowns.set(key, Date.now() + (command.cooldown * 1000));
            return { canExecute: true };
        }

        const expirationTime = this.cooldowns.get(key);
        const now = Date.now();

        if (now < expirationTime) {
            return {
                canExecute: false,
                timeLeft: expirationTime - now
            };
        }

        this.cooldowns.set(key, now + (command.cooldown * 1000));
        return { canExecute: true };
    }

    checkRateLimit(interaction) {
        const userId = interaction.user.id;
        const now = Date.now();
        const windowMs = config.security.rateLimitWindow;
        const maxRequests = config.security.rateLimitMaxRequests;

        if (!this.rateLimits.has(userId)) {
            this.rateLimits.set(userId, {
                count: 1,
                resetTime: now + windowMs
            });
            return { canExecute: true };
        }

        const userLimits = this.rateLimits.get(userId);

        if (now > userLimits.resetTime) {
            // Reset the rate limit window
            userLimits.count = 1;
            userLimits.resetTime = now + windowMs;
            return { canExecute: true };
        }

        if (userLimits.count >= maxRequests) {
            return {
                canExecute: false,
                timeLeft: userLimits.resetTime - now
            };
        }

        userLimits.count++;
        return { canExecute: true };
    }

    async executeWithTimeout(command, interaction) {
        const timeout = command.timeout || config.performance.requestTimeout;
        
        return Promise.race([
            command.execute(interaction),
            new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Command execution timeout (${timeout}ms)`));
                }, timeout);
            })
        ]);
    }

    async recordCommandUsage(interaction, command) {
        try {
            const key = command.data.name;
            
            if (!this.commandStats.has(key)) {
                this.commandStats.set(key, {
                    uses: 0,
                    errors: 0,
                    totalTime: 0,
                    avgTime: 0
                });
            }

            const stats = this.commandStats.get(key);
            stats.uses++;
            stats.lastUsed = Date.now();

            // Record in database
            await database.recordMetric('command_usage', 1, {
                command: command.data.name,
                category: command.category,
                userId: interaction.user.id,
                guildId: interaction.guildId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            logger.error('Failed to record command usage', error);
        }
    }

    async recordCommandSuccess(interaction, command) {
        try {
            const stats = this.commandStats.get(command.data.name);
            if (stats) {
                const executionTime = Date.now() - stats.lastUsed;
                stats.totalTime += executionTime;
                stats.avgTime = stats.totalTime / stats.uses;
            }

            logger.command(command.data.name, interaction.user.id, {
                guildId: interaction.guildId,
                success: true
            });
        } catch (error) {
            logger.error('Failed to record command success', error);
        }
    }

    async recordCommandError(interaction, command, error, errorId) {
        try {
            const stats = this.commandStats.get(command.data.name);
            if (stats) {
                stats.errors++;
            }

            logger.command(command.data.name, interaction.user.id, {
                guildId: interaction.guildId,
                success: false,
                error: error.message,
                errorId
            });
        } catch (logError) {
            logger.error('Failed to record command error', logError);
        }
    }

    reloadCommand(commandName) {
        const command = this.commands.get(commandName);
        if (!command) return false;

        const category = command.category;
        const commandPath = path.join(__dirname, '../commands', category, `${commandName}.js`);

        try {
            delete require.cache[require.resolve(commandPath)];
            const newCommand = require(commandPath);
            
            if (this.validateCommand(newCommand)) {
                newCommand.category = category;
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

    getCommandStats() {
        const totalCommands = this.commands.size;
        const totalUses = Array.from(this.commandStats.values())
            .reduce((sum, stats) => sum + stats.uses, 0);
        const totalErrors = Array.from(this.commandStats.values())
            .reduce((sum, stats) => sum + stats.errors, 0);

        return {
            totalCommands,
            totalUses,
            totalErrors,
            successRate: totalUses > 0 ? ((totalUses - totalErrors) / totalUses * 100).toFixed(2) : 100,
            topCommands: Array.from(this.commandStats.entries())
                .map(([name, stats]) => ({ name, ...stats }))
                .sort((a, b) => b.uses - a.uses)
                .slice(0, 10)
        };
    }

    setupCleanupInterval() {
        // Clean up expired cooldowns and rate limits every 5 minutes
        setInterval(() => {
            this.cleanupExpiredData();
        }, 300000);
    }

    cleanupExpiredData() {
        const now = Date.now();

        // Clean up cooldowns
        for (const [key, expiration] of this.cooldowns.entries()) {
            if (now > expiration) {
                this.cooldowns.delete(key);
            }
        }

        // Clean up rate limits
        for (const [userId, data] of this.rateLimits.entries()) {
            if (now > data.resetTime) {
                this.rateLimits.delete(userId);
            }
        }

        logger.debug(`Cleaned up expired cooldowns and rate limits`);
    }
}

module.exports = CommandHandler;