import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all dependencies before importing the router ───────────────────────

const mockGetData = vi.fn();
const mockWithData = vi.fn();
vi.mock('../data', () => ({
    getData:  mockGetData,
    withData: mockWithData,
}));

const mockCreateSession = vi.fn();
const mockValidateSession = vi.fn();
vi.mock('../session', () => ({
    createSession:   mockCreateSession,
    validateSession: mockValidateSession,
}));

const mockGetCsrfToken = vi.fn();
vi.mock('../csrf', () => ({
    getCsrfToken: mockGetCsrfToken,
}));

const mockSanitizeUsername = vi.fn();
vi.mock('../sanitize', () => ({
    sanitizeUsername: mockSanitizeUsername,
}));

const mockDecryptTotpSecret = vi.fn();
vi.mock('../totp-crypto', () => ({
    decryptTotpSecret: mockDecryptTotpSecret,
}));

const mockAuthenticatorVerify = vi.fn();
vi.mock('otplib', () => ({
    authenticator: { verify: mockAuthenticatorVerify },
}));

// Stub bcryptjs — pure sync for speed in tests
vi.mock('bcryptjs', () => ({
    default: {
        hash:    vi.fn(async (pw) => `hashed:${pw}`),
        compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
    },
    hash:    vi.fn(async (pw) => `hashed:${pw}`),
    compare: vi.fn(async (plain, hash) => hash === `hashed:${plain}`),
}));

// ─── Mini Express harness ─────────────────────────────────────────────────────
import express from 'express';

function makeApp() {
    const app = express();
    app.use(express.json());
    const router = require('../routes/auth.js');
    app.use('/', router);
    return app;
}

function request(app, method, path, body, headers = {}) {
    return new Promise((resolve) => {
        const req = {
            method: method.toUpperCase(),
            url: path,
            headers: { 'content-type': 'application/json', ...headers },
            body,
        };
        // Use supertest-style: just call the handler via express internals
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
                res.on('data', chunk => { raw += chunk; });
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

    it('returns requireSetup: true when no user exists', async () => {
        mockGetData.mockReturnValue({ user: null });
        const app = makeApp();
        const res = await request(app, 'GET', '/status');
        expect(res.status).toBe(200);
        expect(res.body.requireSetup).toBe(true);
    });

    it('returns requireSetup: false when user exists', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hash' } });
        const app = makeApp();
        const res = await request(app, 'GET', '/status');
        expect(res.status).toBe(200);
        expect(res.body.requireSetup).toBe(false);
    });
});

describe('POST /setup', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('creates user and returns session on first run', async () => {
        mockGetData.mockReturnValue({ user: null });
        mockSanitizeUsername.mockReturnValue('admin');
        mockWithData.mockImplementation(async (fn) => fn({ user: null }));
        mockCreateSession.mockReturnValue('sess-abc');
        mockGetCsrfToken.mockReturnValue('csrf-xyz');

        const app = makeApp();
        const res = await request(app, 'POST', '/setup', { username: 'admin', password: 'password123' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBe('sess-abc');
        expect(res.body.csrfToken).toBe('csrf-xyz');
        expect(res.body.user.username).toBe('admin');
    });

    it('returns 409 if already configured', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hash' } });
        const app = makeApp();
        const res = await request(app, 'POST', '/setup', { username: 'admin', password: 'password123' });
        expect(res.status).toBe(409);
        expect(res.body.error).toBe('Already configured');
    });

    it('returns 400 if username is invalid', async () => {
        mockGetData.mockReturnValue({ user: null });
        mockSanitizeUsername.mockReturnValue(null); // invalid
        const app = makeApp();
        const res = await request(app, 'POST', '/setup', { username: '!!bad!!', password: 'password123' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/Invalid username/);
    });

    it('returns 400 if password is too short', async () => {
        mockGetData.mockReturnValue({ user: null });
        mockSanitizeUsername.mockReturnValue('admin');
        const app = makeApp();
        const res = await request(app, 'POST', '/setup', { username: 'admin', password: 'short' });
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/8 characters/);
    });
});

