/**
 * HomePiNAS - Centralized Error Handler Middleware
 * Catches unhandled errors from route handlers and sends consistent JSON responses.
 * 
 * Usage: app.use(errorHandler) — must be registered AFTER all routes.
 */

const log = require('../utils/logger');

/**
 * Express error-handling middleware (4 args required by Express)
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
    const status = err.status || err.statusCode || 500;
    const message = err.expose ? err.message : 'Internal server error';

    log.error(`${req.method} ${req.path} → ${status}:`, err.message);

    if (process.env.LOG_LEVEL === 'debug') {
        log.debug('Stack:', err.stack);
    }

    if (res.headersSent) {
        return next(err);
    }

    res.status(status).json({ error: message });
}

/**
 * Helper to create an error with HTTP status
 * @param {number} status - HTTP status code
 * @param {string} message - Error message
 * @returns {Error}
 */
function httpError(status, message) {
    const err = new Error(message);
    err.status = status;
    err.expose = true;
    return err;
}

module.exports = { errorHandler, httpError };
