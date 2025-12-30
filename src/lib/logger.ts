import winston from 'winston';
import path from 'path';

// Define log format
const logFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} [${level}]: ${message}`;
    if (Object.keys(metadata).length > 0) {
        // Custom replacer to handle Buffers and long arrays
        const replacer = (key: string, value: any) => {
            if (value && value.type === 'Buffer' && Array.isArray(value.data)) {
                return `[Buffer: ${value.data.length} bytes]`;
            }
            if (Array.isArray(value) && value.length > 50 && value.every(v => typeof v === 'number')) {
                 return `[Array(${value.length})]`;
             }
            return value;
        };
        try {
            msg += ` ${JSON.stringify(metadata, replacer)}`;
        } catch (e) {
            msg += ` [Circular or non-serializable metadata]`;
        }
    }
    return msg;
});

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info', // Default to info
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json()
    ),
    defaultMeta: { service: 'pollbot' },
    transports: [
        //
        // - Write all logs with importance level of `error` or less to `error.log`
        // - Write all logs with importance level of `info` or less to `combined.log`
        //
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
    ],
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
// Always log to console so systemd/journalctl can capture it
logger.add(new winston.transports.Console({
    format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        logFormat
    ),
}));