describe('POST /login', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns session when credentials are correct and no TOTP', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: false } });
        mockCreateSession.mockReturnValue('sess-123');
        mockGetCsrfToken.mockReturnValue('csrf-abc');

        const app = makeApp();
        const res = await request(app, 'POST', '/login', { username: 'admin', password: 'secret' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBe('sess-123');
    });

    it('returns requires2FA when TOTP is enabled', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: true } });

        const app = makeApp();
        const res = await request(app, 'POST', '/login', { username: 'admin', password: 'secret' });

        expect(res.status).toBe(200);
        expect(res.body.requires2FA).toBe(true);
        expect(typeof res.body.pendingToken).toBe('string');
        expect(res.body.pendingToken.length).toBe(64); // 32 bytes hex
    });

    it('returns 401 on wrong password', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:correct', totpEnabled: false } });

        const app = makeApp();
        const res = await request(app, 'POST', '/login', { username: 'admin', password: 'wrong' });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid credentials');
    });

    it('returns 401 on unknown username', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: false } });

        const app = makeApp();
        const res = await request(app, 'POST', '/login', { username: 'nobody', password: 'secret' });

        expect(res.status).toBe(401);
    });

    it('returns 400 if username or password missing', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hash' } });
        const app = makeApp();
        const res = await request(app, 'POST', '/login', { username: 'admin' });
        expect(res.status).toBe(400);
    });
});

describe('POST /login/2fa', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('creates session when TOTP code is valid', async () => {
        // First do a login to plant a pending token
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: true, totpSecret: 'enc:v1:...' } });
        const app = makeApp();

        const loginRes = await request(app, 'POST', '/login', { username: 'admin', password: 'secret' });
        expect(loginRes.body.requires2FA).toBe(true);
        const { pendingToken } = loginRes.body;

        // Now verify 2FA
        mockDecryptTotpSecret.mockReturnValue('PLAINBASE32SECRET');
        mockAuthenticatorVerify.mockReturnValue(true);
        mockCreateSession.mockReturnValue('sess-2fa');
        mockGetCsrfToken.mockReturnValue('csrf-2fa');

        const res = await request(app, 'POST', '/login/2fa', { pendingToken, totpCode: '123456' });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.sessionId).toBe('sess-2fa');
    });

    it('returns 401 when TOTP code is invalid', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: true, totpSecret: 'enc:v1:...' } });
        const app = makeApp();

        const loginRes = await request(app, 'POST', '/login', { username: 'admin', password: 'secret' });
        const { pendingToken } = loginRes.body;

        mockDecryptTotpSecret.mockReturnValue('PLAINBASE32SECRET');
        mockAuthenticatorVerify.mockReturnValue(false); // wrong code

        const res = await request(app, 'POST', '/login/2fa', { pendingToken, totpCode: '000000' });

        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Invalid TOTP code');
    });

    it('returns 401 when pendingToken is unknown', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hash' } });
        const app = makeApp();
        const res = await request(app, 'POST', '/login/2fa', { pendingToken: 'not-real', totpCode: '123456' });
        expect(res.status).toBe(401);
    });

    it('pendingToken can only be used once', async () => {
        mockGetData.mockReturnValue({ user: { username: 'admin', password: 'hashed:secret', totpEnabled: true, totpSecret: 'enc:v1:...' } });
        const app = makeApp();

        const loginRes = await request(app, 'POST', '/login', { username: 'admin', password: 'secret' });
        const { pendingToken } = loginRes.body;

        mockDecryptTotpSecret.mockReturnValue('PLAINBASE32SECRET');
        mockAuthenticatorVerify.mockReturnValue(true);
        mockCreateSession.mockReturnValue('sess-once');
        mockGetCsrfToken.mockReturnValue('csrf-once');

        // First use: success
        await request(app, 'POST', '/login/2fa', { pendingToken, totpCode: '123456' });

        // Second use: should fail
        const res2 = await request(app, 'POST', '/login/2fa', { pendingToken, totpCode: '123456' });
        expect(res2.status).toBe(401);
    });
});

describe('POST /verify-session', () => {
    beforeEach(() => { vi.clearAllMocks(); });

    it('returns csrfToken and user for a valid session', async () => {
        mockValidateSession.mockReturnValue({ username: 'admin', expiresAt: Date.now() + 3600000 });
        mockGetCsrfToken.mockReturnValue('fresh-csrf');

        const app = makeApp();
        const res = await request(app, 'POST', '/verify-session', null, { 'x-session-id': 'valid-sess' });

        expect(res.status).toBe(200);
        expect(res.body.csrfToken).toBe('fresh-csrf');
        expect(res.body.user.username).toBe('admin');
    });

    it('returns 401 when session is invalid', async () => {
        mockValidateSession.mockReturnValue(null);
        const app = makeApp();
        const res = await request(app, 'POST', '/verify-session', null, { 'x-session-id': 'bad-sess' });
        expect(res.status).toBe(401);
    });

    it('returns 401 when no session header provided', async () => {
        const app = makeApp();
        const res = await request(app, 'POST', '/verify-session', null);
        expect(res.status).toBe(401);
    });
});
