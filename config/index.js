const { config } = require('dotenv');
const path = require('path');

// Load environment variables
config();

class Config {
    constructor() {
        this.validateEnvironment();
    }

    // Discord Configuration
    get discord() {
        return {
            token: process.env.DISCORD_BOT_TOKEN,
            clientId: process.env.DISCORD_CLIENT_ID,
            guildId: process.env.DISCORD_GUILD_ID,
            intents: [
                'Guilds',
                'GuildMessages',
                'MessageContent',
                'GuildMembers'
            ],
            partials: ['Message', 'Channel', 'Reaction']
        };
    }

    // NeoProtect API Configuration
    get neoprotect() {
        return {
            apiKey: process.env.NEOPROTECT_API_KEY,
            baseURL: process.env.NEOPROTECT_API_BASE_URL || 'https://api.neoprotect.net/v2',
            timeout: parseInt(process.env.API_TIMEOUT) || 10000,
            retryAttempts: 3,
            retryDelay: 1000
        };
    }

    // Database Configuration
    get database() {
        return {
            path: process.env.DATABASE_PATH || './database/neoprotect.db',
            backup: {
                enabled: process.env.ENABLE_AUTO_BACKUP === 'true',
                interval: '0 2 * * *', // Daily at 2 AM
                retention: 7 // Keep 7 backups
            }
        };
    }

    // Monitoring Configuration
    get monitoring() {
        return {
            interval: parseInt(process.env.MONITOR_INTERVAL) || 30000,
            maxMonitorsPerGuild: parseInt(process.env.MAX_MONITORS_PER_GUILD) || 10,
            alertCooldown: parseInt(process.env.ALERT_COOLDOWN) || 300000,
            cacheTimeout: parseInt(process.env.CACHE_TTL) || 300000
        };
    }

    // Web Dashboard Configuration
    get web() {
        return {
            enabled: process.env.WEB_ENABLED === 'true',
            port: parseInt(process.env.WEB_PORT) || 3000,
            authSecret: process.env.WEB_AUTH_SECRET,
            cors: {
                origin: process.env.CORS_ORIGIN || '*',
                credentials: true
            }
        };
    }

    // Logging Configuration
    get logging() {
        return {
            level: process.env.LOG_LEVEL || 'info',
            file: {
                enabled: true,
                maxSize: parseInt(process.env.LOG_FILE_MAX_SIZE) || 10485760, // 10MB
                maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
                filename: path.join(__dirname, '../logs/bot-%DATE%.log')
            },
            console: {
                enabled: true,
                colorize: true,
                timestamp: true
            }
        };
    }

    // Security Configuration
    get security() {
        return {
            rateLimit: {
                windowMs: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
                max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
                skipSuccessfulRequests: true
            },
            adminUserIds: process.env.ADMIN_USER_IDS ? 
                process.env.ADMIN_USER_IDS.split(',').map(id => id.trim()) : [],
            encryptionKey: process.env.ENCRYPTION_KEY || 'default-key-change-in-production'
        };
    }

    // Feature Flags
    get features() {
        return {
            analytics: process.env.ENABLE_ANALYTICS === 'true',
            autoBackup: process.env.ENABLE_AUTO_BACKUP === 'true',
            premium: process.env.ENABLE_PREMIUM_FEATURES === 'true',
            webDashboard: process.env.WEB_ENABLED === 'true'
        };
    }

    // UI Configuration
    get ui() {
        return {
            colors: {
                error: parseInt(process.env.DEFAULT_ALERT_COLOR) || 0xFF0000,
                success: parseInt(process.env.SUCCESS_COLOR) || 0x00FF00,
                warning: parseInt(process.env.WARNING_COLOR) || 0xFFFF00,
                info: parseInt(process.env.INFO_COLOR) || 0x3498DB,
                primary: 0x7289DA,
                secondary: 0x99AAB5
            },
            limits: {
                maxEmbedFields: parseInt(process.env.MAX_EMBED_FIELDS) || 25,
                maxDescriptionLength: 4096,
                maxFieldValueLength: 1024
            },
            emojis: {
                success: '✅',
                error: '❌',
                warning: '⚠️',
                info: 'ℹ️',
                loading: '🔄',
                attack: '🚨',
                shield: '🛡️',
                target: '🎯',
                monitor: '👁️',
                stats: '📊'
            }
        };
    }

    // Performance Configuration
    get performance() {
        return {
            maxConcurrentRequests: 10,
            requestTimeout: 15000,
            connectionPoolSize: 5,
            memoryThreshold: 512 // MB
        };
    }

    // Validation
    validateEnvironment() {
        const required = [
            'DISCORD_BOT_TOKEN',
            'DISCORD_CLIENT_ID',
            'NEOPROTECT_API_KEY'
        ];

        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
        }

        // Validate Discord token format
        if (!process.env.DISCORD_BOT_TOKEN.match(/^[A-Za-z0-9._-]+$/)) {
            throw new Error('Invalid Discord bot token format');
        }

        // Validate client ID format
        if (!process.env.DISCORD_CLIENT_ID.match(/^\d+$/)) {
            throw new Error('Invalid Discord client ID format');
        }

        console.log('✅ Environment validation passed');
    }

    // Environment helpers
    get isDevelopment() {
        return process.env.NODE_ENV === 'development';
    }

    get isProduction() {
        return process.env.NODE_ENV === 'production';
    }

    get isTesting() {
        return process.env.NODE_ENV === 'test';
    }
}

module.exports = new Config();