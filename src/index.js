const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');
const config = require('../config');
const logger = require('./utils/logger');
const database = require('./utils/database');
const neoprotect = require('./utils/neoprotect');
const CommandHandler = require('./handlers/commandHandler');
const EventHandler = require('./handlers/eventHandler');
const MonitoringSystem = require('./utils/monitor');

class NeoProtectBot {
    constructor() {
        this.client = null;
        this.commandHandler = null;
        this.eventHandler = null;
        this.monitoringSystem = null;
        this.isReady = false;
        this.startTime = Date.now();
        
        // Graceful shutdown handling
        this.setupGracefulShutdown();
    }

    async start() {
        try {
            logger.startup('Starting NeoProtect Discord Bot...');
            
            // Initialize Discord client
            await this.initializeClient();
            
            // Initialize handlers
            await this.initializeHandlers();
            
            // Initialize monitoring system
            await this.initializeMonitoring();
            
            // Login to Discord
            await this.login();
            
            logger.startup('Bot initialization completed successfully');
            
        } catch (error) {
            logger.error('Failed to start bot', error);
            process.exit(1);
        }
    }

    async initializeClient() {
        logger.info('Initializing Discord client...');
        
        this.client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildMessages,
                GatewayIntentBits.MessageContent,
                GatewayIntentBits.GuildMembers
            ],
            partials: [
                Partials.Message,
                Partials.Channel,
                Partials.Reaction
            ],
            allowedMentions: {
                parse: ['users', 'roles'],
                repliedUser: false
            }
        });

        // Set up basic error handling
        this.client.on('error', (error) => {
            logger.error('Discord client error', error);
        });

        this.client.on('warn', (warning) => {
            logger.warn(`Discord client warning: ${warning}`);
        });

        this.client.on('rateLimit', (rateLimitData) => {
            logger.warn('Rate limit encountered', rateLimitData);
        });

        // Ready event
        this.client.once('ready', async () => {
            await this.onReady();
        });

        logger.info('Discord client initialized');
    }

    async initializeHandlers() {
        logger.info('Initializing command and event handlers...');
        
        // Initialize command handler
        this.commandHandler = new CommandHandler(this.client);
        
        // Initialize event handler
        this.eventHandler = new EventHandler(this.client);
        
        // Set up interaction handling
        this.client.on('interactionCreate', async (interaction) => {
            await this.commandHandler.handleInteraction(interaction);
        });
        
        logger.info('Handlers initialized');
    }

    async initializeMonitoring() {
        logger.info('Initializing monitoring system...');
        
        this.monitoringSystem = new MonitoringSystem(this.client);
        
        // Store reference for global access
        this.client.monitoring = this.monitoringSystem;
        this.client.neoprotect = neoprotect;
        this.client.database = database;
        
        logger.info('Monitoring system initialized');
    }

    async login() {
        logger.info('Logging in to Discord...');
        await this.client.login(config.discord.token);
    }

    async onReady() {
        this.isReady = true;
        const readyTime = Date.now() - this.startTime;
        
        logger.startup(`Bot is ready! Logged in as ${this.client.user.tag}`);
        logger.startup(`Ready in ${readyTime}ms`);
        
        // Set bot activity
        await this.setActivity();
        
        // Start monitoring system
        this.monitoringSystem.start();
        
        // Deploy slash commands if in development
        if (config.isDevelopment) {
            await this.deployCommands();
        }
        
        // Log bot statistics
        await this.logBotStats();
        
        // Set up periodic status updates
        setInterval(async () => {
            await this.updateActivity();
            await this.logBotStats();
        }, 300000); // Every 5 minutes
        
        logger.startup('Bot is fully operational');
    }

    async setActivity() {
        const monitorCount = (await database.all('SELECT COUNT(*) as count FROM monitored_ips WHERE is_active = TRUE'))[0].count;
        
        await this.client.user.setActivity({
            name: `${monitorCount} IPs | /help`,
            type: ActivityType.Watching
        });
    }

    async updateActivity() {
        try {
            await this.setActivity();
        } catch (error) {
            logger.error('Failed to update activity', error);
        }
    }

    async deployCommands() {
        try {
            logger.info('Deploying slash commands...');
            
            const commands = [];
            for (const [name, command] of this.commandHandler.commands) {
                commands.push(command.data.toJSON());
            }

            // Deploy to test guild if specified, otherwise globally
            if (config.discord.guildId) {
                const guild = await this.client.guilds.fetch(config.discord.guildId);
                await guild.commands.set(commands);
                logger.info(`Deployed ${commands.length} commands to test guild`);
            } else {
                await this.client.application.commands.set(commands);
                logger.info(`Deployed ${commands.length} commands globally`);
            }
            
        } catch (error) {
            logger.error('Failed to deploy commands', error);
        }
    }

    async logBotStats() {
        try {
            const stats = {
                guilds: this.client.guilds.cache.size,
                users: this.client.users.cache.size,
                channels: this.client.channels.cache.size,
                uptime: process.uptime(),
                memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024, // MB
                ping: this.client.ws.ping
            };

            // Record metrics
            await database.recordMetric('guild_count', stats.guilds);
            await database.recordMetric('user_count', stats.users);
            await database.recordMetric('memory_usage', stats.memoryUsage);
            await database.recordMetric('bot_ping', stats.ping);

            // Log performance warning if needed
            if (stats.memoryUsage > config.performance.memoryThreshold) {
                logger.warn(`High memory usage: ${stats.memoryUsage.toFixed(2)}MB`);
            }

            logger.debug('Bot statistics recorded', stats);
            
        } catch (error) {
            logger.error('Failed to log bot stats', error);
        }
    }

    async setupGracefulShutdown() {
        const shutdown = async (signal) => {
            logger.shutdown(`Received ${signal}, shutting down gracefully...`);
            
            try {
                // Stop monitoring system
                if (this.monitoringSystem) {
                    await this.monitoringSystem.shutdown();
                }
                
                // Close database connection
                if (database) {
                    await database.close();
                }
                
                // Destroy Discord client
                if (this.client) {
                    this.client.destroy();
                }
                
                logger.shutdown('Graceful shutdown completed');
                process.exit(0);
                
            } catch (error) {
                logger.shutdown('Error during shutdown', error);
                process.exit(1);
            }
        };

        // Handle various shutdown signals
        process.on('SIGINT', () => shutdown('SIGINT'));
        process.on('SIGTERM', () => shutdown('SIGTERM'));
        process.on('SIGUSR2', () => shutdown('SIGUSR2')); // nodemon restart
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught exception', error);
            shutdown('uncaughtException');
        });
        
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled rejection', reason);
            shutdown('unhandledRejection');
        });
    }

    // Utility methods for external access
    getStats() {
        return {
            isReady: this.isReady,
            uptime: Date.now() - this.startTime,
            guilds: this.client?.guilds.cache.size || 0,
            users: this.client?.users.cache.size || 0,
            channels: this.client?.channels.cache.size || 0,
            ping: this.client?.ws.ping || 0,
            memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
            commands: this.commandHandler?.getCommandStats() || {},
            events: this.eventHandler?.getEventStats() || {},
            monitoring: this.monitoringSystem?.getSystemStats() || {}
        };
    }

    async getHealthCheck() {
        const health = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: Date.now() - this.startTime,
            services: {}
        };

        try {
            // Check Discord connection
            health.services.discord = {
                status: this.client?.ws.status === 0 ? 'healthy' : 'unhealthy',
                ping: this.client?.ws.ping || 0
            };

            // Check database
            try {
                await database.get('SELECT 1');
                health.services.database = { status: 'healthy' };
            } catch (error) {
                health.services.database = { status: 'unhealthy', error: error.message };
                health.status = 'degraded';
            }

            // Check NeoProtect API
            const neoHealth = neoprotect.getHealthStatus();
            health.services.neoprotect = {
                status: neoHealth.isHealthy ? 'healthy' : 'unhealthy',
                lastCheck: neoHealth.lastHealthCheck
            };

            if (!neoHealth.isHealthy) {
                health.status = 'degraded';
            }

            // Check monitoring system
            const monitoringStats = this.monitoringSystem?.getSystemStats();
            health.services.monitoring = {
                status: monitoringStats?.isRunning ? 'healthy' : 'unhealthy',
                alertQueue: monitoringStats?.alertQueue || 0
            };

            if (!monitoringStats?.isRunning) {
                health.status = 'degraded';
            }

        } catch (error) {
            health.status = 'unhealthy';
            health.error = error.message;
        }

        return health;
    }

    // Reload methods for hot-reloading
    async reloadCommands() {
        if (this.commandHandler) {
            this.commandHandler.reloadAllCommands();
            await this.deployCommands();
            return true;
        }
        return false;
    }

    async reloadEvents() {
        if (this.eventHandler) {
            this.eventHandler.reloadAllEvents();
            return true;
        }
        return false;
    }
}

// Initialize and start the bot
const bot = new NeoProtectBot();

// Export for external access (useful for web dashboard)
module.exports = bot;

// Start the bot if this file is run directly
if (require.main === module) {
    bot.start().catch(error => {
        logger.error('Failed to start bot', error);
        process.exit(1);
    });
}