import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetData  = vi.fn();
const mockWithData = vi.fn();
vi.mock('../data', () => ({
    getData:  mockGetData,
    withData: mockWithData,
}));

const mockClearAllSessions = vi.fn();
vi.mock('../session', () => ({
    clearAllSessions: mockClearAllSessions,
}));

// requireAuth middleware: inject req.user = { username: 'admin' }
vi.mock('../auth', () => ({
    requireAuth: (req, _res, next) => {
        req.user = { username: 'admin' };
        next();
    },
}));

vi.mock('bcryptjs', () => ({
    default: {
        hash:    vi.fn(async (pw) => `hashed:${pw}`),
        compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
    },
    hash:    vi.fn(async (pw) => `hashed:${pw}`),
    compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
}));

// ─── HTTP harness (same pattern as auth.test.js) ─────────────────────────────
import express from 'express';

function makeApp() {
    const app = express();
    app.use(express.json());
    const router = require('../routes/users.js');
    app.use('/', router);
    return app;
}

function request(app, method, path, body, headers = {}) {
    return new Promise((resolve) => {
        const server = app.listen(0, () => {
            const port = server.address().port;
            const http = require('http');
            const data = body ? JSON.stringify(body) : undefined;
            const options = {
                hostname: '127.0.0.1',
                port,
                path,
                method: method.toUpperCase(),
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': data ? Buffer.byteLength(data) : 0,
                    ...headers,
                },
            };
            const httpReq = http.request(options, (res) => {
                let raw = '';
                res.on('data', c => { raw += c; });
                res.on('end', () => {
                    server.close();
                    resolve({ status: res.statusCode, body: JSON.parse(raw || 'null') });
                });
            });
            httpReq.on('error', (e) => { server.close(); resolve({ status: 500, body: { error: e.message } }); });
            if (data) httpReq.write(data);
            httpReq.end();
        });
    });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PUT /me/password', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('changes password and clears sessions on success', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:oldpass' } });
        mockWithData.mockImplementation(async (fn) => fn({ user: { username: 'admin', password: 'hashed:oldpass' } }));

        const app = makeApp();
        const res = await request(app, 'PUT', '/me/password', {
            currentPassword: 'oldpass',
            newPassword: 'newpassword123'
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockClearAllSessions).toHaveBeenCalledOnce();
    });

    it('returns 401 when currentPassword is wrong', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:correct' } });

        const app = makeApp();
        const res = await request(app, 'PUT', '/me/password', {
            currentPassword: 'wrong',
            newPassword: 'newpassword123'
        });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Current password is incorrect');
        expect(mockClearAllSessions).not.toHaveBeenCalled();
    });

    it('returns 400 when newPassword is too short', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:oldpass' } });

        const app = makeApp();
        const res = await request(app, 'PUT', '/me/password', {
            currentPassword: 'oldpass',
            newPassword: 'short'
        });

        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/8 characters/);
    });

    it('returns 400 when fields are missing', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:oldpass' } });

        const app = makeApp();
        const res = await request(app, 'PUT', '/me/password', { currentPassword: 'oldpass' });

        expect(res.status).toBe(400);
    });

    it('returns 404 when user record not found in data', async () => {
        // data.user belongs to a different username than what requireAuth injected
        mockGetData.mockReturnValue({ user: { username: 'someone-else', password: 'hashed:pass' } });

        const app = makeApp();
        const res = await request(app, 'PUT', '/me/password', {
            currentPassword: 'oldpass',
            newPassword: 'newpassword123'
        });

        expect(res.status).toBe(404);
    });

    it('does not call withData when current password check fails', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:correct' } });

        const app = makeApp();
        await request(app, 'PUT', '/me/password', { currentPassword: 'wrong', newPassword: 'newpassword123' });

        expect(mockWithData).not.toHaveBeenCalled();
    });
});
