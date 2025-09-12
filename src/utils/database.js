const { MongoClient, ObjectId } = require('mongodb');
const logger = require('./logger');

class MongoDatabase {
    constructor() {
        this.client = null;
        this.db = null;
        this.isConnected = false;
        
        // Simple URL-based connection
        this.connectionString = process.env.MONGODB_URL || 'mongodb://localhost:27017';
        this.dbName = process.env.MONGODB_DATABASE || 'neoprotect_bot';
        
        // Simple connection options
        this.options = {
            maxPoolSize: 10,
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            retryWrites: true
        };

        // Auto-connect when instantiated
        this.connect().catch(error => {
            logger.error('Failed to auto-connect to MongoDB:', error);
        });
    }

    async connect() {
        if (this.isConnected) {
            return true;
        }

        try {
            logger.info(`🍃 Connecting to MongoDB: ${this.connectionString.replace(/\/\/.*@/, '//***:***@')}`);
            
            this.client = new MongoClient(this.connectionString, this.options);
            await this.client.connect();
            
            this.db = this.client.db(this.dbName);
            this.isConnected = true;
            
            // Test the connection
            await this.db.admin().ping();
            
            logger.info(`✅ Connected to MongoDB database: ${this.dbName}`);
            
            // Create indexes
            await this.createIndexes();
            
            return true;
        } catch (error) {
            logger.error('❌ Failed to connect to MongoDB', error);
            this.isConnected = false;
            this.db = null;
            this.client = null;
            
            // Helpful error messages
            if (error.message.includes('ECONNREFUSED')) {
                logger.error('💡 MongoDB server is not running or connection URL is incorrect');
                logger.error('💡 Make sure your MONGODB_URL is correct in .env file');
            }
            
            throw error;
        }
    }

    async ensureConnection() {
        if (!this.isConnected || !this.db) {
            await this.connect();
        }
        return this.isConnected;
    }

    async createIndexes() {
        try {
            // Create indexes for better performance
            await this.db.collection('guilds').createIndex({ guild_id: 1 }, { unique: true, background: true });
            await this.db.collection('monitored_ips').createIndex({ guild_id: 1, ip_address: 1 }, { unique: true, background: true });
            await this.db.collection('attack_history').createIndex({ attack_id: 1 }, { unique: true, background: true });
            await this.db.collection('api_usage').createIndex({ timestamp: -1 }, { background: true });
            await this.db.collection('bot_stats').createIndex({ metric_name: 1, timestamp: -1 }, { background: true });
            
            logger.debug('✅ Database indexes created');
        } catch (error) {
            logger.warn('Error creating indexes (this is usually okay):', error.message);
        }
    }

    async disconnect() {
        try {
            if (this.client) {
                await this.client.close();
                this.isConnected = false;
                this.db = null;
                this.client = null;
                logger.info('Disconnected from MongoDB');
            }
        } catch (error) {
            logger.error('Error disconnecting from MongoDB', error);
        }
    }

    async testConnection() {
        try {
            await this.ensureConnection();
            await this.db.admin().ping();
            return true;
        } catch (error) {
            logger.error('Database connection test failed', error);
            throw error;
        }
    }

    // Guild management
    async getGuild(guildId) {
        try {
            await this.ensureConnection();
            return await this.db.collection('guilds').findOne({ guild_id: guildId });
        } catch (error) {
            logger.error('Error getting guild:', error);
            throw error;
        }
    }

    async createGuild(guildId, name, settings = {}) {
        try {
            await this.ensureConnection();
            const result = await this.db.collection('guilds').updateOne(
                { guild_id: guildId },
                {
                    $set: {
                        guild_id: guildId,
                        name: name,
                        settings: settings,
                        updated_at: new Date()
                    },
                    $setOnInsert: {
                        created_at: new Date(),
                        premium: false
                    }
                },
                { upsert: true }
            );
            logger.debug(`✅ Guild created/updated: ${name}`);
            return result;
        } catch (error) {
            logger.error('Error creating guild:', error);
            throw error;
        }
    }

