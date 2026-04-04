// backend/routes/files.js
'use strict';

const router   = require('express').Router();
const fs       = require('fs');
const fsp      = fs.promises;
const path     = require('path');
const os       = require('os');
const multer   = require('multer');

const { safeExec }                      = require('../security');
const { sanitizePath, sanitizeString }  = require('../sanitize');
const { requireAuth }                   = require('../auth');
const { requirePermission }             = require('../rbac');
const { getData }                       = require('../data');
const log                               = require('../logger');

const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

function modeToString(mode) {
    const chars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
    const owner  = chars[(mode >> 6) & 7];
    const group  = chars[(mode >> 3) & 7];
    const others = chars[mode & 7];
    return `${owner}${group}${others}`;
}

function sanitizeSearchQuery(q) {
    if (!q || typeof q !== 'string' || !q.trim()) return null;
    const safe = q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
    return safe.trim() || null;
}

function resolveUserHome(username) {
    const data = getData();
    const users = Array.isArray(data.users) ? data.users : [];
    const user = users.find(u => u.username === username);
    const homePath = user?.homePath || '/srv/nas';
    const storageConfig = Array.isArray(data.storageConfig) ? data.storageConfig : [];
    const mountPoints = storageConfig.filter(d => d.mountPoint).map(d => d.mountPoint);
    const allowedPaths = mountPoints.length > 0
        ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
        : [homePath, '/home'];
    return { homePath, hasRestrictions: false, allowedPaths };
}

// GET /list
router.get('/list', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        const dirEntries = await fsp.readdir(safePath, { withFileTypes: true });
        const items = await Promise.all(
            dirEntries.map(async entry => {
                const entryPath = path.join(safePath, entry.name);
                let size = 0, modified = null, permissions = '';
                try {
                    const stat = await fsp.stat(entryPath);
                    size = stat.size;
                    modified = stat.mtime.toISOString();
                    permissions = modeToString(stat.mode & 0o777);
                } catch {}
                return {
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size, modified, permissions,
                };
            })
        );
        return res.json({ items: sortEntries(items) });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Path not found' });
        if (err.code === 'ENOTDIR') return res.status(400).json({ error: 'Path is not a directory' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] list error:', err.message);
        return res.status(500).json({ error: 'Failed to list directory' });
    }
});

// GET /download
router.get('/download', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        const stat = await fsp.stat(safePath);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory — cannot download' });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        return res.status(500).json({ error: 'Failed to access file' });
    }

    const filename = path.basename(safePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    const stream = fs.createReadStream(safePath);
    stream.on('error', streamErr => {
        log.error('[files] download stream error:', streamErr.message);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to stream file' });
        else res.destroy();
    });
    stream.pipe(res);
});

// POST /upload
router.post('/upload', requireAuth, requirePermission('write'), upload.array('files'), async (req, res) => {
    const safeDir = sanitizePath(req.body.path);
    if (!safeDir) {
        if (req.files) for (const f of req.files) fsp.unlink(f.path).catch(() => {});
        return res.status(400).json({ error: 'Invalid or missing target path' });
    }
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files provided' });

    try {
        await fsp.mkdir(safeDir, { recursive: true });
        const moved = [], errors = [];
        for (const file of req.files) {
            const safeName = path.basename(file.originalname || file.filename);
            const destPath = path.join(safeDir, safeName);
            try {
                await fsp.rename(file.path, destPath);
                moved.push(safeName);
            } catch (moveErr) {
                log.error('[files] upload move error:', moveErr.message);
                fsp.unlink(file.path).catch(() => {});
                errors.push({ name: safeName, error: moveErr.message });
            }
        }
        if (errors.length > 0 && moved.length === 0) {
            return res.status(500).json({ error: 'All uploads failed', details: errors });
        }
        return res.json({ success: true, uploaded: moved, errors: errors.length > 0 ? errors : undefined });
    } catch (err) {
        log.error('[files] upload error:', err.message);
        return res.status(500).json({ error: 'Upload failed' });
    }
});

