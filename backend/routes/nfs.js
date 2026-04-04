'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

function buildExportsConf(shares) {
    return shares.map(share => {
        return `${share.path}\t${share.clients}(${share.options})`;
    }).join('\n') + (shares.length > 0 ? '\n' : '');
}

async function writeExports(shares) {
    const confContent = buildExportsConf(shares);
    await sudoExec('tee', ['/etc/exports'], { input: confContent });
    await sudoExec('exportfs', ['-ra']);
}

function validateShare(body) {
    if (!body.path || typeof body.path !== 'string') {
        throw new Error('Export path is required');
    }
    if (!body.path.startsWith('/')) {
        throw new Error('Export path must be absolute');
    }
}

// GET /api/nfs/status
router.get('/status', requireAuth, async (req, res) => {
    try {
        let running = false;
        try {
            const { stdout } = await safeExec('systemctl', ['is-active', 'nfs-kernel-server']);
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }

        const data = getData();
        const shares = data.nfsShares || [];
        res.json({ running, shares });
    } catch (err) {
        log.error('[nfs/status] Error:', err.message);
        res.status(500).json({ error: 'Failed to get NFS status' });
    }
});

// GET /api/nfs/shares
router.get('/shares', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json(data.nfsShares || []);
    } catch (err) {
        log.error('[nfs/shares GET] Error:', err.message);
        res.status(500).json({ error: 'Failed to list NFS shares' });
    }
});

// POST /api/nfs/shares
router.post('/shares', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        validateShare(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        let newShare;
        await withData((data) => {
            if (!data.nfsShares) data.nfsShares = [];
            const exists = data.nfsShares.find(s => s.path === req.body.path);
            if (exists) return; // signal conflict

            newShare = {
                id: uuidv4(),
                path: req.body.path,
                clients: req.body.clients || '*',
                options: req.body.options || 'rw,sync,no_subtree_check',
            };
            data.nfsShares.push(newShare);
            return data;
        });

        if (!newShare) {
            return res.status(409).json({ error: 'An export for that path already exists' });
        }

        const data = getData();
        await writeExports(data.nfsShares);
        res.json(newShare);
    } catch (err) {
        log.error('[nfs/shares POST] Error:', err.message);
        res.status(500).json({ error: 'Failed to create NFS export' });
    }
});

// PUT /api/nfs/shares/:id
router.put('/shares/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.nfsShares) data.nfsShares = [];
            const idx = data.nfsShares.findIndex(s => s.id === req.params.id);
            if (idx === -1) return;
            found = true;
            const existing = data.nfsShares[idx];
            data.nfsShares[idx] = {
                ...existing,
                path: req.body.path !== undefined ? req.body.path : existing.path,
                clients: req.body.clients !== undefined ? req.body.clients : existing.clients,
                options: req.body.options !== undefined ? req.body.options : existing.options,
            };
            return data;
        });

        if (!found) return res.status(404).json({ error: 'Export not found' });

        const data = getData();
        await writeExports(data.nfsShares);
        res.json({ success: true });
    } catch (err) {
        log.error('[nfs/shares PUT] Error:', err.message);
        res.status(500).json({ error: 'Failed to update NFS export' });
    }
});

// DELETE /api/nfs/shares/:id
router.delete('/shares/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.nfsShares) data.nfsShares = [];
            const before = data.nfsShares.length;
            data.nfsShares = data.nfsShares.filter(s => s.id !== req.params.id);
            if (data.nfsShares.length < before) {
                found = true;
                return data;
            }
        });

        if (!found) return res.status(404).json({ error: 'Export not found' });

        const data = getData();
        await writeExports(data.nfsShares);
        res.json({ success: true });
    } catch (err) {
        log.error('[nfs/shares DELETE] Error:', err.message);
        res.status(500).json({ error: 'Failed to delete NFS export' });
    }
});

// POST /api/nfs/restart
router.post('/restart', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'nfs-kernel-server']);
        res.json({ success: true });
    } catch (err) {
        log.error('[nfs/restart] Error:', err.message);
        res.status(500).json({ error: 'Failed to restart NFS' });
    }
});

module.exports = router;
