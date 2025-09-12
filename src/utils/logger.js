const winston = require('winston');
const path = require('path');
const fs = require('fs');

class Logger {
    constructor() {
        this.createLogsDirectory();
        this.winston = this.createLogger();
    }

    createLogsDirectory() {
        const logsDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
    }

    createLogger() {
        // Safely load config with fallbacks
        let config;
        try {
            config = require('../../config');
        } catch (error) {
            console.warn('Config not available during logger initialization, using defaults');
            config = this.getDefaultConfig();
        }

        const logFormat = winston.format.combine(
            winston.format.timestamp({
                format: 'YYYY-MM-DD HH:mm:ss'
            }),
            winston.format.errors({ stack: true }),
            winston.format.json(),
            winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
                let log = `${timestamp} [${level.toUpperCase()}]: ${message}`;
                
                if (Object.keys(meta).length > 0) {
                    log += ` ${JSON.stringify(meta)}`;
                }
                
                if (stack) {
                    log += `\n${stack}`;
                }
                
                return log;
            })
        );

        const consoleFormat = winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp({
                format: 'HH:mm:ss'
            }),
            winston.format.printf(({ timestamp, level, message, stack }) => {
                let log = `${timestamp} ${level}: ${message}`;
                if (stack) {
                    log += `\n${stack}`;
                }
                return log;
            })
        );

        const transports = [];

        // Console transport - always enabled during development
        const shouldEnableConsole = this.shouldEnableConsole(config);
        if (shouldEnableConsole) {
            transports.push(new winston.transports.Console({
                format: consoleFormat,
                level: this.getLogLevel(config)
            }));
        }

        // File transport - always enabled
        const shouldEnableFile = this.shouldEnableFile(config);
        if (shouldEnableFile) {
            transports.push(new winston.transports.File({
                filename: path.join(__dirname, '../../logs/error.log'),
                level: 'error',
                format: logFormat,
                maxsize: this.getMaxFileSize(config),
                maxFiles: this.getMaxFiles(config)
            }));

            transports.push(new winston.transports.File({
                filename: path.join(__dirname, '../../logs/combined.log'),
                format: logFormat,
                maxsize: this.getMaxFileSize(config),
                maxFiles: this.getMaxFiles(config)
            }));
        }

        return winston.createLogger({
            level: this.getLogLevel(config),
            format: logFormat,
            transports,
            exitOnError: false
        });
    }

    // Safe config accessors with fallbacks
    getDefaultConfig() {
        return {
            logging: {
                level: process.env.LOG_LEVEL || 'info',
                console: { enabled: true },
                file: { 
                    enabled: true,
                    maxSize: 10485760,
                    maxFiles: 5
                }
            }
        };
    }

    shouldEnableConsole(config) {
        // Check multiple possible config structures
        if (config?.logging?.console?.enabled !== undefined) {
            return config.logging.console.enabled;
        }
        // Fallback: enable console in development
        return process.env.NODE_ENV !== 'production';
    }

    shouldEnableFile(config) {
        // Check multiple possible config structures
        if (config?.logging?.file?.enabled !== undefined) {
            return config.logging.file.enabled;
        }
        // Fallback: always enable file logging
        return true;
    }

    getLogLevel(config) {
        // Try multiple config structures
        if (config?.logging?.level) {
            return config.logging.level;
        }
        return process.env.LOG_LEVEL || 'info';
    }

    getMaxFileSize(config) {
        // Try multiple config structures
        if (config?.logging?.file?.maxSize) {
            return config.logging.file.maxSize;
        }
        if (config?.logging?.maxSize) {
            return config.logging.maxSize;
        }
        return parseInt(process.env.LOG_FILE_MAX_SIZE) || 10485760; // 10MB
    }

    getMaxFiles(config) {
        // Try multiple config structures
        if (config?.logging?.file?.maxFiles) {
            return config.logging.file.maxFiles;
        }
        if (config?.logging?.maxFiles) {
            return config.logging.maxFiles;
        }
        return parseInt(process.env.LOG_MAX_FILES) || 5;
    }

    // Standard logging methods
    debug(message, meta = {}) {
        this.winston.debug(message, meta);
    }

    info(message, meta = {}) {
        this.winston.info(message, meta);
    }

    warn(message, meta = {}) {
        this.winston.warn(message, meta);
    }

    error(message, error = null, meta = {}) {
        if (error instanceof Error) {
            this.winston.error(message, { 
                stack: error.stack, 
                name: error.name, 
                message: error.message, 
                ...meta 
            });
        } else {
            this.winston.error(message, meta);
        }
    }

    // Specialized logging methods
    command(commandName, userId, context = {}) {
        this.info('Command executed', {
            type: 'command',
            command: commandName,
            userId,
            ...context
        });
    }

    api(method, endpoint, statusCode, responseTime, error = null) {
        const logData = {
            type: 'api',
            method,
            endpoint,
            statusCode,
            responseTime: `${responseTime}ms`
        };

        if (error) {
            this.error(`API Error: ${method} ${endpoint}`, error, logData);
        } else {
            this.info(`API Request: ${method} ${endpoint}`, logData);
        }
    }

    monitor(action, ipAddress, details = {}) {
        this.info(`Monitor ${action}`, {
            type: 'monitor',
            action,
            ipAddress,
            ...details
        });
    }

    attack(attackData) {
        this.warn('Attack detected', {
            type: 'attack',
            attackId: attackData.id,
            targetIp: attackData.dstAddress?.ipv4 || attackData.target?.ip,
            attackType: attackData.signatures?.[0]?.name || attackData.type,
            startedAt: attackData.startedAt
        });
    }

    security(event, userId, details = {}) {
        this.warn(`Security event: ${event}`, {
            type: 'security',
            event,
            userId,
            timestamp: new Date().toISOString(),
            ...details
        });
    }

    performance(metric, value, threshold = null) {
        const logData = {
            type: 'performance',
            metric,
            value,
            timestamp: new Date().toISOString()
        };

        if (threshold && value > threshold) {
            this.warn(`Performance threshold exceeded: ${metric}`, logData);
        } else {
            this.debug(`Performance metric: ${metric}`, logData);
        }
    }

    database(operation, table, duration, error = null) {
        const logData = {
            type: 'database',
            operation,
            table,
            duration: `${duration}ms`
        };

        if (error) {
            this.error(`Database error: ${operation} on ${table}`, error, logData);
        } else {
            this.debug(`Database operation: ${operation} on ${table}`, logData);
        }
    }

    // Bot lifecycle events
    startup(message) {
        this.info(`🚀 ${message}`, { type: 'startup' });
    }

    shutdown(message, error = null) {
        if (error) {
            this.error(`🛑 ${message}`, error, { type: 'shutdown' });
        } else {
            this.info(`🛑 ${message}`, { type: 'shutdown' });
        }
    }

    // Health check logging
    health(service, status, responseTime = null, details = {}) {
        const logData = {
            type: 'health',
            service,
            status,
            timestamp: new Date().toISOString(),
            ...details
        };

        if (responseTime) {
            logData.responseTime = `${responseTime}ms`;
        }

        if (status === 'healthy') {
            this.debug(`Health check: ${service} is ${status}`, logData);
        } else {
            this.warn(`Health check: ${service} is ${status}`, logData);
        }
    }

    // Rate limiting
    rateLimit(userId, action, remaining) {
        this.warn('Rate limit triggered', {
            type: 'rateLimit',
            userId,
            action,
            remaining,
            timestamp: new Date().toISOString()
        });
    }

    // Custom log stream for HTTP requests (if using express)
    getHttpLogStream() {
        return {
            write: (message) => {
                this.info(message.trim(), { type: 'http' });
            }
        };
    }

    // Test method to verify logger is working
    test() {
        this.debug('Logger test - debug level');
        this.info('Logger test - info level');
        this.warn('Logger test - warn level');
        this.error('Logger test - error level');
        console.log('✅ Logger test completed - check logs directory');
    }
}

module.exports = new Logger();