const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class EventHandler {
    constructor(client) {
        this.client = client;
        this.events = new Map();
        this.loadEvents();
    }

    loadEvents() {
        const eventsPath = path.join(__dirname, '../events');
        
        if (!fs.existsSync(eventsPath)) {
            fs.mkdirSync(eventsPath, { recursive: true });
            logger.warn('Events directory created');
            return;
        }

        const eventFiles = fs.readdirSync(eventsPath).filter(file => 
            file.endsWith('.js')
        );

        for (const file of eventFiles) {
            const filePath = path.join(eventsPath, file);
            
            try {
                delete require.cache[require.resolve(filePath)];
                const event = require(filePath);
                
                if (this.validateEvent(event)) {
                    this.registerEvent(event);
                    logger.debug(`Loaded event: ${event.name}`);
                } else {
                    logger.warn(`Invalid event structure: ${file}`);
                }
            } catch (error) {
                logger.error(`Failed to load event ${file}`, error);
            }
        }

        logger.info(`Loaded ${this.events.size} events`);
    }

    validateEvent(event) {
        return event 
            && typeof event.execute === 'function'
            && event.name
            && typeof event.once === 'boolean';
    }

    registerEvent(event) {
        this.events.set(event.name, event);
        
        if (event.once) {
            this.client.once(event.name, (...args) => this.handleEvent(event, ...args));
        } else {
            this.client.on(event.name, (...args) => this.handleEvent(event, ...args));
        }
    }

    async handleEvent(event, ...args) {
        try {
            await event.execute(...args, this.client);
        } catch (error) {
            logger.error(`Error executing event ${event.name}`, error);
        }
    }

    reloadEvent(eventName) {
        const event = this.events.get(eventName);
        if (!event) return false;

        const eventPath = path.join(__dirname, '../events', `${eventName}.js`);
        
        try {
            // Remove old listeners
            this.client.removeAllListeners(eventName);
            
            // Load new event
            delete require.cache[require.resolve(eventPath)];
            const newEvent = require(eventPath);
            
            if (this.validateEvent(newEvent)) {
                this.registerEvent(newEvent);
                logger.info(`Reloaded event: ${eventName}`);
                return true;
            }
        } catch (error) {
            logger.error(`Failed to reload event ${eventName}`, error);
        }
        
        return false;
    }

    reloadAllEvents() {
        // Remove all listeners
        for (const eventName of this.events.keys()) {
            this.client.removeAllListeners(eventName);
        }
        
        this.events.clear();
        this.loadEvents();
        logger.info('All events reloaded');
    }

    getEventStats() {
        return {
            totalEvents: this.events.size,
            onceEvents: Array.from(this.events.values()).filter(e => e.once).length,
            normalEvents: Array.from(this.events.values()).filter(e => !e.once).length
        };
    }
}

module.exports = EventHandler;