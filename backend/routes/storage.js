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

// ─────────────────────────────────────────────────────────────────────────────
// CACHE STATUS  GET /cache/status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/cache/status', requireAuth, async (req, res) => {
    try {
        const data = getData();
        const cfg  = data.storageConfig || {};

        const allDisks   = Array.isArray(cfg.disks) ? cfg.disks : [];
        const cacheDisks = allDisks.filter(d => d.role === 'cache');
        const hasCache   = cacheDisks.length > 0;

        let fileCounts = 0;
        const cacheMount = cfg.cacheMount || '/mnt/cache';
        if (hasCache) {
            try {
                const { stdout } = await safeExec('find', [cacheMount, '-maxdepth', '1', '-type', 'f']);
                fileCounts = stdout.trim().split('\n').filter(Boolean).length;
            } catch {
                fileCounts = 0;
            }
        }

        return res.json({
            hasCache,
            cacheDisks: cacheDisks.map(d => d.id),
            fileCounts,
            policy: cfg.cachePolicy || 'auto',
            mover:  cfg.cacheMoverEnabled || false
        });
    } catch (err) {
        log.error('[storage] cache/status error:', err.message);
        return res.status(500).json({ error: 'Failed to get cache status' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// CACHE MOVE NOW  POST /move-now
// ─────────────────────────────────────────────────────────────────────────────

router.post('/move-now', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const data       = getData();
        const cfg        = data.storageConfig || {};
        const cacheMount = cfg.cacheMount || '/mnt/cache';
        const poolMount  = cfg.poolMount   || '/mnt/storage';

        (async () => {
            try {
                await safeExec('rsync', ['-a', '--remove-source-files', `${cacheMount}/`, `${poolMount}/`]);
                log.info('[storage] Cache mover completed');
            } catch (err) {
                log.error('[storage] Cache mover error:', err.message);
            }
        })();

        return res.json({ message: 'Cache mover started' });
    } catch (err) {
        log.error('[storage] move-now error:', err.message);
        return res.status(500).json({ error: 'Failed to start cache mover' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// DISK HEALTH  GET /disks/health
// ─────────────────────────────────────────────────────────────────────────────

function parseSmartAttributes(smart) {
    const attrs   = smart.ata_smart_attributes?.table || [];
    const findAttr = (id) => attrs.find(a => a.id === id);

    const reallocAttr   = findAttr(5);
    const pendingAttr   = findAttr(197);
    const ssdLifeAttr   = findAttr(231);
    const tempAttr      = findAttr(194);
    const powerOnAttr   = findAttr(9);

    return {
        reallocatedSectors: reallocAttr   ? reallocAttr.raw.value   : 0,
        pendingSectors:     pendingAttr   ? pendingAttr.raw.value   : 0,
        ssdLifeLeft:        ssdLifeAttr   ? ssdLifeAttr.raw.value   : null,
        temperature:        tempAttr      ? tempAttr.raw.value
                                         : (smart.temperature?.current ?? null),
        powerOnHours:       powerOnAttr   ? powerOnAttr.raw.value   : null,
        smartPassed:        smart.smart_status ? smart.smart_status.passed : null,
        model:              smart.model_name   || null
    };
}

router.get('/disks/health', requireAuth, async (req, res) => {
    try {
        const lsblkResult = await safeExec('lsblk', ['-J', '-o', 'NAME,TYPE']);
        const lsblk       = JSON.parse(lsblkResult.stdout);
        const physicalDisks = (lsblk.blockdevices || [])
            .filter(d => d.type === 'disk' && !/^(loop|zram|ram)/.test(d.name));

        const disks = [];
        for (const device of physicalDisks) {
            const diskId = sanitizeDiskId(device.name);
            if (!diskId) continue;

            let smartData = null;
            try {
                const { stdout } = await safeExec('smartctl', ['-A', '-j', `/dev/${diskId}`]);
                smartData = JSON.parse(stdout);
            } catch (e) {
                if (e.stdout) {
                    try { smartData = JSON.parse(e.stdout); } catch {}
                }
            }

            const attrs = smartData ? parseSmartAttributes(smartData) : {};
            disks.push({ diskId, ...attrs });
        }

        const hasWarning  = disks.some(d => d.reallocatedSectors > 0 || d.pendingSectors > 0);
        const hasCritical = disks.some(d => d.smartPassed === false);
        const summary     = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy';

        return res.json({ summary, disks });
    } catch (err) {
        log.error('[storage] disks/health error:', err.message);
        return res.status(500).json({ error: 'Failed to get disk health' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// IO STATS  GET /disks/iostats
// ─────────────────────────────────────────────────────────────────────────────

router.get('/disks/iostats', requireAuth, async (req, res) => {
    try {
        const { stdout } = await safeExec('cat', ['/proc/diskstats']);
        const result = {};
        const lines  = stdout.split('\n');
        for (const line of lines) {
            const cols = line.trim().split(/\s+/);
            if (cols.length < 14) continue;
            const name = cols[2];
            if (/[0-9]$/.test(name) || /^(loop|ram|zram)/.test(name)) continue;
            const readSectors  = parseInt(cols[5],  10) || 0;
            const writeSectors = parseInt(cols[9],  10) || 0;
            result[name] = {
                read:  readSectors  * 512,
                write: writeSectors * 512
            };
        }
        return res.json(result);
    } catch (err) {
        log.error('[storage] disks/iostats error:', err.message);
        return res.status(500).json({ error: 'Failed to get IO stats' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// REMOVE FROM POOL  POST /disks/remove-from-pool
// ─────────────────────────────────────────────────────────────────────────────

router.post('/disks/remove-from-pool', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const rawId = req.body.diskId;
        const diskId = sanitizeDiskId(rawId);
        if (!diskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        await withData(data => {
            const cfg = data.storageConfig || {};
            if (Array.isArray(cfg.disks)) {
                cfg.disks = cfg.disks.filter(d => d.id !== diskId);
            }
            data.storageConfig = cfg;
            return data;
        });

        log.info(`[storage] Removed ${diskId} from pool config`);
        return res.json({ success: true, message: `Disk ${diskId} removed from pool` });
    } catch (err) {
        log.error('[storage] remove-from-pool error:', err.message);
        return res.status(500).json({ error: 'Failed to remove disk from pool' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// BADBLOCKS START  POST /badblocks/:diskId
// ─────────────────────────────────────────────────────────────────────────────

router.post('/badblocks/:diskId', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const diskId = sanitizeDiskId(req.params.diskId);
        if (!diskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        const existing = badblocksJobs.get(diskId);
        if (existing && existing.running) {
            return res.status(409).json({ error: 'Badblocks test already running for this disk' });
        }

        badblocksJobs.set(diskId, {
            running:        true,
            progress:       0,
            badBlocksFound: 0,
            result:         null,
            startTime:      Date.now()
        });

        const estimatedHours = 2;

        (async () => {
            try {
                const { spawn } = require('child_process');
                const proc = spawn('badblocks', ['-sv', `/dev/${diskId}`], {
                    stdio: ['ignore', 'pipe', 'pipe']
                });

                let badCount = 0;
                proc.stdout.on('data', (chunk) => {
                    const text = chunk.toString();
                    const badMatch = text.match(/(\d+) bad block/i);
                    if (badMatch) badCount = parseInt(badMatch[1], 10);
                    const pctMatch = text.match(/(\d+\.\d+)%/);
                    const job = badblocksJobs.get(diskId);
                    if (job && pctMatch) job.progress = parseFloat(pctMatch[1]);
                });

                proc.stderr.on('data', (chunk) => {
                    const text = chunk.toString();
                    const pctMatch = text.match(/(\d+\.\d+)%/);
                    const job = badblocksJobs.get(diskId);
                    if (job && pctMatch) job.progress = parseFloat(pctMatch[1]);
                });

                proc.on('close', async (code) => {
                    const job = badblocksJobs.get(diskId);
                    if (job) {
                        job.running        = false;
                        job.progress       = 100;
                        job.badBlocksFound = badCount;
                        job.result         = code === 0 ? 'passed' : 'failed';
                    }
                    const durationMs = Date.now() - (job ? job.startTime : Date.now());
                    const resultStr  = code === 0 ? 'passed' : 'failed';
                    try {
                        const { notifyBadblocksComplete } = require('../health-monitor');
                        await notifyBadblocksComplete(diskId, resultStr, badCount, durationMs);
                    } catch {}
                    log.info(`[storage] badblocks ${diskId} finished: ${resultStr}, bad blocks: ${badCount}`);
                });

                const job = badblocksJobs.get(diskId);
                if (job) job.pid = proc.pid;

            } catch (err) {
                const job = badblocksJobs.get(diskId);
                if (job) { job.running = false; job.result = 'failed'; }
                log.error(`[storage] badblocks ${diskId} spawn error:`, err.message);
            }
        })();

        return res.json({ success: true, estimatedHours });
    } catch (err) {
        log.error('[storage] badblocks start error:', err.message);
        return res.status(500).json({ error: 'Failed to start badblocks test' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// BADBLOCKS STATUS  GET /badblocks/:diskId/status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/badblocks/:diskId/status', requireAuth, (req, res) => {
    const diskId = sanitizeDiskId(req.params.diskId);
    if (!diskId) {
        return res.status(400).json({ error: 'Invalid disk ID' });
    }

    const job = badblocksJobs.get(diskId);
    if (!job) {
        return res.json({ running: false, progress: 0, badBlocksFound: 0, result: null });
    }

    return res.json({
        running:        job.running,
        progress:       job.progress,
        badBlocksFound: job.badBlocksFound,
        result:         job.result
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// BADBLOCKS CANCEL  DELETE /badblocks/:diskId
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/badblocks/:diskId', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const diskId = sanitizeDiskId(req.params.diskId);
        if (!diskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        const job = badblocksJobs.get(diskId);
        if (!job || !job.running) {
            return res.status(404).json({ error: 'No running badblocks test for this disk' });
        }

        if (job.pid) {
            try { process.kill(job.pid, 'SIGTERM'); } catch {}
        }

        job.running = false;
        job.result  = 'cancelled';

        const durationMs = Date.now() - job.startTime;
        try {
            const { notifyBadblocksComplete } = require('../health-monitor');
            await notifyBadblocksComplete(diskId, 'cancelled', job.badBlocksFound || 0, durationMs);
        } catch {}

        return res.json({ success: true });
    } catch (err) {
        log.error('[storage] badblocks cancel error:', err.message);
        return res.status(500).json({ error: 'Failed to cancel badblocks test' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SMART TEST START  POST /smart/:diskId/test
// ─────────────────────────────────────────────────────────────────────────────

router.post('/smart/:diskId/test', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        const diskId = sanitizeDiskId(req.params.diskId);
        if (!diskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        const type = req.body.type;
        if (!['short', 'long'].includes(type)) {
            return res.status(400).json({ error: 'type must be "short" or "long"' });
        }

        await safeExec('smartctl', ['-t', type, `/dev/${diskId}`]);

        smartTests.set(diskId, { running: true, startedAt: Date.now(), type });
        log.info(`[storage] SMART ${type} test started on /dev/${diskId}`);

        return res.json({ success: true });
    } catch (err) {
        log.error('[storage] smart test start error:', err.message);
        return res.status(500).json({ error: 'Failed to start SMART test' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// SMART TEST STATUS  GET /smart/:diskId/status
// ─────────────────────────────────────────────────────────────────────────────

router.get('/smart/:diskId/status', requireAuth, async (req, res) => {
    try {
        const diskId = sanitizeDiskId(req.params.diskId);
        if (!diskId) {
            return res.status(400).json({ error: 'Invalid disk ID' });
        }

        let stdout = '';
        try {
            const result = await safeExec('smartctl', ['-j', '-a', `/dev/${diskId}`]);
            stdout = result.stdout;
        } catch (e) {
            stdout = e.stdout || '';
        }

        if (!stdout) {
            return res.json({ testInProgress: false, remainingPercent: 0 });
        }

        let data;
        try { data = JSON.parse(stdout); } catch {
            return res.json({ testInProgress: false, remainingPercent: 0 });
        }

        const remaining     = data.self_test_status?.remaining_percent ?? 0;
        const testInProgress = remaining > 0;

        if (!testInProgress) {
            smartTests.delete(diskId);
        }

        return res.json({ testInProgress, remainingPercent: remaining });
    } catch (err) {
        log.error('[storage] smart test status error:', err.message);
        return res.status(500).json({ error: 'Failed to get SMART test status' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// FILE LOCATION  GET /file-location?path=...
// ─────────────────────────────────────────────────────────────────────────────

function resolveFileLocation(filePath, storageConfig) {
    const cfg        = storageConfig || {};
    const cacheMount = cfg.cacheMount || '/mnt/cache';
    const poolMount  = cfg.poolMount  || '/mnt/storage';

    if (filePath.startsWith(cacheMount + '/') || filePath === cacheMount) {
        return { diskType: 'cache', physicalLocation: cacheMount };
    }
    if (filePath.startsWith(poolMount + '/') || filePath === poolMount) {
        return { diskType: 'pool', physicalLocation: poolMount };
    }
    return { diskType: 'unknown', physicalLocation: '' };
}

router.get('/file-location', requireAuth, (req, res) => {
    try {
        const rawPath = req.query.path;
        if (!rawPath || typeof rawPath !== 'string') {
            return res.status(400).json({ error: 'path query parameter is required' });
        }

        if (rawPath.includes('..') || rawPath.includes('\0')) {
            return res.status(400).json({ error: 'Invalid path' });
        }

        const data     = getData();
        const location = resolveFileLocation(rawPath, data.storageConfig);
        return res.json(location);
    } catch (err) {
        log.error('[storage] file-location error:', err.message);
        return res.status(500).json({ error: 'Failed to resolve file location' });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// FILE LOCATIONS (batch)  POST /file-locations
// ─────────────────────────────────────────────────────────────────────────────

router.post('/file-locations', requireAuth, (req, res) => {
    try {
        const { paths } = req.body;
        if (!Array.isArray(paths) || paths.length === 0 || paths.length > 500) {
            return res.status(400).json({ error: 'paths must be a non-empty array (max 500)' });
        }

        const data      = getData();
        const locations = {};

        for (const p of paths) {
            if (typeof p !== 'string' || p.includes('..') || p.includes('\0')) continue;
            locations[p] = resolveFileLocation(p, data.storageConfig);
        }

        return res.json({ locations });
    } catch (err) {
        log.error('[storage] file-locations error:', err.message);
        return res.status(500).json({ error: 'Failed to resolve file locations' });
    }
});

module.exports = router;
