/**
 * HomePiNAS - Centralized Error Handler Middleware
 * Catches unhandled errors from route handlers and sends consistent JSON responses.
 *
 * Usage: app.use(errorHandler) — must be registered AFTER all routes.
 */

import type { ErrorRequestHandler } from 'express';

const log = require('../utils/logger');

/**
 * Express error-handling middleware (4 args required by Express)
 */
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
    const status = (err as any).status || (err as any).statusCode || 500;
    const message = (err as any).expose ? (err as any).message : 'Internal server error';

    log.error(`${req.method} ${req.path} → ${status}:`, (err as any).message);

    if (process.env.LOG_LEVEL === 'debug') {
        log.debug('Stack:', (err as any).stack);
    }

    if (res.headersSent) {
        return next(err);
    }

    res.status(status).json({ error: message });
};

/**
 * Helper to create an error with HTTP status
 */
function httpError(status: number, message: string): Error & { status?: number; expose?: boolean } {
    const err = new Error(message) as Error & { status?: number; expose?: boolean };
    err.status = status;
    err.expose = true;
    return err;
}

module.exports = { errorHandler, httpError };
