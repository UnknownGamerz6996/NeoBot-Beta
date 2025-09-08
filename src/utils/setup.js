const fs = require('fs');
const path = require('path');
const readline = require('readline');

class BotSetup {
    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async run() {
        console.log('\n🚀 NeoProtect Discord Bot Setup');
        console.log('=' .repeat(40));
        
        try {
            // Check if .env already exists
            const envPath = path.join(__dirname, '../../.env');
            if (fs.existsSync(envPath)) {
                const overwrite = await this.question('⚠️  .env file already exists. Overwrite? (y/N): ');
                if (overwrite.toLowerCase() !== 'y') {
                    console.log('Setup cancelled.');
                    this.rl.close();
                    return;
                }
            }

            console.log('\n📋 Please provide the following information:\n');

            // Discord Bot Configuration
            const discordToken = await this.question('Discord Bot Token: ');
            const discordClientId = await this.question('Discord Client ID: ');
            const guildId = await this.question('Test Guild ID (optional, for dev): ');

            // NeoProtect API Configuration
            const neoprotectApiKey = await this.question('NeoProtect API Key: ');

            // Optional configurations
            console.log('\n⚙️  Optional Configuration (press Enter for defaults):\n');
            
            const webEnabled = await this.question('Enable web dashboard? (y/N): ');
            const logLevel = await this.question('Log level (debug/info/warn/error) [info]: ') || 'info';
            const nodeEnv = await this.question('Environment (development/production) [production]: ') || 'production';

            // Generate admin user IDs
            console.log('\n👤 Admin Users:');
            const adminIds = [];
            let addMore = true;
            while (addMore) {
                const adminId = await this.question('Admin User ID (or press Enter to finish): ');
                if (adminId.trim()) {
                    adminIds.push(adminId.trim());
                } else {
                    addMore = false;
                }
            }

            // Create .env content
            const envContent = this.generateEnvContent({
                discordToken,
                discordClientId,
                guildId,
                neoprotectApiKey,
                webEnabled: webEnabled.toLowerCase() === 'y',
                logLevel,
                nodeEnv,
                adminIds
            });

            // Write .env file
            fs.writeFileSync(envPath, envContent);
            console.log('\n✅ .env file created successfully!');

            // Create necessary directories
            this.createDirectories();

            // Display next steps
            this.displayNextSteps();

        } catch (error) {
            console.error('\n❌ Setup failed:', error.message);
        } finally {
            this.rl.close();
        }
    }

    generateEnvContent(config) {
        return `# Discord Bot Configuration
DISCORD_BOT_TOKEN=${config.discordToken}
DISCORD_CLIENT_ID=${config.discordClientId}
${config.guildId ? `DISCORD_GUILD_ID=${config.guildId}` : '# DISCORD_GUILD_ID=your_test_guild_id_here'}

# NeoProtect API Configuration
NEOPROTECT_API_KEY=${config.neoprotectApiKey}
NEOPROTECT_API_BASE_URL=https://api.neoprotect.net/v2

# Database Configuration
DATABASE_PATH=./database/neoprotect.db

# Monitoring Configuration
MONITOR_INTERVAL=30000
MAX_MONITORS_PER_GUILD=10
ALERT_COOLDOWN=300000

# Web Dashboard Configuration
WEB_ENABLED=${config.webEnabled}
WEB_PORT=3000
WEB_AUTH_SECRET=${this.generateSecret()}

# Logging Configuration
LOG_LEVEL=${config.logLevel}
LOG_FILE_MAX_SIZE=10485760
LOG_MAX_FILES=5

# Security Configuration
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=10
${config.adminIds.length > 0 ? `ADMIN_USER_IDS=${config.adminIds.join(',')}` : '# ADMIN_USER_IDS=your_user_id_here,another_user_id'}

# Performance Configuration
CACHE_TTL=300000
API_TIMEOUT=10000
MAX_EMBED_FIELDS=25

# Feature Flags
ENABLE_ANALYTICS=true
ENABLE_AUTO_BACKUP=true
ENABLE_PREMIUM_FEATURES=false

# Notification Configuration
DEFAULT_ALERT_COLOR=0xFF0000
SUCCESS_COLOR=0x00FF00
WARNING_COLOR=0xFFFF00
INFO_COLOR=0x3498DB

# Environment
NODE_ENV=${config.nodeEnv}
`;
    }

    generateSecret(length = 32) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let result = '';
        for (let i = 0; i < length; i++) {
            result += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        return result;
    }

    createDirectories() {
        const dirs = [
            'database',
            'logs',
            'backups'
        ];

        console.log('\n📁 Creating directories...');
        dirs.forEach(dir => {
            const dirPath = path.join(__dirname, '../../', dir);
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`   ✅ Created ${dir}/`);
            } else {
                console.log(`   ℹ️  ${dir}/ already exists`);
            }
        });
    }

    displayNextSteps() {
        console.log('\n🎉 Setup Complete!');
        console.log('=' .repeat(40));
        console.log('\n📋 Next Steps:');
        console.log('1. Install dependencies: npm install');
        console.log('2. Start the bot: npm start');
        console.log('3. Invite the bot to your server with these permissions:');
        console.log('   • Send Messages');
        console.log('   • Use Slash Commands');
        console.log('   • Embed Links');
        console.log('   • Manage Channels (optional)');
        console.log('\n4. Test the bot with /help command');
        console.log('5. Add your first monitor with /monitor add');
        console.log('\n🔗 Bot Invite URL:');
        console.log(`https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877908032&scope=bot%20applications.commands`);
        console.log('\nReplace YOUR_CLIENT_ID with your actual Discord Client ID.');
        console.log('\n📚 Documentation: Check README.md for detailed usage instructions');
        console.log('🆘 Support: Use /help command or check the documentation');
    }

    question(query) {
        return new Promise(resolve => {
            this.rl.question(query, resolve);
        });
    }
}

// Run setup if this file is executed directly
if (require.main === module) {
    const setup = new BotSetup();
    setup.run().catch(console.error);
}

module.exports = BotSetup;