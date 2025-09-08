const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const config = require('../../config');
const logger = require('./logger');

class DatabaseManager {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.init();
    }

    async init() {
        try {
            // Ensure database directory exists
            const dbDir = path.dirname(config.database.path);
            if (!fs.existsSync(dbDir)) {
                fs.mkdirSync(dbDir, { recursive: true });
            }

            // Initialize database connection
            this.db = new sqlite3.Database(config.database.path, (err) => {
                if (err) {
                    logger.error('Failed to connect to database', err);
                    throw err;
                }
                logger.info('Connected to SQLite database');
            });

            // Enable foreign keys
            await this.run('PRAGMA foreign_keys = ON');
            
            // Create tables
            await this.createTables();
            
            this.isInitialized = true;
            logger.info('Database initialized successfully');
        } catch (error) {
            logger.error('Database initialization failed', error);
            throw error;
        }
    }

    async createTables() {
        const tables = [
            // Guilds table
            `CREATE TABLE IF NOT EXISTS guilds (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prefix TEXT DEFAULT '!',
                settings TEXT DEFAULT '{}',
                premium BOOLEAN DEFAULT FALSE,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Monitored IPs table
            `CREATE TABLE IF NOT EXISTS monitored_ips (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                alias TEXT,
                last_attack_id TEXT,
                alert_settings TEXT DEFAULT '{}',
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_active BOOLEAN DEFAULT TRUE,
                FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
                UNIQUE(guild_id, ip_address)
            )`,

            // Attack history table
            `CREATE TABLE IF NOT EXISTS attack_history (
                id TEXT PRIMARY KEY,
                ip_address TEXT NOT NULL,
                attack_type TEXT,
                start_time DATETIME NOT NULL,
                end_time DATETIME,
                peak_bps INTEGER,
                peak_pps INTEGER,
                duration INTEGER,
                status TEXT DEFAULT 'active',
                raw_data TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Alert logs table
            `CREATE TABLE IF NOT EXISTS alert_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                ip_address TEXT NOT NULL,
                attack_id TEXT NOT NULL,
                message_id TEXT,
                alert_type TEXT NOT NULL,
                sent_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
                FOREIGN KEY (attack_id) REFERENCES attack_history(id)
            )`,

            // User permissions table
            `CREATE TABLE IF NOT EXISTS user_permissions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                permissions TEXT DEFAULT '[]',
                granted_by TEXT NOT NULL,
                granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guild_id) REFERENCES guilds(id) ON DELETE CASCADE,
                UNIQUE(guild_id, user_id)
            )`,

            // API usage statistics
            `CREATE TABLE IF NOT EXISTS api_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER,
                response_time INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                error_message TEXT
            )`,

            // Bot statistics
            `CREATE TABLE IF NOT EXISTS bot_stats (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                metric_name TEXT NOT NULL,
                metric_value REAL NOT NULL,
                metadata TEXT DEFAULT '{}',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,

            // Settings cache
            `CREATE TABLE IF NOT EXISTS settings_cache (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                expires_at DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        for (const table of tables) {
            await this.run(table);
        }

        // Create indexes for better performance
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_monitored_ips_guild ON monitored_ips(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_monitored_ips_active ON monitored_ips(is_active)',
            'CREATE INDEX IF NOT EXISTS idx_attack_history_ip ON attack_history(ip_address)',
            'CREATE INDEX IF NOT EXISTS idx_attack_history_time ON attack_history(start_time)',
            'CREATE INDEX IF NOT EXISTS idx_alert_logs_guild ON alert_logs(guild_id)',
            'CREATE INDEX IF NOT EXISTS idx_api_usage_time ON api_usage(timestamp)',
            'CREATE INDEX IF NOT EXISTS idx_bot_stats_metric ON bot_stats(metric_name, timestamp)'
        ];

        for (const index of indexes) {
            await this.run(index);
        }

        logger.info('Database tables and indexes created successfully');
    }

    // Promisified database methods
    run(sql, params = []) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            this.db.run(sql, params, function(err) {
                const duration = Date.now() - startTime;
                logger.database('run', 'general', duration, err);
                
                if (err) {
                    reject(err);
                } else {
                    resolve({ id: this.lastID, changes: this.changes });
                }
            });
        });
    }

    get(sql, params = []) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            this.db.get(sql, params, (err, row) => {
                const duration = Date.now() - startTime;
                logger.database('get', 'general', duration, err);
                
                if (err) {
                    reject(err);
                } else {
                    resolve(row);
                }
            });
        });
    }

    all(sql, params = []) {
        return new Promise((resolve, reject) => {
            const startTime = Date.now();
            this.db.all(sql, params, (err, rows) => {
                const duration = Date.now() - startTime;
                logger.database('all', 'general', duration, err);
                
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    // Guild management
    async getGuild(guildId) {
        return await this.get('SELECT * FROM guilds WHERE id = ?', [guildId]);
    }

    async createGuild(guildId, name, settings = {}) {
        return await this.run(
            'INSERT OR REPLACE INTO guilds (id, name, settings) VALUES (?, ?, ?)',
            [guildId, name, JSON.stringify(settings)]
        );
    }

    async updateGuildSettings(guildId, settings) {
        return await this.run(
            'UPDATE guilds SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [JSON.stringify(settings), guildId]
        );
    }

    // Monitored IPs management
    async getMonitoredIPs(guildId) {
        return await this.all(
            'SELECT * FROM monitored_ips WHERE guild_id = ? AND is_active = TRUE ORDER BY created_at DESC',
            [guildId]
        );
    }

    async addMonitoredIP(guildId, channelId, ipAddress, alias, createdBy, alertSettings = {}) {
        return await this.run(
            `INSERT INTO monitored_ips 
             (guild_id, channel_id, ip_address, alias, created_by, alert_settings) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [guildId, channelId, ipAddress, alias, createdBy, JSON.stringify(alertSettings)]
        );
    }

    async removeMonitoredIP(guildId, ipAddress) {
        return await this.run(
            'UPDATE monitored_ips SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND ip_address = ?',
            [guildId, ipAddress]
        );
    }

    async updateLastAttackId(guildId, ipAddress, attackId) {
        return await this.run(
            'UPDATE monitored_ips SET last_attack_id = ?, updated_at = CURRENT_TIMESTAMP WHERE guild_id = ? AND ip_address = ?',
            [attackId, guildId, ipAddress]
        );
    }

    async getMonitoredIP(guildId, ipAddress) {
        return await this.get(
            'SELECT * FROM monitored_ips WHERE guild_id = ? AND ip_address = ? AND is_active = TRUE',
            [guildId, ipAddress]
        );
    }

    // Attack history management
    async saveAttack(attackData) {
        return await this.run(
            `INSERT OR REPLACE INTO attack_history 
             (id, ip_address, attack_type, start_time, peak_bps, peak_pps, raw_data) 
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                attackData.id,
                attackData.dstAddress?.ipv4,
                attackData.signatures?.[0]?.name,
                attackData.startedAt,
                attackData.signatures?.[0]?.bpsPeak,
                attackData.signatures?.[0]?.ppsPeak,
                JSON.stringify(attackData)
            ]
        );
    }

    async getAttackHistory(ipAddress, limit = 10) {
        return await this.all(
            'SELECT * FROM attack_history WHERE ip_address = ? ORDER BY start_time DESC LIMIT ?',
            [ipAddress, limit]
        );
    }

    async getAttackById(attackId) {
        return await this.get('SELECT * FROM attack_history WHERE id = ?', [attackId]);
    }

    // Alert logs
    async logAlert(guildId, channelId, ipAddress, attackId, messageId, alertType) {
        return await this.run(
            'INSERT INTO alert_logs (guild_id, channel_id, ip_address, attack_id, message_id, alert_type) VALUES (?, ?, ?, ?, ?, ?)',
            [guildId, channelId, ipAddress, attackId, messageId, alertType]
        );
    }

    async getAlertHistory(guildId, limit = 50) {
        return await this.all(
            'SELECT * FROM alert_logs WHERE guild_id = ? ORDER BY sent_at DESC LIMIT ?',
            [guildId, limit]
        );
    }

    // User permissions
    async getUserPermissions(guildId, userId) {
        const result = await this.get(
            'SELECT permissions FROM user_permissions WHERE guild_id = ? AND user_id = ?',
            [guildId, userId]
        );
        return result ? JSON.parse(result.permissions) : [];
    }

    async setUserPermissions(guildId, userId, permissions, grantedBy) {
        return await this.run(
            `INSERT OR REPLACE INTO user_permissions 
             (guild_id, user_id, permissions, granted_by, granted_at) 
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [guildId, userId, JSON.stringify(permissions), grantedBy]
        );
    }

    // API usage tracking
    async logApiUsage(endpoint, method, statusCode, responseTime, errorMessage = null) {
        return await this.run(
            'INSERT INTO api_usage (endpoint, method, status_code, response_time, error_message) VALUES (?, ?, ?, ?, ?)',
            [endpoint, method, statusCode, responseTime, errorMessage]
        );
    }

    async getApiStats(hours = 24) {
        return await this.all(
            `SELECT endpoint, COUNT(*) as requests, AVG(response_time) as avg_response_time,
             COUNT(CASE WHEN status_code >= 400 THEN 1 END) as errors
             FROM api_usage 
             WHERE timestamp > datetime('now', '-${hours} hours')
             GROUP BY endpoint ORDER BY requests DESC`,
            []
        );
    }

    // Bot statistics
    async recordMetric(metricName, value, metadata = {}) {
        return await this.run(
            'INSERT INTO bot_stats (metric_name, metric_value, metadata) VALUES (?, ?, ?)',
            [metricName, value, JSON.stringify(metadata)]
        );
    }

    async getMetrics(metricName, hours = 24) {
        return await this.all(
            'SELECT * FROM bot_stats WHERE metric_name = ? AND timestamp > datetime(\'now\', \'-? hours\') ORDER BY timestamp DESC',
            [metricName, hours]
        );
    }

    // Cache management
    async setCache(key, value, expiresIn = null) {
        const expiresAt = expiresIn ? new Date(Date.now() + expiresIn).toISOString() : null;
        return await this.run(
            'INSERT OR REPLACE INTO settings_cache (key, value, expires_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [key, JSON.stringify(value), expiresAt]
        );
    }

    async getCache(key) {
        const result = await this.get(
            'SELECT value, expires_at FROM settings_cache WHERE key = ?',
            [key]
        );
        
        if (!result) return null;
        
        // Check if expired
        if (result.expires_at && new Date(result.expires_at) < new Date()) {
            await this.run('DELETE FROM settings_cache WHERE key = ?', [key]);
            return null;
        }
        
        return JSON.parse(result.value);
    }

    async clearExpiredCache() {
        return await this.run('DELETE FROM settings_cache WHERE expires_at < datetime(\'now\')');
    }

    // Database maintenance
    async vacuum() {
        logger.info('Running database vacuum...');
        return await this.run('VACUUM');
    }

    async getTableSizes() {
        const tables = ['guilds', 'monitored_ips', 'attack_history', 'alert_logs', 'user_permissions', 'api_usage', 'bot_stats'];
        const sizes = {};
        
        for (const table of tables) {
            const result = await this.get(`SELECT COUNT(*) as count FROM ${table}`);
            sizes[table] = result.count;
        }
        
        return sizes;
    }

    // Backup functionality
    async createBackup() {
        try {
            const backupDir = path.join(__dirname, '../../backups');
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = path.join(backupDir, `backup-${timestamp}.db`);
            
            // Simple file copy for SQLite
            fs.copyFileSync(config.database.path, backupPath);
            
            logger.info(`Database backup created: ${backupPath}`);
            return backupPath;
        } catch (error) {
            logger.error('Failed to create database backup', error);
            throw error;
        }
    }

    // Close database connection
    close() {
        return new Promise((resolve) => {
            if (this.db) {
                this.db.close((err) => {
                    if (err) {
                        logger.error('Error closing database', err);
                    } else {
                        logger.info('Database connection closed');
                    }
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }
}

module.exports = new DatabaseManager();