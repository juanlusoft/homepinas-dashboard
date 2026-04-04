'use strict';
const router = require('express').Router();
const { requireAuth } = require('../auth');

router.get('/', requireAuth, (req, res) => {
    res.json({ status: 'Inactive', lastBackup: 'Never' });
});

module.exports = router;
