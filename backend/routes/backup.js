'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const { spawn } = require('child_process');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { sanitizePath } = require('../sanitize');
const log = require('../logger');

const runningJobs = new Map();

function getRunningJobs() { return runningJobs; }

function spawnRsync(job) {
    const { id: jobId, source, destination } = job;
    const safeSrc = sanitizePath(source);
    const safeDst = sanitizePath(destination);
    if (!safeSrc || !safeDst) {
        log.error(`[backup] Invalid path in job ${jobId}: src=${source} dst=${destination}`);
        return;
    }
    const rsyncArgs = ['-av', '--delete', '--progress', safeSrc, safeDst];
    log.info(`[backup] Spawning rsync job ${jobId}`);
    let child;
    try {
        child = spawn('rsync', rsyncArgs, { stdio: ['ignore', 'pipe', 'pipe'], detached: false });
    } catch (err) {
        log.error(`[backup] Failed to spawn rsync for job ${jobId}:`, err.message);
        runningJobs.set(jobId, { pid: null, startTime: Date.now(), error: err.message });
        return;
    }
    runningJobs.set(jobId, { pid: child.pid, startTime: Date.now(), error: null });
    child.stdout.on('data', data => { log.debug(`[backup/${jobId}] rsync: ${data.toString().trim()}`); });
    child.stderr.on('data', data => { log.warn(`[backup/${jobId}] rsync stderr: ${data.toString().trim()}`); });
    child.on('exit', async (code, signal) => {
        const errorMsg = code !== 0 ? `rsync exited with code ${code}${signal ? ` (signal: ${signal})` : ''}` : null;
        await withData(data => {
            const jobs = data.backupJobs || [];
            const idx = jobs.findIndex(j => j.id === jobId);
            if (idx !== -1) { jobs[idx].lastRun = new Date().toISOString(); jobs[idx].lastError = errorMsg; jobs[idx].status = errorMsg ? 'error' : 'ok'; data.backupJobs = jobs; }
            return data;
        }).catch(err => { log.error(`[backup] Failed to update job ${jobId} after exit:`, err.message); });
        runningJobs.delete(jobId);
        log.info(`[backup] Job ${jobId} finished. code=${code}`);
    });
    child.on('error', err => {
        log.error(`[backup] rsync child error for job ${jobId}:`, err.message);
        runningJobs.set(jobId, { pid: null, startTime: Date.now(), error: err.message });
    });
}

router.get('/', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json({ jobs: data.backupJobs || [] });
    } catch (err) {
        log.error('[backup] GET failed:', err);
        res.status(500).json({ error: 'Failed to load backup jobs' });
    }
});

router.post('/', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { name, source, destination, type = 'rsync', schedule, retention } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length === 0) return res.status(400).json({ error: 'name is required' });
        if (!source || typeof source !== 'string') return res.status(400).json({ error: 'source is required' });
        if (!destination || typeof destination !== 'string') return res.status(400).json({ error: 'destination is required' });
        if (!['rsync', 'tar'].includes(type)) return res.status(400).json({ error: 'type must be rsync or tar' });
        const safeSrc = sanitizePath(source);
        const safeDst = sanitizePath(destination);
        if (!safeSrc) return res.status(400).json({ error: 'Invalid source path' });
        if (!safeDst) return res.status(400).json({ error: 'Invalid destination path' });
        const job = {
            id: crypto.randomUUID(),
            name: name.trim().substring(0, 100),
            type,
            source: safeSrc,
            destination: safeDst,
            schedule: schedule || null,
            retention: retention || null,
            lastRun: null,
            lastError: null,
            status: 'idle',
            createdAt: new Date().toISOString()
        };
        await withData(data => { data.backupJobs = [...(data.backupJobs || []), job]; return data; });
        res.status(201).json(job);
    } catch (err) {
        log.error('[backup] POST failed:', err);
        res.status(500).json({ error: 'Failed to create backup job' });
    }
});

router.delete('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        let found = false;
        await withData(data => {
            const jobs = data.backupJobs || [];
            const filtered = jobs.filter(j => j.id !== id);
            found = filtered.length < jobs.length;
            data.backupJobs = filtered;
            return data;
        });
        if (!found) return res.status(404).json({ error: 'Job not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('[backup] DELETE failed:', err);
        res.status(500).json({ error: 'Failed to delete backup job' });
    }
});

router.post('/:id/run', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        if (runningJobs.has(id)) return res.status(409).json({ error: 'Job is already running', jobId: id, status: 'running' });
        const data = getData();
        const job = (data.backupJobs || []).find(j => j.id === id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        spawnRsync(job);
        res.json({ jobId: id, status: 'running' });
    } catch (err) {
        log.error('[backup] POST /:id/run failed:', err);
        res.status(500).json({ error: 'Failed to start backup job' });
    }
});

router.get('/:id/status', requireAuth, (req, res) => {
    try {
        const { id } = req.params;
        const data = getData();
        const job = (data.backupJobs || []).find(j => j.id === id);
        if (!job) return res.status(404).json({ error: 'Job not found' });
        res.json({ running: runningJobs.has(id), progress: null, lastRun: job.lastRun, error: job.lastError || null });
    } catch (err) {
        log.error('[backup] GET /:id/status failed:', err);
        res.status(500).json({ error: 'Failed to get job status' });
    }
});

router.getRunningJobs = getRunningJobs;
module.exports = router;
