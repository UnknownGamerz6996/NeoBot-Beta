const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../../config');

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

        // Console transport
        if (config.logging.console.enabled) {
            transports.push(new winston.transports.Console({
                format: consoleFormat,
                level: config.logging.level
            }));
        }

        // File transport
        if (config.logging.file.enabled) {
            transports.push(new winston.transports.File({
                filename: path.join(__dirname, '../../logs/error.log'),
                level: 'error',
                format: logFormat,
                maxsize: config.logging.file.maxSize,
                maxFiles: config.logging.file.maxFiles
            }));

            transports.push(new winston.transports.File({
                filename: path.join(__dirname, '../../logs/combined.log'),
                format: logFormat,
                maxsize: config.logging.file.maxSize,
                maxFiles: config.logging.file.maxFiles
            }));
        }

        return winston.createLogger({
            level: config.logging.level,
            format: logFormat,
            transports,
            exitOnError: false
        });
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
    command(commandName, userId, guildId, args = {}) {
        this.info('Command executed', {
            type: 'command',
            command: commandName,
            userId,
            guildId,
            args
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
            targetIp: attackData.dstAddress?.ipv4,
            attackType: attackData.signatures?.[0]?.name,
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
}

module.exports = new Logger();