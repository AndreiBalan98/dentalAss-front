const winston = require('winston');
const path = require('path');

// Custom format pentru console
const consoleFormat = winston.format.combine(
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize({ all: true }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level}: ${message}`;
    })
);

// Custom format pentru fișiere
const fileFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    })
);

// Configurația logger-ului
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    defaultMeta: { 
        service: 'ai-voice-assistant',
        version: '1.0.0'
    },
    transports: [
        // Console transport
        new winston.transports.Console({
            format: consoleFormat,
            handleExceptions: true,
            handleRejections: true
        }),
        
        // Fișier pentru toate log-urile
        new winston.transports.File({
            filename: path.join('logs', 'combined.log'),
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 5,
            handleExceptions: true,
            handleRejections: true
        }),
        
        // Fișier doar pentru erori
        new winston.transports.File({
            filename: path.join('logs', 'error.log'),
            level: 'error',
            format: fileFormat,
            maxsize: 5242880, // 5MB
            maxFiles: 3,
            handleExceptions: true,
            handleRejections: true
        }),
        
        // Fișier pentru conversații (INFO level)
        new winston.transports.File({
            filename: path.join('logs', 'conversations.log'),
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
                winston.format.printf(({ timestamp, message }) => {
                    return `[${timestamp}] ${message}`;
                })
            ),
            maxsize: 10485760, // 10MB
            maxFiles: 10
        })
    ],
    
    // Exit on error
    exitOnError: false
});

// Creează directorul logs dacă nu există
const fs = require('fs');
const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Funcții helper pentru logging specific
const loggerHelpers = {
    // Log pentru conversații
    conversation: (action, callId, details = '') => {
        logger.info(`CONV_${action} | ID: ${callId} | ${details}`);
    },
    
    // Log pentru audio processing
    audio: (action, callId, details = '') => {
        logger.info(`AUDIO_${action} | ID: ${callId} | ${details}`);
    },
    
    // Log pentru AI responses
    ai: (action, callId, details = '') => {
        logger.info(`AI_${action} | ID: ${callId} | ${details}`);
    },
    
    // Log pentru erori cu context
    errorWithContext: (error, context = {}) => {
        const errorDetails = {
            message: error.message,
            stack: error.stack,
            ...context
        };
        logger.error(`ERROR | ${JSON.stringify(errorDetails)}`);
    },
    
    // Log pentru performance
    performance: (action, duration, details = '') => {
        logger.info(`PERF_${action} | Duration: ${duration}ms | ${details}`);
    },
    
    // Log pentru API calls
    apiCall: (service, endpoint, status, duration = null) => {
        const durationStr = duration ? ` | Duration: ${duration}ms` : '';
        logger.info(`API_${service.toUpperCase()} | ${endpoint} | Status: ${status}${durationStr}`);
    }
};

// Combină logger-ul principal cu helper-ele
Object.assign(logger, loggerHelpers);

// Handler pentru uncaught exceptions
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Log startup info
logger.info('Logger initialized successfully');
logger.info(`Log level: ${logger.level}`);
logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

module.exports = logger;