    async updateGuildSettings(guildId, settings) {
        try {
            await this.ensureConnection();
            return await this.db.collection('guilds').updateOne(
                { guild_id: guildId },
                {
                    $set: {
                        settings: settings,
                        updated_at: new Date()
                    }
                }
            );
        } catch (error) {
            logger.error('Error updating guild settings:', error);
            throw error;
        }
    }

    // Monitored IPs management
    async getMonitoredIPs(guildId) {
        try {
            await this.ensureConnection();
            return await this.db.collection('monitored_ips')
                .find({ guild_id: guildId, is_active: true })
                .sort({ created_at: -1 })
                .toArray();
        } catch (error) {
            logger.error('Error getting monitored IPs:', error);
            throw error;
        }
    }

    async addMonitoredIP(guildId, channelId, ipAddress, alias, createdBy, alertSettings = {}) {
        try {
            await this.ensureConnection();
            
            const monitor = {
                guild_id: guildId,
                channel_id: channelId,
                ip_address: ipAddress,
                alias: alias,
                created_by: createdBy,
                alert_settings: alertSettings,
                last_attack_id: null,
                last_attack_time: null,
                total_attacks: 0,
                is_active: true,
                created_at: new Date(),
                updated_at: new Date()
            };

            const result = await this.db.collection('monitored_ips').insertOne(monitor);
            return { id: result.insertedId, ...monitor };
        } catch (error) {
            if (error.code === 11000) {
                throw new Error('IP address is already being monitored in this server');
            }
            logger.error('Error adding monitored IP:', error);
            throw error;
        }
    }

    async removeMonitoredIP(guildId, ipAddress) {
        try {
            await this.ensureConnection();
            return await this.db.collection('monitored_ips').updateOne(
                { guild_id: guildId, ip_address: ipAddress },
                {
                    $set: {
                        is_active: false,
                        updated_at: new Date()
                    }
                }
            );
        } catch (error) {
            logger.error('Error removing monitored IP:', error);
            throw error;
        }
    }

    async updateMonitor(monitorId, updates) {
        try {
            await this.ensureConnection();
            return await this.db.collection('monitored_ips').updateOne(
                { _id: new ObjectId(monitorId) },
                {
                    $set: {
                        ...updates,
                        updated_at: new Date()
                    }
                }
            );
        } catch (error) {
            logger.error('Error updating monitor:', error);
            throw error;
        }
    }

    async getMonitoredIP(guildId, ipAddress) {
        try {
            await this.ensureConnection();
            return await this.db.collection('monitored_ips').findOne({
                guild_id: guildId,
                ip_address: ipAddress,
                is_active: true
            });
        } catch (error) {
            logger.error('Error getting monitored IP:', error);
            throw error;
        }
    }

    async getAllActiveMonitors() {
        try {
            await this.ensureConnection();
            return await this.db.collection('monitored_ips')
                .find({ is_active: true })
                .sort({ created_at: -1 })
                .toArray();
        } catch (error) {
            logger.error('Error getting all active monitors:', error);
            return [];
        }
    }

    // API Usage logging
    async logApiUsage(endpoint, method, statusCode, responseTime, errorMessage = null) {
        try {
            await this.ensureConnection();
            const usage = {
                endpoint: endpoint,
                method: method,
                status_code: statusCode,
                response_time: responseTime,
                error_message: errorMessage,
                timestamp: new Date()
            };

            await this.db.collection('api_usage').insertOne(usage);
        } catch (error) {
            logger.warn('Failed to log API usage:', error.message);
        }
    }

    // Metrics and statistics
    async recordMetric(metricName, value, metadata = {}) {
        try {
            await this.ensureConnection();
            const metric = {
                metric_name: metricName,
                metric_value: value,
                metadata: metadata,
                timestamp: new Date()
            };

            await this.db.collection('bot_stats').insertOne(metric);
        } catch (error) {
            logger.warn('Failed to record metric:', error.message);
        }
    }