// POST /delete
router.post('/delete', requireAuth, requirePermission('write'), async (req, res) => {
    const safePath = sanitizePath(req.body.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });
    try {
        await fsp.rm(safePath, { recursive: true, force: false });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] delete error:', err.message);
        return res.status(500).json({ error: 'Failed to delete' });
    }
});

// POST /rename
router.post('/rename', requireAuth, requirePermission('write'), async (req, res) => {
    const safeOld = sanitizePath(req.body.oldPath);
    const safeNew = sanitizePath(req.body.newPath);
    if (!safeOld || !safeNew) return res.status(400).json({ error: 'Invalid or missing path(s)' });
    try {
        await fsp.rename(safeOld, safeNew);
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] rename error:', err.message);
        return res.status(500).json({ error: 'Failed to rename' });
    }
});

// POST /copy
router.post('/copy', requireAuth, requirePermission('write'), async (req, res) => {
    const safeSrc  = sanitizePath(req.body.srcPath);
    const safeDest = sanitizePath(req.body.destPath);
    if (!safeSrc || !safeDest) return res.status(400).json({ error: 'Invalid or missing path(s)' });
    try {
        await fsp.cp(safeSrc, safeDest, { recursive: true });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] copy error:', err.message);
        return res.status(500).json({ error: 'Failed to copy' });
    }
});

// POST /move
router.post('/move', requireAuth, requirePermission('write'), async (req, res) => {
    const safeSrc  = sanitizePath(req.body.source);
    const safeDest = sanitizePath(req.body.destination);
    if (!safeSrc || !safeDest) return res.status(400).json({ error: 'Invalid or missing path(s)' });
    try {
        await fsp.rename(safeSrc, safeDest);
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'EXDEV') {
            try {
                await fsp.cp(safeSrc, safeDest, { recursive: true });
                await fsp.rm(safeSrc, { recursive: true, force: true });
                return res.json({ success: true });
            } catch (fallbackErr) {
                log.error('[files] move cross-device fallback error:', fallbackErr.message);
                return res.status(500).json({ error: 'Failed to move (cross-device)' });
            }
        }
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] move error:', err.message);
        return res.status(500).json({ error: 'Failed to move' });
    }
});

// POST /mkdir
router.post('/mkdir', requireAuth, requirePermission('write'), async (req, res) => {
    const safePath = sanitizePath(req.body.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });
    try {
        await fsp.mkdir(safePath, { recursive: true });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] mkdir error:', err.message);
        return res.status(500).json({ error: 'Failed to create directory' });
    }
});

// GET /search
router.get('/search', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });
    const safeQuery = sanitizeSearchQuery(req.query.query);
    if (!safeQuery) return res.status(400).json({ error: 'Invalid or missing search query' });

    try {
        const { stdout } = await safeExec('find', [
            safePath, '-iname', `*${safeQuery}*`,
            '-maxdepth', '10', '-not', '-path', '*/.*',
        ]);
        const results = [];
        const lines = stdout.split('\n').filter(Boolean);
        await Promise.all(
            lines.map(async filePath => {
                try {
                    const stat = await fsp.stat(filePath);
                    results.push({
                        path: filePath,
                        name: path.basename(filePath),
                        type: stat.isDirectory() ? 'directory' : 'file',
                        size: stat.size,
                    });
                } catch {}
            })
        );
        return res.json({ results });
    } catch (err) {
        log.error('[files] search error:', err.message);
        return res.status(500).json({ error: 'Search failed' });
    }
});

// GET /user-home
router.get('/user-home', requireAuth, async (req, res) => {
    try {
        const result = resolveUserHome(req.user.username);
        return res.json(result);
    } catch (err) {
        log.error('[files] user-home error:', err.message);
        return res.status(500).json({ error: 'Failed to resolve home path' });
    }
});

module.exports = router;
