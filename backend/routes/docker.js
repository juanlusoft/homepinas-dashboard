/**
 * HomePiNAS - Docker Routes
 * Phase 3 implementation
 *
 * Mounted at: /api/docker
 */

'use strict';

const router = require('express').Router();
const path   = require('path');
const fs     = require('fs').promises;
const { safeExec }          = require('../security');
const { withData, getData } = require('../data');
const { requireAuth }       = require('../auth');
const { requirePermission } = require('../rbac');
const {
    validateDockerAction,
    validateContainerId,
    sanitizeComposeName,
    validateComposeContent
} = require('../sanitize');
const log = require('../logger');

const COMPOSE_DIR = path.join(__dirname, '..', '..', 'config', 'compose');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

async function ensureComposeDir() {
    await fs.mkdir(COMPOSE_DIR, { recursive: true, mode: 0o700 });
}

function parseDockerLines(stdout) {
    return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => {
            try { return JSON.parse(line); } catch { return null; }
        })
        .filter(Boolean);
}

function parseDockerStats(stdout) {
    const statsMap = new Map();
    for (const s of parseDockerLines(stdout)) {
        const id = (s.ID || s.id || '').slice(0, 12);
        if (id) statsMap.set(id, s);
    }
    return statsMap;
}

function parseMemString(mem) {
    if (!mem || typeof mem !== 'string') return 0;
    const m = mem.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|B)/i);
    if (!m) return 0;
    const value = parseFloat(m[1]);
    const unit  = m[2].toUpperCase();
    const multipliers = { B: 1, KIB: 1024, MIB: 1024**2, GIB: 1024**3, TIB: 1024**4 };
    return Math.round(value * (multipliers[unit] || 1));
}

function mergeContainerData(container, statsMap, containerNotes) {
    const shortId = (container.ID || '').slice(0, 12);
    const stats   = statsMap.get(shortId) || {};

    const cpu = parseFloat(stats.CPUPerc || '0') || 0;
    let ram    = 0;
    if (stats.MemUsage) {
        const memLeft = stats.MemUsage.split('/')[0].trim();
        ram = parseMemString(memLeft);
    }

    return {
        id:      container.ID     || '',
        name:    (container.Names || '').replace(/^\//, ''),
        image:   container.Image  || '',
        status:  container.Status || '',
        cpu,
        ram,
        ports:   container.Ports  || '',
        mounts:  container.Mounts || '',
        notes:   (containerNotes || {})[shortId] || '',
        hasUpdate:  false,
        compose:    container.Label ? (container.Label['com.docker.compose.project'] || '') : ''
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINERS LIST  GET /containers
// ─────────────────────────────────────────────────────────────────────────────

router.get('/containers', requireAuth, async (req, res) => {
    try {
        const psResult = await safeExec('docker', ['ps', '-a', '--format', '{{json .}}']);
        const containers = parseDockerLines(psResult.stdout);

        let statsMap = new Map();
        try {
            const statsResult = await safeExec('docker', ['stats', '--no-stream', '--format', '{{json .}}']);
            statsMap = parseDockerStats(statsResult.stdout);
        } catch {
            // stats may fail if no containers running
        }

        const data  = getData();
        const notes = data.containerNotes || {};

        const result = containers.map(c => mergeContainerData(c, statsMap, notes));
        return res.json(result);
    } catch (err) {
        log.error('[docker] containers error:', err.message);
        return res.status(500).json({ error: 'Failed to list containers' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE STATUS  GET /update-status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/update-status', requireAuth, (req, res) => {
    try {
        const data   = getData();
        const status = data.dockerUpdateStatus || { lastCheck: null, updatesAvailable: [] };
        return res.json(status);
    } catch (err) {
        log.error('[docker] update-status error:', err.message);
        return res.status(500).json({ error: 'Failed to get update status' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTION  POST /action
// ─────────────────────────────────────────────────────────────────────────────

router.post('/action', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { id, action } = req.body;

        if (!validateContainerId(id)) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }
        if (!validateDockerAction(action)) {
            return res.status(400).json({ error: 'action must be one of: start, stop, restart' });
        }

        await safeExec('docker', [action, id]);
        log.info(`[docker] action=${action} container=${id}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] action error:', err.message);
        return res.status(500).json({ error: `Docker action failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK UPDATES  POST /check-updates
// ─────────────────────────────────────────────────────────────────────────────

router.post('/check-updates', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const psResult = await safeExec('docker', ['ps', '-a', '--format', '{{json .}}']);
        const containers = parseDockerLines(psResult.stdout);
        const images     = [...new Set(containers.map(c => c.Image).filter(Boolean))];

        const updatesAvailable = [];

        for (const image of images) {
            try {
                const localResult = await safeExec('docker', [
                    'inspect', '--format', '{{index .RepoDigests 0}}', image
                ]);
                const localDigest = localResult.stdout.trim();

                const remoteResult = await safeExec('docker', [
                    'manifest', 'inspect', image
                ]);

                let remoteOk = false;
                try {
                    const manifest = JSON.parse(remoteResult.stdout);
                    remoteOk = !!manifest.schemaVersion;
                } catch {}

                if (!localDigest || !remoteOk) {
                    updatesAvailable.push(image);
                }
            } catch {
                // Network error or image not on registry — skip
            }
        }

        const checkResult = {
            lastCheck:        new Date().toISOString(),
            updatesAvailable,
            totalImages:      images.length
        };

        await withData(data => {
            data.dockerUpdateStatus = checkResult;
            return data;
        });

        return res.json({ totalImages: images.length, updatesAvailable });
    } catch (err) {
        log.error('[docker] check-updates error:', err.message);
        return res.status(500).json({ error: 'Failed to check updates' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE CONTAINER  POST /update
// ─────────────────────────────────────────────────────────────────────────────

router.post('/update', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { containerId } = req.body;
        if (!validateContainerId(containerId)) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        const inspectResult = await safeExec('docker', [
            'inspect', '--format', '{{.Config.Image}}', containerId
        ]);
        const image = inspectResult.stdout.trim();
        if (!image) {
            return res.status(404).json({ error: 'Container not found or image unknown' });
        }

        await safeExec('docker', ['pull', image]);
        await safeExec('docker', ['stop', containerId]);
        await safeExec('docker', ['rm',   containerId]);

        log.info(`[docker] Updated container ${containerId} to latest ${image}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] update error:', err.message);
        return res.status(500).json({ error: `Update failed: ${err.message}` });
    }
});

module.exports = router;
