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

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE LIST  GET /compose/list
// ─────────────────────────────────────────────────────────────────────────────

router.get('/compose/list', requireAuth, async (req, res) => {
    try {
        await ensureComposeDir();
        const entries = await fs.readdir(COMPOSE_DIR, { withFileTypes: true });
        const files   = [];
        for (const entry of entries) {
            if (!entry.isFile()) continue;
            if (!/\.(yml|yaml)$/.test(entry.name)) continue;
            const stat = await fs.stat(path.join(COMPOSE_DIR, entry.name));
            const name = entry.name.replace(/\.(yml|yaml)$/, '');
            files.push({ name, modified: stat.mtime.toISOString() });
        }
        files.sort((a, b) => a.name.localeCompare(b.name));
        return res.json(files);
    } catch (err) {
        log.error('[docker] compose/list error:', err.message);
        return res.status(500).json({ error: 'Failed to list compose files' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE IMPORT  POST /compose/import
// ─────────────────────────────────────────────────────────────────────────────

router.post('/compose/import', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { name, content } = req.body;

        const safeName = sanitizeComposeName(name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose file name (alphanumeric, hyphens, underscores; max 50 chars)' });
        }

        const validation = validateComposeContent(content);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        await ensureComposeDir();
        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });

        log.info(`[docker] Compose file imported: ${safeName}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] compose/import error:', err.message);
        return res.status(500).json({ error: 'Failed to import compose file' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE UP  POST /compose/up
// ─────────────────────────────────────────────────────────────────────────────

router.post('/compose/up', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const safeName = sanitizeComposeName(req.body.name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose name' });
        }

        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        try { await fs.access(filePath); } catch {
            return res.status(404).json({ error: 'Compose file not found' });
        }

        const result = await safeExec('docker', ['compose', '-f', filePath, 'up', '-d']);
        log.info(`[docker] compose up: ${safeName}`);
        return res.json({ success: true, output: result.stdout || result.stderr || '' });
    } catch (err) {
        log.error('[docker] compose/up error:', err.message);
        return res.status(500).json({ error: `compose up failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE DOWN  POST /compose/down
// ─────────────────────────────────────────────────────────────────────────────

router.post('/compose/down', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const safeName = sanitizeComposeName(req.body.name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose name' });
        }

        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        try { await fs.access(filePath); } catch {
            return res.status(404).json({ error: 'Compose file not found' });
        }

        await safeExec('docker', ['compose', '-f', filePath, 'down']);
        log.info(`[docker] compose down: ${safeName}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] compose/down error:', err.message);
        return res.status(500).json({ error: `compose down failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE GET  GET /compose/:name
// ─────────────────────────────────────────────────────────────────────────────

router.get('/compose/:name', requireAuth, async (req, res) => {
    try {
        const safeName = sanitizeComposeName(req.params.name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose name' });
        }

        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        let content;
        try {
            content = await fs.readFile(filePath, 'utf8');
        } catch {
            return res.status(404).json({ error: 'Compose file not found' });
        }

        return res.json({ content });
    } catch (err) {
        log.error('[docker] compose get error:', err.message);
        return res.status(500).json({ error: 'Failed to read compose file' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE PUT  PUT /compose/:name
// ─────────────────────────────────────────────────────────────────────────────

router.put('/compose/:name', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const safeName = sanitizeComposeName(req.params.name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose name' });
        }

        const { content } = req.body;
        const validation  = validateComposeContent(content);
        if (!validation.valid) {
            return res.status(400).json({ error: validation.error });
        }

        await ensureComposeDir();
        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        await fs.writeFile(filePath, content, { encoding: 'utf8', mode: 0o600 });

        log.info(`[docker] Compose file updated: ${safeName}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] compose put error:', err.message);
        return res.status(500).json({ error: 'Failed to update compose file' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSE DELETE  DELETE /compose/:name
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/compose/:name', requireAuth, requirePermission('delete'), async (req, res) => {
    try {
        const safeName = sanitizeComposeName(req.params.name);
        if (!safeName) {
            return res.status(400).json({ error: 'Invalid compose name' });
        }

        const filePath = path.join(COMPOSE_DIR, `${safeName}.yml`);
        try { await fs.access(filePath); } catch {
            return res.status(404).json({ error: 'Compose file not found' });
        }

        await fs.unlink(filePath);
        log.info(`[docker] Compose file deleted: ${safeName}`);
        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] compose delete error:', err.message);
        return res.status(500).json({ error: 'Failed to delete compose file' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTAINER NOTES  POST /containers/:id/notes
// ─────────────────────────────────────────────────────────────────────────────

router.post('/containers/:id/notes', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const { id }    = req.params;
        const { notes } = req.body;

        if (!validateContainerId(id)) {
            return res.status(400).json({ error: 'Invalid container ID' });
        }

        if (typeof notes !== 'string' || notes.length > 2000) {
            return res.status(400).json({ error: 'notes must be a string (max 2000 chars)' });
        }

        const shortId = id.slice(0, 12);
        await withData(data => {
            data.containerNotes        = data.containerNotes || {};
            data.containerNotes[shortId] = notes;
            return data;
        });

        return res.json({ success: true });
    } catch (err) {
        log.error('[docker] container notes error:', err.message);
        return res.status(500).json({ error: 'Failed to save notes' });
    }
});

module.exports = router;
