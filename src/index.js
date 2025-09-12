const { Client, GatewayIntentBits, Partials, ActivityType } = require('discord.js');

// Add debug logging for each step
console.log('🔍 Step 1: Loading dependencies...');

let config, logger, database, neoprotect, CommandHandler, EventHandler, MonitoringSystem;

try {
    config = require('../config');
    console.log('✅ Config loaded successfully');
} catch (error) {
    console.error('❌ Failed to load config:', error.message);
    process.exit(1);
}

try {
    logger = require('./utils/logger');
    console.log('✅ Logger loaded successfully');
} catch (error) {
    console.error('❌ Failed to load logger:', error.message);
    process.exit(1);
}

try {
    database = require('./utils/database');
    console.log('✅ Database module loaded successfully');
} catch (error) {
    console.error('❌ Failed to load database:', error.message);
    process.exit(1);
}

try {
    neoprotect = require('./utils/neoprotect');
    console.log('✅ NeoProtect module loaded successfully');
} catch (error) {
    console.error('❌ Failed to load neoprotect:', error.message);
    process.exit(1);
}

try {
    CommandHandler = require('./handlers/commandHandler');
    console.log('✅ CommandHandler loaded successfully');
} catch (error) {
    console.error('❌ Failed to load CommandHandler:', error.message);
    console.error('Creating minimal command handler...');
    CommandHandler = class MinimalCommandHandler {
        constructor(client) {
            this.client = client;
            this.commands = new Map();
        }
        async handleInteraction(interaction) {
            console.log('Command interaction received:', interaction.commandName);
        }
    };
}

try {
    EventHandler = require('./handlers/eventHandler');
    console.log('✅ EventHandler loaded successfully');
} catch (error) {
    console.error('❌ Failed to load EventHandler:', error.message);
    console.error('Creating minimal event handler...');
    EventHandler = class MinimalEventHandler {
        constructor(client) {
            this.client = client;
        }
    };
}

try {
    MonitoringSystem = require('./utils/monitor');
    console.log('✅ MonitoringSystem loaded successfully');
} catch (error) {
    console.error('❌ Failed to load MonitoringSystem:', error.message);
    console.error('Creating minimal monitoring system...');
    MonitoringSystem = class MinimalMonitoringSystem {
        constructor(client) {
            this.client = client;
            this.isRunning = false;
        }
        start() {
            this.isRunning = true;
            console.log('Minimal monitoring system started');
        }
        stop() {
            this.isRunning = false;
        }
        getSystemStats() {
            return { isRunning: this.isRunning };
        }
    };
}

console.log('🔍 Step 2: All modules loaded, creating bot class...');

class NeoProtectBot {
    constructor() {
        console.log('🔍 Step 3: Bot constructor called');
        this.client = null;
        this.commandHandler = null;
        this.eventHandler = null;
        this.monitoringSystem = null;
        this.isReady = false;
        this.startTime = Date.now();
        
        // Graceful shutdown handling
        this.setupGracefulShutdown();
        console.log('✅ Bot constructor completed');
    }

    setupGracefulShutdown() {
        console.log('🔍 Setting up graceful shutdown handlers...');
        
        process.on('SIGINT', async () => {
            console.log('\n🛑 Received SIGINT, shutting down gracefully...');
            await this.shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
            await this.shutdown();
            process.exit(0);
        });

        process.on('uncaughtException', (error) => {
            console.error('💥 Uncaught Exception:', error);
            process.exit(1);
        });

        process.on('unhandledRejection', (reason, promise) => {
            console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
            process.exit(1);
        });
        
        console.log('✅ Graceful shutdown handlers set up');
    }

    async start() {
        try {
            console.log('🔍 Step 4: Starting bot initialization...');
            logger.startup('Starting NeoProtect Discord Bot...');
            
            // Initialize Discord client
            console.log('🔍 Step 5: Initializing Discord client...');
            await this.initializeClient();
            
            // Initialize handlers
            console.log('🔍 Step 6: Initializing handlers...');
            await this.initializeHandlers();
            
            // Initialize monitoring system
            console.log('🔍 Step 7: Initializing monitoring...');
            await this.initializeMonitoring();
            
            // Login to Discord
            console.log('🔍 Step 8: Logging in to Discord...');
            await this.login();
            
            console.log('✅ Bot initialization completed successfully');
            logger.startup('Bot initialization completed successfully');
            
        } catch (error) {
            console.error('💥 Failed to start bot:', error);
            logger.error('Failed to start bot', error);
            process.exit(1);
        }
    }

