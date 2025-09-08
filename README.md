# NeoProtect Discord Bot

Advanced DDoS monitoring and alerting system integrated with NeoProtect API for real-time attack detection and notification.

## Features

- 🛡️ **Real-time DDoS Monitoring** - Continuous monitoring of your IP addresses
- 🚨 **Instant Alerts** - Get notified immediately when attacks are detected
- 📊 **Detailed Analytics** - View comprehensive attack statistics and trends
- 🎯 **Multi-IP Support** - Monitor up to 10 IP addresses per Discord server
- ⚙️ **Customizable Alerts** - Configure alert settings and cooldowns
- 🔒 **Secure & Reliable** - Built with enterprise-grade security practices
- 📈 **Performance Metrics** - Built-in monitoring and health checks
- 🗄️ **Data Persistence** - SQLite database for storing monitoring data

## Quick Start

### Prerequisites

- Node.js 18.0.0 or higher
- Discord Bot Token
- NeoProtect API Key
- Basic understanding of Discord bot setup

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/neoprotect-bot.git
   cd neoprotect-bot
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Run the setup wizard**
   ```bash
   npm run setup
   ```
   This will guide you through configuration and create your `.env` file.

4. **Deploy slash commands**
   ```bash
   # For testing in a specific server (instant)
   npm run deploy -- --guild YOUR_GUILD_ID

   # For global deployment (takes up to 1 hour)
   npm run deploy -- --global
   ```

5. **Start the bot**
   ```bash
   npm start
   ```

### Manual Configuration

If you prefer to configure manually, create a `.env` file:

```env
# Discord Configuration
DISCORD_BOT_TOKEN=your_bot_token_here
DISCORD_CLIENT_ID=your_client_id_here
DISCORD_GUILD_ID=your_test_guild_id  # Optional, for development

# NeoProtect API
NEOPROTECT_API_KEY=your_neoprotect_api_key
NEOPROTECT_API_BASE_URL=https://api.neoprotect.net/v2

# Security
ADMIN_USER_IDS=your_user_id,another_admin_id

# Environment
NODE_ENV=production
```

## Commands

### Monitoring Commands

- `/monitor add <ip> [alias] [channel]` - Add an IP address to monitor
- `/monitor remove <ip>` - Stop monitoring an IP address
- `/monitor list` - List all monitored IPs in this server
- `/monitor test <ip>` - Send a test alert for an IP
- `/monitor status <ip>` - Check monitoring status for an IP

### Attack Information

- `/attacks [ip] [limit] [type] [timeframe]` - View recent DDoS attacks
- `/attack-info <id>` - Get detailed information about a specific attack

### Statistics & Analytics

- `/stats bot` - Bot performance and usage statistics
- `/stats monitoring` - Monitoring system statistics
- `/stats attacks [timeframe]` - Attack statistics and trends
- `/stats api` - NeoProtect API usage statistics

### General Commands

- `/help [category] [command]` - Get help with commands
- `/ping` - Check bot responsiveness
- `/status` - System health check

### Admin Commands (Requires Admin Permissions)

- `/admin reload <component>` - Reload bot components
- `/admin backup` - Create database backup
- `/admin health` - Detailed system health check
- `/admin cache <action>` - Manage bot cache
- `/admin monitoring <action>` - Control monitoring system
- `/admin database <action>` - Database management

## Bot Permissions

The bot requires the following Discord permissions:

### Required Permissions
- **Send Messages** - To send alerts and command responses
- **Use Slash Commands** - For slash command functionality
- **Embed Links** - To display rich embed messages

### Optional Permissions
- **Manage Channels** - For advanced monitoring commands (recommended for admins)

### Bot Invite URL

Replace `YOUR_CLIENT_ID` with your bot's client ID:

```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=274877908032&scope=bot%20applications.commands
```

## Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `DISCORD_BOT_TOKEN` | Discord bot token | - | ✅ |
| `DISCORD_CLIENT_ID` | Discord application client ID | - | ✅ |
| `NEOPROTECT_API_KEY` | NeoProtect API authentication key | - | ✅ |
| `ADMIN_USER_IDS` | Comma-separated admin user IDs | - | ❌ |
| `MONITOR_INTERVAL` | Monitoring check interval (ms) | 30000 | ❌ |
| `MAX_MONITORS_PER_GUILD` | Max monitors per server | 10 | ❌ |
| `ALERT_COOLDOWN` | Alert cooldown period (ms) | 300000 | ❌ |
| `LOG_LEVEL` | Logging level | info | ❌ |
| `NODE_ENV` | Environment mode | production | ❌ |

### Alert Configuration

You can customize alert behavior by modifying the monitor settings:

- **Alert Cooldown**: Minimum time between alerts for the same IP
- **Severity Threshold**: Minimum attack severity to trigger alerts
- **Channel Routing**: Different channels for different IP addresses

## Development

### Project Structure

