'use strict';

/**
 * HomePiNAS - User Management Routes
 * PUT /api/users/me/password
 */

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const log = require('../logger');

// ---------------------------------------------------------------------------
// PUT /me/password
// Body: { currentPassword, newPassword }
// Changes the logged-in user's password and invalidates all their sessions.
// ---------------------------------------------------------------------------
router.put('/me/password', (req, res, next) => {
    // Lazy-load requireAuth so mocks work in tests
    const { requireAuth } = require('../auth');
    requireAuth(req, res, next);
}, async (req, res) => {
    try {
        const { getData, withData } = require('../data');
        const { clearAllSessions } = require('../session');

        const { currentPassword, newPassword } = req.body || {};
        const username = req.user.username;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: 'currentPassword and newPassword are required' });
        }

        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            return res.status(400).json({ error: 'New password must be at least 8 characters' });
        }

        if (newPassword.length > 128) {
            return res.status(400).json({ error: 'New password must be at most 128 characters' });
        }

        const data = getData();

        // Find the user record. Primary admin lives in data.user.
        const userRecord = data.user && data.user.username === username ? data.user : null;

        if (!userRecord) {
            return res.status(404).json({ error: 'User not found' });
        }

        const passwordMatch = await bcrypt.compare(currentPassword, userRecord.password);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const newHash = await bcrypt.hash(newPassword, 12);

        await withData(d => {
            if (d.user && d.user.username === username) {
                d.user.password = newHash;
            }
            return d;
        });

        // Invalidate ALL sessions — the client must log in again with the new password.
        clearAllSessions();

        log.info(`[users] password changed for user: ${username}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[users] password change error:', err.message);
        return res.status(500).json({ error: 'Password change failed' });
    }
});

module.exports = router;
