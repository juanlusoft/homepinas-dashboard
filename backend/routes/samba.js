'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

function buildSmbConf(shares) {
    const globalSection = [
        '[global]',
        '   workgroup = WORKGROUP',
        '   server string = HomePiNAS Samba Server',
        '   security = user',
        '   map to guest = Bad User',
        '   log level = 1',
        '   max log size = 1000',
        '',
    ].join('\n');

    const shareSections = shares.map(share => {
        const lines = [
            `[${share.name}]`,
            `   path = ${share.path}`,
            `   comment = ${share.comment || ''}`,
            `   read only = ${share.readOnly ? 'yes' : 'no'}`,
            `   guest ok = ${share.guestAccess ? 'yes' : 'no'}`,
        ];
        if (share.validUsers) {
            lines.push(`   valid users = ${share.validUsers}`);
        }
        lines.push('');
        return lines.join('\n');
    });

    return globalSection + shareSections.join('\n');
}

async function writeSmbConf(shares) {
    const confContent = buildSmbConf(shares);
    await sudoExec('tee', ['/etc/samba/smb.conf'], { input: confContent });
    try {
        await safeExec('testparm', ['-s', '/etc/samba/smb.conf']);
    } catch (err) {
        log.warn('[samba] testparm reported warnings:', err.stderr || err.message);
    }
}

function validateShare(body) {
    if (!body.name || typeof body.name !== 'string') {
        throw new Error('Share name is required');
    }
    if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(body.name)) {
        throw new Error('Share name must be 1-64 alphanumeric/dash/underscore characters');
    }
    if (!body.path || typeof body.path !== 'string') {
        throw new Error('Share path is required');
    }
    if (!body.path.startsWith('/')) {
        throw new Error('Share path must be absolute');
    }
}

// GET /api/samba/status
router.get('/status', requireAuth, async (req, res) => {
    try {
        let running = false;
        try {
            const { stdout } = await safeExec('systemctl', ['is-active', 'smbd']);
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }

        let connectedUsers = [];
        try {
            const { stdout } = await safeExec('smbstatus', ['-b', '-j']);
            const parsed = JSON.parse(stdout);
            if (parsed && parsed.sessions) {
                connectedUsers = Object.values(parsed.sessions).map(s => ({
                    user: s.username,
                    machine: s.machine,
                    connectedAt: s.session_setup_time,
                }));
            }
        } catch {
            // smbstatus unavailable or no sessions
        }

        const data = getData();
        const shares = data.sambaShares || [];
        res.json({ running, shares, connectedUsers });
    } catch (err) {
        log.error('[samba/status] Error:', err.message);
        res.status(500).json({ error: 'Failed to get Samba status' });
    }
});

// GET /api/samba/shares
router.get('/shares', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json(data.sambaShares || []);
    } catch (err) {
        log.error('[samba/shares GET] Error:', err.message);
        res.status(500).json({ error: 'Failed to list shares' });
    }
});

// POST /api/samba/shares
router.post('/shares', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        validateShare(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        let newShare;
        await withData((data) => {
            if (!data.sambaShares) data.sambaShares = [];
            const exists = data.sambaShares.find(s => s.name === req.body.name);
            if (exists) return; // signal conflict

            newShare = {
                id: uuidv4(),
                name: req.body.name,
                path: req.body.path,
                comment: req.body.comment || '',
                readOnly: Boolean(req.body.readOnly),
                guestAccess: Boolean(req.body.guestAccess),
                validUsers: req.body.validUsers || '',
            };
            data.sambaShares.push(newShare);
            return data;
        });

        if (!newShare) {
            return res.status(409).json({ error: 'A share with that name already exists' });
        }

        const data = getData();
        await writeSmbConf(data.sambaShares);
        res.json(newShare);
    } catch (err) {
        log.error('[samba/shares POST] Error:', err.message);
        res.status(500).json({ error: 'Failed to create share' });
    }
});

// PUT /api/samba/shares/:id
router.put('/shares/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.sambaShares) data.sambaShares = [];
            const idx = data.sambaShares.findIndex(s => s.id === req.params.id);
            if (idx === -1) return;
            found = true;
            const existing = data.sambaShares[idx];
            data.sambaShares[idx] = {
                ...existing,
                name: req.body.name !== undefined ? req.body.name : existing.name,
                path: req.body.path !== undefined ? req.body.path : existing.path,
                comment: req.body.comment !== undefined ? req.body.comment : existing.comment,
                readOnly: req.body.readOnly !== undefined ? Boolean(req.body.readOnly) : existing.readOnly,
                guestAccess: req.body.guestAccess !== undefined ? Boolean(req.body.guestAccess) : existing.guestAccess,
                validUsers: req.body.validUsers !== undefined ? req.body.validUsers : existing.validUsers,
            };
            return data;
        });

        if (!found) return res.status(404).json({ error: 'Share not found' });

        const data = getData();
        await writeSmbConf(data.sambaShares);
        res.json({ success: true });
    } catch (err) {
        log.error('[samba/shares PUT] Error:', err.message);
        res.status(500).json({ error: 'Failed to update share' });
    }
});

// DELETE /api/samba/shares/:id
router.delete('/shares/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.sambaShares) data.sambaShares = [];
            const before = data.sambaShares.length;
            data.sambaShares = data.sambaShares.filter(s => s.id !== req.params.id);
            if (data.sambaShares.length < before) {
                found = true;
                return data;
            }
        });

        if (!found) return res.status(404).json({ error: 'Share not found' });

        const data = getData();
        await writeSmbConf(data.sambaShares);
        res.json({ success: true });
    } catch (err) {
        log.error('[samba/shares DELETE] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete share' });
    }
});

// POST /api/samba/restart
router.post('/restart', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'smbd', 'nmbd']);
        res.json({ success: true });
    } catch (err) {
        log.error('[samba/restart] Error:', err.message);
        res.status(500).json({ error: 'Failed to restart Samba' });
    }
});

module.exports = router;
