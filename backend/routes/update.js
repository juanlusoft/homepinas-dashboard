/**
 * HomePiNAS - Update Routes
 * Mounted at /api/update
 */

'use strict';

const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const { safeExec, sudoExec } = require('../security');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

function parseSemver(v) {
    return v.replace(/^v/, '').split('.').map(Number);
}

function compareSemver(a, b) {
    const [am, an, ap] = parseSemver(a);
    const [bm, bn, bp] = parseSemver(b);
    return (am - bm) || (an - bn) || (ap - bp);
}

function pickLatestTag(tagsRaw, fallback) {
    const tags = tagsRaw.trim().split('\n')
        .filter(t => /^\d+\.\d+\.\d+/.test(t.replace(/^v/, '')));
    if (tags.length === 0) return fallback;
    return tags.sort((a, b) => compareSemver(b, a))[0];
}

function parseAptOutput(stdout) {
    const lines = stdout.split('\n').filter(l => l.startsWith('Inst '));
    const packages = lines.map(l => {
        const match = l.match(/^Inst (\S+)/);
        return match ? match[1] : null;
    }).filter(Boolean);

    const securityUpdates = lines.filter(l =>
        l.includes('security.ubuntu.com') || l.includes('debian.org/security')
    ).length;

    return { packages, securityUpdates };
}

async function _checkHandler(req, res) {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const currentVersion = pkg.version;

        await safeExec('git', ['fetch', '--tags', '--quiet']);
        const { stdout: tagsRaw } = await safeExec('git', ['tag', '-l']);
        const latestVersion = pickLatestTag(tagsRaw, currentVersion);

        const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

        const { stdout: statusRaw } = await safeExec('git', ['status', '--porcelain']);
        const localChangesFiles = statusRaw.trim()
            .split('\n')
            .filter(Boolean)
            .map(l => l.slice(2).trim());
        const localChanges = localChangesFiles.length > 0;

        let changelog = '';
        if (updateAvailable) {
            try {
                const { stdout: logRaw } = await safeExec('git', [
                    'log', '--oneline', `${currentVersion}..${latestVersion}`
                ]);
                changelog = logRaw.trim();
            } catch {
                // Git log can fail if tags don't exist locally
            }
        }

        res.json({
            updateAvailable,
            currentVersion,
            latestVersion,
            changelog,
            localChanges,
            localChangesFiles,
        });
    } catch (err) {
        log.error('[update/check] Error:', err.message);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
}

async function _applyHandler(req, res) {
    try {
        await safeExec('git', ['pull']);
        await safeExec('npm', ['install', '--omit=dev']);
        await sudoExec('systemctl', ['restart', 'homepinas']);
        res.json({ success: true, message: 'Update applied. Service restarting.' });
    } catch (err) {
        log.error('[update/apply] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply update' });
    }
}

async function _checkOsHandler(req, res) {
    try {
        const { stdout } = await sudoExec('apt-get', ['-s', 'upgrade']);
        const { packages, securityUpdates } = parseAptOutput(stdout);
        res.json({
            updatesAvailable: packages.length > 0,
            securityUpdates,
            packages,
        });
    } catch (err) {
        log.error('[update/check-os] Error:', err.message);
        res.status(500).json({ error: 'Failed to check OS updates' });
    }
}

async function _applyOsHandler(req, res) {
    try {
        await sudoExec('apt-get', ['-y', '--no-install-recommends', 'upgrade']);
        res.json({ success: true });
    } catch (err) {
        log.error('[update/apply-os] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply OS updates' });
    }
}

router.get('/check',      requireAuth, _checkHandler);
router.post('/apply',     requireAuth, requirePermission('admin'), _applyHandler);
router.get('/check-os',   requireAuth, _checkOsHandler);
router.post('/apply-os',  requireAuth, requirePermission('admin'), _applyOsHandler);

module.exports = router;
module.exports._checkHandler    = _checkHandler;
module.exports._applyHandler    = _applyHandler;
module.exports._checkOsHandler  = _checkOsHandler;
module.exports._applyOsHandler  = _applyOsHandler;
