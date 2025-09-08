const logger = require('../utils/logger');
const config = require('../../config');

module.exports = {
    name: 'ready',
    once: true,
    async execute(client) {
        logger.startup(`Bot is ready! Logged in as ${client.user.tag}`);
        logger.startup(`Serving ${client.guilds.cache.size} guilds with ${client.users.cache.size} users`);

        // Set initial activity
        await client.user.setActivity({
            name: 'DDoS attacks | /help',
            type: 3 // Watching
        });

        // Initialize guild data for existing guilds
        for (const guild of client.guilds.cache.values()) {
            try {
                await client.database.createGuild(guild.id, guild.name);
            } catch (error) {
                logger.error(`Failed to initialize guild ${guild.id}`, error);
            }
        }

        logger.startup('Bot initialization completed successfully');
    }
};