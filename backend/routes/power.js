/**
 * HomePiNAS - Power Routes
 * Mounted at /api/power
 * All routes require auth + admin permission.
 */

'use strict';

const router = require('express').Router();
const { sudoExec } = require('../security');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

function schedulePowerCommand(sysctlArg) {
    setTimeout(async () => {
        try {
            await sudoExec('systemctl', [sysctlArg]);
        } catch (err) {
            log.error(`[power] systemctl ${sysctlArg} failed:`, err.message);
        }
    }, 1000);
}

async function _rebootHandler(req, res) {
    log.info('[power] Reboot requested by', req.user?.username);
    res.json({ success: true });
    schedulePowerCommand('reboot');
}

async function _shutdownHandler(req, res) {
    log.info('[power] Shutdown requested by', req.user?.username);
    res.json({ success: true });
    schedulePowerCommand('poweroff');
}

async function _actionHandler(req, res) {
    const { action } = req.params;

    if (action === 'reboot') {
        log.info('[power/:action] Reboot via generic action by', req.user?.username);
        res.json({ success: true });
        schedulePowerCommand('reboot');
        return;
    }

    if (action === 'shutdown' || action === 'poweroff') {
        log.info('[power/:action] Shutdown via generic action by', req.user?.username);
        res.json({ success: true });
        schedulePowerCommand('poweroff');
        return;
    }

    return res.status(400).json({ error: `Unknown power action: ${action}. Use reboot or shutdown.` });
}

router.post('/reboot',   requireAuth, requirePermission('admin'), _rebootHandler);
router.post('/shutdown', requireAuth, requirePermission('admin'), _shutdownHandler);
router.post('/:action',  requireAuth, requirePermission('admin'), _actionHandler);

module.exports = router;
module.exports._rebootHandler   = _rebootHandler;
module.exports._shutdownHandler = _shutdownHandler;
module.exports._actionHandler   = _actionHandler;
