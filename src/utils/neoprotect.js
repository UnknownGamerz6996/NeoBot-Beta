const axios = require('axios');
const config = require('../../config');
const logger = require('./logger');
const database = require('./database');

class NeoProtectClient {
    constructor() {
        this.baseURL = config.neoprotect.baseURL;
        this.apiKey = config.neoprotect.apiKey;
        this.timeout = config.neoprotect.timeout;
        this.retryAttempts = config.neoprotect.retryAttempts;
        this.retryDelay = config.neoprotect.retryDelay;
        
        // Cache for API responses
        this.cache = new Map();
        this.cacheTimeout = config.monitoring.cacheTimeout;
        
        // Rate limiting
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.maxConcurrentRequests = config.performance.maxConcurrentRequests;
        this.activeRequests = 0;
        
        // Initialize axios instance
        this.client = this.createAxiosInstance();
        
        // Health check interval
        this.healthCheckInterval = null;
        this.lastHealthCheck = null;
        this.isHealthy = true;
        
        this.startHealthCheck();
    }

    createAxiosInstance() {
        const instance = axios.create({
            baseURL: this.baseURL,
            timeout: this.timeout,
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'NeoProtect-Discord-Bot/2.0'
            }
        });

        // Request interceptor
        instance.interceptors.request.use(
            (config) => {
                config.metadata = { startTime: Date.now() };
                logger.debug(`API Request: ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                logger.error('API Request Error', error);
                return Promise.reject(error);
            }
        );

        // Response interceptor
        instance.interceptors.response.use(
            (response) => {
                const duration = Date.now() - response.config.metadata.startTime;
                logger.api(
                    response.config.method?.toUpperCase(),
                    response.config.url,
                    response.status,
                    duration
                );
                
                // Log API usage to database
                this.logApiUsage(
                    response.config.url,
                    response.config.method?.toUpperCase(),
                    response.status,
                    duration
                );
                
                return response;
            },
            (error) => {
                const duration = error.config ? Date.now() - error.config.metadata.startTime : 0;
                const status = error.response?.status || 0;
                const url = error.config?.url || 'unknown';
                const method = error.config?.method?.toUpperCase() || 'unknown';
                
                logger.api(method, url, status, duration, error);
                
                // Log API usage to database
                this.logApiUsage(url, method, status, duration, error.message);
                
                return Promise.reject(error);
            }
        );

        return instance;
    }

    async logApiUsage(endpoint, method, statusCode, responseTime, errorMessage = null) {
        try {
            await database.logApiUsage(endpoint, method, statusCode, responseTime, errorMessage);
        } catch (error) {
            logger.error('Failed to log API usage', error);
        }
    }

    // Cache management
    getCacheKey(endpoint, params = {}) {
        return `${endpoint}_${JSON.stringify(params)}`;
    }

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            logger.debug(`Cache hit for key: ${key}`);
            return cached.data;
        }
        return null;
    }

    setCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
        logger.debug(`Cache set for key: ${key}`);
    }

    clearCache() {
        this.cache.clear();
        logger.debug('Cache cleared');
    }

    // Queue management for rate limiting
    async addToQueue(requestFunction) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ requestFunction, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessingQueue || this.activeRequests >= this.maxConcurrentRequests) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0 && this.activeRequests < this.maxConcurrentRequests) {
            const { requestFunction, resolve, reject } = this.requestQueue.shift();
            this.activeRequests++;

            try {
                const result = await requestFunction();
                resolve(result);
            } catch (error) {
                reject(error);
            } finally {
                this.activeRequests--;
            }
        }

        this.isProcessingQueue = false;
    }

    // Retry mechanism
    async withRetry(requestFunction, attempt = 1) {
        try {
            return await requestFunction();
        } catch (error) {
            if (attempt < this.retryAttempts && this.shouldRetry(error)) {
                logger.warn(`API request failed, retrying (attempt ${attempt}/${this.retryAttempts})`, {
                    error: error.message,
                    status: error.response?.status
                });
                
                await this.delay(this.retryDelay * attempt);
                return this.withRetry(requestFunction, attempt + 1);
            }
            throw error;
        }
    }

    shouldRetry(error) {
        // Retry on network errors or 5xx status codes
        return !error.response || (error.response.status >= 500 && error.response.status < 600);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // Health check system
    startHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            await this.performHealthCheck();
        }, 60000); // Check every minute

        // Initial health check
        this.performHealthCheck();
    }

    async performHealthCheck() {
        try {
            const startTime = Date.now();
            await this.client.get('/ips/attacks', { timeout: 5000, params: { limit: 1 } });
            const responseTime = Date.now() - startTime;
            
            this.isHealthy = true;
            this.lastHealthCheck = new Date();
            
            logger.health('neoprotect-api', 'healthy', responseTime);
            
            // Record health metric
            await database.recordMetric('api_health_check', 1, {
                responseTime,
                status: 'healthy'
            });
        } catch (error) {
            this.isHealthy = false;
            this.lastHealthCheck = new Date();
            
            logger.health('neoprotect-api', 'unhealthy', null, {
                error: error.message,
                status: error.response?.status
            });
            
            // Record health metric
            await database.recordMetric('api_health_check', 0, {
                status: 'unhealthy',
                error: error.message
            });
        }
    }

    // API Methods
    async getAttacks(options = {}) {
        const cacheKey = this.getCacheKey('/ips/attacks', options);
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const params = {
                    ...options,
                    limit: options.limit || 100
                };

                const response = await this.client.get('/ips/attacks', { params });
                const data = response.data;
                
                this.setCache(cacheKey, data);
                
                // Save attacks to database
                if (Array.isArray(data)) {
                    for (const attack of data) {
                        try {
                            await database.saveAttack(attack);
                        } catch (error) {
                            logger.error('Failed to save attack to database', error);
                        }
                    }
                }
                
                return data;
            });
        });
    }

    async getAttackById(attackId) {
        const cacheKey = this.getCacheKey(`/ips/attacks/${attackId}`);
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const response = await this.client.get(`/ips/attacks/${attackId}`);
                const data = response.data;
                
                this.setCache(cacheKey, data);
                
                // Save attack to database
                try {
                    await database.saveAttack(data);
                } catch (error) {
                    logger.error('Failed to save attack to database', error);
                }
                
                return data;
            });
        });
    }

    async getAttacksByIP(ipAddress, options = {}) {
        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const allAttacks = await this.getAttacks(options);
                return allAttacks.filter(attack => 
                    attack.dstAddress?.ipv4 === ipAddress
                );
            });
        });
    }

    async getIPInfo(ipAddress) {
        const cacheKey = this.getCacheKey(`/ips/${ipAddress}`);
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const response = await this.client.get(`/ips/${ipAddress}`);
                const data = response.data;
                
                this.setCache(cacheKey, data);
                return data;
            });
        });
    }

    async getProtectionStatus(ipAddress) {
        const cacheKey = this.getCacheKey(`/ips/${ipAddress}/protection`);
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const response = await this.client.get(`/ips/${ipAddress}/protection`);
                const data = response.data;
                
                this.setCache(cacheKey, data);
                return data;
            });
        });
    }

    async getStatistics(timeRange = '24h') {
        const cacheKey = this.getCacheKey('/statistics', { timeRange });
        const cached = this.getFromCache(cacheKey);
        if (cached) return cached;

        return this.addToQueue(async () => {
            return this.withRetry(async () => {
                const response = await this.client.get('/statistics', {
                    params: { timeRange }
                });
                const data = response.data;
                
                this.setCache(cacheKey, data);
                return data;
            });
        });
    }

    // Utility methods
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    formatNumber(num) {
        return new Intl.NumberFormat().format(num);
    }

    formatDuration(startTime, endTime) {
        const start = new Date(startTime);
        const end = endTime ? new Date(endTime) : new Date();
        const duration = end - start;
        
        const seconds = Math.floor(duration / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    isValidIP(ip) {
        const ipv4Regex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
        const ipv6Regex = /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        return ipv4Regex.test(ip) || ipv6Regex.test(ip);
    }

    // Status methods
    getHealthStatus() {
        return {
            isHealthy: this.isHealthy,
            lastHealthCheck: this.lastHealthCheck,
            cacheSize: this.cache.size,
            queueLength: this.requestQueue.length,
            activeRequests: this.activeRequests
        };
    }

    async getApiStats() {
        return await database.getApiStats(24);
    }

    // Cleanup
    destroy() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }
        this.clearCache();
        logger.info('NeoProtect client destroyed');
    }
}

module.exports = new NeoProtectClient();