const { REST, Routes } = require('discord.js');
const fs = require('fs');
const path = require('path');
const config = require('../../config');

class CommandDeployer {
    constructor() {
        this.rest = new REST({ version: '10' }).setToken(config.discord.token);
        this.commands = [];
    }

    async loadCommands() {
        console.log('📁 Loading commands...');
        
        const commandsPath = path.join(__dirname, '../commands');
        const commandFolders = fs.readdirSync(commandsPath).filter(folder =>
            fs.statSync(path.join(commandsPath, folder)).isDirectory()
        );

        for (const folder of commandFolders) {
            const folderPath = path.join(commandsPath, folder);
            const commandFiles = fs.readdirSync(folderPath).filter(file =>
                file.endsWith('.js')
            );

            for (const file of commandFiles) {
                const filePath = path.join(folderPath, file);
                
                try {
                    const command = require(filePath);
                    
                    if (this.validateCommand(command)) {
                        this.commands.push(command.data.toJSON());
                        console.log(`   ✅ Loaded ${command.data.name} from ${folder}`);
                    } else {
                        console.log(`   ❌ Invalid command: ${file}`);
                    }
                } catch (error) {
                    console.error(`   ❌ Failed to load ${file}:`, error.message);
                }
            }
        }

        console.log(`📊 Loaded ${this.commands.length} commands total\n`);
    }

    validateCommand(command) {
        return command 
            && typeof command.execute === 'function'
            && command.data 
            && command.data.name
            && command.data.description
            && typeof command.data.toJSON === 'function';
    }

    async deployGlobal() {
        try {
            console.log('🌍 Deploying commands globally...');
            console.log(`📤 Deploying ${this.commands.length} commands...`);

            const data = await this.rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: this.commands }
            );

            console.log(`✅ Successfully deployed ${data.length} global commands!`);
            console.log('⏰ Note: Global commands may take up to 1 hour to appear everywhere\n');
            
