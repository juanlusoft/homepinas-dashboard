// Tests for backend/routes/system.js
// Run with: npx vitest run backend/tests/system.test.js --reporter=verbose

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../security.ts', () => ({
    safeExec: vi.fn(),
    sudoExec: vi.fn(),
}));

vi.mock('../data.ts', () => ({
    getData: vi.fn(() => ({ fanMode: 'balanced', publicIp: '1.2.3.4' })),
    withData: vi.fn(async (fn) => {
        const data = { fanMode: 'balanced', publicIp: '1.2.3.4' };
        await fn(data);
        return data;
    }),
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

vi.mock('os', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        loadavg: vi.fn(() => [1.5, 1.2, 1.0]),
        cpus: vi.fn(() => Array(4).fill({})),
        freemem: vi.fn(() => 2 * 1024 * 1024 * 1024),    // 2 GB free
        totalmem: vi.fn(() => 8 * 1024 * 1024 * 1024),   // 8 GB total
        uptime: vi.fn(() => 3600),
        hostname: vi.fn(() => 'homepinas'),
    };
});

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        readFileSync: vi.fn((p) => {
            if (p === '/sys/class/thermal/thermal_zone0/temp') return '42000\n';
            return actual.readFileSync(p);
        }),
        existsSync: vi.fn(() => false),
        promises: actual.promises,
    };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeReq(overrides = {}) {
    return { body: {}, query: {}, params: {}, user: { username: 'admin' }, ...overrides };
}

function makeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('system route — /stats', () => {
    let handler;
    beforeEach(async () => {
        vi.clearAllMocks();
        // Import lazily so mocks are set up first
        const mod = await import('../routes/system.js');
        handler = mod._statsHandler;
    });

    it('returns cpuLoad as percentage', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        // loadavg[0]=1.5, cpus=4 → 1.5/4*100 = 37.5
        expect(body.cpuLoad).toBeCloseTo(37.5, 1);
    });

    it('returns ramUsed as percentage', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        // (1 - 2/8)*100 = 75
        expect(body.ramUsed).toBeCloseTo(75, 1);
    });

    it('returns cpuTemp from thermal zone', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.cpuTemp).toBe(42);
    });

    it('returns cpuTemp as null when thermal zone unavailable', async () => {
        const fs = await import('fs');
        fs.readFileSync.mockImplementation((p) => {
            if (p === '/sys/class/thermal/thermal_zone0/temp') throw new Error('ENOENT');
            throw new Error('unexpected');
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.cpuTemp).toBeNull();
    });

    it('returns hostname and uptime', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.hostname).toBe('homepinas');
        expect(body.uptime).toBe(3600);
    });

    it('returns cached publicIP from data', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.publicIP).toBe('1.2.3.4');
    });

    it('returns 200 even when one metric throws', async () => {
        const os = await import('os');
        os.loadavg.mockImplementation(() => { throw new Error('loadavg failed'); });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        // Should still respond (partial data)
        expect(res.json).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalledWith(500);
    });
});

describe('system route — fan mode', () => {
    let getFanHandler, setFanHandler;
    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../routes/system.js');
        getFanHandler = mod._getFanModeHandler;
        setFanHandler = mod._setFanModeHandler;
    });

    it('GET /fan/mode returns current mode from data', async () => {
        const req = makeReq();
        const res = makeRes();
        await getFanHandler(req, res);
        expect(res.json).toHaveBeenCalledWith({ mode: 'balanced' });
    });

    it('POST /fan/mode saves valid mode', async () => {
        const { withData } = await import('../data.ts');
        const req = makeReq({ body: { mode: 'silent' } });
        const res = makeRes();
        await setFanHandler(req, res);
        expect(withData).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });

    it('POST /fan/mode rejects invalid mode', async () => {
        const req = makeReq({ body: { mode: 'turbo' } });
        const res = makeRes();
        await setFanHandler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });
});

describe('system route — factory-reset', () => {
    it('clears data.json on factory reset', async () => {
        vi.clearAllMocks();
        const { withData } = await import('../data.ts');
        const mod = await import('../routes/system.js');
        const handler = mod._factoryResetHandler;
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(withData).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ success: true });
    });
});
