const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

class CommandHandler {
    constructor(client) {
        console.log('🔍 CommandHandler constructor called');
        this.client = client;
        this.commands = new Collection();
        this.cooldowns = new Collection();
        
        // Try to load commands, but don't fail if directory doesn't exist
        this.loadCommands();
        console.log('✅ CommandHandler constructor completed');
    }

    loadCommands() {
        try {
            const commandsPath = path.join(__dirname, '../commands');
            
            if (!fs.existsSync(commandsPath)) {
                console.log('⚠️ Commands directory not found, creating basic commands...');
                this.createBasicCommands();
                return;
            }

            console.log('🔍 Loading commands from directory...');
            let loadedCount = 0;
            
            // Get all subdirectories (categories)
            const categories = fs.readdirSync(commandsPath).filter(item => {
                const itemPath = path.join(commandsPath, item);
                return fs.statSync(itemPath).isDirectory();
            });

            for (const category of categories) {
                const categoryPath = path.join(commandsPath, category);
                const commandFiles = fs.readdirSync(categoryPath).filter(file => 
                    file.endsWith('.js')
                );

                for (const file of commandFiles) {
                    try {
                        const filePath = path.join(categoryPath, file);
                        delete require.cache[require.resolve(filePath)];
                        const command = require(filePath);
                        
                        if (this.validateCommand(command)) {
                            this.commands.set(command.data.name, command);
                            loadedCount++;
                            console.log(`✅ Loaded command: ${command.data.name}`);
                        } else {
                            console.warn(`⚠️ Invalid command: ${file}`);
                        }
                    } catch (error) {
                        console.error(`❌ Failed to load command ${file}:`, error.message);
                    }
                }
            }

            console.log(`✅ Loaded ${loadedCount} commands from ${categories.length} categories`);
            
            if (loadedCount === 0) {
                this.createBasicCommands();
            }
            
        } catch (error) {
            console.error('❌ Error loading commands:', error.message);
            this.createBasicCommands();
        }
    }

    createBasicCommands() {
        console.log('🔍 Creating basic built-in commands...');
        
        // Create a basic ping command
        const pingCommand = {
            data: {
                name: 'ping',
                description: 'Check bot responsiveness'
            },
            async execute(interaction) {
                const latency = Date.now() - interaction.createdTimestamp;
                await interaction.reply(`🏓 Pong! Latency: ${latency}ms`);
            }
        };

        // Create a basic help command
        const helpCommand = {
            data: {
                name: 'help',
                description: 'Show available commands'
            },
            async execute(interaction) {
                await interaction.reply({
                    content: '📚 **Available Commands:**\n`/ping` - Check bot responsiveness\n`/help` - Show this help message',
                    ephemeral: true
                });
            }
        };

        this.commands.set('ping', pingCommand);
        this.commands.set('help', helpCommand);
        
        console.log('✅ Created 2 basic commands: ping, help');
    }

    validateCommand(command) {
        return command 
            && command.data 
            && command.data.name 
            && command.data.description
            && typeof command.execute === 'function';
    }

    async handleInteraction(interaction) {
        console.log('🔍 Interaction received:', interaction.type, interaction.commandName);
        
        if (!interaction.isChatInputCommand()) {
            console.log('⚠️ Not a chat input command, ignoring');
            return;
        }

        const command = this.commands.get(interaction.commandName);
        
        if (!command) {
            console.warn(`⚠️ Unknown command: ${interaction.commandName}`);
            try {
                await interaction.reply({
                    content: '❌ Unknown command!',
                    ephemeral: true
                });
            } catch (error) {
                console.error('Failed to send unknown command response:', error);
            }
            return;
        }

        try {
            console.log(`🔍 Executing command: ${interaction.commandName}`);
            await command.execute(interaction);
            console.log(`✅ Command executed successfully: ${interaction.commandName}`);
        } catch (error) {
            console.error(`❌ Command execution failed: ${interaction.commandName}`, error);
            
            try {
                const errorMessage = '❌ There was an error executing this command!';
                
                if (interaction.deferred || interaction.replied) {
                    await interaction.followUp({
                        content: errorMessage,
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content: errorMessage,
                        ephemeral: true
                    });
                }
            } catch (replyError) {
                console.error('Failed to send error response:', replyError);
            }
        }
    }

    // Get list of commands for deployment
    getCommandsForDeployment() {
        const commands = [];
        for (const [name, command] of this.commands) {
            commands.push(command.data);
        }
        return commands;
    }

    // Get command statistics
    getStats() {
        return {
            totalCommands: this.commands.size,
            commandNames: Array.from(this.commands.keys())
        };
    }
}

module.exports = CommandHandler;