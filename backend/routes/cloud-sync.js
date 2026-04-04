'use strict';
const router = require('express').Router();
const { requireAuth } = require('../auth');

router.get('/status', requireAuth, (req, res) => {
    res.json({
        enabled: false,
        lastSync: null,
        nextScheduledSync: null,
        queuedFiles: 0,
        syncingFiles: 0,
        bytesRemaining: 0,
        errorCount: 0
    });
});

module.exports = router;
