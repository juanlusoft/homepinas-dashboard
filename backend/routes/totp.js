'use strict';

/**
 * HomePiNAS - TOTP 2FA Routes
 * GET  /api/totp/status
 * POST /api/totp/setup
 * POST /api/totp/verify
 * DELETE /api/totp/disable
 */

const router   = require('express').Router();
const bcrypt   = require('bcryptjs');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Pending TOTP secrets (unconfirmed — stored here until the user verifies)
// Shape: Map<sessionId: string, { secret: string, expires: number }>
// ---------------------------------------------------------------------------
const PENDING_TTL_MS = 5 * 60 * 1000;
/** @type {Map<string, { secret: string, expires: number }>} */
const pendingSecrets = new Map();

function prunePendingSecrets() {
    const now = Date.now();
    for (const [id, entry] of pendingSecrets) {
        if (now > entry.expires) pendingSecrets.delete(id);
    }
}

// ---------------------------------------------------------------------------
// Helper: get the session ID from the request (matches requireAuth logic)
// ---------------------------------------------------------------------------
function getSessionId(req) {
    return req.headers['x-session-id'] || req.query.sessionId || null;
}

// ---------------------------------------------------------------------------
// GET /status
// Returns { enabled: boolean }
// ---------------------------------------------------------------------------
router.get('/status', (req, res, next) => {
    const { requireAuth } = require('../auth');
    requireAuth(req, res, next);
}, (req, res) => {
    const { getData } = require('../data');
    const data = getData();
    if (!data.user) return res.status(500).json({ error: 'No user configured' });
    return res.json({ enabled: !!data.user.totpEnabled });
});

// ---------------------------------------------------------------------------
// POST /setup
// Generates a new pending TOTP secret. Returns QR code data URI + plain Base32.
// The secret is NOT saved to data.json yet — that happens in /verify.
// ---------------------------------------------------------------------------
router.post('/setup', (req, res, next) => {
    const { requireAuth } = require('../auth');
    requireAuth(req, res, next);
}, async (req, res) => {
    try {
        const { getData } = require('../data');
        const QRCode = require('qrcode');
        const { authenticator } = require('otplib');

        const data = getData();
        if (!data.user) return res.status(500).json({ error: 'No user configured' });

        const username = req.user.username;
        const sessionId = getSessionId(req);
        if (!sessionId) return res.status(401).json({ error: 'Missing session ID' });

        // Generate a new random Base32 secret
        const secret = authenticator.generateSecret();

        // Build the otpauth URL for the QR code
        const otpauthUrl = authenticator.keyuri(username, 'HomePiNAS', secret);

        // Generate a QR code as a data URI (PNG, base64-encoded)
        const qrCode = await QRCode.toDataURL(otpauthUrl);

        // Store in pending map (overwrites any previous pending secret for this session)
        prunePendingSecrets();
        pendingSecrets.set(sessionId, { secret, expires: Date.now() + PENDING_TTL_MS });

        log.info(`[totp] setup initiated for user: ${username}`);
        return res.json({ qrCode, secret });
    } catch (err) {
        log.error('[totp] setup error:', err.message);
        return res.status(500).json({ error: 'TOTP setup failed' });
    }
});

// ---------------------------------------------------------------------------
// POST /verify
// Body: { token }
// Verifies the TOTP token against the pending secret. On success, persists to data.json.
// ---------------------------------------------------------------------------
router.post('/verify', (req, res, next) => {
    const { requireAuth } = require('../auth');
    requireAuth(req, res, next);
}, async (req, res) => {
    try {
        const { withData } = require('../data');
        const { encryptTotpSecret } = require('../totp-crypto');
        const { authenticator } = require('otplib');

        const { token } = req.body || {};
        if (!token) return res.status(400).json({ error: 'token is required' });

        const sessionId = getSessionId(req);
        if (!sessionId) return res.status(401).json({ error: 'Missing session ID' });

        prunePendingSecrets();
        const pending = pendingSecrets.get(sessionId);
        if (!pending) {
            return res.status(400).json({ error: 'No pending TOTP setup. Call /api/totp/setup first.' });
        }

        const isValid = authenticator.verify({ token: String(token), secret: pending.secret });
        if (!isValid) {
            return res.status(400).json({ error: 'Invalid TOTP token' });
        }

        // Persist: encrypt the secret and save to data.json
        const encryptedSecret = encryptTotpSecret(pending.secret);
        await withData(d => {
            if (d.user) {
                d.user.totpSecret  = encryptedSecret;
                d.user.totpEnabled = true;
            }
            return d;
        });

        // Remove from pending map
        pendingSecrets.delete(sessionId);

        log.info(`[totp] TOTP enabled for user: ${req.user.username}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[totp] verify error:', err.message);
        return res.status(500).json({ error: 'TOTP verification failed' });
    }
});

// ---------------------------------------------------------------------------
// DELETE /disable
// Body: { password }
// Verifies password, then removes TOTP from the account.
// ---------------------------------------------------------------------------
router.delete('/disable', (req, res, next) => {
    const { requireAuth } = require('../auth');
    requireAuth(req, res, next);
}, async (req, res) => {
    try {
        const { getData, withData } = require('../data');

        const { password } = req.body || {};
        if (!password) return res.status(400).json({ error: 'password is required' });

        const data = getData();
        if (!data.user) return res.status(500).json({ error: 'No user configured' });

        const passwordMatch = await bcrypt.compare(password, data.user.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Incorrect password' });
        }

        await withData(d => {
            if (d.user) {
                d.user.totpEnabled = false;
                d.user.totpSecret  = null;
            }
            return d;
        });

        log.info(`[totp] TOTP disabled for user: ${req.user.username}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[totp] disable error:', err.message);
        return res.status(500).json({ error: 'TOTP disable failed' });
    }
});

module.exports = router;
