# Phase 2: System + Power + Update + Network — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement four Express route modules — `system`, `power`, `update`, and `network` — so HomePiNAS serves every API endpoint the frontend requires for system stats, power control, software updates, and network interface management.

**Architecture:** Each module is a CommonJS Express Router (`require`/`module.exports`) mounted at its existing path in `routes.ts`. All OS commands flow through `safeExec`/`sudoExec` from `security.ts`. Persistent state (fan mode, public IP cache, update status) lives in `data.json` via `withData`/`getData`. Auth is enforced on every route via `requireAuth`; write/destructive/admin actions additionally call `requirePermission`. Validation helpers are consumed from the already-existing `sanitize.ts` (no duplication).

**Tech Stack:** Node.js 20+, Express 4, CommonJS modules (plain `.js` route files), `os` and `fs` stdlib, `vitest` for tests.

---

## Prerequisites

Before any route task begins, two one-time changes must land first (Task 0).

---

## File Structure

| File | Status | Responsibility |
|------|--------|---------------|
| `backend/security.ts` | **Modify** | Add `git`, `npm` to `safeExec` allowlist; add `ip` to `sudoExec` allowlist |
| `backend/routes/system.js` | **Create** | Stats, disks, fan, dashboard-updates, os-updates, action, factory-reset |
| `backend/routes/power.js` | **Create** | Reboot, shutdown, generic action |
| `backend/routes/update.js` | **Create** | Check dashboard update, apply, check OS updates, apply OS updates |
| `backend/routes/network.js` | **Create** | List interfaces, configure interface, public IP |
| `backend/tests/system.test.js` | **Create** | Unit tests for system route logic |
| `backend/tests/power.test.js` | **Create** | Unit tests for power route logic |
| `backend/tests/update.test.js` | **Create** | Unit tests for update route logic |
| `backend/tests/network.test.js` | **Create** | Unit tests for network route logic |

---

## Task 0: Extend Security Allowlists (prerequisite)

**Files:**
- Modify: `backend/security.ts` (lines 47–57 `allowedCommands`, lines 92–98 `allowedSudoCommands`)

- [ ] **Step 1: Add `git` and `npm` to `safeExec` allowlist**

In `backend/security.ts`, locate the `allowedCommands` array (currently ends with `'ip'`). Add the two new entries:

```ts
const allowedCommands = [
    'cat', 'ls', 'df', 'mount', 'umount', 'smartctl',
    'systemctl', 'snapraid', 'mergerfs', 'smbpasswd', 'useradd',
    'usermod', 'chown', 'chmod', 'mkfs.ext4', 'mkfs.xfs', 'parted',
    'partprobe', 'id', 'getent', 'cp', 'tee', 'mkdir',
    'journalctl', 'smbstatus', 'smbd', 'nmbd', 'userdel',
    'apcaccess', 'apctest', 'upsc', 'upscmd', 'rsync', 'tar',
    'crontab', 'mv', 'grep', 'blkid', 'lsblk', 'findmnt',
    'mkswap', 'swapon', 'swapoff', 'fdisk', 'xorriso', 'mksquashfs',
    'wg', 'qrencode', 'which', 'ip',
    'git', 'npm'                          // ← added for update routes
];
```

- [ ] **Step 2: Add `ip` to `sudoExec` allowlist**

In the same file, locate `allowedSudoCommands`. Add `'ip'` to the list:

```ts
const allowedSudoCommands = [
    'cp', 'mv', 'chown', 'chmod', 'mkdir', 'tee', 'cat',
    'systemctl', 'smbpasswd', 'useradd', 'usermod', 'userdel',
    'mount', 'umount', 'mkfs.ext4', 'mkfs.xfs', 'parted', 'partprobe',
    'samba-tool', 'net', 'testparm',
    'apt-get', 'dpkg', 'fuser', 'killall', 'rm', 'sysctl', 'wg',
    'ip'                                  // ← added for network configure
];
```

- [ ] **Step 3: Verify the change compiles**

```bash
cd /path/to/dashboard-v3.5
npx tsc --noEmit -p backend/tsconfig.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/security.ts
git commit -m "security: extend safeExec/sudoExec allowlists for phase-2 routes (git, npm, ip)"
```

---

## Task 1: `backend/routes/system.js` — write the failing tests first

