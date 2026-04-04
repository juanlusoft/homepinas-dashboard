'use strict';
const router = require('express').Router();
const { requireAuth } = require('../auth');

router.all('*', requireAuth, (req, res) => {
    res.status(402).json({ error: 'license_required' });
});

module.exports = router;
