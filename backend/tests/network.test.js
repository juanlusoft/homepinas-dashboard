// Tests for backend/routes/network.js
// Run with: npx vitest run backend/tests/network.test.js --reporter=verbose

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../security.ts', () => ({
    safeExec: vi.fn(),
    sudoExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
}));

vi.mock('../data.ts', () => ({
    getData: vi.fn(() => ({ publicIp: null, publicIpCachedAt: 0 })),
    withData: vi.fn(async (fn) => {
        const data = { publicIp: null, publicIpCachedAt: 0 };
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

vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        existsSync: vi.fn(() => false),
        readFileSync: vi.fn(() => ''),
    };
});

// Mock global fetch for public-ip tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function makeReq(overrides = {}) {
    return { body: {}, params: {}, query: {}, user: { username: 'admin' }, ...overrides };
}

function makeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}

const IP_ADDR_JSON = JSON.stringify([
    {
        ifindex: 1,
        ifname: 'lo',
        flags: ['LOOPBACK', 'UP'],
        addr_info: [{ local: '127.0.0.1', prefixlen: 8, family: 'inet' }],
    },
    {
        ifindex: 2,
        ifname: 'eth0',
        flags: ['BROADCAST', 'MULTICAST', 'UP', 'LOWER_UP'],
        addr_info: [{ local: '192.168.1.100', prefixlen: 24, family: 'inet' }],
    },
    {
        ifindex: 3,
        ifname: 'wlan0',
        flags: ['BROADCAST', 'MULTICAST'],
        addr_info: [],
    },
]);

describe('network route — /interfaces', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        const { safeExec } = await import('../security.ts');
        safeExec.mockResolvedValue({ stdout: IP_ADDR_JSON, stderr: '' });
        const mod = await import('../routes/network.js');
        handler = mod._interfacesHandler;
    });

    it('returns an array of interfaces excluding loopback', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(Array.isArray(body)).toBe(true);
        expect(body.some(i => i.id === 'lo')).toBe(false);
    });

    it('includes eth0 with correct IP and subnet', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        const eth0 = body.find(i => i.id === 'eth0');
        expect(eth0).toBeDefined();
        expect(eth0.ip).toBe('192.168.1.100');
        expect(eth0.subnet).toBe('255.255.255.0');
    });

    it('marks disconnected interface correctly', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        const wlan0 = body.find(i => i.id === 'wlan0');
        expect(wlan0).toBeDefined();
        expect(wlan0.status).toBe('disconnected');
    });

    it('converts /24 prefix to 255.255.255.0', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        const eth0 = body.find(i => i.id === 'eth0');
        expect(eth0.subnet).toBe('255.255.255.0');
    });

    it('returns 500 when ip command fails', async () => {
        const { safeExec } = await import('../security.ts');
        safeExec.mockRejectedValue(new Error('ip not found'));
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('network route — /configure', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../routes/network.js');
        handler = mod._configureHandler;
    });

    it('rejects invalid interface name', async () => {
        const req = makeReq({ body: { id: '../../etc/passwd', dhcp: true } });
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects invalid static IP', async () => {
        const req = makeReq({ body: { id: 'eth0', dhcp: false, ip: 'not.an.ip', subnet: '255.255.255.0', gateway: '192.168.1.1' } });
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('rejects static config without subnet', async () => {
        const req = makeReq({ body: { id: 'eth0', dhcp: false, ip: '192.168.1.50', gateway: '192.168.1.1' } });
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(400);
    });

    it('accepts DHCP config and calls tee + ip link set', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq({ body: { id: 'eth0', dhcp: true } });
        const res = makeRes();
        await handler(req, res);
        expect(sudoExec).toHaveBeenCalledWith('tee', ['/etc/network/interfaces.d/eth0'], expect.any(Object));
        expect(sudoExec).toHaveBeenCalledWith('ip', ['link', 'set', 'eth0', 'up']);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });

    it('accepts static config with valid IPs', async () => {
        const { sudoExec } = await import('../security.ts');
        const req = makeReq({ body: {
            id: 'eth0', dhcp: false,
            ip: '192.168.1.50', subnet: '255.255.255.0',
            gateway: '192.168.1.1', dns: '8.8.8.8'
        }});
        const res = makeRes();
        await handler(req, res);
        expect(sudoExec).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    });
});

describe('network route — /public-ip', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../routes/network.js');
        handler = mod._publicIpHandler;
    });

    it('fetches public IP from ipify when cache is empty', async () => {
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ip: '203.0.113.42' }),
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(res.json).toHaveBeenCalledWith({ ip: '203.0.113.42' });
    });

    it('returns cached IP when cache is fresh', async () => {
        const { getData } = await import('../data.ts');
        getData.mockReturnValue({
            publicIp: '203.0.113.99',
            publicIpCachedAt: Date.now() - 60000,
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(mockFetch).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ ip: '203.0.113.99' });
    });

    it('re-fetches when cache is stale (> 10 min)', async () => {
        const { getData } = await import('../data.ts');
        getData.mockReturnValue({
            publicIp: '1.1.1.1',
            publicIpCachedAt: Date.now() - 700000,
        });
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({ ip: '203.0.113.55' }),
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(mockFetch).toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({ ip: '203.0.113.55' });
    });

    it('returns 502 when fetch fails and no cache', async () => {
        mockFetch.mockRejectedValue(new Error('network error'));
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(502);
    });
});
