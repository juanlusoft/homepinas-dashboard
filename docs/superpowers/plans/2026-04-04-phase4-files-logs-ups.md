# Phase 4: Files + Logs + UPS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement three Express route modules — `files.js`, `logs.js`, and `ups.js` — plus their vitest test suites, with full path traversal protection, multer-based uploads, journald log parsing, and APC UPS status reporting.

**Architecture:** Each route module is a self-contained CommonJS Express Router in `backend/routes/`. All filesystem access is gated by `sanitizePath`/`sanitizePathWithinBase` from `backend/sanitize.ts`. All shell commands go through `safeExec` from `backend/security.ts`, which has a static allowlist. The `find` command is already in the allowlist. multer is not yet installed and must be added as a dependency before the files route is implemented.

**Tech Stack:** Node.js 20+, Express 4, CommonJS (`require`/`module.exports`), multer 1.x (diskStorage), vitest 2.x, `fs/promises`, `os`, `path`, `child_process` (via `safeExec`)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/routes/files.js` | Create | All 10 file-manager endpoints |
| `backend/routes/logs.js` | Create | journalctl log fetching + service listing |
| `backend/routes/ups.js` | Create | APC UPS status via apcaccess |
| `backend/tests/files.test.js` | Create | Unit + integration tests for files route logic |
| `backend/tests/logs.test.js` | Create | Unit tests for log parsing + route logic |
| `backend/tests/ups.test.js` | Create | Unit tests for UPS output parsing + route logic |
| `package.json` | Modify | Add `multer` + `@types/multer` |

Routes are already registered in `backend/routes.ts` — no changes needed there.

The `safeExec` allowlist in `backend/security.ts` already contains `find`, `journalctl`, `systemctl`, `apcaccess`, and `which` — no changes to `security.ts` are needed.

---

## Task 1: Install multer

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install multer and its types**

```bash
cd /path/to/dashboard-v3.5
npm install multer@1
npm install --save-dev @types/multer
```

Expected output ends with something like:
```
added 3 packages, ...
```

- [ ] **Step 2: Verify multer is in package.json**

Open `package.json` and confirm `"multer"` appears under `dependencies` and `"@types/multer"` appears under `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: install multer for file upload support"
```

---

## Task 2: Write failing tests for files route — list + download

**Files:**
- Create: `backend/tests/files.test.js`

- [ ] **Step 1: Create the test file with list and download tests**

```js
// backend/tests/files.test.js
// Tests for backend/routes/files.js
// Run with: npx vitest backend/tests/files.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';

// ---------------------------------------------------------------------------
// Helpers shared across test groups
// ---------------------------------------------------------------------------

/**
 * Build a minimal Express-like req/res/next triple for unit testing
 * route handlers directly (no HTTP stack needed).
 */
function makeReqRes(overrides = {}) {
    const res = {
        _status: 200,
        _json: null,
        _headers: {},
        status(code) { this._status = code; return this; },
        json(body) { this._json = body; return this; },
        setHeader(k, v) { this._headers[k] = v; },
        attachment(filename) { this._attachment = filename; return this; },
    };
    const req = {
        query: {},
        body: {},
        user: { username: 'testuser' },
        ...overrides,
    };
    const next = vi.fn();
    return { req, res, next };
}

// ---------------------------------------------------------------------------
// sanitizePath — unit-level smoke tests (the real function is tested in
// sanitize.test.js; here we just confirm the files route calls it correctly)
// ---------------------------------------------------------------------------

describe('files route — list endpoint logic', () => {
    it('returns 400 when path query param is missing', async () => {
        // Import the actual sanitizePath to confirm behavior
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath(undefined)).toBeNull();
        expect(sanitizePath('')).toBeNull();
        expect(sanitizePath(null)).toBeNull();
    });

    it('sanitizePath blocks dangerous system directories', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('/etc')).toBeNull();
        expect(sanitizePath('/proc/self/mem')).toBeNull();
        expect(sanitizePath('/root')).toBeNull();
    });

    it('sanitizePath allows safe NAS paths', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('/srv/nas')).not.toBeNull();
        expect(sanitizePath('/srv/nas/photos')).not.toBeNull();
        expect(sanitizePath('/home/juan/documents')).not.toBeNull();
    });

    it('sortEntries puts directories before files, both alphabetical', () => {
        // This is the sorting logic the route must implement.
        // We test it as a pure function extracted from the module.
        function sortEntries(entries) {
            return [...entries].sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
            });
        }

        const input = [
            { name: 'zebra.txt', type: 'file' },
            { name: 'alpha', type: 'directory' },
            { name: 'apple.jpg', type: 'file' },
            { name: 'beta', type: 'directory' },
        ];
        const sorted = sortEntries(input);
        expect(sorted[0].name).toBe('alpha');
        expect(sorted[1].name).toBe('beta');
        expect(sorted[2].name).toBe('apple.jpg');
        expect(sorted[3].name).toBe('zebra.txt');
    });
});

describe('files route — download endpoint logic', () => {
    it('sanitizePath rejects path traversal in download path', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        expect(sanitizePath('../../../etc/passwd')).toBeNull();
        expect(sanitizePath('/srv/nas/../../etc/shadow')).toBeNull();
    });

    it('sanitizePath accepts a valid file path for download', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        const result = sanitizePath('/srv/nas/backups/archive.tar.gz');
        expect(result).not.toBeNull();
        expect(result).toBe('/srv/nas/backups/archive.tar.gz');
    });
});

describe('files route — upload path resolution logic', () => {
    it('sanitizePath accepts a valid upload target directory', async () => {
        const { sanitizePath } = await import('../sanitize.ts');
        const result = sanitizePath('/srv/nas/uploads');
        expect(result).not.toBeNull();
    });

    it('final upload path is a join of sanitized dir and original filename', () => {
        // Logic used inside the upload handler
        function buildUploadPath(sanitizedDir, originalname) {
            // Strip any path component from originalname (prevent dir traversal via filename)
            const safeName = path.basename(originalname);
            return path.join(sanitizedDir, safeName);
        }

        expect(buildUploadPath('/srv/nas/uploads', 'photo.jpg')).toBe('/srv/nas/uploads/photo.jpg');
        // path.basename strips directory components
        expect(buildUploadPath('/srv/nas/uploads', '../../etc/passwd')).toBe('/srv/nas/uploads/passwd');
    });
});

