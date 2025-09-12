const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { MongoClient } = require('mongodb');
const config = require('../config');
const logger = require('./logger');

class DatabaseMigration {
    constructor() {
        this.sqliteDb = null;
        this.mongoClient = null;
        this.mongodb = null;
        this.migrationStats = {
            guilds: 0,
            monitored_ips: 0,
            attack_history: 0,
            alert_logs: 0,
            user_permissions: 0,
            api_usage: 0,
            bot_stats: 0,
            errors: 0
        };
    }

    async migrate() {
        try {
            logger.info('🚀 Starting SQLite to MongoDB migration...');
            
            // Check if SQLite database exists
            const sqlitePath = './database/neoprotect.db';
            if (!fs.existsSync(sqlitePath)) {
                logger.warn('No SQLite database found to migrate');
                return false;
            }

            // Connect to both databases
            await this.connectDatabases(sqlitePath);
            
            // Create MongoDB collections and indexes
            await this.setupMongoDB();
            
            // Migrate data table by table
            await this.migrateGuilds();
            await this.migrateMonitoredIPs();
            await this.migrateAttackHistory();
            await this.migrateAlertLogs();
            await this.migrateUserPermissions();
            await this.migrateApiUsage();
            await this.migrateBotStats();
            
            // Verify migration
            await this.verifyMigration();
            
            // Create backup of SQLite before cleanup
            await this.backupSQLite();
            
            logger.info('✅ Migration completed successfully!');
            this.logMigrationStats();
            
            return true;
            
        } catch (error) {
            logger.error('❌ Migration failed:', error);
            throw error;
        } finally {
            await this.cleanup();
        }
    }

    async connectDatabases(sqlitePath) {
        try {
            // Connect to SQLite
            logger.info('📂 Connecting to SQLite database...');
            this.sqliteDb = await this.openSQLite(sqlitePath);
            
            // Connect to MongoDB
            logger.info('🍃 Connecting to MongoDB...');
            const connectionString = config.getMongoConnectionString();
            this.mongoClient = new MongoClient(connectionString, {
                maxPoolSize: 10,
                serverSelectionTimeoutMS: 5000
            });
            
            await this.mongoClient.connect();
            this.mongodb = this.mongoClient.db(config.database.database);
            
            logger.info('✅ Connected to both databases');
        } catch (error) {
            logger.error('Failed to connect to databases:', error);
            throw error;
        }
    }

