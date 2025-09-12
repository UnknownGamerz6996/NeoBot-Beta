const path = require('path');
require('dotenv').config();

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
            applicationId: process.env.DISCORD_CLIENT_ID // Add this for proper command deployment
        };
    }

    // NeoProtect API Configuration
    get neoprotect() {
        return {
            apiKey: process.env.NEOPROTECT_API_KEY,
            baseURL: process.env.NEOPROTECT_API_BASE_URL || 'https://api.neoprotect.net/v2',
            timeout: parseInt(process.env.API_TIMEOUT) || 15000,
            retryAttempts: parseInt(process.env.API_RETRY_ATTEMPTS) || 3,
            retryDelay: parseInt(process.env.API_RETRY_DELAY) || 1000
        };
    }

    // Database Configuration
    get database() {
        return {
            path: process.env.DATABASE_PATH || './database/neoprotect.db',
            backupPath: process.env.DATABASE_BACKUP_PATH || './backups',
            maxConnections: parseInt(process.env.DB_MAX_CONNECTIONS) || 10,
            busyTimeout: parseInt(process.env.DB_BUSY_TIMEOUT) || 30000,
            pragma: {
                journal_mode: 'WAL',
                synchronous: 'NORMAL',
                cache_size: -16000, // 16MB cache
                temp_store: 'MEMORY',
                mmap_size: 268435456 // 256MB mmap
            }
        };
    }

    // Monitoring Configuration
    get monitoring() {
        return {
            interval: parseInt(process.env.MONITOR_INTERVAL) || 30000,
            maxMonitorsPerGuild: parseInt(process.env.MAX_MONITORS_PER_GUILD) || 10,
            alertCooldown: parseInt(process.env.ALERT_COOLDOWN) || 300000,
            maxConcurrentChecks: parseInt(process.env.MAX_CONCURRENT_CHECKS) || 5,
            healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL) || 60000,
            cleanupInterval: parseInt(process.env.CLEANUP_INTERVAL) || 3600000 // 1 hour
        };
    }

    // Security Configuration
    get security() {
        return {
            adminUserIds: process.env.ADMIN_USER_IDS?.split(',').filter(Boolean) || [],
            rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 60000,
            rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 10,
            maxApiKeysPerUser: parseInt(process.env.MAX_API_KEYS_PER_USER) || 3,
            tokenExpiration: parseInt(process.env.TOKEN_EXPIRATION) || 86400000 // 24 hours
        };
    }

    // Logging Configuration
    get logging() {
        return {
            level: process.env.LOG_LEVEL || (this.isProduction ? 'info' : 'debug'),
            maxSize: parseInt(process.env.LOG_FILE_MAX_SIZE) || 10485760, // 10MB
            maxFiles: parseInt(process.env.LOG_MAX_FILES) || 5,
            datePattern: process.env.LOG_DATE_PATTERN || 'YYYY-MM-DD',
            dir: process.env.LOG_DIR || './logs',
            format: {
                timestamp: true,
                colorize: !this.isProduction,
                prettyPrint: !this.isProduction
            }
        };
    }

    // Features Configuration
    get features() {
        return {
            autoBackup: this.parseBoolean(process.env.ENABLE_AUTO_BACKUP, true),
            analytics: this.parseBoolean(process.env.ENABLE_ANALYTICS, true),
            premiumFeatures: this.parseBoolean(process.env.ENABLE_PREMIUM_FEATURES, false),
            webDashboard: this.parseBoolean(process.env.WEB_ENABLED, false),
            notifications: this.parseBoolean(process.env.ENABLE_NOTIFICATIONS, true),
            healthChecks: this.parseBoolean(process.env.ENABLE_HEALTH_CHECKS, true)
        };
    }

    // Web Dashboard Configuration
    get web() {
        return {
            enabled: this.features.webDashboard,
            port: parseInt(process.env.WEB_PORT) || 3000,
            host: process.env.WEB_HOST || 'localhost',
            authSecret: process.env.WEB_AUTH_SECRET || this.generateSecret(),
            cors: {
                origin: process.env.WEB_CORS_ORIGIN?.split(',') || ['http://localhost:3000'],
                credentials: true
            },
            rateLimit: {
                windowMs: parseInt(process.env.WEB_RATE_LIMIT_WINDOW) || 900000, // 15 minutes
                max: parseInt(process.env.WEB_RATE_LIMIT_MAX) || 100
            }
        };
    }

    // Cache Configuration
    get cache() {
        return {
            ttl: parseInt(process.env.CACHE_TTL) || 300000, // 5 minutes
            maxSize: parseInt(process.env.CACHE_MAX_SIZE) || 1000,
            checkPeriod: parseInt(process.env.CACHE_CHECK_PERIOD) || 600000, // 10 minutes
            enabled: this.parseBoolean(process.env.CACHE_ENABLED, true)
        };
    }

    // UI Configuration
    get ui() {
        return {
            colors: {
                primary: parseInt(process.env.PRIMARY_COLOR, 16) || 0x3498DB,
                success: parseInt(process.env.SUCCESS_COLOR, 16) || 0x00FF00,
                error: parseInt(process.env.ERROR_COLOR, 16) || 0xFF0000,
                warning: parseInt(process.env.WARNING_COLOR, 16) || 0xFFFF00,
                info: parseInt(process.env.INFO_COLOR, 16) || 0x3498DB,
                secondary: parseInt(process.env.SECONDARY_COLOR, 16) || 0x95A5A6
            },
            limits: {
                maxEmbedFields: parseInt(process.env.MAX_EMBED_FIELDS) || 25,
                maxDescriptionLength: 4096,
                maxFieldValueLength: 1024,
                maxEmbedLength: 6000
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
                stats: '📊',
                health: '❤️',
                database: '💾'
            }
        };
    }

    // Performance Configuration
    get performance() {
        return {
            maxConcurrentRequests: parseInt(process.env.MAX_CONCURRENT_REQUESTS) || 10,
            requestTimeout: parseInt(process.env.REQUEST_TIMEOUT) || 15000,
            connectionPoolSize: parseInt(process.env.CONNECTION_POOL_SIZE) || 5,
            memoryThreshold: parseInt(process.env.MEMORY_THRESHOLD) || 512, // MB
            cpuThreshold: parseInt(process.env.CPU_THRESHOLD) || 80, // percentage
            maxEventLoopDelay: parseInt(process.env.MAX_EVENT_LOOP_DELAY) || 100 // ms
        };
    }

    // Notification Configuration
    get notifications() {
        return {
            channels: {
                alerts: process.env.ALERT_CHANNEL_ID,
                logs: process.env.LOG_CHANNEL_ID,
                errors: process.env.ERROR_CHANNEL_ID
            },
            webhooks: {
                alerts: process.env.ALERT_WEBHOOK_URL,
                errors: process.env.ERROR_WEBHOOK_URL
            },
            cooldowns: {
                sameAttack: parseInt(process.env.SAME_ATTACK_COOLDOWN) || 300000, // 5 minutes
                sameIP: parseInt(process.env.SAME_IP_COOLDOWN) || 60000, // 1 minute
                globalAlert: parseInt(process.env.GLOBAL_ALERT_COOLDOWN) || 10000 // 10 seconds
            }
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

        // Validate Discord token format (basic check)
        if (!process.env.DISCORD_BOT_TOKEN.match(/^[A-Za-z0-9._-]+$/)) {
            throw new Error('Invalid Discord bot token format');
        }

        // Validate client ID format
        if (!process.env.DISCORD_CLIENT_ID.match(/^\d+$/)) {
            throw new Error('Invalid Discord client ID format');
        }

        // Validate API key format (basic check)
        if (process.env.NEOPROTECT_API_KEY.length < 10) {
            throw new Error('NeoProtect API key appears to be too short');
        }

        console.log('✅ Environment validation passed');
    }

    // Utility methods
    parseBoolean(value, defaultValue = false) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            return value.toLowerCase() === 'true' || value === '1';
        }
        return defaultValue;
    }

    generateSecret(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
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

    get nodeEnv() {
        return process.env.NODE_ENV || 'development';
    }

    // Get configuration summary for debugging
    getConfigSummary() {
        return {
            environment: this.nodeEnv,
            features: Object.keys(this.features).filter(key => this.features[key]),
            monitoring: {
                interval: this.monitoring.interval,
                maxMonitors: this.monitoring.maxMonitorsPerGuild
            },
            performance: {
                memoryThreshold: this.performance.memoryThreshold,
                maxConcurrentRequests: this.performance.maxConcurrentRequests
            },
            security: {
                adminCount: this.security.adminUserIds.length,
                rateLimitEnabled: this.security.rateLimitMaxRequests > 0
            }
        };
    }
}

module.exports = new Config();