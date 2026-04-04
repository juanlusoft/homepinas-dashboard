/**
 * HomePiNAS - System Routes
 * Mounted at /api/system
 */

'use strict';

const router = require('express').Router();
const os = require('os');
const fs = require('fs');
const path = require('path');

const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { validateFanMode, validateSystemAction } = require('../sanitize');
const log = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readCpuTemp() {
    try {
        const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        return Math.round(parseInt(raw.trim(), 10) / 1000);
    } catch {
        return null;
    }
}

async function buildStats() {
    const stats = {};

    try {
        stats.cpuLoad = parseFloat(
            ((os.loadavg()[0] / os.cpus().length) * 100).toFixed(1)
        );
    } catch {
        stats.cpuLoad = null;
    }

    try {
        stats.ramUsed = parseFloat(
            ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)
        );
        stats.ramTotal = Math.round(os.totalmem() / 1024 / 1024 / 1024);
    } catch {
        stats.ramUsed = null;
        stats.ramTotal = null;
    }

    try {
        stats.cpuTemp = readCpuTemp();
    } catch {
        stats.cpuTemp = null;
    }

    try {
        stats.uptime = os.uptime();
    } catch {
        stats.uptime = null;
    }

    try {
        stats.hostname = os.hostname();
    } catch {
        stats.hostname = null;
    }

    try {
        const data = getData();
        stats.publicIP = data.publicIp || null;
    } catch {
        stats.publicIP = null;
    }

    return stats;
}

// ─── Route Handlers (exported for unit testing) ───────────────────────────────

async function _statsHandler(req, res) {
    try {
        const stats = await buildStats();
        res.json(stats);
    } catch (err) {
        log.error('[system/stats] Unexpected error:', err.message);
        res.status(500).json({ error: 'Failed to read system stats' });
    }
}

async function _disksHandler(req, res) {
    try {
        const { stdout } = await safeExec('lsblk', [
            '-J', '-d', '-o', 'NAME,MODEL,TYPE,SIZE,SERIAL,ROTA,TRAN'
        ]);
        const lsblk = JSON.parse(stdout);
        const devices = (lsblk.blockdevices || []).filter(d => {
            if (d.type !== 'disk') return false;
            if (/^(loop|zram|ram|mmcblk)/.test(d.name)) return false;
            return d.size && d.size !== '0' && d.size !== '0B';
        });

        const disks = await Promise.all(devices.map(async (d) => {
            let temp = null;
            let model = d.model || d.name;
            try {
                const { stdout: smartRaw } = await safeExec('smartctl', ['-A', '-j', `/dev/${d.name}`]);
                const smart = JSON.parse(smartRaw);
                temp = smart.temperature?.current ?? null;
                model = smart.model_name || model;
            } catch {
                // SMART not available for this disk
            }
            return {
                id: d.name,
                model,
                type: d.rota ? 'HDD' : (d.tran === 'nvme' ? 'NVMe' : 'SSD'),
                size: d.size,
                temp,
                serial: d.serial || null,
            };
        }));

        res.json(disks);
    } catch (err) {
        log.error('[system/disks] Error:', err.message);
        res.status(500).json({ error: 'Failed to read disk list' });
    }
}

async function _getFanModeHandler(req, res) {
    try {
        const data = getData();
        res.json({ mode: data.fanMode || 'balanced' });
    } catch (err) {
        log.error('[system/fan/mode GET] Error:', err.message);
        res.status(500).json({ error: 'Failed to read fan mode' });
    }
}

