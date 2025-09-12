const config = require('../../config');
const logger = require('../utils/logger');
const database = require('../utils/database');

class ErrorHandler {
    constructor() {
        this.errorCounts = new Map();
        this.lastErrors = new Map();
        this.setupGlobalHandlers();
    }

    setupGlobalHandlers() {
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception', error, {
                type: 'uncaughtException',
                stack: error.stack,
                timestamp: new Date().toISOString()
            });
            
            // Try to gracefully shutdown
            this.emergencyShutdown('uncaughtException', error);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error('Unhandled Promise Rejection', reason, {
                type: 'unhandledRejection',
                promise: promise.toString(),
                timestamp: new Date().toISOString()
            });
            
            // Don't shutdown on unhandled rejections, just log them
            // as they're often non-critical
        });

        // Handle warning events
        process.on('warning', (warning) => {
            logger.warn('Process Warning', {
                type: 'processWarning',
                name: warning.name,
                message: warning.message,
                stack: warning.stack
            });
        });
    }

    // Main error handling for commands
    async handleCommandError(interaction, command, error) {
        const errorId = this.generateErrorId();
        const userId = interaction.user.id;
        const guildId = interaction.guildId;
        const commandName = command?.data?.name || 'unknown';

        // Log the error with context
        logger.error(`Command error in ${commandName}`, error, {
            errorId,
            userId,
            guildId,
            commandName,
            type: 'commandError',
            stack: error.stack
        });

        // Record error metrics
        try {
            await this.recordError('command_error', commandName, error, {
                userId,
                guildId,
                errorId
            });
        } catch (dbError) {
            logger.error('Failed to record error metric', dbError);
        }

        // Determine error type and create appropriate response
        const errorResponse = this.createErrorResponse(error, errorId, commandName);

        try {
            // Send error message to user
            if (interaction.deferred || interaction.replied) {
                await interaction.followUp({
                    embeds: [errorResponse.embed],
                    ephemeral: true
                });
            } else {
                await interaction.reply({
                    embeds: [errorResponse.embed],
                    ephemeral: true
                });
            }
        } catch (responseError) {
            logger.error('Failed to send error response', responseError, {
                originalErrorId: errorId,
                commandName
            });
        }

        // Check if this error is happening frequently
        await this.checkErrorFrequency(commandName, error);

        return errorId;
    }

    // Handle API errors specifically
    async handleApiError(service, endpoint, error, context = {}) {
        const errorId = this.generateErrorId();
        
        logger.error(`API error in ${service}`, error, {
            errorId,
            service,
            endpoint,
            statusCode: error.response?.status,
            responseData: error.response?.data,
            type: 'apiError',
            ...context
        });

        // Record API error
        await this.recordError('api_error', service, error, {
            endpoint,
            statusCode: error.response?.status,
            ...context
        });

        // Check if we should implement circuit breaker
        await this.checkApiErrorRate(service);

        return {
            errorId,
            shouldRetry: this.shouldRetryApiError(error),
            retryAfter: this.getRetryDelay(error)
        };
    }

    // Handle database errors
    async handleDatabaseError(operation, error, context = {}) {
        const errorId = this.generateErrorId();
        
        logger.error(`Database error in ${operation}`, error, {
            errorId,
            operation,
            type: 'databaseError',
            sqliteCode: error.code,
            errno: error.errno,
            ...context
        });

        // Don't try to record database errors in the database
        // if the database itself is having issues
        if (!this.isDatabaseConnectionError(error)) {
            try {
                await this.recordError('database_error', operation, error, context);
            } catch (recordError) {
                logger.error('Failed to record database error', recordError);
            }
        }

        return {
            errorId,
            shouldRetry: this.shouldRetryDatabaseError(error),
            isConnectionError: this.isDatabaseConnectionError(error)
        };
    }

    // Create user-friendly error response
    createErrorResponse(error, errorId, commandName) {
        const { EmbedBuilder } = require('discord.js');
        
        let title = '❌ Command Error';
        let description = 'An unexpected error occurred while processing your command.';
        let color = config.ui.colors.error;

        // Customize based on error type
        if (error.name === 'DiscordAPIError') {
            title = '❌ Discord API Error';
            description = 'There was an issue communicating with Discord. Please try again in a moment.';
        } else if (error.message?.includes('timeout')) {
            title = '⏱️ Timeout Error';
            description = 'The operation took too long to complete. Please try again.';
        } else if (error.message?.includes('rate limit')) {
            title = '🚦 Rate Limited';
            description = 'Too many requests. Please wait a moment before trying again.';
            color = config.ui.colors.warning;
        } else if (error.message?.includes('permission')) {
            title = '🔒 Permission Error';
            description = 'The bot doesn\'t have the necessary permissions to complete this action.';
            color = config.ui.colors.warning;
        } else if (error.message?.includes('database')) {
            title = '💾 Database Error';
            description = 'There was an issue accessing the database. Please try again.';
        }

        const embed = new EmbedBuilder()
            .setColor(color)
            .setTitle(title)
            .setDescription(description)
            .addFields([
                {
                    name: '🔍 Error ID',
                    value: `\`${errorId}\``,
                    inline: true
                },
                {
                    name: '📝 Command',
                    value: `\`/${commandName}\``,
                    inline: true
                },
                {
                    name: '💡 What to do',
                    value: [
                        '• Try the command again in a few moments',
                        '• If the issue persists, contact an administrator',
                        '• Include the Error ID when reporting issues'
                    ].join('\n'),
                    inline: false
                }
            ])
            .setTimestamp()
            .setFooter({ text: 'NeoProtect Bot Error Handler' });

        return { embed, errorId };
    }

    // Generate unique error ID
    generateErrorId() {
        const timestamp = Date.now().toString(36);
        const random = Math.random().toString(36).substr(2, 5);
        return `${timestamp}-${random}`.toUpperCase();
    }

    // Record error in database for analytics
    async recordError(type, source, error, context = {}) {
        try {
            if (!database) return;

            await database.recordMetric('errors', 1, {
                type,
                source,
                errorMessage: error.message,
                errorName: error.name,
                stack: error.stack?.substring(0, 1000), // Limit stack trace length
                ...context,
                timestamp: new Date().toISOString()
            });
        } catch (dbError) {
            // Don't throw database errors when recording errors
            logger.warn('Failed to record error metric', dbError);
        }
    }

    // Check if errors are happening too frequently
    async checkErrorFrequency(source, error) {
        const key = `${source}:${error.name}`;
        const now = Date.now();
        
        if (!this.errorCounts.has(key)) {
            this.errorCounts.set(key, { count: 1, firstSeen: now, lastSeen: now });
        } else {
            const errorData = this.errorCounts.get(key);
            errorData.count++;
            errorData.lastSeen = now;
            
            // If we've seen this error 10+ times in the last hour, log a warning
            const oneHour = 3600000;
            if (errorData.count >= 10 && (now - errorData.firstSeen) < oneHour) {
                logger.warn(`High error frequency detected`, {
                    source,
                    errorName: error.name,
                    count: errorData.count,
                    timespan: now - errorData.firstSeen
                });
                
                // Reset counter to avoid spam
                errorData.count = 0;
                errorData.firstSeen = now;
            }
        }
    }

    // Check API error rate for circuit breaker
    async checkApiErrorRate(service) {
        // Implementation for circuit breaker pattern
        // This would track API failure rates and temporarily disable
        // API calls if failure rate is too high
    }

    // Determine if we should retry an API error
    shouldRetryApiError(error) {
        if (!error.response) return true; // Network error, can retry
        
        const status = error.response.status;
        
        // Don't retry client errors (4xx except 429)
        if (status >= 400 && status < 500 && status !== 429) {
            return false;
        }
        
        // Retry server errors and rate limits
        return status >= 500 || status === 429;
    }

    // Get retry delay for API errors
    getRetryDelay(error) {
        if (error.response?.status === 429) {
            // Rate limited - check Retry-After header
            const retryAfter = error.response.headers['retry-after'];
            return retryAfter ? parseInt(retryAfter) * 1000 : 60000; // Default 1 minute
        }
        
        // Exponential backoff for other errors
        const attempt = error.attempt || 1;
        return Math.min(Math.pow(2, attempt) * 1000, 30000); // Max 30 seconds
    }

    // Determine if we should retry a database error
    shouldRetryDatabaseError(error) {
        // Retry on connection issues and busy database
        return error.code === 'SQLITE_BUSY' || 
               error.code === 'SQLITE_LOCKED' ||
               error.code === 'ENOENT' ||
               error.errno === -2; // ENOENT
    }

    // Check if error is a database connection issue
    isDatabaseConnectionError(error) {
        return error.code === 'SQLITE_CANTOPEN' ||
               error.code === 'ENOENT' ||
               error.errno === -2 ||
               error.message?.includes('no such file');
    }

    // Emergency shutdown procedure
    async emergencyShutdown(reason, error) {
        logger.error(`Emergency shutdown initiated: ${reason}`, error);
        
        try {
            // Give processes time to clean up
            setTimeout(() => {
                process.exit(1);
            }, 5000);
            
            // Try to gracefully close connections
            if (global.client) {
                await global.client.destroy();
            }
            
            if (database) {
                await database.close();
            }
            
        } catch (shutdownError) {
            logger.error('Error during emergency shutdown', shutdownError);
            process.exit(1);
        }
    }

    // Get error statistics
    getErrorStats() {
        const totalErrors = Array.from(this.errorCounts.values())
            .reduce((sum, data) => sum + data.count, 0);
            
        const uniqueErrors = this.errorCounts.size;
        
        return {
            totalErrors,
            uniqueErrors,
            errorTypes: Array.from(this.errorCounts.entries())
                .map(([key, data]) => ({
                    error: key,
                    count: data.count,
                    lastSeen: new Date(data.lastSeen).toISOString()
                }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 10) // Top 10 errors
        };
    }

    // Clear old error data
    cleanupErrorData() {
        const oneDay = 86400000;
        const now = Date.now();
        
        for (const [key, data] of this.errorCounts.entries()) {
            if (now - data.lastSeen > oneDay) {
                this.errorCounts.delete(key);
            }
        }
    }
}

module.exports = new ErrorHandler();N