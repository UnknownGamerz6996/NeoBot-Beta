const logger = require('../utils/logger');

module.exports = {
    name: 'error',
    once: false,
    async execute(error, client) {
        logger.error('Discord client error', error);

        // Record error metric
        try {
            await client.database.recordMetric('client_errors', 1, {
                error: error.message,
                name: error.name,
                code: error.code
            });
        } catch (dbError) {
            logger.error('Failed to record error metric', dbError);
        }
    }
};