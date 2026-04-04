// Tests for backend/routes/vpn.js

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
    const router = require('../routes/vpn.js');
    app.use('/api/vpn', router);
    return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockDataStore = { vpnClients: [], vpnConfig: {} };
    mockSafeExec.mockResolvedValue({ stdout: '', stderr: '' });
    mockSudoExec.mockResolvedValue({ stdout: '', stderr: '' });
    mockGetData.mockImplementation(() => ({ ...mockDataStore }));
    mockWithData.mockImplementation(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    });
});

describe('GET /api/vpn/status', () => {
    it('returns installed:false when wg is not found', async () => {
        mockSafeExec.mockRejectedValue(new Error('not found'));
        const res = await supertest(makeApp()).get('/api/vpn/status');
        expect(res.status).toBe(200);
        expect(res.body.installed).toBe(false);
        expect(res.body.running).toBe(false);
    });

    it('returns installed:true and running:true when both commands succeed', async () => {
        mockSafeExec
            .mockResolvedValueOnce({ stdout: '/usr/bin/wg\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: 'active\n', stderr: '' })
            .mockResolvedValueOnce({ stdout: '', stderr: '' });
        const res = await supertest(makeApp()).get('/api/vpn/status');
        expect(res.status).toBe(200);
        expect(res.body.installed).toBe(true);
        expect(res.body.running).toBe(true);
    });
});

describe('POST /api/vpn/install', () => {
    it('returns installing:true immediately', async () => {
        const res = await supertest(makeApp()).post('/api/vpn/install');
        expect(res.status).toBe(200);
        expect(res.body.installing).toBe(true);
    });
});

describe('GET /api/vpn/install/progress', () => {
    it('returns progress object', async () => {
        const res = await supertest(makeApp()).get('/api/vpn/install/progress');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('step');
        expect(res.body).toHaveProperty('progress');
        expect(res.body).toHaveProperty('completed');
        expect(res.body).toHaveProperty('running');
    });
});

describe('PUT /api/vpn/config', () => {
    it('updates vpnConfig and responds with success', async () => {
        const res = await supertest(makeApp())
            .put('/api/vpn/config')
            .send({ endpoint: 'vpn.example.com', port: 51820, dns: '1.1.1.1' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid port (below 1024)', async () => {
        const res = await supertest(makeApp())
            .put('/api/vpn/config')
            .send({ port: 80 });
        expect(res.status).toBe(400);
    });

    it('returns 400 for port above 65535', async () => {
        const res = await supertest(makeApp())
            .put('/api/vpn/config')
            .send({ port: 99999 });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/vpn/clients/:id', () => {
    it('returns 404 for non-existent client', async () => {
        const res = await supertest(makeApp()).delete('/api/vpn/clients/ghost');
        expect(res.status).toBe(404);
    });

    it('removes an existing client', async () => {
        mockDataStore = {
            vpnClients: [{ id: 'abc', name: 'laptop', publicKey: 'PUBKEY', assignedIp: '10.8.0.2', privateKey: 'PRIVKEY', createdAt: '' }],
            vpnConfig: {},
        };
        const res = await supertest(makeApp()).delete('/api/vpn/clients/abc');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('POST /api/vpn/clients', () => {
    it('returns 400 if name is missing', async () => {
        const res = await supertest(makeApp()).post('/api/vpn/clients').send({});
        expect(res.status).toBe(400);
    });
});
