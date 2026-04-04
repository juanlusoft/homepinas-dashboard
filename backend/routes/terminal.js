'use strict';
const router = require('express').Router();
const { requireAuth } = require('../auth');
const { getActiveSessions } = require('../terminal-ws');
const log = require('../logger');

router.get('/sessions', requireAuth, (req, res) => {
    try {
        const sessions = getActiveSessions();
        res.json(sessions);
    } catch (err) {
        log.error('[terminal] Failed to get sessions:', err);
        res.status(500).json({ error: 'Failed to retrieve sessions' });
    }
});

module.exports = router;