**Files:**
- Create: `backend/tests/system.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/system.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests and confirm they fail**

```bash
cd /path/to/dashboard-v3.5
npx vitest run backend/tests/system.test.js --reporter=verbose
```

Expected: FAIL — `Cannot find module '../routes/system.js'`

---

## Task 2: `backend/routes/system.js` — implement

**Files:**
- Create: `backend/routes/system.js`

- [ ] **Step 1: Create the file**

Create `backend/routes/system.js`:

```js
/**
 * HomePiNAS - System Routes
 * Mounted at /api/system
 */

'use strict';

const router = require('express').Router();
const os = require('os');
const fs = require('fs');
const path = require('path');

const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { validateFanMode, validateSystemAction } = require('../sanitize');
const log = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Read CPU temperature from Linux thermal zone.
 * Returns degrees Celsius (integer) or null if unavailable.
 */
function readCpuTemp() {
    try {
        const raw = fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8');
        return Math.round(parseInt(raw.trim(), 10) / 1000);
    } catch {
        return null;
    }
}

/**
 * Build system stats object. Each metric is wrapped in try/catch so a
 * single failure never breaks the whole response.
 */
async function buildStats() {
    const stats = {};

    try {
        stats.cpuLoad = parseFloat(
            ((os.loadavg()[0] / os.cpus().length) * 100).toFixed(1)
        );
    } catch {
        stats.cpuLoad = null;
    }

    try {
        stats.ramUsed = parseFloat(
            ((1 - os.freemem() / os.totalmem()) * 100).toFixed(1)
        );
        stats.ramTotal = Math.round(os.totalmem() / 1024 / 1024 / 1024); // GB
    } catch {
        stats.ramUsed = null;
        stats.ramTotal = null;
    }

    try {
        stats.cpuTemp = readCpuTemp();
    } catch {
        stats.cpuTemp = null;
    }

    try {
        stats.uptime = os.uptime();
    } catch {
        stats.uptime = null;
    }

    try {
        stats.hostname = os.hostname();
    } catch {
        stats.hostname = null;
    }

    try {
        const data = getData();
        stats.publicIP = data.publicIp || null;
    } catch {
        stats.publicIP = null;
    }

    return stats;
}

// ─── Route Handlers (exported for unit testing) ───────────────────────────────

async function _statsHandler(req, res) {
    try {
        const stats = await buildStats();
        res.json(stats);
    } catch (err) {
        log.error('[system/stats] Unexpected error:', err.message);
        res.status(500).json({ error: 'Failed to read system stats' });
    }
}

async function _disksHandler(req, res) {
    try {
        const { stdout } = await safeExec('lsblk', [
            '-J', '-d', '-o', 'NAME,MODEL,TYPE,SIZE,SERIAL,ROTA,TRAN'
        ]);
        const lsblk = JSON.parse(stdout);
        const devices = (lsblk.blockdevices || []).filter(d => {
            if (d.type !== 'disk') return false;
            if (/^(loop|zram|ram|mmcblk)/.test(d.name)) return false;
            return d.size && d.size !== '0' && d.size !== '0B';
        });

        const disks = await Promise.all(devices.map(async (d) => {
            let temp = null;
            let model = d.model || d.name;
            try {
                const { stdout: smartRaw } = await safeExec('smartctl', [
                    '-A', '-j', `/dev/${d.name}`
                ]);
                const smart = JSON.parse(smartRaw);
                temp = smart.temperature?.current ?? null;
                model = smart.model_name || model;
            } catch {
                // SMART not available for this disk — continue
            }
            return {
                id: d.name,
                model,
                type: d.rota ? 'HDD' : (d.tran === 'nvme' ? 'NVMe' : 'SSD'),
                size: d.size,
                temp,
                serial: d.serial || null,
            };
        }));

        res.json(disks);
    } catch (err) {
        log.error('[system/disks] Error:', err.message);
        res.status(500).json({ error: 'Failed to read disk list' });
    }
}

async function _getFanModeHandler(req, res) {
    try {
        const data = getData();
        res.json({ mode: data.fanMode || 'balanced' });
    } catch (err) {
        log.error('[system/fan/mode GET] Error:', err.message);
        res.status(500).json({ error: 'Failed to read fan mode' });
    }
}

