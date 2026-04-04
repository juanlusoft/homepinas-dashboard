'use strict';

const router = require('express').Router();
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { sendViaEmail, sendViaTelegram } = require('../notify');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip sensitive fields (passwords, tokens) for the GET response.
 * Returns a copy safe to send to the frontend.
 */
function sanitizeConfigForResponse(notifications) {
    if (!notifications) return { email: null, telegram: null };

    const safe = {};

    if (notifications.email) {
        safe.email = {
            host: notifications.email.host || '',
            port: notifications.email.port || 587,
            secure: notifications.email.secure || false,
            user: notifications.email.user || '',
            from: notifications.email.from || '',
            to: notifications.email.to || '',
            // Mask the password: show *** if set, else empty
            password: notifications.email.password ? '***' : '',
            enabled: notifications.email.enabled !== false,
        };
    } else {
        safe.email = null;
    }

    if (notifications.telegram) {
        safe.telegram = {
            chatId: notifications.telegram.chatId || '',
            // Mask the bot token
            botToken: notifications.telegram.botToken ? '***' : '',
            enabled: notifications.telegram.enabled || false,
        };
    } else {
        safe.telegram = null;
    }

    return safe;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/notifications/config
router.get('/config', requireAuth, requirePermission('admin'), (req, res) => {
    try {
        const data = getData();
        const safeConfig = sanitizeConfigForResponse(data.notifications);
        res.json(safeConfig);
    } catch (err) {
        log.error('[notifications] get config error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notifications/config
router.post('/config', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { email, telegram } = req.body;

        await withData((data) => {
            if (!data.notifications) {
                data.notifications = { email: null, telegram: null, history: [], errorReporting: null };
            }

            if (email !== undefined) {
                const existing = data.notifications.email || {};
                data.notifications.email = {
                    host: email.host || existing.host || '',
                    port: parseInt(email.port, 10) || existing.port || 587,
                    secure: email.secure !== undefined ? Boolean(email.secure) : (existing.secure || false),
                    user: email.user || existing.user || '',
                    from: email.from || existing.from || '',
                    to: email.to || existing.to || '',
                    // Only update password if a real value (not '***') is provided
                    password: (email.password && email.password !== '***')
                        ? email.password
                        : existing.password || '',
                    enabled: email.enabled !== undefined ? Boolean(email.enabled) : (existing.enabled !== false),
                };
            }

            if (telegram !== undefined) {
                const existing = data.notifications.telegram || {};
                data.notifications.telegram = {
                    chatId: telegram.chatId || existing.chatId || '',
                    botToken: (telegram.botToken && telegram.botToken !== '***')
                        ? telegram.botToken
                        : existing.botToken || '',
                    enabled: telegram.enabled !== undefined ? Boolean(telegram.enabled) : (existing.enabled || false),
                };
            }

            return data;
        });

        res.json({ success: true });
    } catch (err) {
        log.error('[notifications] save config error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notifications/test
router.post('/test', requireAuth, requirePermission('admin'), async (req, res) => {
    const { channel } = req.body;

    if (!channel || !['email', 'telegram'].includes(channel)) {
        return res.status(400).json({ error: "channel must be 'email' or 'telegram'" });
    }

    try {
        let result;
        if (channel === 'email') {
            result = await sendViaEmail(
                'HomePiNAS — Test Notification',
                'This is a test notification from your HomePiNAS dashboard.',
                '<h3>HomePiNAS Test</h3><p>This is a test notification from your HomePiNAS dashboard.</p>'
            );
        } else {
            result = await sendViaTelegram(
                '*HomePiNAS Test*\n\nThis is a test notification from your HomePiNAS dashboard.'
            );
        }

        if (!result.success) {
            return res.status(502).json({ error: result.error || 'Notification delivery failed' });
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[notifications] test error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