            return data;
        } catch (error) {
            console.error('❌ Failed to deploy global commands:', error);
            throw error;
        }
    }

    async deployGuild(guildId) {
        try {
            console.log(`🏠 Deploying commands to guild ${guildId}...`);
            console.log(`📤 Deploying ${this.commands.length} commands...`);

            const data = await this.rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, guildId),
                { body: this.commands }
            );

            console.log(`✅ Successfully deployed ${data.length} guild commands!`);
            console.log('⚡ Guild commands are available immediately\n');
            
            return data;
        } catch (error) {
            console.error(`❌ Failed to deploy guild commands to ${guildId}:`, error);
            throw error;
        }
    }

    async deleteGlobalCommands() {
        try {
            console.log('🗑️  Deleting all global commands...');
            
            const data = await this.rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: [] }
            );

            console.log('✅ Successfully deleted all global commands!\n');
            return data;
        } catch (error) {
            console.error('❌ Failed to delete global commands:', error);
            throw error;
        }
    }

    async deleteGuildCommands(guildId) {
        try {
            console.log(`🗑️  Deleting all guild commands from ${guildId}...`);
            
            const data = await this.rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, guildId),
                { body: [] }
            );

            console.log(`✅ Successfully deleted all guild commands from ${guildId}!\n`);
            return data;
        } catch (error) {
            console.error(`❌ Failed to delete guild commands from ${guildId}:`, error);
            throw error;
        }
    }

    async listCommands(guildId = null) {
        try {
            const route = guildId 
                ? Routes.applicationGuildCommands(config.discord.clientId, guildId)
                : Routes.applicationCommands(config.discord.clientId);
            
            const commands = await this.rest.get(route);
            
            console.log(`📋 ${guildId ? 'Guild' : 'Global'} commands currently deployed:`);
            if (commands.length === 0) {
                console.log('   No commands deployed');
            } else {
                commands.forEach(cmd => {
                    console.log(`   • ${cmd.name} - ${cmd.description}`);
                });
            }
            console.log(`   Total: ${commands.length} commands\n`);
            
            return commands;
        } catch (error) {
            console.error(`❌ Failed to list commands:`, error);
            throw error;
        }
    }

    displayHelp() {
        console.log('\n🔧 NeoProtect Bot - Command Deployment Tool');
        console.log('=' .repeat(50));
        console.log('\nUsage: node src/utils/deploy-commands.js [options]\n');
        console.log('Options:');
        console.log('  --global              Deploy commands globally');
        console.log('  --guild <id>          Deploy commands to specific guild');
        console.log('  --delete-global       Delete all global commands');
        console.log('  --delete-guild <id>   Delete all guild commands');
        console.log('  --list                List current global commands');
        console.log('  --list-guild <id>     List current guild commands');
        console.log('  --help                Show this help message');
        console.log('\nExamples:');
        console.log('  node src/utils/deploy-commands.js --global');
        console.log('  node src/utils/deploy-commands.js --guild 123456789012345678');
        console.log('  node src/utils/deploy-commands.js --list');
        console.log('  node src/utils/deploy-commands.js --delete-global');
        console.log('\nNotes:');
        console.log('  • Global commands take up to 1 hour to propagate');
        console.log('  • Guild commands are available immediately');
        console.log('  • Use guild deployment for testing');
        console.log('  • Use global deployment for production\n');
    }

    async run() {
        const args = process.argv.slice(2);
        
        if (args.length === 0 || args.includes('--help')) {
            this.displayHelp();
            return;
        }

        try {
            // Validate configuration
            if (!config.discord.token || !config.discord.clientId) {
                throw new Error('Missing Discord configuration. Please check your .env file.');
            }

            console.log('🚀 NeoProtect Bot - Command Deployment');
            console.log('=' .repeat(40));
            console.log(`📱 Client ID: ${config.discord.clientId}`);
            console.log(`🔑 Token: ${config.discord.token.substring(0, 10)}...\n`);

            // Load commands first (except for list/delete operations)
            if (!args.includes('--list') && !args.includes('--list-guild') && 
                !args.includes('--delete-global') && !args.includes('--delete-guild')) {
                await this.loadCommands();
            }

            // Process command line arguments
            if (args.includes('--global')) {
                await this.deployGlobal();
            } 
            else if (args.includes('--guild')) {
                const guildIndex = args.indexOf('--guild');
                const guildId = args[guildIndex + 1];
                if (!guildId) {
                    throw new Error('Guild ID is required when using --guild option');
                }
                await this.deployGuild(guildId);
            }
            else if (args.includes('--delete-global')) {
                await this.deleteGlobalCommands();
            }
            else if (args.includes('--delete-guild')) {
                const guildIndex = args.indexOf('--delete-guild');
                const guildId = args[guildIndex + 1];
                if (!guildId) {
                    throw new Error('Guild ID is required when using --delete-guild option');
                }
                await this.deleteGuildCommands(guildId);
            }
            else if (args.includes('--list')) {
                await this.listCommands();
            }
            else if (args.includes('--list-guild')) {
                const guildIndex = args.indexOf('--list-guild');
                const guildId = args[guildIndex + 1];
                if (!guildId) {
                    throw new Error('Guild ID is required when using --list-guild option');
                }
                await this.listCommands(guildId);
            }
            else {
                console.log('❌ Unknown option. Use --help for usage information.');
                return;
            }

            console.log('🎉 Operation completed successfully!');

        } catch (error) {
            console.error('\n❌ Deployment failed:', error.message);
            
            if (error.code === 50001) {
                console.error('💡 This error usually means the bot lacks proper permissions.');
                console.error('   Make sure the bot has "applications.commands" scope.');
            } else if (error.code === 50035) {
                console.error('💡 This error indicates invalid command data.');
                console.error('   Check your command definitions for syntax errors.');
            }
            
            process.exit(1);
        }
    }
}

// Run deployment if this file is executed directly
if (require.main === module) {
    const deployer = new CommandDeployer();
    deployer.run();
}

module.exports = CommandDeployer;