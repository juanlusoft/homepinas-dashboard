// Tests for backend/routes/scheduler.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all dependencies before importing the router ───────────────────────

const mockCronSchedule = vi.fn(() => ({ stop: vi.fn() }));
const mockCronValidate = vi.fn((expr) => {
    const validExprs = ['0 2 * * *', '*/5 * * * *', '0 0 * * 0'];
    return validExprs.includes(expr);
});
vi.mock('node-cron', () => ({
    default: {
        schedule: mockCronSchedule,
        validate: mockCronValidate,
    },
    schedule: mockCronSchedule,
    validate: mockCronValidate,
}));

let mockDataStore = {};
const mockGetData = vi.fn(() => ({ ...mockDataStore }));
const mockWithData = vi.fn(async (fn) => {
    const data = { ...mockDataStore };
    const result = await fn(data);
    if (result !== undefined) mockDataStore = result;
    return result;
});
vi.mock('../data', () => ({
    getData: mockGetData,
    withData: mockWithData,
}));

vi.mock('../security', () => ({
    safeExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('../auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'admin' }; next(); },
}));
vi.mock('../rbac', () => ({
    requirePermission: () => (req, res, next) => next(),
}));
vi.mock('../logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    info: vi.fn(), warn: vi.fn(), error: vi.fn(),
}));

// ─── Mini Express harness ─────────────────────────────────────────────────────
import express from 'express';
import supertest from 'supertest';

function makeApp() {
    const app = express();
    app.use(express.json());
    const router = require('../routes/scheduler.js');
    app.use('/api/scheduler', router);
    return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockDataStore = { schedulerTasks: [] };
    mockCronValidate.mockImplementation((expr) => ['0 2 * * *', '*/5 * * * *', '0 0 * * 0'].includes(expr));
    mockCronSchedule.mockReturnValue({ stop: vi.fn() });
    mockGetData.mockImplementation(() => ({ ...mockDataStore }));
    mockWithData.mockImplementation(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    });
});

describe('GET /api/scheduler', () => {
    it('returns empty tasks array', async () => {
        const res = await supertest(makeApp()).get('/api/scheduler');
        expect(res.status).toBe(200);
        expect(res.body.tasks).toEqual([]);
    });

    it('returns tasks from data store', async () => {
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Nightly Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };
        const res = await supertest(makeApp()).get('/api/scheduler');
        expect(res.body.tasks).toHaveLength(1);
        expect(res.body.tasks[0].name).toBe('Nightly Sync');
    });
});

describe('POST /api/scheduler', () => {
    it('creates a task and registers it with node-cron', async () => {
        const res = await supertest(makeApp())
            .post('/api/scheduler')
            .send({ name: 'Nightly Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', enabled: true });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(mockCronSchedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), expect.any(Object));
    });

    it('returns 400 for missing name', async () => {
        const res = await supertest(makeApp())
            .post('/api/scheduler')
            .send({ type: 'snapraid-sync', cronExpr: '0 2 * * *' });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid cron expression', async () => {
        const res = await supertest(makeApp())
            .post('/api/scheduler')
            .send({ name: 'test', type: 'snapraid-sync', cronExpr: 'not-a-cron' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('cron');
    });

    it('returns 400 for invalid type', async () => {
        const res = await supertest(makeApp())
            .post('/api/scheduler')
            .send({ name: 'test', type: 'unknown-type', cronExpr: '0 2 * * *' });
        expect(res.status).toBe(400);
    });

    it('does not register with cron when enabled is false', async () => {
        await supertest(makeApp())
            .post('/api/scheduler')
            .send({ name: 'disabled task', type: 'snapraid-sync', cronExpr: '0 2 * * *', enabled: false });
        expect(mockCronSchedule).not.toHaveBeenCalled();
    });
});

describe('PUT /api/scheduler/:id', () => {
    it('returns 404 for non-existent task', async () => {
        const res = await supertest(makeApp())
            .put('/api/scheduler/ghost')
            .send({ name: 'Updated' });
        expect(res.status).toBe(404);
    });

    it('updates task and re-schedules', async () => {
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Old Name', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };
        const res = await supertest(makeApp())
            .put('/api/scheduler/abc')
            .send({ name: 'New Name', cronExpr: '*/5 * * * *' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('DELETE /api/scheduler/:id', () => {
    it('returns 404 for non-existent task', async () => {
        const res = await supertest(makeApp()).delete('/api/scheduler/ghost');
        expect(res.status).toBe(404);
    });

    it('removes the task and cancels the cron job', async () => {
        const stopMock = vi.fn();
        mockCronSchedule.mockReturnValue({ stop: stopMock });
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };
        await supertest(makeApp())
            .post('/api/scheduler')
            .send({ name: 'Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *' });
        const res = await supertest(makeApp()).delete('/api/scheduler/abc');
        expect(res.status).toBe(200);
    });
});
