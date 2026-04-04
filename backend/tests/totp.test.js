import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const mockGetData  = vi.fn();
const mockWithData = vi.fn();
vi.mock('../data', () => ({
    getData:  mockGetData,
    withData: mockWithData,
}));

// requireAuth: inject req.user and a fake session ID header
vi.mock('../auth', () => ({
    requireAuth: (req, _res, next) => {
        req.user = { username: 'admin' };
        // Simulate the x-session-id being present (set by makeApp below)
        next();
    },
}));

const mockEncryptTotpSecret = vi.fn();
const mockDecryptTotpSecret = vi.fn();
vi.mock('../totp-crypto', () => ({
    encryptTotpSecret: mockEncryptTotpSecret,
    decryptTotpSecret: mockDecryptTotpSecret,
}));

const mockAuthGenerateSecret = vi.fn();
const mockAuthKeyuri         = vi.fn();
const mockAuthVerify         = vi.fn();
vi.mock('otplib', () => ({
    authenticator: {
        generateSecret: mockAuthGenerateSecret,
        keyuri:         mockAuthKeyuri,
        verify:         mockAuthVerify,
    },
}));

vi.mock('qrcode', () => ({
    default: { toDataURL: vi.fn(async () => 'data:image/png;base64,MOCKQR') },
    toDataURL: vi.fn(async () => 'data:image/png;base64,MOCKQR'),
}));

vi.mock('bcryptjs', () => ({
    default: {
        compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
    },
    compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
}));

// ─── HTTP harness ─────────────────────────────────────────────────────────────
import express from 'express';

const SESSION_HEADER = 'test-session-id-abc';

function makeApp() {
    const app = express();
    app.use(express.json());
    // Always inject the session header so getSessionId() works in the route
    app.use((req, _res, next) => {
        req.headers['x-session-id'] = SESSION_HEADER;
        next();
    });
    const router = require('../routes/totp.js');
    app.use('/', router);
    return app;
}

function request(app, method, path, body) {
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
                    'x-session-id': SESSION_HEADER,
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

describe('GET /status', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns enabled: false when totpEnabled is false', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', totpEnabled: false } });
        const app = makeApp();
        const res = await request(app, 'GET', '/status');
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(false);
    });

    it('returns enabled: true when totpEnabled is true', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', totpEnabled: true } });
        const app = makeApp();
        const res = await request(app, 'GET', '/status');
        expect(res.status).toBe(200);
        expect(res.body.enabled).toBe(true);
    });
});

describe('POST /setup', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns qrCode and secret', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin' } });
        mockAuthGenerateSecret.mockReturnValue('MOCKBASE32SECRET');
        mockAuthKeyuri.mockReturnValue('otpauth://totp/HomePiNAS:admin?secret=MOCKBASE32SECRET&issuer=HomePiNAS');

        const app = makeApp();
        const res = await request(app, 'POST', '/setup');

        expect(res.status).toBe(200);
        expect(res.body.secret).toBe('MOCKBASE32SECRET');
        expect(res.body.qrCode).toMatch(/^data:image\/png;base64,/);
    });

    it('stores the pending secret so /verify can access it', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin' } });
        mockAuthGenerateSecret.mockReturnValue('PENDINGSECRET');
        mockAuthKeyuri.mockReturnValue('otpauth://totp/HomePiNAS:admin?secret=PENDINGSECRET');
        mockAuthVerify.mockReturnValue(true);
        mockEncryptTotpSecret.mockReturnValue('enc:v1:encrypted');
        mockWithData.mockImplementation(async (fn) => fn({ user: { username: 'admin' } }));

        const app = makeApp();
        await request(app, 'POST', '/setup');

        const verifyRes = await request(app, 'POST', '/verify', { token: '123456' });
        expect(verifyRes.status).toBe(200);
        expect(verifyRes.body.success).toBe(true);
    });
});

describe('POST /verify', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns 400 if no pending secret exists', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin' } });
        // No /setup was called — pendingSecrets Map does not have this session
        // We need a fresh app instance so the module-level Map is clean
        vi.resetModules();
        const app = makeApp();
        const res = await request(app, 'POST', '/verify', { token: '123456' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/No pending TOTP setup/);
    });

    it('returns 400 if TOTP token is invalid', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin' } });
        mockAuthGenerateSecret.mockReturnValue('TESTSECRET');
        mockAuthKeyuri.mockReturnValue('otpauth://totp/HomePiNAS:admin?secret=TESTSECRET');
        mockAuthVerify.mockReturnValue(false); // invalid token

        vi.resetModules();
        const app = makeApp();
        await request(app, 'POST', '/setup'); // plant pending secret

        const res = await request(app, 'POST', '/verify', { token: '000000' });
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('Invalid TOTP token');
    });

    it('returns 400 if token field is missing', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin' } });
        const app = makeApp();
        const res = await request(app, 'POST', '/verify', {});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('token is required');
    });
});

describe('DELETE /disable', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('disables TOTP when password is correct', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:mypassword', totpEnabled: true } });
        mockWithData.mockImplementation(async (fn) => fn({ user: { username: 'admin', totpEnabled: true } }));

        const app = makeApp();
        const res = await request(app, 'DELETE', '/disable', { password: 'mypassword' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockWithData).toHaveBeenCalledOnce();
    });

    it('returns 401 when password is wrong', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:correct', totpEnabled: true } });

        const app = makeApp();
        const res = await request(app, 'DELETE', '/disable', { password: 'wrong' });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Incorrect password');
        expect(mockWithData).not.toHaveBeenCalled();
    });

    it('returns 400 if password field is missing', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:pass', totpEnabled: true } });
        const app = makeApp();
        const res = await request(app, 'DELETE', '/disable', {});
        expect(res.status).toBe(400);
        expect(res.body.error).toBe('password is required');
    });
});