```
neoprotect-bot/
├── src/
│   ├── commands/          # Slash commands organized by category
│   │   ├── monitoring/    # IP monitoring commands
│   │   ├── attacks/       # Attack information commands
│   │   ├── stats/         # Statistics commands
│   │   ├── general/       # General utility commands
│   │   └── admin/         # Administrative commands
│   ├── events/            # Discord.js event handlers
│   ├── handlers/          # Command and event handling
│   ├── utils/             # Utility modules
│   │   ├── database.js    # Database management
│   │   ├── logger.js      # Logging system
│   │   ├── monitor.js     # Monitoring system
│   │   └── neoprotect.js  # NeoProtect API client
│   └── index.js           # Main bot entry point
├── config/
│   └── index.js           # Configuration management
├── database/              # SQLite database files
├── logs/                  # Log files
├── backups/               # Database backups
├── .env                   # Environment configuration
└── package.json
```

### Development Commands

```bash
# Development mode with auto-restart
npm run dev

# Deploy commands to test guild
npm run deploy -- --guild YOUR_GUILD_ID

# Deploy commands globally
npm run deploy -- --global

# Create database backup
node -e "require('./src/utils/database').createBackup()"

# Run setup wizard
npm run setup
```

### Adding New Commands

1. Create a new file in the appropriate category folder under `src/commands/`
2. Follow the existing command structure:

```javascript
const { SlashCommandBuilder } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('command-name')
        .setDescription('Command description'),
    permissions: [], // Optional Discord permissions
    customPermissions: [], // Optional custom permissions
    guildOnly: false, // Whether command works only in guilds
    cooldown: 5, // Cooldown in seconds
    category: 'category-name',
    
    async execute(interaction) {
        // Command implementation
    }
};
```

3. Redeploy commands with `npm run deploy`

## Deployment

### Production Deployment

1. **Server Requirements**
   - Node.js 18+ runtime
   - Persistent storage for SQLite database
   - Network access to Discord and NeoProtect APIs

2. **Process Management**
   
   **Option 1: PM2 (Recommended)**
   ```bash
   npm install -g pm2
   pm2 start src/index.js --name "neoprotect-bot"
   pm2 save
   pm2 startup
   ```

   **Option 2: systemd**
   ```bash
   # Create service file
   sudo nano /etc/systemd/system/neoprotect-bot.service
   
   # Enable and start
   sudo systemctl enable neoprotect-bot
   sudo systemctl start neoprotect-bot
   ```

3. **Environment Configuration**
   - Set `NODE_ENV=production`
   - Configure proper log rotation
   - Set up automated backups
   - Configure monitoring and alerts

### Docker Deployment

```dockerfile
FROM node:18-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
EXPOSE 3000

CMD ["npm", "start"]
```

```yaml
# docker-compose.yml
version: '3.8'
services:
  neoprotect-bot:
    build: .
    restart: unless-stopped
    environment:
      - NODE_ENV=production
    volumes:
      - ./database:/app/database
      - ./logs:/app/logs
      - ./backups:/app/backups
    env_file:
      - .env
```

## Monitoring & Maintenance

### Health Checks

The bot includes comprehensive health monitoring:

- **Discord API connectivity**
- **NeoProtect API health**
- **Database responsiveness**
- **Memory usage tracking**
- **Performance metrics**

Use `/admin health` or `/status` commands to check system health.

### Database Maintenance

```bash
# Create backup
/admin backup

# Vacuum database
/admin database vacuum

# View database statistics
/admin database stats

# Clean old records
/admin database cleanup
```

### Log Management

Logs are automatically rotated and managed. Check log files in the `logs/` directory:

- `combined.log` - All log entries
- `error.log` - Error-level logs only

## Troubleshooting

### Common Issues

**Bot doesn't respond to commands**
- Check bot has required permissions
- Verify slash commands are deployed
- Check bot is online and connected

**Monitoring alerts not working**
- Verify NeoProtect API key is valid
- Check monitoring system status with `/stats monitoring`
- Ensure bot has permissions in alert channels

**Database errors**
- Check file permissions on database directory
- Verify disk space availability
- Review database logs

**High memory usage**
- Clear cache with `/admin cache clear`
- Restart bot to free memory
- Check for memory leaks in logs

### Getting Help

1. Check the logs in `logs/combined.log`
2. Use `/admin health` for detailed diagnostics
3. Review configuration in `.env` file
4. Check Discord bot permissions
5. Verify API connectivity

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Security

- Never commit your `.env` file
- Regularly rotate API keys
- Keep dependencies updated
- Monitor logs for suspicious activity
- Use strong admin passwords

## Support

- 📖 **Documentation**: Check this README and inline code comments
- 🐛 **Bug Reports**: Open an issue on GitHub
- 💡 **Feature Requests**: Open an issue with the enhancement label

---

**Made with ❤️ by UnknownGamerz for Vertuo Hosting**