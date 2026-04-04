/**
 * HomePiNAS - Structured Logger
 * v2.0.0 - JSON structured logging for production, human-readable for dev
 *
 * In production (NODE_ENV=production): outputs JSON lines (machine-parseable)
 * In development: outputs human-readable colored lines
 *
 * Set LOG_LEVEL env var: debug | info | warn | error (default: info)
 *
 * @example
 *   const log = require('../utils/logger');
 *   log.info('Server started on port %d', port);
 *   log.error('Failed to read file', err.message);
 *   log.debug('Request body:', body);
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const currentLevel = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;
const isProduction = process.env.NODE_ENV === 'production';

/**
 * Format a structured JSON log line (production).
 */
function formatJson(level, args) {
    const entry = {
        time: new Date().toISOString(),
        level,
        msg: args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
    };
    return JSON.stringify(entry);
}

/**
 * Format a human-readable log line (dev).
 */
function formatHuman(tag, args) {
    const ts = new Date().toISOString();
    return [`[${ts}] [${tag}]`, ...args];
}

const log = {
    debug(...args) {
        if (currentLevel <= LEVELS.debug) {
            if (isProduction) {
                process.stdout.write(formatJson('debug', args) + '\n');
            } else {
                console.log(...formatHuman('DEBUG', args));
            }
        }
    },
    info(...args) {
        if (currentLevel <= LEVELS.info) {
            if (isProduction) {
                process.stdout.write(formatJson('info', args) + '\n');
            } else {
                console.log(...formatHuman('INFO', args));
            }
        }
    },
    warn(...args) {
        if (currentLevel <= LEVELS.warn) {
            if (isProduction) {
                process.stderr.write(formatJson('warn', args) + '\n');
            } else {
                console.warn(...formatHuman('WARN', args));
            }
        }
    },
    error(...args) {
        if (currentLevel <= LEVELS.error) {
            if (isProduction) {
                process.stderr.write(formatJson('error', args) + '\n');
            } else {
                console.error(...formatHuman('ERROR', args));
            }
        }
    }
};

module.exports = log;