async function _setFanModeHandler(req, res) {
    const { mode } = req.body;
    const validMode = validateFanMode(mode);
    if (!validMode) {
        return res.status(400).json({ error: 'Invalid fan mode. Must be silent, balanced, or performance' });
    }

    try {
        await withData((data) => {
            data.fanMode = validMode;
            return data;
        });

        // Best-effort: attempt to apply via systemctl fan service if it exists
        try {
            await sudoExec('systemctl', ['restart', 'fan-control']);
        } catch {
            // Fan service not installed — ignore
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[system/fan/mode POST] Error:', err.message);
        res.status(500).json({ error: 'Failed to set fan mode' });
    }
}

async function _dashboardUpdatesHandler(req, res) {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const currentVersion = pkg.version;

        await safeExec('git', ['fetch', '--tags', '--quiet']);
        const { stdout: tagsRaw } = await safeExec('git', ['tag', '-l']);
        const tags = tagsRaw.trim().split('\n').filter(Boolean);

        // Pick the highest semver tag
        const latestVersion = tags
            .filter(t => /^\d+\.\d+\.\d+/.test(t.replace(/^v/, '')))
            .sort((a, b) => {
                const parse = v => v.replace(/^v/, '').split('.').map(Number);
                const [am, an, ap] = parse(a);
                const [bm, bn, bp] = parse(b);
                return bm - am || bn - an || bp - ap;
            })[0] || currentVersion;

        const hasUpdate = latestVersion !== currentVersion &&
            latestVersion.replace(/^v/, '') !== currentVersion.replace(/^v/, '');

        res.json({ hasUpdate, latestVersion, currentVersion });
    } catch (err) {
        log.error('[system/dashboard-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
}

async function _applyDashboardUpdateHandler(req, res) {
    try {
        await safeExec('git', ['pull']);
        await safeExec('npm', ['install', '--omit=dev']);
        await sudoExec('systemctl', ['restart', 'homepinas']);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/apply-dashboard-update] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply update' });
    }
}

async function _osUpdatesHandler(req, res) {
    try {
        const { stdout } = await sudoExec('apt-get', ['-s', 'upgrade']);
        // apt-get -s outputs lines like: "Inst package [oldver] (newver ...)"
        const lines = stdout.split('\n');
        const upgradable = lines.filter(l => l.startsWith('Inst '));
        res.json({
            hasUpdate: upgradable.length > 0,
            updateCount: upgradable.length,
        });
    } catch (err) {
        log.error('[system/os-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to check OS updates' });
    }
}

async function _applyOsUpdatesHandler(req, res) {
    try {
        await sudoExec('apt-get', ['-y', 'upgrade']);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/apply-os-updates] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply OS updates' });
    }
}

async function _actionHandler(req, res) {
    const { action } = req.body;
    if (!validateSystemAction(action)) {
        return res.status(400).json({ error: 'Invalid action. Must be reboot or shutdown' });
    }

    res.json({ success: true });

    setTimeout(async () => {
        try {
            const sysctlArg = action === 'reboot' ? 'reboot' : 'poweroff';
            await sudoExec('systemctl', [sysctlArg]);
        } catch (err) {
            log.error(`[system/action] Failed to ${action}:`, err.message);
        }
    }, 1000);
}

async function _factoryResetHandler(req, res) {
    try {
        await withData((data) => {
            // Wipe all state — replace with empty object
            Object.keys(data).forEach(k => delete data[k]);
            return data;
        });
        log.info('[system/factory-reset] Data reset by', req.user?.username);
        res.json({ success: true });
    } catch (err) {
        log.error('[system/factory-reset] Error:', err.message);
        res.status(500).json({ error: 'Failed to perform factory reset' });
    }
}

// ─── Route Registrations ──────────────────────────────────────────────────────

router.get('/stats',                requireAuth, _statsHandler);
router.get('/disks',                requireAuth, _disksHandler);
router.get('/fan/mode',             requireAuth, _getFanModeHandler);
router.post('/fan/mode',            requireAuth, requirePermission('write'), _setFanModeHandler);
router.post('/fan',                 requireAuth, requirePermission('write'), _setFanModeHandler);
router.get('/dashboard-updates',    requireAuth, _dashboardUpdatesHandler);
router.post('/apply-dashboard-update', requireAuth, requirePermission('admin'), _applyDashboardUpdateHandler);
router.get('/os-updates',           requireAuth, _osUpdatesHandler);
router.post('/apply-os-updates',    requireAuth, requirePermission('admin'), _applyOsUpdatesHandler);
router.post('/action',              requireAuth, requirePermission('admin'), _actionHandler);
router.post('/factory-reset',       requireAuth, requirePermission('admin'), _factoryResetHandler);

