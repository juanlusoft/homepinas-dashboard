/**
 * HomePiNAS - Storage Routes
 * Phase 3 implementation
 *
 * Mounted at:
 *   /api/storage  (main prefix)
 *   /api/cache    (alias — for POST /api/cache/move-now)
 *
 * Long-running jobs (SnapRAID sync, badblocks, SMART tests) are tracked
 * in module-level Maps that reset on server restart.
 */

'use strict';

const router  = require('express').Router();
const path    = require('path');
const { safeExec, sudoExec } = require('../security');
const { withData, getData }  = require('../data');
const { requireAuth }        = require('../auth');
const { requirePermission }  = require('../rbac');
const { sanitizeDiskId, validateDiskConfig } = require('../sanitize');
const log     = require('../logger');

// ─────────────────────────────────────────────────────────────────────────────
// MODULE-LEVEL JOB MAPS (reset on restart — intentional)
// ─────────────────────────────────────────────────────────────────────────────

const snapraidJobs = new Map();
const badblocksJobs = new Map();
const smartTests = new Map();

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function parseDfOutput(stdout) {
    const lines = stdout.trim().split('\n');
    const data = lines[lines.length - 1];
    if (!data) return null;
    const parts = data.split(/\s+/);
    if (parts.length < 6) return null;
    const poolSize    = parseInt(parts[1], 10);
    const poolUsed    = parseInt(parts[2], 10);
    const poolFree    = parseInt(parts[3], 10);
    const usedPercent = parseInt(parts[4], 10);
    if (isNaN(poolSize)) return null;
    return { poolSize, poolUsed, poolFree, usedPercent };
}

function parseDiskstats(content, diskId) {
    const lines = content.split('\n');
    for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols[2] === diskId) {
            const readSectors  = parseInt(cols[5],  10) || 0;
            const writeSectors = parseInt(cols[9],  10) || 0;
            return {
                read:  readSectors  * 512,
                write: writeSectors * 512
            };
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// POOL STATUS  GET /pool/status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/pool/status', requireAuth, async (req, res) => {
    try {
        const data       = getData();
        const poolMount  = data.storageConfig?.poolMount || '';
        const configured = !!poolMount;

        if (!configured) {
            return res.json({
                configured: false,
                running:    false,
                poolMount:  '',
                poolSize:   0,
                poolUsed:   0,
                poolFree:   0,
                usedPercent: 0
            });
        }

        let dfResult;
        try {
            dfResult = await safeExec('df', ['-B1', poolMount]);
        } catch {
            return res.json({
                configured: true,
                running:    false,
                poolMount,
                poolSize:   0,
                poolUsed:   0,
                poolFree:   0,
                usedPercent: 0
            });
        }

        const parsed = parseDfOutput(dfResult.stdout);
        if (!parsed) {
            return res.json({ configured: true, running: false, poolMount, poolSize: 0, poolUsed: 0, poolFree: 0, usedPercent: 0 });
        }

        return res.json({
            configured:  true,
            running:     true,
            poolMount,
            poolSize:    parsed.poolSize,
            poolUsed:    parsed.poolUsed,
            poolFree:    parsed.poolFree,
            usedPercent: parsed.usedPercent
        });
    } catch (err) {
        log.error('[storage] pool/status error:', err.message);
        return res.status(500).json({ error: 'Failed to get pool status' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POOL CONFIGURE  POST /pool/configure
// ─────────────────────────────────────────────────────────────────────────────

router.post('/pool/configure', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { disks } = req.body;
        const validated = validateDiskConfig(disks);
        if (!validated) {
            return res.status(400).json({ error: 'Invalid disk configuration' });
        }

        for (const disk of validated) {
            if (disk.format) {
                log.info(`[storage] Formatting /dev/${disk.id} as ext4`);
                await sudoExec('mkfs.ext4', ['-F', `/dev/${disk.id}`]);
            }
        }

        const dataDisks = validated.filter(d => d.role === 'data');
        if (dataDisks.length === 0) {
            return res.status(400).json({ error: 'At least one data disk is required' });
        }

        const poolMount = '/mnt/storage';

        await withData(data => {
            data.storageConfig = data.storageConfig || {};
            data.storageConfig.disks     = validated;
            data.storageConfig.poolMount = poolMount;
            return data;
        });

        log.info('[storage] Pool configured with', dataDisks.length, 'data disks');
        return res.json({ success: true, poolMount });
    } catch (err) {
        log.error('[storage] pool/configure error:', err.message);
        return res.status(500).json({ error: 'Failed to configure pool' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SNAPRAID SYNC  POST /snapraid/sync
// ─────────────────────────────────────────────────────────────────────────────

router.post('/snapraid/sync', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const current = snapraidJobs.get('current');
        if (current && current.running) {
            return res.status(409).json({ error: 'SnapRAID sync already running' });
        }

        const jobId = `snapraid-${Date.now()}`;
        snapraidJobs.set('current', { running: true, progress: 0, status: 'starting', error: null, jobId });

        (async () => {
            try {
                const { spawn } = require('child_process');
                const proc = spawn('snapraid', ['sync'], { stdio: ['ignore', 'pipe', 'pipe'] });

                proc.stdout.on('data', (chunk) => {
                    const text = chunk.toString();
                    const pctMatch = text.match(/(\d+)%/);
                    const job = snapraidJobs.get('current');
                    if (job) {
                        job.status   = text.trim().split('\n').pop() || job.status;
                        if (pctMatch) job.progress = parseInt(pctMatch[1], 10);
                    }
                });

                proc.on('close', (code) => {
                    const job = snapraidJobs.get('current');
                    if (job) {
                        job.running  = false;
                        job.progress = 100;
                        job.status   = code === 0 ? 'completed' : 'failed';
                        job.error    = code !== 0 ? `snapraid exited with code ${code}` : null;
                    }
                    log.info(`[storage] SnapRAID sync finished, exit code: ${code}`);
                });
            } catch (err) {
                const job = snapraidJobs.get('current');
                if (job) { job.running = false; job.status = 'failed'; job.error = err.message; }
            }
        })();

        return res.json({ success: true, jobId });
    } catch (err) {
        log.error('[storage] snapraid/sync error:', err.message);
        return res.status(500).json({ error: 'Failed to start SnapRAID sync' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SNAPRAID PROGRESS  GET /snapraid/sync/progress
// ─────────────────────────────────────────────────────────────────────────────

router.get('/snapraid/sync/progress', requireAuth, (req, res) => {
    const job = snapraidJobs.get('current');
    if (!job) {
        return res.json({ running: false, progress: 0, status: 'idle', error: null });
    }
    return res.json({
        running:  job.running,
        progress: job.progress,
        status:   job.status,
        error:    job.error
    });
});

module.exports = router;
