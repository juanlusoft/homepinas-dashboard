'use strict';
const router = require('express').Router();
const path = require('path');
const fs = require('fs').promises;
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const log = require('../logger');

const COMPOSE_DIR = path.join(__dirname, '..', '..', 'config', 'compose');

async function getStackStatus(filePath) {
    try {
        const { stdout } = await safeExec('docker', ['compose', '-f', filePath, 'ps', '--format', 'json'], { timeout: 10000 });
        const lines = stdout.trim().split('\n').filter(Boolean);
        if (lines.length === 0) return 'stopped';
        const statuses = lines.map(line => {
            try { return (JSON.parse(line).State || '').toLowerCase(); } catch { return 'unknown'; }
        });
        const running = statuses.filter(s => s === 'running').length;
        if (running === 0) return 'stopped';
        if (running === statuses.length) return 'running';
        return 'partial';
    } catch {
        return 'stopped';
    }
}

router.get('/', requireAuth, async (req, res) => {
    try {
        await fs.mkdir(COMPOSE_DIR, { recursive: true });
        const entries = await fs.readdir(COMPOSE_DIR, { withFileTypes: true });
        const ymlFiles = entries.filter(e => e.isFile() && e.name.endsWith('.yml'));
        const stacks = await Promise.all(ymlFiles.map(async entry => {
            const filePath = path.join(COMPOSE_DIR, entry.name);
            const stat = await fs.stat(filePath);
            const name = path.basename(entry.name, '.yml');
            const status = await getStackStatus(filePath);
            return { name, status, modified: stat.mtime.toISOString() };
        }));
        res.json(stacks);
    } catch (err) {
        log.error('[stacks] GET failed:', err);
        res.status(500).json({ error: 'Failed to list stacks' });
    }
});

module.exports = router;
