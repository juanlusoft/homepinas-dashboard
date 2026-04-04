// Tests for backend/routes/notifications.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock all dependencies before importing the router ───────────────────────

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

const mockSendViaEmail = vi.fn();
const mockSendViaTelegram = vi.fn();
vi.mock('../notify', () => ({
    sendViaEmail: mockSendViaEmail,
    sendViaTelegram: mockSendViaTelegram,
}));

// ─── Mini Express harness ─────────────────────────────────────────────────────
import express from 'express';
import supertest from 'supertest';

function makeApp() {
    const app = express();
    app.use(express.json());
    const router = require('../routes/notifications.js');
    app.use('/api/notifications', router);
    return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
    vi.clearAllMocks();
    mockDataStore = {
        notifications: {
            email: null,
            telegram: null,
            history: [],
            errorReporting: null,
        },
    };
    mockGetData.mockImplementation(() => ({ ...mockDataStore }));
    mockWithData.mockImplementation(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    });
});

describe('GET /api/notifications/config', () => {
    it('returns null email and telegram when not configured', async () => {
        const res = await supertest(makeApp()).get('/api/notifications/config');
        expect(res.status).toBe(200);
        expect(res.body.email).toBeNull();
        expect(res.body.telegram).toBeNull();
    });

    it('masks password with *** when email is configured', async () => {
        mockDataStore = {
            notifications: {
                email: { host: 'smtp.example.com', port: 587, secure: false, user: 'user@example.com', from: 'from@example.com', to: 'to@example.com', password: 'secret123', enabled: true },
                telegram: null,
            },
        };
        const res = await supertest(makeApp()).get('/api/notifications/config');
        expect(res.status).toBe(200);
        expect(res.body.email.password).toBe('***');
        expect(res.body.email.host).toBe('smtp.example.com');
    });

    it('masks botToken with *** when telegram is configured', async () => {
        mockDataStore = {
            notifications: {
                email: null,
                telegram: { botToken: 'realtoken123', chatId: '123456', enabled: true },
            },
        };
        const res = await supertest(makeApp()).get('/api/notifications/config');
        expect(res.body.telegram.botToken).toBe('***');
        expect(res.body.telegram.chatId).toBe('123456');
    });
});

describe('POST /api/notifications/config', () => {
    it('saves email config', async () => {
        const res = await supertest(makeApp())
            .post('/api/notifications/config')
            .send({
                email: {
                    host: 'smtp.gmail.com',
                    port: 587,
                    secure: false,
                    user: 'me@gmail.com',
                    from: 'me@gmail.com',
                    to: 'alerts@gmail.com',
                    password: 'apppassword',
                    enabled: true,
                },
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockDataStore.notifications.email.password).toBe('apppassword');
    });

    it('does not overwrite existing password when *** is submitted', async () => {
        mockDataStore = {
            notifications: {
                email: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'me@gmail.com', from: 'me@gmail.com', to: 'alerts@gmail.com', password: 'existingpassword', enabled: true },
            },
        };
        await supertest(makeApp())
            .post('/api/notifications/config')
            .send({ email: { password: '***' } });
        expect(mockDataStore.notifications.email.password).toBe('existingpassword');
    });
});

describe('POST /api/notifications/test', () => {
    it('returns 400 for invalid channel', async () => {
        const res = await supertest(makeApp()).post('/api/notifications/test').send({ channel: 'slack' });
        expect(res.status).toBe(400);
    });

    it('calls sendViaEmail for email channel', async () => {
        mockSendViaEmail.mockResolvedValue({ success: true });
        const res = await supertest(makeApp()).post('/api/notifications/test').send({ channel: 'email' });
        expect(res.status).toBe(200);
        expect(mockSendViaEmail).toHaveBeenCalledOnce();
    });

    it('calls sendViaTelegram for telegram channel', async () => {
        mockSendViaTelegram.mockResolvedValue({ success: true });
        const res = await supertest(makeApp()).post('/api/notifications/test').send({ channel: 'telegram' });
        expect(res.status).toBe(200);
        expect(mockSendViaTelegram).toHaveBeenCalledOnce();
    });

    it('returns 502 when notification delivery fails', async () => {
        mockSendViaEmail.mockResolvedValue({ success: false, error: 'SMTP connection refused' });
        const res = await supertest(makeApp()).post('/api/notifications/test').send({ channel: 'email' });
        expect(res.status).toBe(502);
        expect(res.body.error).toBe('SMTP connection refused');
    });
});
