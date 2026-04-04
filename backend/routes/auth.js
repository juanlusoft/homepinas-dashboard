'use strict';

/**
 * HomePiNAS - Auth Routes
 * POST /api/setup, POST /api/login, POST /api/login/2fa,
 * POST /api/verify-session, GET /api/status
 *
 * NO requireAuth on any of these — they are public entry points.
 */

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');

const log = require('../logger');

// ---------------------------------------------------------------------------
// Pending 2FA tokens (in-memory, TTL 5 minutes)
// Shape: Map<token: string, { username: string, expires: number }>
// ---------------------------------------------------------------------------
const PENDING_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { username: string, expires: number }>} */
const pendingTokens = new Map();

/** Remove expired pending tokens (called before each lookup) */
function prunePendingTokens() {
    const now = Date.now();
    for (const [token, entry] of pendingTokens) {
        if (now > entry.expires) {
            pendingTokens.delete(token);
        }
    }
}

// ---------------------------------------------------------------------------
// Helper: build session response payload
// ---------------------------------------------------------------------------
function buildSessionPayload(sessionId, username) {
    const { getCsrfToken } = require('../csrf');
    const csrfToken = getCsrfToken(sessionId);
    return {
        success: true,
        sessionId,
        csrfToken,
        user: { username }
    };
}

// ---------------------------------------------------------------------------
// GET /api/status
// Public. Returns { requireSetup: true } when no admin user exists yet.
// ---------------------------------------------------------------------------
router.get('/status', (req, res) => {
    const { getData } = require('../data');
    const data = getData();
    return res.json({ requireSetup: !data.user });
});

// ---------------------------------------------------------------------------
// POST /api/setup
// Body: { username, password }
// Creates the primary admin account. Fails 409 if already configured.
// ---------------------------------------------------------------------------
router.post('/setup', async (req, res) => {
    try {
        const { getData, withData } = require('../data');
        const { createSession } = require('../session');
        const { sanitizeUsername } = require('../sanitize');

        const data = getData();
        if (data.user) {
            return res.status(409).json({ error: 'Already configured' });
        }

        const { username, password } = req.body || {};

        const cleanUsername = sanitizeUsername(username);
        if (!cleanUsername) {
            return res.status(400).json({ error: 'Invalid username. Must be 3-32 chars, start with a letter, letters/numbers/_ only.' });
        }

        if (!password || typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (password.length > 128) {
            return res.status(400).json({ error: 'Password must be at most 128 characters' });
        }

        const hash = await bcrypt.hash(password, 12);

        let sessionId;
        await withData(d => {
            d.user = { username: cleanUsername, password: hash, totpEnabled: false };
            return d;
        });

        sessionId = createSession(cleanUsername);
        if (!sessionId) {
            return res.status(500).json({ error: 'Failed to create session' });
        }

        log.info(`[auth] setup completed for user: ${cleanUsername}`);
        return res.json(buildSessionPayload(sessionId, cleanUsername));
    } catch (err) {
        log.error('[auth] setup error:', err.message);
        return res.status(500).json({ error: 'Setup failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/login
// Body: { username, password }
// Returns session tokens OR { requires2FA: true, pendingToken } if TOTP active.
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
    try {
        const { getData } = require('../data');
        const { createSession } = require('../session');

        const { username, password } = req.body || {};

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const data = getData();
        if (!data.user) {
            return res.status(403).json({ error: 'Not configured. Run setup first.' });
        }

        // Only the primary admin user is supported in this route.
        if (data.user.username.toLowerCase() !== String(username).toLowerCase()) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        const passwordMatch = await bcrypt.compare(password, data.user.password);
        if (!passwordMatch) {
            log.info(`[auth] failed login attempt for username: ${username}`);
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // If TOTP is enabled, issue a short-lived pending token instead of a session.
        if (data.user.totpEnabled) {
            prunePendingTokens();
            const pendingToken = crypto.randomBytes(32).toString('hex');
            pendingTokens.set(pendingToken, {
                username: data.user.username,
                expires: Date.now() + PENDING_TTL_MS
            });
            return res.json({ requires2FA: true, pendingToken });
        }

        // No TOTP — create session immediately.
        const sessionId = createSession(data.user.username);
        if (!sessionId) {
            return res.status(500).json({ error: 'Failed to create session' });
        }

        log.info(`[auth] login successful for user: ${data.user.username}`);
        return res.json(buildSessionPayload(sessionId, data.user.username));
    } catch (err) {
        log.error('[auth] login error:', err.message);
        return res.status(500).json({ error: 'Login failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/login/2fa
// Body: { pendingToken, totpCode }
// Validates the TOTP code and issues a full session.
// ---------------------------------------------------------------------------
router.post('/login/2fa', async (req, res) => {
    try {
        const { getData } = require('../data');
        const { createSession } = require('../session');
        const { decryptTotpSecret } = require('../totp-crypto');
        const { authenticator } = require('otplib');

        const { pendingToken, totpCode } = req.body || {};

        if (!pendingToken || !totpCode) {
            return res.status(400).json({ error: 'pendingToken and totpCode are required' });
        }

        prunePendingTokens();
        const entry = pendingTokens.get(pendingToken);
        if (!entry) {
            return res.status(401).json({ error: 'Invalid or expired pending token' });
        }

        if (Date.now() > entry.expires) {
            pendingTokens.delete(pendingToken);
            return res.status(401).json({ error: 'Pending token has expired. Please log in again.' });
        }

        const data = getData();
        if (!data.user || data.user.username !== entry.username) {
            return res.status(401).json({ error: 'User not found' });
        }

        const plainSecret = decryptTotpSecret(data.user.totpSecret);
        if (!plainSecret) {
            return res.status(500).json({ error: 'TOTP configuration error' });
        }

        const isValid = authenticator.verify({ token: String(totpCode), secret: plainSecret });
        if (!isValid) {
            return res.status(401).json({ error: 'Invalid TOTP code' });
        }

        // Consume the pending token — one-time use.
        pendingTokens.delete(pendingToken);

        const sessionId = createSession(entry.username);
        if (!sessionId) {
            return res.status(500).json({ error: 'Failed to create session' });
        }

        log.info(`[auth] 2FA login successful for user: ${entry.username}`);
        return res.json(buildSessionPayload(sessionId, entry.username));
    } catch (err) {
        log.error('[auth] 2fa login error:', err.message);
        return res.status(500).json({ error: '2FA login failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/verify-session
// Reads X-Session-Id header. Returns { csrfToken, user } or 401.
// Used by the frontend on every page load to refresh the CSRF token.
// ---------------------------------------------------------------------------
router.post('/verify-session', (req, res) => {
    const { validateSession } = require('../session');
    const { getCsrfToken } = require('../csrf');

    const sessionId = req.headers['x-session-id'];

    if (!sessionId) {
        return res.status(401).json({ error: 'No session ID provided' });
    }

    const session = validateSession(sessionId);
    if (!session) {
        return res.status(401).json({ error: 'Session invalid or expired' });
    }

    const csrfToken = getCsrfToken(sessionId);
    return res.json({ csrfToken, user: { username: session.username } });
});

module.exports = router;