    openSQLite(path) {
        return new Promise((resolve, reject) => {
            const db = new sqlite3.Database(path, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(db);
                }
            });
        });
    }

    sqliteQuery(sql, params = []) {
        return new Promise((resolve, reject) => {
            this.sqliteDb.all(sql, params, (err, rows) => {
                if (err) {
                    reject(err);
                } else {
                    resolve(rows);
                }
            });
        });
    }

    async setupMongoDB() {
        try {
            logger.info('⚙️ Setting up MongoDB collections and indexes...');
            
            const collections = [
                'guilds', 'monitored_ips', 'attack_history', 
                'alert_logs', 'user_permissions', 'api_usage', 'bot_stats'
            ];

            // Create collections
            for (const collectionName of collections) {
                try {
                    await this.mongodb.createCollection(collectionName);
                } catch (error) {
                    if (error.code !== 48) { // NamespaceExists
                        throw error;
                    }
                }
            }

            // Create indexes
            await this.mongodb.collection('guilds').createIndex({ guild_id: 1 }, { unique: true });
            await this.mongodb.collection('monitored_ips').createIndex({ guild_id: 1, ip_address: 1 }, { unique: true });
            await this.mongodb.collection('attack_history').createIndex({ attack_id: 1 }, { unique: true });
            await this.mongodb.collection('alert_logs').createIndex({ guild_id: 1, sent_at: -1 });
            await this.mongodb.collection('user_permissions').createIndex({ guild_id: 1, user_id: 1 }, { unique: true });
            await this.mongodb.collection('api_usage').createIndex({ timestamp: -1 });
            await this.mongodb.collection('bot_stats').createIndex({ metric_name: 1, timestamp: -1 });
            
            logger.info('✅ MongoDB setup completed');
        } catch (error) {
            logger.error('Failed to setup MongoDB:', error);
            throw error;
        }
    }

    async migrateGuilds() {
        try {
            logger.info('📋 Migrating guilds...');
            
            const guilds = await this.sqliteQuery('SELECT * FROM guilds');
            
            if (guilds.length === 0) {
                logger.info('No guilds to migrate');
                return;
            }

            const mongoGuilds = guilds.map(guild => ({
                guild_id: guild.id,
                name: guild.name,
                settings: this.parseJSON(guild.settings) || {},
                premium: Boolean(guild.premium),
                created_at: new Date(guild.created_at),
                updated_at: new Date(guild.updated_at)
            }));

            await this.mongodb.collection('guilds').insertMany(mongoGuilds);
            this.migrationStats.guilds = mongoGuilds.length;
            
            logger.info(`✅ Migrated ${mongoGuilds.length} guilds`);
        } catch (error) {
            logger.error('Failed to migrate guilds:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateMonitoredIPs() {
        try {
            logger.info('👁️ Migrating monitored IPs...');
            
            const monitors = await this.sqliteQuery('SELECT * FROM monitored_ips');
            
            if (monitors.length === 0) {
                logger.info('No monitored IPs to migrate');
                return;
            }

            const mongoMonitors = monitors.map(monitor => ({
                guild_id: monitor.guild_id,
                channel_id: monitor.channel_id,
                ip_address: monitor.ip_address,
                alias: monitor.alias,
                last_attack_id: monitor.last_attack_id,
                last_attack_time: monitor.last_attack_time ? new Date(monitor.last_attack_time) : null,
                total_attacks: monitor.total_attacks || 0,
                alert_settings: this.parseJSON(monitor.alert_settings) || {},
                created_by: monitor.created_by,
                is_active: Boolean(monitor.is_active),
                created_at: new Date(monitor.created_at),
                updated_at: new Date(monitor.updated_at)
            }));

            await this.mongodb.collection('monitored_ips').insertMany(mongoMonitors);
            this.migrationStats.monitored_ips = mongoMonitors.length;
            
            logger.info(`✅ Migrated ${mongoMonitors.length} monitored IPs`);
        } catch (error) {
            logger.error('Failed to migrate monitored IPs:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateAttackHistory() {
        try {
            logger.info('🚨 Migrating attack history...');
            
            const attacks = await this.sqliteQuery('SELECT * FROM attack_history');
            
            if (attacks.length === 0) {
                logger.info('No attack history to migrate');
                return;
            }

            const mongoAttacks = attacks.map(attack => ({
                attack_id: attack.id,
                ip_address: attack.ip_address,
                attack_type: attack.attack_type,
                start_time: new Date(attack.start_time),
                end_time: attack.end_time ? new Date(attack.end_time) : null,
                peak_bps: attack.peak_bps,
                peak_pps: attack.peak_pps,
                duration: attack.duration,
                status: attack.status || 'active',
                raw_data: this.parseJSON(attack.raw_data) || {},
                created_at: new Date(attack.created_at)
            }));

            // Insert in batches to avoid memory issues
            const batchSize = 1000;
            for (let i = 0; i < mongoAttacks.length; i += batchSize) {
                const batch = mongoAttacks.slice(i, i + batchSize);
                await this.mongodb.collection('attack_history').insertMany(batch);
            }
            
            this.migrationStats.attack_history = mongoAttacks.length;
            logger.info(`✅ Migrated ${mongoAttacks.length} attack records`);
        } catch (error) {
            logger.error('Failed to migrate attack history:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateAlertLogs() {
        try {
            logger.info('📢 Migrating alert logs...');
            
            const alerts = await this.sqliteQuery('SELECT * FROM alert_logs');
            
            if (alerts.length === 0) {
                logger.info('No alert logs to migrate');
                return;
            }

            const mongoAlerts = alerts.map(alert => ({
                guild_id: alert.guild_id,
                channel_id: alert.channel_id,
                ip_address: alert.ip_address,
                attack_id: alert.attack_id,
                message_id: alert.message_id,
                alert_type: alert.alert_type,
                sent_at: new Date(alert.sent_at)
            }));

            await this.mongodb.collection('alert_logs').insertMany(mongoAlerts);
            this.migrationStats.alert_logs = mongoAlerts.length;
            
            logger.info(`✅ Migrated ${mongoAlerts.length} alert logs`);
        } catch (error) {
            logger.error('Failed to migrate alert logs:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateUserPermissions() {
        try {
            logger.info('🔐 Migrating user permissions...');
            
            const permissions = await this.sqliteQuery('SELECT * FROM user_permissions');
            
            if (permissions.length === 0) {
                logger.info('No user permissions to migrate');
                return;
            }

            const mongoPermissions = permissions.map(perm => ({
                guild_id: perm.guild_id,
                user_id: perm.user_id,
                permissions: this.parseJSON(perm.permissions) || [],
                granted_by: perm.granted_by,
                granted_at: new Date(perm.granted_at)
            }));

            await this.mongodb.collection('user_permissions').insertMany(mongoPermissions);
            this.migrationStats.user_permissions = mongoPermissions.length;
            
            logger.info(`✅ Migrated ${mongoPermissions.length} user permissions`);
        } catch (error) {
            logger.error('Failed to migrate user permissions:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateApiUsage() {
        try {
            logger.info('📊 Migrating API usage stats...');
            
            const apiStats = await this.sqliteQuery('SELECT * FROM api_usage ORDER BY timestamp DESC LIMIT 10000');
            
            if (apiStats.length === 0) {
                logger.info('No API usage stats to migrate');
                return;
            }

            const mongoApiStats = apiStats.map(stat => ({
                endpoint: stat.endpoint,
                method: stat.method,
                status_code: stat.status_code,
                response_time: stat.response_time,
                error_message: stat.error_message,
                timestamp: new Date(stat.timestamp)
            }));

            await this.mongodb.collection('api_usage').insertMany(mongoApiStats);
            this.migrationStats.api_usage = mongoApiStats.length;
            
            logger.info(`✅ Migrated ${mongoApiStats.length} API usage records`);
        } catch (error) {
            logger.error('Failed to migrate API usage:', error);
            this.migrationStats.errors++;
        }
    }

    async migrateBotStats() {
        try {
            logger.info('📈 Migrating bot statistics...');
            
            const botStats = await this.sqliteQuery('SELECT * FROM bot_stats ORDER BY timestamp DESC LIMIT 10000');
            
            if (botStats.length === 0) {
                logger.info('No bot stats to migrate');
                return;
            }

            const mongoBotStats = botStats.map(stat => ({
                metric_name: stat.metric_name,
                metric_value: stat.metric_value,
                metadata: this.parseJSON(stat.metadata) || {},
                timestamp: new Date(stat.timestamp)
            }));

            await this.mongodb.collection('bot_stats').insertMany(mongoBotStats);
            this.migrationStats.bot_stats = mongoBotStats.length;
            
            logger.info(`✅ Migrated ${mongoBotStats.length} bot statistics`);
        } catch (error) {
            logger.error('Failed to migrate bot stats:', error);
            this.migrationStats.errors++;
        }
    }

    async verifyMigration() {
        try {
            logger.info('🔍 Verifying migration...');
            
            const verificationResults = {};
            
            // Check each collection count
            const collections = ['guilds', 'monitored_ips', 'attack_history', 'alert_logs', 'user_permissions'];
            
            for (const collection of collections) {
                const mongoCount = await this.mongodb.collection(collection).countDocuments();
                verificationResults[collection] = {
                    migrated: this.migrationStats[collection],
                    inMongo: mongoCount,
                    match: this.migrationStats[collection] === mongoCount
                };
            }
            
            logger.info('Migration verification results:', verificationResults);
            
            const allMatch = Object.values(verificationResults).every(result => result.match);
            if (!allMatch) {
                logger.warn('⚠️ Some collections have mismatched counts - please review');
            } else {
                logger.info('✅ All collection counts verified successfully');
            }
        } catch (error) {
            logger.error('Error during verification:', error);
        }
    }

    async backupSQLite() {
        try {
            logger.info('💾 Creating SQLite backup...');
            
            const backupDir = './backups';
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${backupDir}/sqlite_backup_${timestamp}.db`;
            
            fs.copyFileSync('./database/neoprotect.db', backupPath);
            
            logger.info(`✅ SQLite backup created: ${backupPath}`);
        } catch (error) {
            logger.error('Failed to backup SQLite:', error);
        }
    }

    async cleanup() {
        try {
            if (this.sqliteDb) {
                this.sqliteDb.close();
            }
            if (this.mongoClient) {
                await this.mongoClient.close();
            }
        } catch (error) {
            logger.error('Error during cleanup:', error);
        }
    }

    parseJSON(jsonString) {
        try {
            return JSON.parse(jsonString);
        } catch {
            return null;
        }
    }

    logMigrationStats() {
        logger.info('📊 Migration Statistics:');
        logger.info(`  Guilds: ${this.migrationStats.guilds}`);
        logger.info(`  Monitored IPs: ${this.migrationStats.monitored_ips}`);
        logger.info(`  Attack History: ${this.migrationStats.attack_history}`);
        logger.info(`  Alert Logs: ${this.migrationStats.alert_logs}`);
        logger.info(`  User Permissions: ${this.migrationStats.user_permissions}`);
        logger.info(`  API Usage: ${this.migrationStats.api_usage}`);
        logger.info(`  Bot Stats: ${this.migrationStats.bot_stats}`);
        logger.info(`  Errors: ${this.migrationStats.errors}`);
        
        const totalRecords = Object.values(this.migrationStats)
            .filter((value, index, array) => index !== array.length - 1) // Exclude errors
            .reduce((sum, count) => sum + count, 0);
        
        logger.info(`  Total Records Migrated: ${totalRecords}`);
    }
}

// Export for use in other files
module.exports = DatabaseMigration;

// Allow running directly
if (require.main === module) {
    const migration = new DatabaseMigration();
    migration.migrate()
        .then(() => {
            console.log('Migration completed successfully!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Migration failed:', error);
            process.exit(1);
        });
}