module.exports = router;
module.exports._statsHandler            = _statsHandler;
module.exports._disksHandler            = _disksHandler;
module.exports._getFanModeHandler       = _getFanModeHandler;
module.exports._setFanModeHandler       = _setFanModeHandler;
module.exports._dashboardUpdatesHandler = _dashboardUpdatesHandler;
module.exports._applyDashboardUpdateHandler = _applyDashboardUpdateHandler;
module.exports._osUpdatesHandler        = _osUpdatesHandler;
module.exports._applyOsUpdatesHandler   = _applyOsUpdatesHandler;
module.exports._actionHandler           = _actionHandler;
module.exports._factoryResetHandler     = _factoryResetHandler;
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
npx vitest run backend/tests/system.test.js --reporter=verbose
```

Expected output:
```
 PASS  backend/tests/system.test.js
  system route — /stats
    ✓ returns cpuLoad as percentage
    ✓ returns ramUsed as percentage
    ✓ returns cpuTemp from thermal zone
    ✓ returns cpuTemp as null when thermal zone unavailable
    ✓ returns hostname and uptime
    ✓ returns cached publicIP from data
    ✓ returns 200 even when one metric throws
  system route — fan mode
    ✓ GET /fan/mode returns current mode from data
    ✓ POST /fan/mode saves valid mode
    ✓ POST /fan/mode rejects invalid mode
  system route — factory-reset
    ✓ clears data.json on factory reset
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/system.js backend/tests/system.test.js
git commit -m "feat: implement system route (stats, disks, fan, updates, action, factory-reset)"
```

---

## Task 3: `backend/routes/power.js` — write the failing tests first

**Files:**
- Create: `backend/tests/power.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/power.test.js`:

```js
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
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run backend/tests/power.test.js --reporter=verbose
```

Expected: FAIL — `Cannot find module '../routes/power.js'`

---

## Task 4: `backend/routes/power.js` — implement

**Files:**
- Create: `backend/routes/power.js`

- [ ] **Step 1: Create the file**

Create `backend/routes/power.js`:

```js
/**
 * HomePiNAS - Power Routes
 * Mounted at /api/power
 * All routes require auth + admin permission.
 */

'use strict';

const router = require('express').Router();
const { sudoExec } = require('../security');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Fire-and-forget power command after a 1-second delay.
 * The delay gives Express time to flush the response before the process ends.
 */
