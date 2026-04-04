'use strict';

const router = require('express').Router();
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { safeExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

const liveSchedules = new Map();

function isValidCron(expr) {
    return cron.validate(expr);
}

async function runTaskAction(task) {
    log.info(`[scheduler] Running task: ${task.name} (${task.id}), type=${task.type}`);
    try {
        if (task.type === 'snapraid-sync') {
            await safeExec('snapraid', ['sync']);
        } else if (task.type === 'backup') {
            const data = getData();
            const jobs = data.backupJobs || [];
            const job = jobs.find(j => j.id === (task.action && task.action.jobId));
            if (!job) {
                log.warn(`[scheduler] Backup job not found: ${task.action && task.action.jobId}`);
                return;
            }
            await safeExec('rsync', ['-av', '--delete', job.source, job.destination]);
        } else if (task.type === 'custom-command') {
            const action = task.action || {};
            if (!action.command) {
                log.warn('[scheduler] custom-command task missing action.command');
                return;
            }
            const args = Array.isArray(action.args) ? action.args : [];
            await safeExec(action.command, args);
        } else {
            log.warn(`[scheduler] Unknown task type: ${task.type}`);
            return;
        }
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const t = data.schedulerTasks.find(t => t.id === task.id);
            if (t) t.lastRun = new Date().toISOString();
            return data;
        });
        log.info(`[scheduler] Task ${task.name} completed successfully`);
    } catch (err) {
        log.error(`[scheduler] Task ${task.name} failed:`, err.message);
    }
}

function scheduleTask(task) {
    if (liveSchedules.has(task.id)) {
        liveSchedules.get(task.id).stop();
        liveSchedules.delete(task.id);
    }
    if (!task.enabled) return;
    if (!isValidCron(task.cronExpr)) {
        log.warn(`[scheduler] Invalid cron expression for task ${task.name}: ${task.cronExpr}`);
        return;
    }
    const job = cron.schedule(task.cronExpr, () => {
        runTaskAction(task).catch(err => {
            log.error(`[scheduler] Unhandled error in task ${task.name}:`, err.message);
        });
    }, { scheduled: true, timezone: 'UTC' });
    liveSchedules.set(task.id, job);
    log.info(`[scheduler] Scheduled task: ${task.name} (${task.cronExpr})`);
}

function cancelTask(taskId) {
    if (liveSchedules.has(taskId)) {
        liveSchedules.get(taskId).stop();
        liveSchedules.delete(taskId);
        log.info(`[scheduler] Cancelled task: ${taskId}`);
    }
}

function computeNextRun(cronExpr) {
    return null;
}

function initScheduler() {
    log.info('[scheduler] Initialising scheduled tasks...');
    const data = getData();
    const tasks = data.schedulerTasks || [];
    let loaded = 0;
    for (const task of tasks) {
        if (task.enabled) {
            scheduleTask(task);
            loaded++;
        }
    }
    log.info(`[scheduler] Loaded ${loaded} enabled task(s) out of ${tasks.length} total`);
}

// GET /api/scheduler
router.get('/', requireAuth, (req, res) => {
    try {
        const data = getData();
        const tasks = (data.schedulerTasks || []).map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            cronExpr: t.cronExpr,
            action: t.action,
            enabled: t.enabled,
            nextRun: computeNextRun(t.cronExpr),
            lastRun: t.lastRun || null,
        }));
        res.json({ tasks });
    } catch (err) {
        log.error('[scheduler] list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/scheduler
router.post('/', requireAuth, requirePermission('admin'), async (req, res) => {
    const { name, type, cronExpr, action, enabled } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Task name is required' });
    }
    if (!type || !['snapraid-sync', 'backup', 'custom-command'].includes(type)) {
        return res.status(400).json({ error: "type must be 'snapraid-sync', 'backup', or 'custom-command'" });
    }
    if (!cronExpr || !isValidCron(cronExpr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
    }
    try {
        const newTask = {
            id: uuidv4(),
            name: name.trim(),
            type,
            cronExpr,
            action: action || null,
            enabled: enabled !== false,
            lastRun: null,
            createdAt: new Date().toISOString(),
        };
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            data.schedulerTasks.push(newTask);
            return data;
        });
        scheduleTask(newTask);
        res.json({
            id: newTask.id,
            name: newTask.name,
            type: newTask.type,
            cronExpr: newTask.cronExpr,
            action: newTask.action,
            enabled: newTask.enabled,
            nextRun: computeNextRun(newTask.cronExpr),
            lastRun: null,
        });
    } catch (err) {
        log.error('[scheduler] create task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/scheduler/:id
router.put('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    const { name, type, cronExpr, action, enabled } = req.body;
    if (type && !['snapraid-sync', 'backup', 'custom-command'].includes(type)) {
        return res.status(400).json({ error: "type must be 'snapraid-sync', 'backup', or 'custom-command'" });
    }
    if (cronExpr && !isValidCron(cronExpr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
    }
    try {
        let updatedTask = null;
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const idx = data.schedulerTasks.findIndex(t => t.id === req.params.id);
            if (idx === -1) return;
            const existing = data.schedulerTasks[idx];
            const merged = {
                ...existing,
                name: name !== undefined ? name.trim() : existing.name,
                type: type !== undefined ? type : existing.type,
                cronExpr: cronExpr !== undefined ? cronExpr : existing.cronExpr,
                action: action !== undefined ? action : existing.action,
                enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled,
            };
            data.schedulerTasks[idx] = merged;
            updatedTask = merged;
            return data;
        });
        if (!updatedTask) return res.status(404).json({ error: 'Task not found' });
        scheduleTask(updatedTask);
        res.json({ success: true });
    } catch (err) {
        log.error('[scheduler] update task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/scheduler/:id
router.delete('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const before = data.schedulerTasks.length;
            data.schedulerTasks = data.schedulerTasks.filter(t => t.id !== req.params.id);
            if (data.schedulerTasks.length === before) {
                found = false;
                return;
            }
            found = true;
            return data;
        });
        if (!found) return res.status(404).json({ error: 'Task not found' });
        cancelTask(req.params.id);
        res.json({ success: true });
    } catch (err) {
        log.error('[scheduler] delete task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.initScheduler = initScheduler;
