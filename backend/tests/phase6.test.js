// Tests for Phase 6 route modules

import { describe, it, expect, vi, afterEach } from 'vitest';

// ─── Mock all dependencies before importing routes ────────────────────────────

vi.mock('../terminal-ws', () => ({
    getActiveSessions: vi.fn(() => []),
}));

vi.mock('../auth', () => ({
    requireAuth: (req, res, next) => { req.user = { username: 'admin' }; next(); },
}));
vi.mock('../rbac', () => ({
    requirePermission: () => (req, res, next) => next(),
}));
vi.mock('../logger', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
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

const mockSafeExec = vi.fn();
vi.mock('../security', () => ({
    safeExec: mockSafeExec,
    sudoExec: vi.fn(),
}));

vi.mock('../sanitize', () => ({
    sanitizePath: (p) => p && typeof p === 'string' && p.startsWith('/') ? p : null,
    sanitizeComposeName: (n) => {
        if (!n || typeof n !== 'string') return null;
        const s = n.replace(/[^a-zA-Z0-9_-]/g, '');
        if (s.length === 0 || s.length > 50) return null;
        if (!/^[a-zA-Z0-9]/.test(s)) return null;
        return s;
    },
    validateComposeContent: (content) => {
        if (!content || typeof content !== 'string') return { valid: false, error: 'Content must be a string' };
        if (!/services/.test(content)) return { valid: false, error: 'No services key' };
        return { valid: true };
    },
}));

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('terminal route', () => {
    it('module loads and exports a router', () => {
        const terminalRouter = require('../routes/terminal.js');
        expect(terminalRouter).toBeDefined();
        expect(typeof terminalRouter).toBe('function');
    });
});

describe('cloud-backup route', () => {
    it('module loads and exports a router', () => {
        const cloudBackupRouter = require('../routes/cloud-backup.js');
        expect(cloudBackupRouter).toBeDefined();
        expect(typeof cloudBackupRouter).toBe('function');
    });
});

describe('cloud-sync route', () => {
    it('module loads and exports a router', () => {
        const cloudSyncRouter = require('../routes/cloud-sync.js');
        expect(cloudSyncRouter).toBeDefined();
        expect(typeof cloudSyncRouter).toBe('function');
    });
});

describe('active-backup route', () => {
    it('module loads and exports a router', () => {
        const activeBackupRouter = require('../routes/active-backup.js');
        expect(activeBackupRouter).toBeDefined();
        expect(typeof activeBackupRouter).toBe('function');
    });
});

describe('active-directory route', () => {
    it('module loads and exports a router', () => {
        const activeDirectoryRouter = require('../routes/active-directory.js');
        expect(activeDirectoryRouter).toBeDefined();
        expect(typeof activeDirectoryRouter).toBe('function');
    });
});

describe('shortcuts route', () => {
    it('module loads and exports a router', () => {
        const shortcutsRouter = require('../routes/shortcuts.js');
        expect(shortcutsRouter).toBeDefined();
        expect(typeof shortcutsRouter).toBe('function');
    });

    it('does not throw on load', () => {
        expect(() => require('../routes/shortcuts.js')).not.toThrow();
    });
});

describe('stacks route', () => {
    it('module loads and exports a router', () => {
        const stacksRouter = require('../routes/stacks.js');
        expect(stacksRouter).toBeDefined();
        expect(typeof stacksRouter).toBe('function');
    });
});

describe('ddns route', () => {
    let ddnsRouter;

    afterEach(() => {
        if (ddnsRouter && typeof ddnsRouter.stopDdnsInterval === 'function') {
            ddnsRouter.stopDdnsInterval();
        }
    });

    it('module loads and exports a router', () => {
        ddnsRouter = require('../routes/ddns.js');
        expect(ddnsRouter).toBeDefined();
        expect(typeof ddnsRouter).toBe('function');
    });

    it('exports stopDdnsInterval function', () => {
        ddnsRouter = require('../routes/ddns.js');
        expect(typeof ddnsRouter.stopDdnsInterval).toBe('function');
    });

    it('validateProvider returns true for valid providers and false for invalid', () => {
        ddnsRouter = require('../routes/ddns.js');
        expect(ddnsRouter.validateProvider('duckdns')).toBe(true);
        expect(ddnsRouter.validateProvider('cloudflare')).toBe(true);
        expect(ddnsRouter.validateProvider('noip')).toBe(true);
        expect(ddnsRouter.validateProvider('invalid')).toBe(false);
        expect(ddnsRouter.validateProvider('')).toBe(false);
    });
});

describe('backup route', () => {
    it('module loads and exports a router', () => {
        const backupRouter = require('../routes/backup.js');
        expect(backupRouter).toBeDefined();
        expect(typeof backupRouter).toBe('function');
    });

    it('exports getRunningJobs function', () => {
        const backupRouter = require('../routes/backup.js');
        expect(typeof backupRouter.getRunningJobs).toBe('function');
        expect(backupRouter.getRunningJobs()).toBeInstanceOf(Map);
    });
});

describe('homestore route', () => {
    it('module loads and exports a router', () => {
        const homestoreRouter = require('../routes/homestore.js');
        expect(homestoreRouter).toBeDefined();
        expect(typeof homestoreRouter).toBe('function');
    });

    it('CATALOG contains exactly 15 apps', () => {
        const homestoreRouter = require('../routes/homestore.js');
        expect(Array.isArray(homestoreRouter.CATALOG)).toBe(true);
        expect(homestoreRouter.CATALOG).toHaveLength(15);
    });

    it('every app in CATALOG has required fields', () => {
        const homestoreRouter = require('../routes/homestore.js');
        for (const app of homestoreRouter.CATALOG) {
            expect(app).toHaveProperty('id');
            expect(app).toHaveProperty('name');
            expect(app).toHaveProperty('description');
            expect(app).toHaveProperty('icon');
            expect(app).toHaveProperty('category');
            expect(app).toHaveProperty('arch');
            expect(app).toHaveProperty('composeContent');
            expect(Array.isArray(app.arch)).toBe(true);
            expect(app.arch.length).toBeGreaterThan(0);
        }
    });

    it('all CATALOG app IDs are unique', () => {
        const homestoreRouter = require('../routes/homestore.js');
        const ids = homestoreRouter.CATALOG.map(a => a.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
    });
});
