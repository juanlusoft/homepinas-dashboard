// Tests for backend/routes/nfs.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all dependencies before importing the router ───────────────────────

const mockSafeExec = vi.fn();
const mockSudoExec = vi.fn();
vi.mock('../security', () => ({
    safeExec: mockSafeExec,
    sudoExec: mockSudoExec,
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
    const router = require('../routes/nfs.js');
    app.use('/api/nfs', router);
    return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockDataStore = { nfsShares: [] };
    mockSafeExec.mockResolvedValue({ stdout: 'active\n', stderr: '' });
    mockSudoExec.mockResolvedValue({ stdout: '', stderr: '' });
    mockGetData.mockImplementation(() => ({ ...mockDataStore }));
    mockWithData.mockImplementation(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    });
});

describe('GET /api/nfs/status', () => {
    it('returns running state and shares', async () => {
        const res = await supertest(makeApp()).get('/api/nfs/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('running');
        expect(res.body).toHaveProperty('shares');
    });
});

describe('POST /api/nfs/shares', () => {
    it('creates a share with defaults', async () => {
        const res = await supertest(makeApp())
            .post('/api/nfs/shares')
            .send({ path: '/srv/nas/media' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(res.body.path).toBe('/srv/nas/media');
        expect(res.body.clients).toBe('*');
        expect(res.body.options).toBe('rw,sync,no_subtree_check');
    });

    it('calls exportfs -ra after writing /etc/exports', async () => {
        await supertest(makeApp())
            .post('/api/nfs/shares')
            .send({ path: '/srv/nas/media' });
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/exports'], expect.anything());
        expect(mockSudoExec).toHaveBeenCalledWith('exportfs', ['-ra']);
    });

    it('returns 400 for missing path', async () => {
        const res = await supertest(makeApp()).post('/api/nfs/shares').send({});
        expect(res.status).toBe(400);
    });

    it('returns 400 for relative path', async () => {
        const res = await supertest(makeApp()).post('/api/nfs/shares').send({ path: 'relative' });
        expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate path', async () => {
        mockDataStore = {
            nfsShares: [{ id: '1', path: '/srv/nas/media', clients: '*', options: 'rw,sync,no_subtree_check' }],
        };
        const res = await supertest(makeApp()).post('/api/nfs/shares').send({ path: '/srv/nas/media' });
        expect(res.status).toBe(409);
    });
});

describe('DELETE /api/nfs/shares/:id', () => {
    it('removes share and updates /etc/exports', async () => {
        mockDataStore = {
            nfsShares: [{ id: 'abc', path: '/srv/nas/media', clients: '*', options: 'rw' }],
        };
        const res = await supertest(makeApp()).delete('/api/nfs/shares/abc');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('exportfs', ['-ra']);
    });

    it('returns 404 for non-existent share', async () => {
        const res = await supertest(makeApp()).delete('/api/nfs/shares/ghost');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/nfs/restart', () => {
    it('restarts nfs-kernel-server', async () => {
        const res = await supertest(makeApp()).post('/api/nfs/restart');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('systemctl', ['restart', 'nfs-kernel-server']);
    });
});