    async initializeClient() {
        console.log('🔍 Creating Discord client with intents...');
        
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

        console.log('🔍 Setting up client event handlers...');

        // Set up basic error handling
        this.client.on('error', (error) => {
            console.error('Discord client error:', error);
            logger.error('Discord client error', error);
        });

        this.client.on('warn', (warning) => {
            console.warn('Discord client warning:', warning);
            logger.warn(`Discord client warning: ${warning}`);
        });

        this.client.on('rateLimit', (rateLimitData) => {
            console.warn('Rate limit encountered:', rateLimitData);
            logger.warn('Rate limit encountered', rateLimitData);
        });

        // Ready event
        this.client.once('ready', async () => {
            console.log('🔍 Discord client ready event fired');
            await this.onReady();
        });

        console.log('✅ Discord client initialized');
    }

    async initializeHandlers() {
        console.log('🔍 Initializing command handler...');
        this.commandHandler = new CommandHandler(this.client);
        
        console.log('🔍 Initializing event handler...');
        this.eventHandler = new EventHandler(this.client);
        
        console.log('🔍 Setting up interaction handling...');
        this.client.on('interactionCreate', async (interaction) => {
            console.log('Interaction received:', interaction.type);
            await this.commandHandler.handleInteraction(interaction);
        });
        
        console.log('✅ Handlers initialized');
    }

    async initializeMonitoring() {
        console.log('🔍 Creating monitoring system...');
        this.monitoringSystem = new MonitoringSystem(this.client);
        
        console.log('🔍 Setting up client references...');
        this.client.monitoring = this.monitoringSystem;
        this.client.neoprotect = neoprotect;
        this.client.database = database;
        
        console.log('✅ Monitoring system initialized');
    }

    async login() {
        console.log('🔍 Attempting Discord login...');
        
        if (!config.discord || !config.discord.token) {
            throw new Error('Discord token not found in config');
        }
        
        console.log('🔍 Token exists, logging in...');
        await this.client.login(config.discord.token);
        console.log('✅ Discord login successful');
    }

    async onReady() {
        console.log('🔍 Bot ready event handler called');
        this.isReady = true;
        const readyTime = Date.now() - this.startTime;
        
        console.log(`🎉 Bot is ready! Logged in as ${this.client.user.tag}`);
        console.log(`⚡ Ready in ${readyTime}ms`);
        
        logger.startup(`Bot is ready! Logged in as ${this.client.user.tag}`);
        logger.startup(`Ready in ${readyTime}ms`);
        
        // Set bot activity
        console.log('🔍 Setting bot activity...');
        await this.setActivity();
        
        // Start monitoring system
        console.log('🔍 Starting monitoring system...');
        try {
            this.monitoringSystem.start();
            console.log('✅ Monitoring system started');
        } catch (error) {
            console.error('⚠️ Failed to start monitoring system:', error.message);
        }
        
        console.log('🎉 Bot is fully operational!');
        logger.startup('Bot is fully operational');
        
        // Keep the process alive
        console.log('🔍 Bot startup complete, waiting for events...');
    }

    async setActivity() {
        try {
            await this.client.user.setActivity({
                name: 'DDoS Protection | /help',
                type: ActivityType.Watching
            });
            console.log('✅ Bot activity set');
        } catch (error) {
            console.error('⚠️ Failed to set activity:', error.message);
        }
    }

    async shutdown() {
        console.log('🔍 Starting graceful shutdown...');
        
        try {
            if (this.monitoringSystem) {
                console.log('🔍 Stopping monitoring system...');
                this.monitoringSystem.stop();
            }
            
            if (this.client) {
                console.log('🔍 Destroying Discord client...');
                this.client.destroy();
            }
            
            console.log('✅ Graceful shutdown completed');
        } catch (error) {
            console.error('❌ Error during shutdown:', error);
        }
    }
}

console.log('🔍 Step 9: Creating bot instance...');
const bot = new NeoProtectBot();

console.log('🔍 Step 10: Starting bot...');
bot.start().catch(error => {
    console.error('💥 Bot failed to start:', error);
    process.exit(1);
});

console.log('🔍 Step 11: Bot start command issued, waiting for completion...');