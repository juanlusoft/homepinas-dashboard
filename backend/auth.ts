/**
 * HomePiNAS - Authentication Middleware
 * v1.5.6 - Modular Architecture
 */

import type { RequestHandler } from 'express-serve-static-core';

const { validateSession } = require('../utils/session');
const { logSecurityEvent } = require('../utils/security');

/**
 * Require authentication middleware
 * Checks X-Session-Id header first, then falls back to query param (for direct URLs like images)
 */
const requireAuth: RequestHandler = (req, res, next) => {
    // Try header first, then query string (for direct URL access like img src)
    const sessionId = req.headers['x-session-id'] || req.query.sessionId;
    const session = validateSession(sessionId);

    if (!session) {
        logSecurityEvent('UNAUTHORIZED_ACCESS', { path: req.path }, req.ip);
        return res.status(401).json({ error: 'Authentication required' });
    }

    req.user = session;
    next();
};

module.exports = {
    requireAuth
};
