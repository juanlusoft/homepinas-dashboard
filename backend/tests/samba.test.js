// Tests for backend/routes/samba.js

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
    const router = require('../routes/samba.js');
    app.use('/api/samba', router);
    return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockDataStore = { sambaShares: [] };
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

describe('GET /api/samba/status', () => {
    it('returns running:true when smbd is active', async () => {
        mockSafeExec
            .mockResolvedValueOnce({ stdout: 'active\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: '{}', stderr: '' });
        const res = await supertest(makeApp()).get('/api/samba/status');
        expect(res.status).toBe(200);
        expect(res.body.running).toBe(true);
        expect(res.body.shares).toEqual([]);
    });

    it('returns running:false when smbd is inactive', async () => {
        mockSafeExec.mockRejectedValueOnce(new Error('inactive'));
        const res = await supertest(makeApp()).get('/api/samba/status');
        expect(res.status).toBe(200);
        expect(res.body.running).toBe(false);
    });
});

describe('GET /api/samba/shares', () => {
    it('returns empty array when no shares exist', async () => {
        const res = await supertest(makeApp()).get('/api/samba/shares');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('returns existing shares from data store', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'abc', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: true, validUsers: '' }],
        };
        const res = await supertest(makeApp()).get('/api/samba/shares');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].name).toBe('media');
    });
});

describe('POST /api/samba/shares', () => {
    it('creates a share and writes smb.conf', async () => {
        const res = await supertest(makeApp())
            .post('/api/samba/shares')
            .send({ name: 'media', path: '/srv/nas/media', comment: 'Media', readOnly: false, guestAccess: true });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(res.body.name).toBe('media');
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/samba/smb.conf'], expect.anything());
    });

    it('returns 400 for missing name', async () => {
        const res = await supertest(makeApp())
            .post('/api/samba/shares')
            .send({ path: '/srv/nas/media' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('name');
    });

    it('returns 400 for non-absolute path', async () => {
        const res = await supertest(makeApp())
            .post('/api/samba/shares')
            .send({ name: 'test', path: 'relative/path' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('absolute');
    });

    it('returns 409 for duplicate share name', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'existing', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: false, validUsers: '' }],
        };
        const res = await supertest(makeApp())
            .post('/api/samba/shares')
            .send({ name: 'media', path: '/srv/nas/other' });
        expect(res.status).toBe(409);
    });

    it('returns 400 for invalid share name characters', async () => {
        const res = await supertest(makeApp())
            .post('/api/samba/shares')
            .send({ name: 'my share!', path: '/srv/nas/media' });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/samba/shares/:id', () => {
    it('deletes existing share and rewrites smb.conf', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'abc', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: false, validUsers: '' }],
        };
        const res = await supertest(makeApp()).delete('/api/samba/shares/abc');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/samba/smb.conf'], expect.anything());
    });

    it('returns 404 for non-existent share', async () => {
        const res = await supertest(makeApp()).delete('/api/samba/shares/nonexistent');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/samba/restart', () => {
    it('calls systemctl restart smbd nmbd', async () => {
        const res = await supertest(makeApp()).post('/api/samba/restart');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('systemctl', ['restart', 'smbd', 'nmbd']);
    });

    it('returns 500 if systemctl fails', async () => {
        mockSudoExec.mockRejectedValueOnce(new Error('systemctl failed'));
        const res = await supertest(makeApp()).post('/api/samba/restart');
        expect(res.status).toBe(500);
    });
});