async function _setFanModeHandler(req, res) {
    const { mode } = req.body;
    const validMode = validateFanMode(mode);
    if (!validMode) {
        return res.status(400).json({ error: 'Invalid fan mode. Must be silent, balanced, or performance' });
    }

    try {
        await withData((data) => {
            data.fanMode = validMode;
            return data;
        });

        try {
            await sudoExec('systemctl', ['restart', 'fan-control']);
        } catch {
            // Fan service not installed
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[system/fan/mode POST] Error:', err.message);
        res.status(500).json({ error: 'Failed to set fan mode' });
    }
}

async function _dashboardUpdatesHandler(req, res) {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const currentVersion = pkg.version;

        await safeExec('git', ['fetch', '--tags', '--quiet']);
        const { stdout: tagsRaw } = await safeExec('git', ['tag', '-l']);
        const tags = tagsRaw.trim().split('\n').filter(Boolean);

        const latestVersion = tags
            .filter(t => /^\d+\.\d+\.\d+/.test(t.replace(/^v/, '')))
            .sort((a, b) => {
                const parse = v => v.replace(/^v/, '').split('.').map(Number);
                const [am, an, ap] = parse(a);
                const [bm, bn, bp] = parse(b);
                return bm - am || bn - an || bp - ap;
            })[0] || currentVersion;

        const hasUpdate = latestVersion !== currentVersion &&
            latestVersion.replace(/^v/, '') !== currentVersion.replace(/^v/, '');

        res.json({ hasUpdate, latestVersion, currentVersion });
    } catch (err) {
        log.error('[system/dashboard-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
}

async function _applyDashboardUpdateHandler(req, res) {
    try {
        await safeExec('git', ['pull']);
        await safeExec('npm', ['install', '--omit=dev']);
        await sudoExec('systemctl', ['restart', 'homepinas']);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/apply-dashboard-update] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply update' });
    }
}

async function _osUpdatesHandler(req, res) {
    try {
        const { stdout } = await sudoExec('apt-get', ['-s', 'upgrade']);
        const lines = stdout.split('\n');
        const upgradable = lines.filter(l => l.startsWith('Inst '));
        res.json({
            hasUpdate: upgradable.length > 0,
            updateCount: upgradable.length,
        });
    } catch (err) {
        log.error('[system/os-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to check OS updates' });
    }
}

async function _applyOsUpdatesHandler(req, res) {
    try {
        await sudoExec('apt-get', ['-y', '--no-install-recommends', 'upgrade']);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/apply-os-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply OS updates' });
    }
}

async function _actionHandler(req, res) {
    const { action } = req.body;
    if (!validateSystemAction(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be reboot or shutdown' });
    }

    res.json({ success: true });

    setTimeout(async () => {
        try {
            const sysctlArg = action === 'reboot' ? 'reboot' : 'poweroff';
            await sudoExec('systemctl', [sysctlArg]);
        } catch (err) {
            log.error(`[system/action] Failed to ${action}:`, err.message);
        }
    }, 1000);
}

async function _factoryResetHandler(req, res) {
    try {
        await withData((data) => {
            Object.keys(data).forEach(k => delete data[k]);
            return data;
        });
        log.info('[system/factory-reset] Data reset by', req.user?.username);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/factory-reset] Error:', err.message);
        res.status(500).json({ error: 'Failed to perform factory reset' });
    }
}

// ─── Route Registrations ──────────────────────────────────────────────────────

router.get('/stats',                requireAuth, _statsHandler);
router.get('/disks',                requireAuth, _disksHandler);
router.get('/fan/mode',             requireAuth, _getFanModeHandler);
router.post('/fan/mode',            requireAuth, requirePermission('write'), _setFanModeHandler);
router.post('/fan',                 requireAuth, requirePermission('write'), _setFanModeHandler);
router.get('/dashboard-updates',    requireAuth, _dashboardUpdatesHandler);
router.post('/apply-dashboard-update', requireAuth, requirePermission('admin'), _applyDashboardUpdateHandler);
router.get('/os-updates',           requireAuth, _osUpdatesHandler);
router.post('/apply-os-updates',    requireAuth, requirePermission('admin'), _applyOsUpdatesHandler);
router.post('/action',              requireAuth, requirePermission('admin'), _actionHandler);
router.post('/factory-reset',       requireAuth, requirePermission('admin'), _factoryResetHandler);

module.exports = router;
module.exports._statsHandler            = _statsHandler;
module.exports._disksHandler            = _disksHandler;
module.exports._getFanModeHandler       = _getFanModeHandler;
module.exports._setFanModeHandler       = _setFanModeHandler;
module.exports._dashboardUpdatesHandler = _dashboardUpdatesHandler;
module.exports._applyDashboardUpdateHandler = _applyDashboardUpdateHandler;
module.exports._osUpdatesHandler        = _osUpdatesHandler;
module.exports._applyOsUpdatesHandler   = _applyOsUpdatesHandler;
module.exports._actionHandler           = _actionHandler;
module.exports._factoryResetHandler     = _factoryResetHandler;
