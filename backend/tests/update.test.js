// Tests for backend/routes/update.js
// Run with: npx vitest run backend/tests/update.test.js --reporter=verbose

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'path';

vi.mock('../security.ts', () => ({
    safeExec: vi.fn(),
    sudoExec: vi.fn(),
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
        readFileSync: vi.fn((p, enc) => {
            if (p.endsWith('package.json')) {
                return JSON.stringify({ version: '3.5.0' });
            }
            return actual.readFileSync(p, enc);
        }),
    };
});

function makeReq(overrides = {}) {
    return { body: {}, params: {}, user: { username: 'admin' }, ...overrides };
}

function makeRes() {
    const res = {};
    res.status = vi.fn(() => res);
    res.json = vi.fn(() => res);
    return res;
}

describe('update route — /check', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        const { safeExec } = await import('../security.ts');
        safeExec.mockImplementation(async (cmd, args) => {
            if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', stderr: '' };
            if (cmd === 'git' && args[0] === 'tag') return { stdout: '3.4.0\n3.5.0\n3.6.0\n', stderr: '' };
            if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '' };
            if (cmd === 'git' && args[0] === 'log') return { stdout: 'abc1234 fix: something\n', stderr: '' };
            return { stdout: '', stderr: '' };
        });
        const mod = await import('../routes/update.js');
        handler = mod._checkHandler;
    });

    it('returns currentVersion from package.json', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.currentVersion).toBe('3.5.0');
    });

    it('returns latestVersion as highest semver tag', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.latestVersion).toBe('3.6.0');
    });

    it('sets updateAvailable true when latest > current', async () => {
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.updateAvailable).toBe(true);
    });

    it('sets updateAvailable false when already on latest', async () => {
        const { safeExec } = await import('../security.ts');
        safeExec.mockImplementation(async (cmd, args) => {
            if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', stderr: '' };
            if (cmd === 'git' && args[0] === 'tag') return { stdout: '3.5.0\n', stderr: '' };
            if (cmd === 'git' && args[0] === 'status') return { stdout: '', stderr: '' };
            if (cmd === 'git' && args[0] === 'log') return { stdout: '', stderr: '' };
            return { stdout: '', stderr: '' };
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.updateAvailable).toBe(false);
    });

    it('sets localChanges true when git status is non-empty', async () => {
        const { safeExec } = await import('../security.ts');
        safeExec.mockImplementation(async (cmd, args) => {
            if (cmd === 'git' && args[0] === 'fetch') return { stdout: '', stderr: '' };
            if (cmd === 'git' && args[0] === 'tag') return { stdout: '3.6.0\n', stderr: '' };
            if (cmd === 'git' && args[0] === 'status') return { stdout: ' M backend/routes/system.js\n', stderr: '' };
            if (cmd === 'git' && args[0] === 'log') return { stdout: '', stderr: '' };
            return { stdout: '', stderr: '' };
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.localChanges).toBe(true);
        expect(body.localChangesFiles).toContain('backend/routes/system.js');
    });

    it('returns 500 when git fails completely', async () => {
        const { safeExec } = await import('../security.ts');
        safeExec.mockRejectedValue(new Error('git not found'));
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        expect(res.status).toHaveBeenCalledWith(500);
    });
});

describe('update route — /check-os', () => {
    let handler;

    beforeEach(async () => {
        vi.clearAllMocks();
        const mod = await import('../routes/update.js');
        handler = mod._checkOsHandler;
    });

    it('returns package count from apt-get dry run', async () => {
        const { sudoExec } = await import('../security.ts');
        sudoExec.mockResolvedValue({
            stdout: [
                'NOTE: This is only a simulation!',
                'Inst libssl3 [3.0.2-0ubuntu1.12] (3.0.2-0ubuntu1.13 Ubuntu:22.04/jammy-updates [amd64])',
                'Inst curl [7.81.0-1ubuntu1.14] (7.81.0-1ubuntu1.15 Ubuntu:22.04/jammy-updates [amd64])',
                'Inst openssl [3.0.2-0ubuntu1.12] (3.0.2-0ubuntu1.13 security.ubuntu.com:22.04/jammy-security [amd64])',
            ].join('\n'),
            stderr: '',
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.updatesAvailable).toBe(true);
        expect(body.packages).toHaveLength(3);
    });

    it('identifies security updates by origin URL', async () => {
        const { sudoExec } = await import('../security.ts');
        sudoExec.mockResolvedValue({
            stdout: [
                'Inst openssl [3.0.2] (3.0.3 security.ubuntu.com:22.04/jammy-security [amd64])',
                'Inst curl [7.81.0] (7.81.1 Ubuntu:22.04/jammy-updates [amd64])',
            ].join('\n'),
            stderr: '',
        });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.securityUpdates).toBe(1);
    });

    it('returns updatesAvailable false when no packages', async () => {
        const { sudoExec } = await import('../security.ts');
        sudoExec.mockResolvedValue({ stdout: '0 upgraded, 0 newly installed.\n', stderr: '' });
        const req = makeReq();
        const res = makeRes();
        await handler(req, res);
        const body = res.json.mock.calls[0][0];
        expect(body.updatesAvailable).toBe(false);
        expect(body.packages).toHaveLength(0);
    });
});