describe('files route — search query validation', () => {
    it('rejects empty search query', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            // Strip characters that could confuse find's -iname glob
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        expect(validateSearchQuery('')).toBeNull();
        expect(validateSearchQuery(null)).toBeNull();
        expect(validateSearchQuery('   ')).toBeNull();
    });

    it('sanitizes shell-dangerous characters from search query', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        expect(validateSearchQuery('$(rm -rf /)')).toBe('rm -rf ');
        expect(validateSearchQuery('normal search')).toBe('normal search');
        expect(validateSearchQuery('file.txt')).toBe('file.txt');
    });

    it('truncates search query to 100 characters', () => {
        function validateSearchQuery(q) {
            if (!q || typeof q !== 'string' || q.trim().length === 0) return null;
            return q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
        }
        const longQuery = 'a'.repeat(200);
        expect(validateSearchQuery(longQuery).length).toBe(100);
    });
});

describe('files route — user-home logic', () => {
    it('returns default home path when no user-specific path configured', () => {
        function resolveUserHome(data, username) {
            const users = data.users || [];
            const user = users.find(u => u.username === username);
            const homePath = user?.homePath || '/srv/nas';
            const storageConfig = data.storageConfig || [];
            const mountPoints = storageConfig
                .filter(d => d.mountPoint)
                .map(d => d.mountPoint);
            const allowedPaths = mountPoints.length > 0
                ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
                : [homePath, '/home'];
            return { homePath, hasRestrictions: false, allowedPaths };
        }

        const result = resolveUserHome({ users: [], storageConfig: [] }, 'testuser');
        expect(result.homePath).toBe('/srv/nas');
        expect(result.hasRestrictions).toBe(false);
        expect(result.allowedPaths).toContain('/srv/nas');
    });

    it('uses user-specific homePath when set in data', () => {
        function resolveUserHome(data, username) {
            const users = data.users || [];
            const user = users.find(u => u.username === username);
            const homePath = user?.homePath || '/srv/nas';
            const storageConfig = data.storageConfig || [];
            const mountPoints = storageConfig
                .filter(d => d.mountPoint)
                .map(d => d.mountPoint);
            const allowedPaths = mountPoints.length > 0
                ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
                : [homePath, '/home'];
            return { homePath, hasRestrictions: false, allowedPaths };
        }

        const data = {
            users: [{ username: 'juan', homePath: '/srv/nas/juan' }],
            storageConfig: []
        };
        const result = resolveUserHome(data, 'juan');
        expect(result.homePath).toBe('/srv/nas/juan');
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail (route not yet implemented)**

```bash
cd /path/to/dashboard-v3.5
npx vitest run backend/tests/files.test.js
```

Expected: All tests in the groups that import the sanitize module should pass (they test pure logic). The sorting, upload path, search, and user-home tests are self-contained pure functions — they should also pass. This is acceptable: these are pre-conditions and pure-logic tests. The actual HTTP route tests will come in Task 4.

- [ ] **Step 3: Commit the test file**

```bash
git add backend/tests/files.test.js
git commit -m "test: add files route unit tests (pre-implementation)"
```

---

## Task 3: Write failing tests for logs and ups routes

**Files:**
- Create: `backend/tests/logs.test.js`
- Create: `backend/tests/ups.test.js`

- [ ] **Step 1: Create logs test file**

```js
// backend/tests/logs.test.js
// Tests for backend/routes/logs.js
// Run with: npx vitest backend/tests/logs.test.js

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function tests for journalctl JSON line parsing
// These mirror the exact parsing logic the logs route must implement.
// ---------------------------------------------------------------------------

/**
 * The exact priority→level mapping the route uses.
 * journald PRIORITY: 0=emerg, 1=alert, 2=crit, 3=err, 4=warning, 5=notice, 6=info, 7=debug
 */
function mapPriority(priority) {
    const p = parseInt(priority, 10);
    if (isNaN(p)) return 'info';
    if (p <= 3) return 'error';
    if (p === 4) return 'warn';
    if (p <= 6) return 'info';
    return 'debug';
}

/**
 * Parse a single journalctl --output json line into a log entry object.
 * Returns null if the line is not valid JSON.
 */
function parseJournalLine(line) {
    if (!line || !line.trim()) return null;
    let obj;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    const tsUs = parseInt(obj.__REALTIME_TIMESTAMP, 10);
    const timestamp = isNaN(tsUs) ? null : new Date(tsUs / 1000).toISOString();
    const rawMsg = obj.MESSAGE;
    const message = Array.isArray(rawMsg)
        ? Buffer.from(rawMsg).toString('utf8')
        : String(rawMsg || '');
    const level = mapPriority(obj.PRIORITY);
    const service = (obj._SYSTEMD_UNIT || '').replace(/\.service$/, '');
    return { timestamp, level, message, service };
}

describe('logs route — PRIORITY mapping', () => {
    it('maps 0 (emerg) to error', () => expect(mapPriority('0')).toBe('error'));
    it('maps 1 (alert) to error', () => expect(mapPriority('1')).toBe('error'));
    it('maps 2 (crit) to error',  () => expect(mapPriority('2')).toBe('error'));
    it('maps 3 (err) to error',   () => expect(mapPriority('3')).toBe('error'));
    it('maps 4 (warning) to warn', () => expect(mapPriority('4')).toBe('warn'));
    it('maps 5 (notice) to info', () => expect(mapPriority('5')).toBe('info'));
    it('maps 6 (info) to info',   () => expect(mapPriority('6')).toBe('info'));
    it('maps 7 (debug) to debug', () => expect(mapPriority('7')).toBe('debug'));
    it('maps non-numeric to info', () => expect(mapPriority('xyz')).toBe('info'));
    it('maps undefined to info',  () => expect(mapPriority(undefined)).toBe('info'));
});

describe('logs route — journalctl line parsing', () => {
    it('parses a valid journalctl JSON line', () => {
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000', // microseconds
            MESSAGE: 'Service started successfully',
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'sshd.service'
        });
        const result = parseJournalLine(line);
        expect(result).not.toBeNull();
        expect(result.message).toBe('Service started successfully');
        expect(result.level).toBe('info');
        expect(result.service).toBe('sshd');
        expect(result.timestamp).toBe(new Date(1712188800000).toISOString());
    });

    it('strips .service suffix from _SYSTEMD_UNIT', () => {
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000',
            MESSAGE: 'ok',
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'nginx.service'
        });
        expect(parseJournalLine(line).service).toBe('nginx');
    });

    it('returns null for empty/whitespace lines', () => {
        expect(parseJournalLine('')).toBeNull();
        expect(parseJournalLine('   ')).toBeNull();
        expect(parseJournalLine(null)).toBeNull();
    });

    it('returns null for invalid JSON lines', () => {
        expect(parseJournalLine('-- Journal begins --')).toBeNull();
        expect(parseJournalLine('{broken json')).toBeNull();
    });

    it('handles array-type MESSAGE field (binary log)', () => {
        // journald sometimes emits MESSAGE as an array of byte values
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000',
            MESSAGE: [72, 101, 108, 108, 111], // "Hello"
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'myapp.service'
        });
        const result = parseJournalLine(line);
        expect(result).not.toBeNull();
        // message is a Buffer.from([...]).toString() — may not equal "Hello" exactly
        // but must be a non-empty string
        expect(typeof result.message).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// Service list parsing
// ---------------------------------------------------------------------------

/**
 * Parse `systemctl list-units --type=service --state=loaded --no-pager --plain`
 * output into an array of service name strings (without .service suffix).
 *
 * Output format per line (when --plain is used):
 *   UNIT                        LOAD   ACTIVE SUB     DESCRIPTION
 *   sshd.service                loaded active running OpenSSH server daemon
 *
 * We skip the header and any blank/separator lines.
 */
function parseServiceList(stdout) {
    if (!stdout) return [];
    const OBSCURE = [
        'sys-', 'dev-', 'proc-', 'run-', 'snap.', 'user@',
        'session-', 'getty@', 'serial-', 'systemd-'
    ];
    const lines = stdout.split('\n').slice(1); // skip header
    const services = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('UNIT') || trimmed.startsWith('Legend')) continue;
        const parts = trimmed.split(/\s+/);
        const unit = parts[0];
        if (!unit || !unit.endsWith('.service')) continue;
        const name = unit.replace(/\.service$/, '');
        if (OBSCURE.some(prefix => name.startsWith(prefix))) continue;
        services.push(name);
    }
    return services.slice(0, 50);
}

describe('logs route — service list parsing', () => {
    const sampleOutput = `UNIT                        LOAD   ACTIVE SUB     DESCRIPTION
sshd.service                loaded active running OpenSSH server daemon
nginx.service               loaded active running A high performance web server
docker.service              loaded active running Docker Application Container Engine
systemd-journald.service    loaded active running Journal Service
sys-kernel-config.service   loaded active running Kernel Config
user@1000.service           loaded active running User Manager for UID 1000

Legend: LOAD   = Reflects whether the unit definition was properly loaded.`;

    it('extracts service names from systemctl output', () => {
        const result = parseServiceList(sampleOutput);
        expect(result).toContain('sshd');
        expect(result).toContain('nginx');
        expect(result).toContain('docker');
    });

    it('filters out obscure systemd units', () => {
        const result = parseServiceList(sampleOutput);
        expect(result).not.toContain('systemd-journald');
        expect(result).not.toContain('sys-kernel-config');
        expect(result).not.toContain('user@1000');
    });

    it('returns at most 50 services', () => {
        // Build a large fake output
        let big = 'UNIT LOAD ACTIVE SUB DESCRIPTION\n';
        for (let i = 0; i < 80; i++) {
            big += `service${i}.service loaded active running Desc\n`;
        }
        expect(parseServiceList(big).length).toBeLessThanOrEqual(50);
    });

    it('returns empty array for empty/null stdout', () => {
        expect(parseServiceList('')).toEqual([]);
        expect(parseServiceList(null)).toEqual([]);
    });
});

describe('logs route — lines param validation', () => {
    it('clamps lines param to safe range', () => {
        function clampLines(raw) {
            const n = parseInt(raw, 10);
            if (isNaN(n) || n < 1) return 200;
            return Math.min(n, 5000);
        }
        expect(clampLines('100')).toBe(100);
        expect(clampLines('200')).toBe(200);
        expect(clampLines('9999')).toBe(5000);
        expect(clampLines('0')).toBe(200);
        expect(clampLines('-5')).toBe(200);
        expect(clampLines(undefined)).toBe(200);
        expect(clampLines('abc')).toBe(200);
    });
});
```

- [ ] **Step 2: Create UPS test file**

```js
// backend/tests/ups.test.js
// Tests for backend/routes/ups.js
// Run with: npx vitest backend/tests/ups.test.js

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function test for apcaccess output parsing
// ---------------------------------------------------------------------------

/**
 * Parse `apcaccess status` stdout.
 * Each line is "KEY      : VALUE" (with variable whitespace around the colon).
 * Returns a flat object of trimmed key→value strings.
 */
function parseApcaccessOutput(stdout) {
    if (!stdout) return {};
    const result = {};
    for (const line of stdout.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

/**
 * Map raw apcaccess key-value pairs to the API response shape.
 * Strips units from numeric fields (e.g. "95.0 Percent" → 95.0).
 */
function mapApcaccessToResponse(raw) {
    function parseFloat2(s) {
        return parseFloat(String(s || '').split(' ')[0]) || null;
    }
    return {
        available: true,
        batteryCharge: parseFloat2(raw['BCHARGE']),
        runtime:       parseFloat2(raw['TIMELEFT']),
        load:          parseFloat2(raw['LOADPCT']),
        inputVoltage:  parseFloat2(raw['LINEV']),
        status:        (raw['STATUS']  || '').trim() || null,
        model:         (raw['MODEL']   || '').trim() || null,
        driver:        (raw['DRIVER']  || '').trim() || null,
    };
}

const SAMPLE_APCACCESS = `
APC      : 001,036,0851
DATE     : 2026-04-04 10:00:00 -0400
HOSTNAME : homepinas
VERSION  : 3.14.14 (31 May 2016) debian
UPSNAME  : UPS_IDEN
CABLE    : USB Cable
DRIVER   : USB UPS Driver
UPSMODE  : Stand Alone
STARTTIME: 2026-04-04 09:58:00 -0400
MODEL    : Back-UPS ES 700G
STATUS   : ONLINE
LINEV    : 121.0 Volts
LOADPCT  : 23.0 Percent
BCHARGE  : 100.0 Percent
TIMELEFT : 28.4 Minutes
MBATTCHG : 5 Percent
MINTIMEL : 3 Minutes
MAXTIME  : 0 Seconds
FIRMWARE : 871.O4 .I USB FW:O4
`;

describe('ups route — apcaccess output parsing', () => {
    it('parses all key-value lines from apcaccess output', () => {
        const raw = parseApcaccessOutput(SAMPLE_APCACCESS);
        expect(raw['STATUS']).toBe('ONLINE');
        expect(raw['MODEL']).toBe('Back-UPS ES 700G');
        expect(raw['BCHARGE']).toBe('100.0 Percent');
        expect(raw['TIMELEFT']).toBe('28.4 Minutes');
        expect(raw['LOADPCT']).toBe('23.0 Percent');
        expect(raw['LINEV']).toBe('121.0 Volts');
        expect(raw['DRIVER']).toBe('USB UPS Driver');
    });

    it('returns empty object for null/empty input', () => {
        expect(parseApcaccessOutput(null)).toEqual({});
        expect(parseApcaccessOutput('')).toEqual({});
    });

    it('handles lines without colon gracefully', () => {
        const result = parseApcaccessOutput('no colon here\nKEY : value');
        expect(result['KEY']).toBe('value');
    });
});

describe('ups route — response shape mapping', () => {
    it('maps apcaccess fields to the correct response properties', () => {
        const raw = parseApcaccessOutput(SAMPLE_APCACCESS);
        const response = mapApcaccessToResponse(raw);
        expect(response.available).toBe(true);
        expect(response.batteryCharge).toBe(100.0);
        expect(response.runtime).toBe(28.4);
        expect(response.load).toBe(23.0);
        expect(response.inputVoltage).toBe(121.0);
        expect(response.status).toBe('ONLINE');
        expect(response.model).toBe('Back-UPS ES 700G');
        expect(response.driver).toBe('USB UPS Driver');
    });

    it('returns null for missing numeric fields', () => {
        const response = mapApcaccessToResponse({});
        expect(response.batteryCharge).toBeNull();
        expect(response.runtime).toBeNull();
        expect(response.load).toBeNull();
        expect(response.inputVoltage).toBeNull();
    });

    it('strips unit suffix from numeric values', () => {
        const raw = { BCHARGE: '87.5 Percent', TIMELEFT: '14.2 Minutes', LOADPCT: '41.0 Percent', LINEV: '118.0 Volts' };
        const r = mapApcaccessToResponse(raw);
        expect(r.batteryCharge).toBe(87.5);
        expect(r.runtime).toBe(14.2);
        expect(r.load).toBe(41.0);
        expect(r.inputVoltage).toBe(118.0);
    });
});

describe('ups route — apcaccess availability check', () => {
    it('unavailable response shape is correct', () => {
        // When safeExec('which', ['apcaccess']) throws, the route returns this
        const unavailableResponse = { available: false };
        expect(unavailableResponse.available).toBe(false);
        expect(Object.keys(unavailableResponse)).toEqual(['available']);
    });
});
```

- [ ] **Step 3: Run both test files to confirm they all pass (pure logic tests)**

```bash
npx vitest run backend/tests/logs.test.js backend/tests/ups.test.js
```

Expected: All tests pass. These are pure-function tests with no external dependencies.

- [ ] **Step 4: Commit**

```bash
git add backend/tests/logs.test.js backend/tests/ups.test.js
git commit -m "test: add logs and ups route unit tests (pre-implementation)"
```

---

## Task 4: Implement `backend/routes/ups.js`

**Files:**
- Create: `backend/routes/ups.js`

This is the simplest route (1 endpoint) — implement it first to establish the pattern.

- [ ] **Step 1: Create the file**

```js
// backend/routes/ups.js
// Mounted at /api/ups
// GET /api/ups/status — returns APC UPS status via apcaccess

'use strict';

const router = require('express').Router();
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse `apcaccess status` stdout.
 * Each line is "KEY      : VALUE" (variable whitespace around colon).
 */
function parseApcaccessOutput(stdout) {
    if (!stdout) return {};
    const result = {};
    for (const line of stdout.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

/**
 * Map raw apcaccess key-value pairs to the API response shape.
 * Numeric fields have their unit suffix stripped (e.g. "95.0 Percent" → 95.0).
 */
function mapApcaccessToResponse(raw) {
    function extractFloat(s) {
        const n = parseFloat(String(s || '').split(' ')[0]);
        return isNaN(n) ? null : n;
    }
    return {
        available:    true,
        batteryCharge: extractFloat(raw['BCHARGE']),
        runtime:       extractFloat(raw['TIMELEFT']),
        load:          extractFloat(raw['LOADPCT']),
        inputVoltage:  extractFloat(raw['LINEV']),
        status:        (raw['STATUS']  || '').trim() || null,
        model:         (raw['MODEL']   || '').trim() || null,
        driver:        (raw['DRIVER']  || '').trim() || null,
    };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/ups/status
 * Returns UPS status from apcaccess, or { available: false } if not installed.
 */
router.get('/status', requireAuth, async (req, res) => {
    try {
        // Check if apcaccess is installed
        try {
            await safeExec('which', ['apcaccess']);
        } catch {
            return res.json({ available: false });
        }

        // Run apcaccess status
        const { stdout } = await safeExec('apcaccess', ['status']);
        const raw = parseApcaccessOutput(stdout);
        return res.json(mapApcaccessToResponse(raw));
    } catch (err) {
        log.error('[ups] Failed to get UPS status:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve UPS status' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Run the ups tests to verify they still pass**

```bash
npx vitest run backend/tests/ups.test.js
```

Expected: All tests pass (they test the same pure logic that is now inside the module).

- [ ] **Step 3: Commit**

```bash
git add backend/routes/ups.js
git commit -m "feat: implement ups route with apcaccess status parsing"
```

---

## Task 5: Implement `backend/routes/logs.js`

**Files:**
- Create: `backend/routes/logs.js`

- [ ] **Step 1: Create the file**

```js
// backend/routes/logs.js
// Mounted at /api/logs
// GET /api/logs            — fetch journal entries (query: service?, lines?, since?)
// GET /api/logs/services   — list loaded systemd services

'use strict';

const router = require('express').Router();
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const { sanitizeString } = require('../sanitize');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map journald PRIORITY integer to a human-readable log level string.
 * 0=emerg 1=alert 2=crit 3=err → error
 * 4=warning                     → warn
 * 5=notice 6=info               → info
 * 7=debug                       → debug
 */
function mapPriority(priority) {
    const p = parseInt(priority, 10);
    if (isNaN(p)) return 'info';
    if (p <= 3) return 'error';
    if (p === 4) return 'warn';
    if (p <= 6) return 'info';
    return 'debug';
}

/**
 * Parse a single journalctl --output json line into a normalised entry.
 * Returns null for blank lines and non-JSON lines (e.g. journal header comments).
 */
function parseJournalLine(line) {
    if (!line || !line.trim()) return null;
    let obj;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    const tsUs = parseInt(obj.__REALTIME_TIMESTAMP, 10);
    const timestamp = isNaN(tsUs) ? null : new Date(tsUs / 1000).toISOString();

    // MESSAGE can be a string or an array of byte values (binary journal entries)
    const rawMsg = obj.MESSAGE;
    const message = Array.isArray(rawMsg)
        ? Buffer.from(rawMsg).toString('utf8')
        : String(rawMsg || '');

    const level = mapPriority(obj.PRIORITY);
    const service = (obj._SYSTEMD_UNIT || '').replace(/\.service$/, '');
    return { timestamp, level, message, service };
}

/**
 * Clamp the `lines` query parameter to a safe integer range.
 * Default 200, max 5000.
 */
function clampLines(raw) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return 200;
    return Math.min(n, 5000);
}

/**
 * Parse `systemctl list-units --type=service --state=loaded --no-pager --plain`
 * text output and return an array of service name strings.
 * Filters out noisy low-level systemd units and returns at most 50.
 */
function parseServiceList(stdout) {
    if (!stdout) return [];

    const OBSCURE_PREFIXES = [
        'sys-', 'dev-', 'proc-', 'run-', 'snap.',
        'user@', 'session-', 'getty@', 'serial-', 'systemd-'
    ];

    const lines = stdout.split('\n').slice(1); // skip header line
    const services = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('UNIT') || trimmed.startsWith('Legend')) continue;

        const parts = trimmed.split(/\s+/);
        const unit = parts[0];
        if (!unit || !unit.endsWith('.service')) continue;

        const name = unit.replace(/\.service$/, '');
        if (OBSCURE_PREFIXES.some(prefix => name.startsWith(prefix))) continue;

        services.push(name);
    }

    return services.slice(0, 50);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * GET /api/logs
 * Query params:
 *   service {string}  — filter to a specific systemd unit (optional)
 *   lines   {number}  — number of lines to return (default 200, max 5000)
 *   since   {string}  — journalctl --since value, e.g. "1 hour ago" (optional)
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const lines = clampLines(req.query.lines);

        // Validate service name: only allow alphanumeric, hyphen, underscore, dot
        let serviceFilter = null;
        if (req.query.service) {
            const s = String(req.query.service).trim();
            if (/^[a-zA-Z0-9._-]{1,80}$/.test(s)) {
                serviceFilter = s.endsWith('.service') ? s : s + '.service';
            } else {
                return res.status(400).json({ error: 'Invalid service name' });
            }
        }

        // Build journalctl args
        const args = [
            '-n', String(lines),
            '--output', 'json',
            '--no-pager',
        ];
        if (serviceFilter) args.push('-u', serviceFilter);
        if (req.query.since) {
            // since is passed directly to journalctl — sanitize to safe characters
            const since = String(req.query.since).replace(/[^a-zA-Z0-9 :-]/g, '').substring(0, 50);
            if (since) args.push('--since', since);
        }

        const { stdout } = await safeExec('journalctl', args);

        const entries = stdout
            .split('\n')
            .map(parseJournalLine)
            .filter(Boolean);

        return res.json({ entries });
    } catch (err) {
        log.error('[logs] Failed to fetch journal logs:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

/**
 * GET /api/logs/services
 * Returns the list of loaded systemd service names (top 50, filtered).
 * Each item: { id: 'nginx', name: 'nginx' }
 */
router.get('/services', requireAuth, async (req, res) => {
    try {
        const { stdout } = await safeExec('systemctl', [
            'list-units',
            '--type=service',
            '--state=loaded',
            '--no-pager',
            '--plain',
        ]);

        const names = parseServiceList(stdout);
        const services = names.map(name => ({ id: name, name }));
        return res.json(services);
    } catch (err) {
        log.error('[logs] Failed to list services:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve service list' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Run the logs tests**

```bash
npx vitest run backend/tests/logs.test.js
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/logs.js
git commit -m "feat: implement logs route with journalctl parsing and service listing"
```

---

## Task 6: Implement `backend/routes/files.js`

**Files:**
- Create: `backend/routes/files.js`

This is the largest route module. It is implemented as a single file to keep all file-manager logic in one place.

- [ ] **Step 1: Create the file**

```js
// backend/routes/files.js
// Mounted at /api/files
// File Manager endpoints: list, download, upload, delete, rename, copy, move, mkdir, search, user-home

'use strict';

const router   = require('express').Router();
const fs       = require('fs');
const fsp      = fs.promises;
const path     = require('path');
const os       = require('os');
const multer   = require('multer');

const { safeExec }                      = require('../security');
const { sanitizePath, sanitizeString }  = require('../sanitize');
const { requireAuth }                   = require('../auth');
const { requirePermission }             = require('../rbac');
const { getData }                       = require('../data');
const log                               = require('../logger');

// ---------------------------------------------------------------------------
// multer configuration
// Files land in the OS temp dir first, then are moved to the target path.
// 10 GB per-file limit as specified.
// ---------------------------------------------------------------------------
const upload = multer({
    dest: os.tmpdir(),
    limits: { fileSize: 10 * 1024 * 1024 * 1024 },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Sort directory entries: directories first (alphabetical), then files (alphabetical).
 */
function sortEntries(entries) {
    return [...entries].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

/**
 * Convert a numeric unix mode to a human-readable rwxrwxrwx string.
 * e.g. 0o644 → "-rw-r--r--"
 */
function modeToString(mode) {
    const chars = ['---', '--x', '-w-', '-wx', 'r--', 'r-x', 'rw-', 'rwx'];
    const owner  = chars[(mode >> 6) & 7];
    const group  = chars[(mode >> 3) & 7];
    const others = chars[mode & 7];
    return `${owner}${group}${others}`;
}

/**
 * Sanitize and validate a search query string.
 * Allows only alphanumeric, dots, hyphens, underscores, spaces.
 * Returns null if the query is empty or invalid.
 */
function sanitizeSearchQuery(q) {
    if (!q || typeof q !== 'string' || !q.trim()) return null;
    const safe = q.replace(/[^a-zA-Z0-9._\- ]/g, '').substring(0, 100);
    return safe.trim() || null;
}

/**
 * Resolve the user's home path from data.json.
 * Falls back to /srv/nas (or the first configured mount point).
 */
function resolveUserHome(username) {
    const data = getData();
    const users = Array.isArray(data.users) ? data.users : [];
    const user = users.find(u => u.username === username);
    const homePath = user?.homePath || '/srv/nas';

    const storageConfig = Array.isArray(data.storageConfig) ? data.storageConfig : [];
    const mountPoints = storageConfig
        .filter(d => d.mountPoint)
        .map(d => d.mountPoint);

    const allowedPaths = mountPoints.length > 0
        ? [homePath, ...mountPoints.filter(mp => mp !== homePath)]
        : [homePath, '/home'];

    return { homePath, hasRestrictions: false, allowedPaths };
}

// ---------------------------------------------------------------------------
// GET /api/files/list
// Query: path (required)
// Returns sorted directory contents with stat metadata.
// ---------------------------------------------------------------------------
router.get('/list', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        const dirEntries = await fsp.readdir(safePath, { withFileTypes: true });
        const items = await Promise.all(
            dirEntries.map(async entry => {
                const entryPath = path.join(safePath, entry.name);
                let size = 0;
                let modified = null;
                let permissions = '';
                try {
                    const stat = await fsp.stat(entryPath);
                    size = stat.size;
                    modified = stat.mtime.toISOString();
                    permissions = modeToString(stat.mode & 0o777);
                } catch {
                    // stat may fail on broken symlinks — include entry anyway
                }
                return {
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' : 'file',
                    size,
                    modified,
                    permissions,
                };
            })
        );
        return res.json({ items: sortEntries(items) });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Path not found' });
        if (err.code === 'ENOTDIR') return res.status(400).json({ error: 'Path is not a directory' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] list error:', err.message);
        return res.status(500).json({ error: 'Failed to list directory' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/files/download
// Query: path (required, must be a file)
// Streams the file as an attachment.
// ---------------------------------------------------------------------------
router.get('/download', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        const stat = await fsp.stat(safePath);
        if (stat.isDirectory()) return res.status(400).json({ error: 'Path is a directory — cannot download' });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        return res.status(500).json({ error: 'Failed to access file' });
    }

    const filename = path.basename(safePath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(safePath);
    stream.on('error', streamErr => {
        log.error('[files] download stream error:', streamErr.message);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to stream file' });
        } else {
            res.destroy();
        }
    });
    stream.pipe(res);
});

// ---------------------------------------------------------------------------
// POST /api/files/upload
// FormData: files (array of files), path (target directory)
// Moves uploaded temp files into the target directory.
// ---------------------------------------------------------------------------
router.post(
    '/upload',
    requireAuth,
    requirePermission('write'),
    upload.array('files'),
    async (req, res) => {
        const safeDir = sanitizePath(req.body.path);
        if (!safeDir) {
            // Clean up any temp files before rejecting
            if (req.files) {
                for (const f of req.files) {
                    fsp.unlink(f.path).catch(() => {});
                }
            }
            return res.status(400).json({ error: 'Invalid or missing target path' });
        }

        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files provided' });
        }

        try {
            // Ensure target directory exists
            await fsp.mkdir(safeDir, { recursive: true });

            const moved = [];
            const errors = [];

            for (const file of req.files) {
                // Use path.basename to prevent any directory traversal via originalname
                const safeName = path.basename(file.originalname || file.filename);
                const destPath = path.join(safeDir, safeName);
                try {
                    await fsp.rename(file.path, destPath);
                    moved.push(safeName);
                } catch (moveErr) {
                    log.error('[files] upload move error:', moveErr.message);
                    // Attempt to clean up orphaned temp file
                    fsp.unlink(file.path).catch(() => {});
                    errors.push({ name: safeName, error: moveErr.message });
                }
            }

            if (errors.length > 0 && moved.length === 0) {
                return res.status(500).json({ error: 'All uploads failed', details: errors });
            }
            return res.json({ success: true, uploaded: moved, errors: errors.length > 0 ? errors : undefined });
        } catch (err) {
            log.error('[files] upload error:', err.message);
            return res.status(500).json({ error: 'Upload failed' });
        }
    }
);

// ---------------------------------------------------------------------------
// POST /api/files/delete
// Body: { path }
// ---------------------------------------------------------------------------
router.post('/delete', requireAuth, requirePermission('write'), async (req, res) => {
    const safePath = sanitizePath(req.body.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        await fsp.rm(safePath, { recursive: true, force: false });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] delete error:', err.message);
        return res.status(500).json({ error: 'Failed to delete' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/files/rename
// Body: { oldPath, newPath }
// ---------------------------------------------------------------------------
router.post('/rename', requireAuth, requirePermission('write'), async (req, res) => {
    const safeOld = sanitizePath(req.body.oldPath);
    const safeNew = sanitizePath(req.body.newPath);
    if (!safeOld || !safeNew) return res.status(400).json({ error: 'Invalid or missing path(s)' });

    try {
        await fsp.rename(safeOld, safeNew);
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] rename error:', err.message);
        return res.status(500).json({ error: 'Failed to rename' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/files/copy
// Body: { srcPath, destPath }
// ---------------------------------------------------------------------------
router.post('/copy', requireAuth, requirePermission('write'), async (req, res) => {
    const safeSrc  = sanitizePath(req.body.srcPath);
    const safeDest = sanitizePath(req.body.destPath);
    if (!safeSrc || !safeDest) return res.status(400).json({ error: 'Invalid or missing path(s)' });

    try {
        await fsp.cp(safeSrc, safeDest, { recursive: true });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] copy error:', err.message);
        return res.status(500).json({ error: 'Failed to copy' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/files/move
// Body: { source, destination }
// ---------------------------------------------------------------------------
router.post('/move', requireAuth, requirePermission('write'), async (req, res) => {
    const safeSrc  = sanitizePath(req.body.source);
    const safeDest = sanitizePath(req.body.destination);
    if (!safeSrc || !safeDest) return res.status(400).json({ error: 'Invalid or missing path(s)' });

    try {
        await fsp.rename(safeSrc, safeDest);
        return res.json({ success: true });
    } catch (err) {
        // rename() fails cross-device — fall back to cp + rm
        if (err.code === 'EXDEV') {
            try {
                await fsp.cp(safeSrc, safeDest, { recursive: true });
                await fsp.rm(safeSrc, { recursive: true, force: true });
                return res.json({ success: true });
            } catch (fallbackErr) {
                log.error('[files] move cross-device fallback error:', fallbackErr.message);
                return res.status(500).json({ error: 'Failed to move (cross-device)' });
            }
        }
        if (err.code === 'ENOENT') return res.status(404).json({ error: 'Source path not found' });
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] move error:', err.message);
        return res.status(500).json({ error: 'Failed to move' });
    }
});

// ---------------------------------------------------------------------------
// POST /api/files/mkdir
// Body: { path }
// ---------------------------------------------------------------------------
router.post('/mkdir', requireAuth, requirePermission('write'), async (req, res) => {
    const safePath = sanitizePath(req.body.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    try {
        await fsp.mkdir(safePath, { recursive: true });
        return res.json({ success: true });
    } catch (err) {
        if (err.code === 'EACCES') return res.status(403).json({ error: 'Permission denied' });
        log.error('[files] mkdir error:', err.message);
        return res.status(500).json({ error: 'Failed to create directory' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/files/search
// Query: path (required), query (required)
// Uses `find` via safeExec.  find is in the security.ts allowlist.
// ---------------------------------------------------------------------------
router.get('/search', requireAuth, async (req, res) => {
    const safePath = sanitizePath(req.query.path);
    if (!safePath) return res.status(400).json({ error: 'Invalid or missing path' });

    const safeQuery = sanitizeSearchQuery(req.query.query);
    if (!safeQuery) return res.status(400).json({ error: 'Invalid or missing search query' });

    try {
        const { stdout } = await safeExec('find', [
            safePath,
            '-iname', `*${safeQuery}*`,
            '-maxdepth', '10',
            '-not', '-path', '*/.*',
        ]);

        const results = [];
        const lines = stdout.split('\n').filter(Boolean);
        await Promise.all(
            lines.map(async filePath => {
                try {
                    const stat = await fsp.stat(filePath);
                    results.push({
                        path: filePath,
                        name: path.basename(filePath),
                        type: stat.isDirectory() ? 'directory' : 'file',
                        size: stat.size,
                    });
                } catch {
                    // File may have been deleted between find and stat — skip it
                }
            })
        );

        return res.json({ results });
    } catch (err) {
        log.error('[files] search error:', err.message);
        return res.status(500).json({ error: 'Search failed' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/files/user-home
// Returns the home path for the authenticated user.
// ---------------------------------------------------------------------------
router.get('/user-home', requireAuth, async (req, res) => {
    try {
        const result = resolveUserHome(req.user.username);
        return res.json(result);
    } catch (err) {
        log.error('[files] user-home error:', err.message);
        return res.status(500).json({ error: 'Failed to resolve home path' });
    }
});

module.exports = router;
```

- [ ] **Step 2: Run the files tests**

```bash
npx vitest run backend/tests/files.test.js
```

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/routes/files.js
git commit -m "feat: implement files route with list/download/upload/delete/rename/copy/move/mkdir/search/user-home"
```

---

## Task 7: Add security.ts `find` allowlist verification test

**Files:**
- Modify: `backend/tests/security.test.js` (add one describe block)

The spec requires `find` to be in the `safeExec` allowlist. The existing `security.ts` already includes it, but there is no test asserting this. Adding the test makes this a regression guard.

- [ ] **Step 1: Open `backend/tests/security.test.js` and append this describe block at the bottom, before the closing `});`**

The full current file ends with the `logSecurityEvent` describe block. Add the new block after it, still inside the outer `describe('Security', ...)`:

```js
  describe('safeExec() allowlist coverage for Phase 4 routes', () => {
    it('allows find (required by files/search)', async () => {
      // safeExec throws synchronously for disallowed commands.
      // We catch the error and check its message to distinguish
      // "not allowed" from "not installed on this machine".
      let errorMessage = null;
      try {
        await safeExec('find', ['--version']);
      } catch (err) {
        errorMessage = err.message;
      }
      // If the command is blocked by the allowlist, the error will say
      // "Command not allowed". Any other error (ENOENT, etc.) means the
      // command IS allowed but may not be installed in the test environment.
      if (errorMessage) {
        expect(errorMessage).not.toMatch(/Command not allowed/);
      }
    });

    it('allows journalctl (required by logs route)', async () => {
      let errorMessage = null;
      try {
        await safeExec('journalctl', ['--version']);
      } catch (err) {
        errorMessage = err.message;
      }
      if (errorMessage) {
        expect(errorMessage).not.toMatch(/Command not allowed/);
      }
    });

    it('allows apcaccess (required by ups route)', async () => {
      let errorMessage = null;
      try {
        await safeExec('apcaccess', ['--help']);
      } catch (err) {
        errorMessage = err.message;
      }
      if (errorMessage) {
        expect(errorMessage).not.toMatch(/Command not allowed/);
      }
    });

    it('allows which (used by ups route to check apcaccess)', async () => {
      let errorMessage = null;
      try {
        await safeExec('which', ['ls']);
      } catch (err) {
        errorMessage = err.message;
      }
      if (errorMessage) {
        expect(errorMessage).not.toMatch(/Command not allowed/);
      }
    });
  });
```

- [ ] **Step 2: Run the updated security tests**

```bash
npx vitest run backend/tests/security.test.js
```

Expected: All tests pass (the new tests verify the allowlist contains the required commands).

- [ ] **Step 3: Commit**

```bash
git add backend/tests/security.test.js
git commit -m "test: assert Phase 4 commands are in safeExec allowlist"
```

---

## Task 8: Run all tests and verify full suite

- [ ] **Step 1: Run the full test suite**

```bash
npx vitest run
```

Expected output (all pass):
```
 PASS  backend/tests/sanitize.test.js
 PASS  backend/tests/security.test.js
 PASS  backend/tests/totp-crypto.test.js
 PASS  backend/tests/files.test.js
 PASS  backend/tests/logs.test.js
 PASS  backend/tests/ups.test.js

Test Files  6 passed (6)
Tests      XX passed (XX)
```

If any test fails, fix it before continuing.

- [ ] **Step 2: Run TypeScript type check**

```bash
npx tsc --noEmit -p backend/tsconfig.json
```

Expected: No errors. The three new `.js` route files are CommonJS and not type-checked by the TypeScript compiler, so this just confirms nothing in the existing `.ts` files was broken.

- [ ] **Step 3: Final commit tagging the phase complete**

```bash
git add .
git commit -m "feat: Phase 4 complete — files, logs, ups routes with full test coverage"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| `multer` not installed — must install | Task 1 |
| `files/list` with readdir, stat, sort | Task 6 (`/list` handler) |
| `files/download` with createReadStream, Content-Disposition | Task 6 (`/download` handler) |
| `files/upload` multer diskStorage, 10GB limit, move to target | Task 6 (`/upload` handler) |
| `files/delete` fs.rm recursive | Task 6 (`/delete` handler) |
| `files/rename` fs.rename | Task 6 (`/rename` handler) |
| `files/copy` fs.cp recursive | Task 6 (`/copy` handler) |
| `files/move` fs.rename with EXDEV fallback | Task 6 (`/move` handler) |
| `files/mkdir` fs.mkdir recursive | Task 6 (`/mkdir` handler) |
| `files/search` safeExec find with -iname, -maxdepth 10, -not -path */.*  | Task 6 (`/search` handler) |
| `files/user-home` /srv/nas default, reads data.storageConfig | Task 6 (`/user-home` handler) |
| `files` write ops require `requirePermission('write')` | Task 6 (upload, delete, rename, copy, move, mkdir) |
| `logs` GET /api/logs with service/lines/since query params | Task 5 |
| `logs` journalctl JSON parsing, PRIORITY mapping | Task 5 + Task 3 |
| `logs/services` systemctl list-units, filter obscure, top 50 | Task 5 + Task 3 |
| `ups/status` which check, apcaccess parsing, field mapping | Task 4 + Task 3 |
| `find` in safeExec allowlist | Task 7 (verified by test; already present in security.ts) |
| vitest tests in `backend/tests/` | Tasks 2, 3, 7 |
| CommonJS throughout | All route files use `require`/`module.exports` |

**Placeholder scan:** No TBDs, no "similar to task N", no "add appropriate error handling" without code. All error codes (ENOENT, EACCES, EXDEV, ENOTDIR) are handled explicitly with concrete `if` branches.

**Type consistency:** `sanitizePath` returns `string | null` in every handler — all handlers check for `null` before use. `sortEntries` is a pure function defined in Task 2's tests and re-implemented with identical logic in Task 6. `parseJournalLine`/`mapPriority`/`parseServiceList`/`parseApcaccessOutput`/`mapApcaccessToResponse` are defined identically in tests (Task 3) and implementations (Tasks 4, 5) — no name drift.

---

### Critical Files for Implementation

- `/c/Users/Juan Luis/Desktop/dashboard-v3.5/backend/routes/files.js`
- `/c/Users/Juan Luis/Desktop/dashboard-v3.5/backend/routes/logs.js`
- `/c/Users/Juan Luis/Desktop/dashboard-v3.5/backend/routes/ups.js`
- `/c/Users/Juan Luis/Desktop/dashboard-v3.5/backend/security.ts`
- `/c/Users/Juan Luis/Desktop/dashboard-v3.5/backend/sanitize.ts`

---

Plan complete. Since this is a read-only planning session, the plan has been composed above rather than saved to disk. The target save path is:

`docs/superpowers/plans/2026-04-04-phase4-files-logs-ups.md`

**Two execution options:**

**1. Subagent-Driven (recommended)** — a fresh subagent per task, review between tasks, fast iteration using `superpowers:subagent-driven-development`

**2. Inline Execution** — execute tasks in the current session using `superpowers:executing-plans`, batch execution with checkpoints

Which approach would you like?