    async getMetrics(metricName, hoursBack = 24) {
        try {
            await this.ensureConnection();
            const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
            
            return await this.db.collection('bot_stats')
                .find({
                    metric_name: metricName,
                    timestamp: { $gte: cutoffTime }
                })
                .sort({ timestamp: -1 })
                .toArray();
        } catch (error) {
            logger.error('Error getting metrics:', error);
            return [];
        }
    }

    // Attack history
    async saveAttack(attackData) {
        try {
            await this.ensureConnection();
            const attack = {
                attack_id: attackData.id,
                ip_address: attackData.dstAddress?.ipv4 || attackData.target?.ip,
                attack_type: attackData.signatures?.[0]?.name || attackData.type,
                start_time: new Date(attackData.startedAt),
                end_time: attackData.endedAt ? new Date(attackData.endedAt) : null,
                peak_bps: attackData.signatures?.[0]?.bpsPeak || attackData.peakBandwidth,
                peak_pps: attackData.signatures?.[0]?.ppsPeak || attackData.peakPps,
                duration: attackData.duration,
                status: attackData.status || 'active',
                raw_data: attackData,
                created_at: new Date()
            };

            return await this.db.collection('attack_history').updateOne(
                { attack_id: attackData.id },
                { $set: attack },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error saving attack:', error);
            throw error;
        }
    }

    async getAttackHistory(ipAddress, limit = 10) {
        try {
            await this.ensureConnection();
            return await this.db.collection('attack_history')
                .find({ ip_address: ipAddress })
                .sort({ start_time: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error('Error getting attack history:', error);
            return [];
        }
    }

    async getAttackById(attackId) {
        try {
            await this.ensureConnection();
            return await this.db.collection('attack_history').findOne({ attack_id: attackId });
        } catch (error) {
            logger.error('Error getting attack by ID:', error);
            return null;
        }
    }

    // Alert logs
    async logAlert(guildId, channelId, ipAddress, attackId, messageId, alertType) {
        try {
            await this.ensureConnection();
            const alert = {
                guild_id: guildId,
                channel_id: channelId,
                ip_address: ipAddress,
                attack_id: attackId,
                message_id: messageId,
                alert_type: alertType,
                sent_at: new Date()
            };

            return await this.db.collection('alert_logs').insertOne(alert);
        } catch (error) {
            logger.error('Error logging alert:', error);
            throw error;
        }
    }

    async getAlertHistory(guildId, limit = 50) {
        try {
            await this.ensureConnection();
            return await this.db.collection('alert_logs')
                .find({ guild_id: guildId })
                .sort({ sent_at: -1 })
                .limit(limit)
                .toArray();
        } catch (error) {
            logger.error('Error getting alert history:', error);
            return [];
        }
    }

    // User permissions
    async getUserPermissions(guildId, userId) {
        try {
            await this.ensureConnection();
            const userPerms = await this.db.collection('user_permissions').findOne({
                guild_id: guildId,
                user_id: userId
            });
            return userPerms?.permissions || [];
        } catch (error) {
            logger.error('Error getting user permissions:', error);
            return [];
        }
    }

    async setUserPermissions(guildId, userId, permissions, grantedBy) {
        try {
            await this.ensureConnection();
            return await this.db.collection('user_permissions').updateOne(
                { guild_id: guildId, user_id: userId },
                {
                    $set: {
                        guild_id: guildId,
                        user_id: userId,
                        permissions: permissions,
                        granted_by: grantedBy,
                        granted_at: new Date()
                    }
                },
                { upsert: true }
            );
        } catch (error) {
            logger.error('Error setting user permissions:', error);
            throw error;
        }
    }

    // Cleanup and maintenance
    async cleanupOldMetrics(daysToKeep = 30) {
        try {
            await this.ensureConnection();
            const cutoffTime = new Date(Date.now() - (daysToKeep * 24 * 60 * 60 * 1000));
            
            const results = await Promise.all([
                this.db.collection('bot_stats').deleteMany({ timestamp: { $lt: cutoffTime } }),
                this.db.collection('api_usage').deleteMany({ timestamp: { $lt: cutoffTime } }),
                this.db.collection('alert_logs').deleteMany({ sent_at: { $lt: cutoffTime } })
            ]);
            
            const totalDeleted = results.reduce((sum, result) => sum + result.deletedCount, 0);
            logger.info(`Cleaned up ${totalDeleted} old records`);
            return totalDeleted;
        } catch (error) {
            logger.error('Error during cleanup:', error);
            throw error;
        }
    }

    async createBackup() {
        try {
            await this.ensureConnection();
            const backupData = {
                timestamp: new Date(),
                database: this.dbName,
                collections: {}
            };

            const collections = ['guilds', 'monitored_ips', 'attack_history', 'user_permissions'];
            
            for (const collectionName of collections) {
                backupData.collections[collectionName] = await this.db.collection(collectionName).find({}).toArray();
            }

            const backupPath = `./backups/mongodb_backup_${Date.now()}.json`;
            const fs = require('fs').promises;
            const path = require('path');
            
            // Ensure backups directory exists
            const backupDir = path.dirname(backupPath);
            const fsSync = require('fs');
            if (!fsSync.existsSync(backupDir)) {
                fsSync.mkdirSync(backupDir, { recursive: true });
            }
            
            await fs.writeFile(backupPath, JSON.stringify(backupData, null, 2));
            
            logger.info(`MongoDB backup created: ${backupPath}`);
            return backupPath;
        } catch (error) {
            logger.error('Error creating backup:', error);
            throw error;
        }
    }

    async getTableSizes() {
        try {
            await this.ensureConnection();
            const collections = ['guilds', 'monitored_ips', 'attack_history', 'alert_logs', 'user_permissions', 'api_usage', 'bot_stats'];
            const sizes = {};
            
            for (const collectionName of collections) {
                try {
                    const count = await this.db.collection(collectionName).countDocuments();
                    sizes[collectionName] = count;
                } catch (error) {
                    sizes[collectionName] = 0;
                }
            }
            
            return sizes;
        } catch (error) {
            logger.error('Error getting collection sizes:', error);
            return {};
        }
    }

    // Statistics for API
    async getApiStats(hoursBack = 24) {
        try {
            await this.ensureConnection();
            const cutoffTime = new Date(Date.now() - (hoursBack * 60 * 60 * 1000));
            
            const stats = await this.db.collection('api_usage')
                .aggregate([
                    { $match: { timestamp: { $gte: cutoffTime } } },
                    {
                        $group: {
                            _id: '$endpoint',
                            totalRequests: { $sum: 1 },
                            errors: { $sum: { $cond: [{ $gte: ['$status_code', 400] }, 1, 0] } },
                            avgResponseTime: { $avg: '$response_time' }
                        }
                    }
                ])
                .toArray();
            
            return stats;
        } catch (error) {
            logger.error('Error getting API stats:', error);
            return [];
        }
    }

    // Additional compatibility methods for stats
    async getSummaryStats() {
        try {
            await this.ensureConnection();
            const now = new Date();
            const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            
            const [
                totalRequests,
                totalErrors,
                recentAlerts,
                activeMonitors
            ] = await Promise.all([
                this.db.collection('api_usage').countDocuments({ timestamp: { $gte: last24h } }),
                this.db.collection('api_usage').countDocuments({ 
                    timestamp: { $gte: last24h },
                    status_code: { $gte: 400 }
                }),
                this.db.collection('alert_logs').countDocuments({ sent_at: { $gte: last24h } }),
                this.db.collection('monitored_ips').countDocuments({ is_active: true })
            ]);

            return {
                totalRequests,
                totalErrors,
                recentAlerts,
                activeMonitors,
                successRate: totalRequests > 0 ? ((totalRequests - totalErrors) / totalRequests * 100).toFixed(1) : 100
            };
        } catch (error) {
            logger.error('Error getting summary stats:', error);
            return {
                totalRequests: 0,
                totalErrors: 0,
                recentAlerts: 0,
                activeMonitors: 0,
                successRate: 100
            };
        }
    }
}

module.exports = new MongoDatabase();