const fs = require('fs');
const path = require('path');

class EventHandler {
    constructor(client) {
        console.log('🔍 EventHandler constructor called');
        this.client = client;
        this.events = new Map();
        
        // Try to load events, but don't fail if directory doesn't exist
        this.loadEvents();
        console.log('✅ EventHandler constructor completed');
    }

    loadEvents() {
        try {
            const eventsPath = path.join(__dirname, '../events');
            
            if (!fs.existsSync(eventsPath)) {
                console.log('⚠️ Events directory not found, using built-in events');
                this.setupBuiltinEvents();
                return;
            }

            console.log('🔍 Loading events from directory...');
            const eventFiles = fs.readdirSync(eventsPath).filter(file => 
                file.endsWith('.js')
            );

            let loadedCount = 0;
            for (const file of eventFiles) {
                try {
                    const filePath = path.join(eventsPath, file);
                    delete require.cache[require.resolve(filePath)];
                    const event = require(filePath);
                    
                    if (this.validateEvent(event)) {
                        this.registerEvent(event);
                        loadedCount++;
                        console.log(`✅ Loaded event: ${event.name}`);
                    } else {
                        console.warn(`⚠️ Invalid event: ${file}`);
                    }
                } catch (error) {
                    console.error(`❌ Failed to load event ${file}:`, error.message);
                }
            }

            console.log(`✅ Loaded ${loadedCount} events`);
            
            if (loadedCount === 0) {
                this.setupBuiltinEvents();
            }
            
        } catch (error) {
            console.error('❌ Error loading events:', error.message);
            this.setupBuiltinEvents();
        }
    }

    setupBuiltinEvents() {
        console.log('🔍 Setting up built-in events...');

        // Built-in ready event
        const readyEvent = {
            name: 'ready',
            once: true,
            execute: (client) => {
                console.log(`🎉 Bot logged in as ${client.user.tag}!`);
                console.log(`📊 Serving ${client.guilds.cache.size} servers`);
                
                // Set activity
                client.user.setActivity({
                    name: 'DDoS Protection | /help',
                    type: 3 // Watching
                }).catch(console.error);
            }
        };

        // Built-in error event
        const errorEvent = {
            name: 'error',
            once: false,
            execute: (error) => {
                console.error('❌ Discord.js error:', error);
            }
        };

        // Built-in guild join event
        const guildCreateEvent = {
            name: 'guildCreate',
            once: false,
            execute: (guild) => {
                console.log(`✅ Joined new guild: ${guild.name} (${guild.id})`);
            }
        };

        // Built-in guild leave event
        const guildDeleteEvent = {
            name: 'guildDelete',
            once: false,
            execute: (guild) => {
                console.log(`👋 Left guild: ${guild.name} (${guild.id})`);
            }
        };

        // Register built-in events
        this.registerEvent(readyEvent);
        this.registerEvent(errorEvent);
        this.registerEvent(guildCreateEvent);
        this.registerEvent(guildDeleteEvent);

        console.log('✅ Built-in events registered');
    }

    validateEvent(event) {
        return event 
            && typeof event.execute === 'function'
            && event.name
            && typeof event.once === 'boolean';
    }

    registerEvent(event) {
        this.events.set(event.name, event);
        
        try {
            if (event.once) {
                this.client.once(event.name, (...args) => this.handleEvent(event, ...args));
            } else {
                this.client.on(event.name, (...args) => this.handleEvent(event, ...args));
            }
        } catch (error) {
            console.error(`❌ Failed to register event ${event.name}:`, error);
        }
    }

    async handleEvent(event, ...args) {
        try {
            console.log(`🔍 Handling event: ${event.name}`);
            await event.execute(...args, this.client);
        } catch (error) {
            console.error(`❌ Error executing event ${event.name}:`, error);
        }
    }

    // Get event statistics
    getStats() {
        return {
            totalEvents: this.events.size,
            onceEvents: Array.from(this.events.values()).filter(e => e.once).length,
            normalEvents: Array.from(this.events.values()).filter(e => !e.once).length,
            eventNames: Array.from(this.events.keys())
        };
    }

    // Reload a specific event
    reloadEvent(eventName) {
        const event = this.events.get(eventName);
        if (!event) {
            console.warn(`⚠️ Event ${eventName} not found`);
            return false;
        }

        try {
            // Remove old listeners
            this.client.removeAllListeners(eventName);
            
            // Reload and register
            const eventPath = path.join(__dirname, '../events', `${eventName}.js`);
            delete require.cache[require.resolve(eventPath)];
            const newEvent = require(eventPath);
            
            if (this.validateEvent(newEvent)) {
                this.registerEvent(newEvent);
                console.log(`✅ Reloaded event: ${eventName}`);
                return true;
            } else {
                console.error(`❌ Invalid event after reload: ${eventName}`);
                return false;
            }
        } catch (error) {
            console.error(`❌ Failed to reload event ${eventName}:`, error);
            return false;
        }
    }

    // Reload all events
    reloadAllEvents() {
        try {
            console.log('🔍 Reloading all events...');
            
            // Remove all listeners
            for (const eventName of this.events.keys()) {
                this.client.removeAllListeners(eventName);
            }
            
            this.events.clear();
            this.loadEvents();
            
            console.log('✅ All events reloaded');
        } catch (error) {
            console.error('❌ Failed to reload all events:', error);
        }
    }
}

module.exports = EventHandler;