function schedulePowerCommand(sysctlArg) {
    setTimeout(async () => {
        try {
            await sudoExec('systemctl', [sysctlArg]);
        } catch (err) {
            log.error(`[power] systemctl ${sysctlArg} failed:`, err.message);
        }
    }, 1000);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function _rebootHandler(req, res) {
    log.info('[power] Reboot requested by', req.user?.username);
    res.json({ success: true });
    schedulePowerCommand('reboot');
}

async function _shutdownHandler(req, res) {
    log.info('[power] Shutdown requested by', req.user?.username);
    res.json({ success: true });
    schedulePowerCommand('poweroff');
}

async function _actionHandler(req, res) {
    const { action } = req.params;

    if (action === 'reboot') {
        log.info('[power/:action] Reboot via generic action by', req.user?.username);
        res.json({ success: true });
        schedulePowerCommand('reboot');
        return;
    }

    if (action === 'shutdown' || action === 'poweroff') {
        log.info('[power/:action] Shutdown via generic action by', req.user?.username);
        res.json({ success: true });
        schedulePowerCommand('poweroff');
        return;
    }

    return res.status(400).json({ error: `Unknown power action: ${action}. Use reboot or shutdown.` });
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.post('/reboot',   requireAuth, requirePermission('admin'), _rebootHandler);
router.post('/shutdown', requireAuth, requirePermission('admin'), _shutdownHandler);
router.post('/:action',  requireAuth, requirePermission('admin'), _actionHandler);

module.exports = router;
module.exports._rebootHandler   = _rebootHandler;
module.exports._shutdownHandler = _shutdownHandler;
module.exports._actionHandler   = _actionHandler;
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
npx vitest run backend/tests/power.test.js --reporter=verbose
```

Expected output:
```
 PASS  backend/tests/power.test.js
  power route
    ✓ POST /reboot responds with success immediately
    ✓ POST /reboot calls systemctl reboot after 1s delay
    ✓ POST /shutdown responds with success immediately
    ✓ POST /shutdown calls systemctl poweroff after 1s delay
    ✓ POST /:action with "reboot" calls reboot
    ✓ POST /:action with "shutdown" normalises to poweroff
    ✓ POST /:action with "poweroff" normalises to poweroff
    ✓ POST /:action with unknown action returns 400
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/power.js backend/tests/power.test.js
git commit -m "feat: implement power route (reboot, shutdown, generic action)"
```

---

## Task 5: `backend/routes/update.js` — write the failing tests first

**Files:**
- Create: `backend/tests/update.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/update.test.js`:

```js
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

// Stub process.cwd() to return a predictable path with a mock package.json
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
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run backend/tests/update.test.js --reporter=verbose
```

Expected: FAIL — `Cannot find module '../routes/update.js'`

---

## Task 6: `backend/routes/update.js` — implement

**Files:**
- Create: `backend/routes/update.js`

- [ ] **Step 1: Create the file**

Create `backend/routes/update.js`:

```js
/**
 * HomePiNAS - Update Routes
 * Mounted at /api/update
 */

'use strict';

const router = require('express').Router();
const fs = require('fs');
const path = require('path');

const { safeExec, sudoExec } = require('../security');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Parse semver string into [major, minor, patch] numbers.
 * Strips a leading 'v' prefix.
 */
function parseSemver(v) {
    return v.replace(/^v/, '').split('.').map(Number);
}

/**
 * Compare two semver strings. Returns positive if a > b.
 */
function compareSemver(a, b) {
    const [am, an, ap] = parseSemver(a);
    const [bm, bn, bp] = parseSemver(b);
    return (am - bm) || (an - bn) || (ap - bp);
}

/**
 * Return the highest semver tag from a newline-separated list.
 * Falls back to fallback if no valid tags found.
 */
function pickLatestTag(tagsRaw, fallback) {
    const tags = tagsRaw.trim().split('\n')
        .filter(t => /^\d+\.\d+\.\d+/.test(t.replace(/^v/, '')));
    if (tags.length === 0) return fallback;
    return tags.sort((a, b) => compareSemver(b, a))[0]; // descending
}

/**
 * Parse `apt-get -s upgrade` output into a package list.
 * Returns { packages: string[], securityUpdates: number }
 */
function parseAptOutput(stdout) {
    const lines = stdout.split('\n').filter(l => l.startsWith('Inst '));
    const packages = lines.map(l => {
        // "Inst pkgname [oldver] (newver repo [arch])"
        const match = l.match(/^Inst (\S+)/);
        return match ? match[1] : null;
    }).filter(Boolean);

    const securityUpdates = lines.filter(l =>
        l.includes('security.ubuntu.com') || l.includes('debian.org/security')
    ).length;

    return { packages, securityUpdates };
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function _checkHandler(req, res) {
    try {
        const pkgPath = path.join(process.cwd(), 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const currentVersion = pkg.version;

        await safeExec('git', ['fetch', '--tags', '--quiet']);
        const { stdout: tagsRaw } = await safeExec('git', ['tag', '-l']);
        const latestVersion = pickLatestTag(tagsRaw, currentVersion);

        const updateAvailable = compareSemver(latestVersion, currentVersion) > 0;

        const { stdout: statusRaw } = await safeExec('git', ['status', '--porcelain']);
        const localChangesFiles = statusRaw.trim()
            .split('\n')
            .filter(Boolean)
            .map(l => l.slice(3).trim());     // strip the XY status prefix
        const localChanges = localChangesFiles.length > 0;

        let changelog = '';
        if (updateAvailable) {
            try {
                const { stdout: logRaw } = await safeExec('git', [
                    'log', '--oneline', `${currentVersion}..${latestVersion}`
                ]);
                changelog = logRaw.trim();
            } catch {
                // Git log can fail if tags don't exist locally — not fatal
            }
        }

        res.json({
            updateAvailable,
            currentVersion,
            latestVersion,
            changelog,
            localChanges,
            localChangesFiles,
        });
    } catch (err) {
        log.error('[update/check] Error:', err.message);
        res.status(500).json({ error: 'Failed to check for updates' });
    }
}

async function _applyHandler(req, res) {
    try {
        await safeExec('git', ['pull']);
        await safeExec('npm', ['install', '--omit=dev']);
        await sudoExec('systemctl', ['restart', 'homepinas']);
        res.json({ success: true, message: 'Update applied. Service restarting.' });
    } catch (err) {
        log.error('[update/apply] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply update: ' + err.message });
    }
}

async function _checkOsHandler(req, res) {
    try {
        const { stdout } = await sudoExec('apt-get', ['--dry-run', '-s', 'upgrade']);
        const { packages, securityUpdates } = parseAptOutput(stdout);
        res.json({
            updatesAvailable: packages.length > 0,
            securityUpdates,
            packages,
        });
    } catch (err) {
        log.error('[update/check-os] Error:', err.message);
        res.status(500).json({ error: 'Failed to check OS updates' });
    }
}

async function _applyOsHandler(req, res) {
    try {
        await sudoExec('apt-get', ['-y', '--no-install-recommends', 'upgrade']);
        res.json({ success: true });
    } catch (err) {
        log.error('[update/apply-os] Error:', err.message);
        res.status(500).json({ error: 'Failed to apply OS updates: ' + err.message });
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/check',      requireAuth, _checkHandler);
router.post('/apply',     requireAuth, requirePermission('admin'), _applyHandler);
router.get('/check-os',   requireAuth, _checkOsHandler);
router.post('/apply-os',  requireAuth, requirePermission('admin'), _applyOsHandler);

module.exports = router;
module.exports._checkHandler    = _checkHandler;
module.exports._applyHandler    = _applyHandler;
module.exports._checkOsHandler  = _checkOsHandler;
module.exports._applyOsHandler  = _applyOsHandler;
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
npx vitest run backend/tests/update.test.js --reporter=verbose
```

Expected output:
```
 PASS  backend/tests/update.test.js
  update route — /check
    ✓ returns currentVersion from package.json
    ✓ returns latestVersion as highest semver tag
    ✓ sets updateAvailable true when latest > current
    ✓ sets updateAvailable false when already on latest
    ✓ sets localChanges true when git status is non-empty
    ✓ returns 500 when git fails completely
  update route — /check-os
    ✓ returns package count from apt-get dry run
    ✓ identifies security updates by origin URL
    ✓ returns updatesAvailable false when no packages
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/update.js backend/tests/update.test.js
git commit -m "feat: implement update route (check, apply, check-os, apply-os)"
```

---

## Task 7: `backend/routes/network.js` — write the failing tests first

**Files:**
- Create: `backend/tests/network.test.js`

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/network.test.js`:

```js
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

// Mock node-fetch / global fetch for public-ip tests
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

// Sample `ip -j addr show` output (two interfaces)
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
            publicIpCachedAt: Date.now() - 60000, // 1 min ago — within 10-min TTL
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
            publicIpCachedAt: Date.now() - 700000, // > 10 min ago
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
```

- [ ] **Step 2: Run tests and confirm they fail**

```bash
npx vitest run backend/tests/network.test.js --reporter=verbose
```

Expected: FAIL — `Cannot find module '../routes/network.js'`

---

## Task 8: `backend/routes/network.js` — implement

**Files:**
- Create: `backend/routes/network.js`

- [ ] **Step 1: Create the file**

Create `backend/routes/network.js`:

```js
/**
 * HomePiNAS - Network Routes
 * Mounted at /api/network
 */

'use strict';

const router = require('express').Router();
const fs = require('fs');

const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { validateInterfaceName, validateIPv4, validateSubnetMask } = require('../sanitize');
const log = require('../logger');

// Public IP cache TTL: 10 minutes
const PUBLIC_IP_TTL_MS = 10 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert a CIDR prefix length (e.g. 24) into a dotted subnet mask (255.255.255.0).
 */
function prefixToSubnet(prefixlen) {
    const mask = prefixlen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixlen)) >>> 0;
    return [
        (mask >>> 24) & 0xFF,
        (mask >>> 16) & 0xFF,
        (mask >>> 8) & 0xFF,
        mask & 0xFF,
    ].join('.');
}

/**
 * Determine if an interface uses DHCP by checking:
 *   1. /var/lib/dhcp/dhclient.{iface}.leases  (ISC dhclient lease file)
 *   2. /etc/network/interfaces                (Debian-style config)
 */
function detectDhcp(ifname) {
    try {
        if (fs.existsSync(`/var/lib/dhcp/dhclient.${ifname}.leases`)) return true;
    } catch { /* ignore */ }

    try {
        const content = fs.readFileSync('/etc/network/interfaces', 'utf8');
        const lines = content.split('\n');
        let inIface = false;
        for (const line of lines) {
            if (line.trim().startsWith(`iface ${ifname}`)) { inIface = true; continue; }
            if (inIface && line.trim().startsWith('iface ')) break;
            if (inIface && line.includes('dhcp')) return true;
        }
    } catch { /* ignore */ }

    return false;
}

/**
 * Build an interface record from a single entry in `ip -j addr` output.
 */
function parseIpAddrEntry(entry) {
    const isUp = (entry.flags || []).includes('UP') && (entry.flags || []).includes('LOWER_UP');
    const inet = (entry.addr_info || []).find(a => a.family === 'inet');

    return {
        id: entry.ifname,
        name: entry.ifname,
        status: isUp ? 'connected' : 'disconnected',
        dhcp: detectDhcp(entry.ifname),
        ip: inet ? inet.local : null,
        subnet: inet ? prefixToSubnet(inet.prefixlen) : null,
        gateway: null,   // ip addr doesn't expose gw; would need `ip route`
        dns: null,       // would need /etc/resolv.conf
    };
}

/**
 * Build the stanza to write into /etc/network/interfaces.d/{iface}.
 */
function buildInterfacesStanza(id, dhcp, ip, subnet, gateway, dns) {
    if (dhcp) {
        return `auto ${id}\niface ${id} inet dhcp\n`;
    }
    let stanza = `auto ${id}\niface ${id} inet static\n`;
    stanza += `    address ${ip}\n`;
    stanza += `    netmask ${subnet}\n`;
    if (gateway) stanza += `    gateway ${gateway}\n`;
    if (dns) stanza += `    dns-nameservers ${dns}\n`;
    return stanza;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

async function _interfacesHandler(req, res) {
    try {
        const { stdout } = await safeExec('ip', ['-j', 'addr', 'show']);
        const entries = JSON.parse(stdout);
        const interfaces = entries
            .filter(e => e.ifname !== 'lo' && !e.ifname.startsWith('lo:'))
            .map(parseIpAddrEntry);
        res.json(interfaces);
    } catch (err) {
        log.error('[network/interfaces] Error:', err.message);
        res.status(500).json({ error: 'Failed to list network interfaces' });
    }
}

async function _configureHandler(req, res) {
    const { id, dhcp, ip, subnet, gateway, dns } = req.body;

    // Validate interface name
    if (!validateInterfaceName(id)) {
        return res.status(400).json({ error: 'Invalid interface name' });
    }

    if (!dhcp) {
        // Static config requires ip + subnet
        if (!ip || !validateIPv4(ip)) {
            return res.status(400).json({ error: 'Invalid or missing IP address' });
        }
        if (!subnet || !validateSubnetMask(subnet)) {
            return res.status(400).json({ error: 'Invalid or missing subnet mask' });
        }
        if (gateway && !validateIPv4(gateway)) {
            return res.status(400).json({ error: 'Invalid gateway address' });
        }
        if (dns && !validateIPv4(dns)) {
            return res.status(400).json({ error: 'Invalid DNS address' });
        }
    }

    try {
        const stanza = buildInterfacesStanza(id, dhcp, ip, subnet, gateway, dns);
        const destFile = `/etc/network/interfaces.d/${id}`;

        // Write config file via sudo tee (stdin)
        await sudoExec('tee', [destFile], { input: stanza });

        // Bring interface up
        await sudoExec('ip', ['link', 'set', id, 'up']);

        log.info(`[network/configure] Interface ${id} configured by ${req.user?.username}`);
        res.json({ success: true, message: `Interface ${id} configured` });
    } catch (err) {
        log.error('[network/configure] Error:', err.message);
        res.status(500).json({ error: 'Failed to configure interface: ' + err.message });
    }
}

async function _publicIpHandler(req, res) {
    try {
        const data = getData();
        const cachedAt = data.publicIpCachedAt || 0;
        const age = Date.now() - cachedAt;

        // Return cached value if still fresh
        if (data.publicIp && age < PUBLIC_IP_TTL_MS) {
            return res.json({ ip: data.publicIp });
        }

        // Fetch fresh IP
        const response = await fetch('https://api.ipify.org?format=json');
        if (!response.ok) throw new Error(`ipify returned ${response.status}`);
        const json = await response.json();
        const freshIp = json.ip;

        // Cache in data.json
        await withData((d) => {
            d.publicIp = freshIp;
            d.publicIpCachedAt = Date.now();
            return d;
        });

        res.json({ ip: freshIp });
    } catch (err) {
        log.error('[network/public-ip] Error:', err.message);

        // Try returning stale cache rather than nothing
        const data = getData();
        if (data.publicIp) {
            return res.json({ ip: data.publicIp });
        }

        res.status(502).json({ error: 'Failed to determine public IP' });
    }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

router.get('/interfaces',  requireAuth, _interfacesHandler);
router.post('/configure',  requireAuth, requirePermission('admin'), _configureHandler);
router.get('/public-ip',   requireAuth, _publicIpHandler);

module.exports = router;
module.exports._interfacesHandler = _interfacesHandler;
module.exports._configureHandler  = _configureHandler;
module.exports._publicIpHandler   = _publicIpHandler;
```

- [ ] **Step 2: Run tests — expect them to pass**

```bash
npx vitest run backend/tests/network.test.js --reporter=verbose
```

Expected output:
```
 PASS  backend/tests/network.test.js
  network route — /interfaces
    ✓ returns an array of interfaces excluding loopback
    ✓ includes eth0 with correct IP and subnet
    ✓ marks disconnected interface correctly
    ✓ converts /24 prefix to 255.255.255.0
    ✓ returns 500 when ip command fails
  network route — /configure
    ✓ rejects invalid interface name
    ✓ rejects invalid static IP
    ✓ rejects static config without subnet
    ✓ accepts DHCP config and calls tee + ip link set
    ✓ accepts static config with valid IPs
  network route — /public-ip
    ✓ fetches public IP from ipify when cache is empty
    ✓ returns cached IP when cache is fresh
    ✓ re-fetches when cache is stale (> 10 min)
    ✓ returns 502 when fetch fails and no cache
```

- [ ] **Step 3: Commit**

```bash
git add backend/routes/network.js backend/tests/network.test.js
git commit -m "feat: implement network route (interfaces, configure, public-ip)"
```

---

## Task 9: Full test suite smoke-check

- [ ] **Step 1: Run all four test files together**

```bash
npx vitest run backend/tests/system.test.js backend/tests/power.test.js backend/tests/update.test.js backend/tests/network.test.js --reporter=verbose
```

Expected: all tests pass, no failures.

- [ ] **Step 2: TypeScript check still passes**

```bash
npx tsc --noEmit -p backend/tsconfig.json
```

Expected: no errors (the `.js` route files are not checked by tsc, only the `.ts` files).

- [ ] **Step 3: Final commit**

```bash
git add backend/routes/system.js backend/routes/power.js backend/routes/update.js backend/routes/network.js \
        backend/tests/system.test.js backend/tests/power.test.js backend/tests/update.test.js backend/tests/network.test.js \
        backend/security.ts
git commit -m "feat: phase 2 routes complete — system, power, update, network"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task that covers it |
|---|---|
| `GET /api/system/stats` — CPU load, RAM, temp, uptime, hostname, publicIP | Task 2, `_statsHandler` |
| `GET /api/dashboard` (alias for stats) | Task 2, router line `router.get('/stats', ...)` — note: `/api/dashboard` is a separate mount point not in this route file. If `routes.ts` needs it, add `app.get('/api/dashboard', requireAuth, _statsHandler)` directly in `routes.ts`. |
| `GET /api/system/disks` | Task 2, `_disksHandler` |
| `GET/POST /api/system/fan/mode` + `POST /api/system/fan` | Task 2 |
| `GET /api/system/dashboard-updates`, `POST /api/system/apply-dashboard-update` | Task 2 |
| `GET /api/system/os-updates`, `POST /api/system/apply-os-updates` | Task 2 |
| `POST /api/system/action` | Task 2 |
| `POST /api/system/factory-reset` | Task 2 |
| `POST /api/power/reboot`, `POST /api/power/shutdown` | Task 4 |
| `POST /api/power/:action` | Task 4 |
| `GET /api/update/check` | Task 6 |
| `POST /api/update/apply` | Task 6 |
| `GET /api/update/check-os` | Task 6 |
| `POST /api/update/apply-os` | Task 6 |
| `GET /api/network/interfaces` | Task 8 |
| `POST /api/network/configure` | Task 8 |
| `GET /api/network/public-ip` | Task 8 |
| `safeExec` allowlist additions (git, npm) | Task 0 |
| `sudoExec` allowlist addition (ip) | Task 0 |

**Gap found — `/api/dashboard` alias:** The spec says `GET /api/dashboard` returns the same payload as `/api/system/stats`. This route is mounted at root `/api` in `routes.ts`, not under `/api/system`. The `system.js` router handles `/api/system/*`. The fix: in `routes.ts`, add one line after the existing `app.use('/api/system', systemRoutes)`:

```ts
app.get('/api/dashboard', requireAuth, (req, res) => {
    // Delegate to system stats
    req.url = '/stats';
    systemRoutes(req, res, () => res.status(404).json({ error: 'not found' }));
});
```

Or, simpler: export `_statsHandler` from `system.js` (already done) and import it in `routes.ts`:

```ts
const { _statsHandler } = require('./routes/system');
app.get('/api/dashboard', requireAuth, _statsHandler);
```

Add this to `routes.ts` after the `app.use('/api/system', systemRoutes)` line.

**Placeholder scan:** No TBDs, todos, or "similar to" references found.

**Type consistency:** All handler names are consistent across test mocks (`mod._statsHandler`, etc.) and the `module.exports` assignments.
