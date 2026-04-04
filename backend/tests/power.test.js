// Tests for backend/routes/power.js
// Run with: npx vitest run backend/tests/power.test.js --reporter=verbose

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../security.ts', () => ({
    safeExec: vi.fn(),
    sudoExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('../auth.ts', () => ({
    requireAuth: (_req, _res, next) => next(),
}));

vi.mock('../rbac.ts', () => ({
    requirePermission: () => (_req, _res, next) => next(),
}));

vi.mock('../logger.ts', () => ({
    default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
}));

function makeReq(overrides = {}) {
    return { body: {}, params: {}, user: { username: 'admin' }, ...overrides };
}

function makeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}

describe('power route', () => {
    let rebootHandler, shutdownHandler, actionHandler;

    beforeEach(async () => {
        vi.clearAllMocks();
        vi.useFakeTimers();
        const mod = await import('../routes/power.js');
        rebootHandler = mod._rebootHandler;
        shutdownHandler = mod._shutdownHandler;
        actionHandler = mod._actionHandler;
    });

    it('POST /reboot responds with success immediately', async () => {
        const req = makeReq();
        const res = makeRes();
        await rebootHandler(req, res);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('POST /reboot calls systemctl reboot after 1s delay', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq();
        const res = makeRes();
        await rebootHandler(req, res);
        expect(sudoExec).not.toHaveBeenCalled(); // not yet
        vi.advanceTimersByTime(1500);
        await Promise.resolve(); // flush microtasks
        expect(sudoExec).toHaveBeenCalledWith('systemctl', ['reboot']);
    });

    it('POST /shutdown responds with success immediately', async () => {
        const req = makeReq();
        const res = makeRes();
        await shutdownHandler(req, res);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('POST /shutdown calls systemctl poweroff after 1s delay', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq();
        const res = makeRes();
        await shutdownHandler(req, res);
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
        expect(sudoExec).toHaveBeenCalledWith('systemctl', ['poweroff']);
    });

    it('POST /:action with "reboot" calls reboot', async () => {
        const req = makeReq({ params: { action: 'reboot' } });
        const res = makeRes();
        await actionHandler(req, res);
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('POST /:action with "shutdown" normalises to poweroff', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq({ params: { action: 'shutdown' } });
        const res = makeRes();
        await actionHandler(req, res);
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
        expect(sudoExec).toHaveBeenCalledWith('systemctl', ['poweroff']);
    });

    it('POST /:action with "poweroff" normalises to poweroff', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq({ params: { action: 'poweroff' } });
        const res = makeRes();
        await actionHandler(req, res);
        vi.advanceTimersByTime(1500);
        await Promise.resolve();
        expect(sudoExec).toHaveBeenCalledWith('systemctl', ['poweroff']);
    });

    it('POST /:action with unknown action returns 400', async () => {
        const req = makeReq({ params: { action: 'hibernate' } });
        const res = makeRes();
        await actionHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.any(String) }));
    });
});
