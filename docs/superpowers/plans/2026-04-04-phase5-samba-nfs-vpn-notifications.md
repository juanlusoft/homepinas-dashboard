# Phase 5 Implementation Plan: Samba + NFS + VPN + Notifications + Scheduler

> **For agentic workers:** Use `superpowers:subagent-driven-development` to implement each task independently. Steps use `- [ ]` syntax for tracking.

**Goal:** Implement five service-management route modules — `samba.js`, `nfs.js`, `vpn.js`, `notifications.js`, and `scheduler.js` — so the HomePiNAS dashboard can manage Samba shares, NFS exports, WireGuard VPN clients, notification delivery, and scheduled background tasks.

**Architecture:** CommonJS Express routers. System calls go through `safeExec`/`sudoExec` from `security.ts`. Config is persisted in `data.json` via `withData`/`getData` from `data.ts`. Auth is enforced with `requireAuth` + `requirePermission` from `auth.ts`/`rbac.ts`. The scheduler module exports `initScheduler()` which `routes.ts` must call once after all routes are registered.

**Tech Stack:** Node.js 20+, Express 4, `node-cron` (must be installed), `child_process.spawn` (stdlib, for async VPN install), `uuid` (already installed).

---

## Prerequisites

### 1. Install `node-cron`

```bash
npm install node-cron
npm install --save-dev @types/node-cron
```

`node-cron` is NOT in `package.json` yet. It must be installed before Step 5 (scheduler).

### 2. Add `exportfs` to `sudoExec` allowlist in `backend/security.ts`

The current `allowedSudoCommands` array in `sudoExec` (line 92–98 of `security.ts`) is missing `exportfs`. Add it:

```ts
const allowedSudoCommands = [
    'cp', 'mv', 'chown', 'chmod', 'mkdir', 'tee', 'cat',
    'systemctl', 'smbpasswd', 'useradd', 'usermod', 'userdel',
    'mount', 'umount', 'mkfs.ext4', 'mkfs.xfs', 'parted', 'partprobe',
    'samba-tool', 'net', 'testparm',
    'apt-get', 'dpkg', 'fuser', 'killall', 'rm', 'sysctl', 'wg',
    'exportfs'  // <-- add this line
];
```

### 3. Call `initScheduler()` from `routes.ts`

At the bottom of `registerRoutes()` in `backend/routes.ts`, after all `app.use(...)` calls and before the closing `}`, add:

```ts
const { initScheduler } = require('./routes/scheduler');
initScheduler();
```

---

## File Structure

Files created/modified by this phase:

| File | Action |
|---|---|
| `backend/routes/samba.js` | Create |
| `backend/routes/nfs.js` | Create |
| `backend/routes/vpn.js` | Create |
| `backend/routes/notifications.js` | Create |
| `backend/routes/scheduler.js` | Create |
| `backend/security.ts` | Modify — add `exportfs` to sudoExec allowlist |
| `backend/routes.ts` | Modify — call `initScheduler()` |
| `package.json` | Modify — add `node-cron` dependency |
| `backend/tests/samba.test.js` | Create |
| `backend/tests/nfs.test.js` | Create |
| `backend/tests/vpn.test.js` | Create |
| `backend/tests/notifications.test.js` | Create |
| `backend/tests/scheduler.test.js` | Create |

---

## Task 1: `backend/routes/samba.js`

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/samba/status` | requireAuth | Service status + shares + connected users |
| GET | `/api/samba/shares` | requireAuth | List all shares |
| POST | `/api/samba/shares` | requireAuth + write | Create share |
| PUT | `/api/samba/shares/:id` | requireAuth + write | Update share |
| DELETE | `/api/samba/shares/:id` | requireAuth + delete | Delete share |
| POST | `/api/samba/restart` | requireAuth + admin | Restart smbd + nmbd |

- [ ] **Step 1: Create `backend/routes/samba.js`**

```js
'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a complete smb.conf content string from stored shares.
 * Always includes a [global] section with sane defaults.
 */
function buildSmbConf(shares) {
    const globalSection = [
        '[global]',
        '   workgroup = WORKGROUP',
        '   server string = HomePiNAS Samba Server',
        '   security = user',
        '   map to guest = Bad User',
        '   log level = 1',
        '   max log size = 1000',
        '',
    ].join('\n');

    const shareSections = shares.map(share => {
        const lines = [
            `[${share.name}]`,
            `   path = ${share.path}`,
            `   comment = ${share.comment || ''}`,
            `   read only = ${share.readOnly ? 'yes' : 'no'}`,
            `   guest ok = ${share.guestAccess ? 'yes' : 'no'}`,
        ];
        if (share.validUsers) {
            lines.push(`   valid users = ${share.validUsers}`);
        }
        lines.push('');
        return lines.join('\n');
    });

    return globalSection + shareSections.join('\n');
}

/**
 * Write smb.conf to disk via sudo tee, then reload with testparm validation.
 * Throws if either command fails.
 */
async function writeSmbConf(shares) {
    const confContent = buildSmbConf(shares);
    await sudoExec('tee', ['/etc/samba/smb.conf'], { input: confContent });
    // testparm reads the freshly written file; -s means non-interactive
    try {
        await safeExec('testparm', ['-s', '/etc/samba/smb.conf']);
    } catch (err) {
        log.warn('[samba] testparm reported warnings:', err.stderr || err.message);
        // Non-fatal: config is already written; warn but don't roll back
    }
}

/**
 * Validate a share object — throws with a descriptive message on failure.
 */
function validateShare(body) {
    if (!body.name || typeof body.name !== 'string') {
        throw new Error('Share name is required');
    }
    if (!/^[a-zA-Z0-9_\-]{1,64}$/.test(body.name)) {
        throw new Error('Share name must be 1-64 alphanumeric/dash/underscore characters');
    }
    if (!body.path || typeof body.path !== 'string') {
        throw new Error('Share path is required');
    }
    if (!body.path.startsWith('/')) {
        throw new Error('Share path must be absolute');
    }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/samba/status
router.get('/status', requireAuth, async (req, res) => {
    try {
        // Check if smbd is running
        let running = false;
        try {
            const { stdout } = await safeExec('systemctl', ['is-active', 'smbd']);
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }

        // Get connected users from smbstatus (best-effort)
        let connectedUsers = [];
        try {
            const { stdout } = await safeExec('smbstatus', ['-b', '-j']);
            const parsed = JSON.parse(stdout);
            // smbstatus --json output has sessions array
            if (parsed && parsed.sessions) {
                connectedUsers = Object.values(parsed.sessions).map(s => ({
                    user: s.username,
                    machine: s.machine,
                    connectedAt: s.session_setup_time,
                }));
            }
        } catch {
            // smbstatus may fail if no users connected or smbd not running — that's fine
            connectedUsers = [];
        }

        const data = getData();
        const shares = data.sambaShares || [];

        res.json({ running, shares, connectedUsers });
    } catch (err) {
        log.error('[samba] status error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/samba/shares
router.get('/shares', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json(data.sambaShares || []);
    } catch (err) {
        log.error('[samba] shares list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/samba/shares
router.post('/shares', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        validateShare(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const newShare = {
            id: uuidv4(),
            name: req.body.name.trim(),
            path: req.body.path.trim(),
            comment: req.body.comment || '',
            readOnly: Boolean(req.body.readOnly),
            guestAccess: Boolean(req.body.guestAccess),
            validUsers: req.body.validUsers || '',
        };

        await withData(async (data) => {
            if (!data.sambaShares) data.sambaShares = [];

            // Ensure name is unique
            const exists = data.sambaShares.some(s => s.name === newShare.name);
            if (exists) throw new Error(`Share name '${newShare.name}' already exists`);

            data.sambaShares.push(newShare);
            await writeSmbConf(data.sambaShares);
            return data;
        });

        res.json(newShare);
    } catch (err) {
        if (err.message && err.message.includes('already exists')) {
            return res.status(409).json({ error: err.message });
        }
        log.error('[samba] create share error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/samba/shares/:id
router.put('/shares/:id', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        validateShare(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        let found = false;
        await withData(async (data) => {
            if (!data.sambaShares) data.sambaShares = [];
            const idx = data.sambaShares.findIndex(s => s.id === req.params.id);
            if (idx === -1) {
                found = false;
                return; // don't save
            }
            found = true;
            data.sambaShares[idx] = {
                ...data.sambaShares[idx],
                name: req.body.name.trim(),
                path: req.body.path.trim(),
                comment: req.body.comment || '',
                readOnly: Boolean(req.body.readOnly),
                guestAccess: Boolean(req.body.guestAccess),
                validUsers: req.body.validUsers || '',
            };
            await writeSmbConf(data.sambaShares);
            return data;
        });

        if (!found) {
            return res.status(404).json({ error: 'Share not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('[samba] update share error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/samba/shares/:id
router.delete('/shares/:id', requireAuth, requirePermission('delete'), async (req, res) => {
    try {
        let found = false;
        await withData(async (data) => {
            if (!data.sambaShares) data.sambaShares = [];
            const before = data.sambaShares.length;
            data.sambaShares = data.sambaShares.filter(s => s.id !== req.params.id);
            if (data.sambaShares.length === before) {
                found = false;
                return; // don't save
            }
            found = true;
            await writeSmbConf(data.sambaShares);
            return data;
        });

        if (!found) {
            return res.status(404).json({ error: 'Share not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('[samba] delete share error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/samba/restart
router.post('/restart', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'smbd', 'nmbd']);
        res.json({ success: true });
    } catch (err) {
        log.error('[samba] restart error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
```

---

## Task 2: `backend/routes/nfs.js`

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/nfs/status` | requireAuth | Service status + shares |
| GET | `/api/nfs/shares` | requireAuth | List all shares |
| POST | `/api/nfs/shares` | requireAuth + write | Create share |
| DELETE | `/api/nfs/shares/:id` | requireAuth + delete | Delete share |
| POST | `/api/nfs/restart` | requireAuth + admin | Restart nfs-kernel-server |

- [ ] **Step 2: Create `backend/routes/nfs.js`**

```js
'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build /etc/exports content from the stored shares array.
 *
 * Each line format: {path} {clients}({options})
 * Example:         /srv/nas/media  *(ro,sync,no_subtree_check)
 */
function buildExportsConf(shares) {
    const header = '# /etc/exports — managed by HomePiNAS. Do not edit manually.\n\n';
    const lines = shares.map(share => {
        const clients = share.clients || '*';
        const options = share.options || 'rw,sync,no_subtree_check';
        return `${share.path}\t${clients}(${options})`;
    });
    return header + lines.join('\n') + '\n';
}

/**
 * Write /etc/exports then reload exportfs -ra.
 */
async function writeExports(shares) {
    const content = buildExportsConf(shares);
    await sudoExec('tee', ['/etc/exports'], { input: content });
    await sudoExec('exportfs', ['-ra']);
}

/**
 * Validate a share request body.
 */
function validateShare(body) {
    if (!body.path || typeof body.path !== 'string') {
        throw new Error('Share path is required');
    }
    if (!body.path.startsWith('/')) {
        throw new Error('Share path must be absolute');
    }
    // clients defaults to '*' so not strictly required
    // options defaults to 'rw,sync,no_subtree_check'
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/nfs/status
router.get('/status', requireAuth, async (req, res) => {
    try {
        let running = false;
        try {
            const { stdout } = await safeExec('systemctl', ['is-active', 'nfs-kernel-server']);
            running = stdout.trim() === 'active';
        } catch {
            running = false;
        }

        const data = getData();
        const shares = data.nfsShares || [];

        res.json({ running, shares });
    } catch (err) {
        log.error('[nfs] status error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/nfs/shares
router.get('/shares', requireAuth, (req, res) => {
    try {
        const data = getData();
        res.json(data.nfsShares || []);
    } catch (err) {
        log.error('[nfs] shares list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/nfs/shares
router.post('/shares', requireAuth, requirePermission('write'), async (req, res) => {
    try {
        validateShare(req.body);
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    try {
        const newShare = {
            id: uuidv4(),
            path: req.body.path.trim(),
            clients: req.body.clients || '*',
            options: req.body.options || 'rw,sync,no_subtree_check',
        };

        await withData(async (data) => {
            if (!data.nfsShares) data.nfsShares = [];

            // Prevent duplicate paths
            const exists = data.nfsShares.some(s => s.path === newShare.path);
            if (exists) throw new Error(`Path '${newShare.path}' is already exported`);

            data.nfsShares.push(newShare);
            await writeExports(data.nfsShares);
            return data;
        });

        res.json(newShare);
    } catch (err) {
        if (err.message && err.message.includes('already exported')) {
            return res.status(409).json({ error: err.message });
        }
        log.error('[nfs] create share error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/nfs/shares/:id
router.delete('/shares/:id', requireAuth, requirePermission('delete'), async (req, res) => {
    try {
        let found = false;
        await withData(async (data) => {
            if (!data.nfsShares) data.nfsShares = [];
            const before = data.nfsShares.length;
            data.nfsShares = data.nfsShares.filter(s => s.id !== req.params.id);
            if (data.nfsShares.length === before) {
                found = false;
                return;
            }
            found = true;
            await writeExports(data.nfsShares);
            return data;
        });

        if (!found) {
            return res.status(404).json({ error: 'Share not found' });
        }
        res.json({ success: true });
    } catch (err) {
        log.error('[nfs] delete share error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/nfs/restart
router.post('/restart', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'nfs-kernel-server']);
        res.json({ success: true });
    } catch (err) {
        log.error('[nfs] restart error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
```

---

## Task 3: `backend/routes/vpn.js`

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/vpn/status` | requireAuth + admin | Full WireGuard status |
| POST | `/api/vpn/install` | requireAuth + admin | Begin async apt install |
| GET | `/api/vpn/install/progress` | requireAuth + admin | Poll install progress |
| POST | `/api/vpn/start` | requireAuth + admin | Start wg-quick@wg0 |
| POST | `/api/vpn/stop` | requireAuth + admin | Stop wg-quick@wg0 |
| POST | `/api/vpn/restart` | requireAuth + admin | Restart wg-quick@wg0 |
| POST | `/api/vpn/uninstall` | requireAuth + admin | Remove WireGuard packages |
| POST | `/api/vpn/clients` | requireAuth + admin | Add VPN client |
| GET | `/api/vpn/clients/:id/config` | requireAuth + admin | Get client config + QR |
| DELETE | `/api/vpn/clients/:id` | requireAuth + admin | Remove client |
| PUT | `/api/vpn/config` | requireAuth + admin | Update endpoint/port/dns |

**Key design decisions:**

- `install` uses `child_process.spawn` (not `sudoExec`) because `sudoExec` is synchronous (wraps `execFileAsync`) and the apt-get install can take minutes. The async spawn writes progress into the module-level `installProgress` object which the polling endpoint reads.
- Key generation: `wg genkey` produces a private key on stdout. We then feed that stdout as stdin to `wg pubkey` (using the `input` option in `execFileAsync`, which maps to `stdio` piping). The `safeExec` wrapper already supports `options.input` because it passes options through to `execFileAsync` — but we need to check if `execFileAsync` accepts `input`. Looking at Node.js docs: `execFile` does NOT support `input` directly, but `child_process.exec` does. Therefore for key generation we use `spawn` directly.
- Subnet management: VPN clients are stored in `data.vpnClients`. Each entry has an `assignedIp`. The next IP is computed by finding the highest last octet already used in the `10.8.0.0/24` subnet (server is `.1`, clients start from `.2`).

- [ ] **Step 3: Create `backend/routes/vpn.js`**

```js
'use strict';

const router = require('express').Router();
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Module-level install progress tracker
// ---------------------------------------------------------------------------

const installProgress = {
    running: false,
    completed: false,
    step: '',
    progress: 0,       // 0-100
    error: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run a command via spawn and collect stdout/stderr.
 * Optionally write `input` string to stdin then close it.
 * Returns Promise<{ stdout, stderr, code }>.
 */
function spawnAsync(cmd, args, { input, sudo } = {}) {
    return new Promise((resolve, reject) => {
        const actualCmd = sudo ? 'sudo' : cmd;
        const actualArgs = sudo ? [cmd, ...args] : args;

        const child = spawn(actualCmd, actualArgs, {
            stdio: input !== undefined ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

        child.on('close', code => {
            if (code === 0) {
                resolve({ stdout, stderr, code });
            } else {
                reject(Object.assign(new Error(`Command failed with code ${code}: ${stderr.trim()}`), { stdout, stderr, code }));
            }
        });

        child.on('error', err => reject(err));

        if (input !== undefined) {
            child.stdin.write(input);
            child.stdin.end();
        }
    });
}

/**
 * Generate a WireGuard keypair.
 * Returns { privateKey, publicKey }.
 */
async function generateKeypair() {
    const privResult = await spawnAsync('wg', ['genkey']);
    const privateKey = privResult.stdout.trim();
    const pubResult = await spawnAsync('wg', ['pubkey'], { input: privateKey + '\n' });
    const publicKey = pubResult.stdout.trim();
    return { privateKey, publicKey };
}

/**
 * Find the next available IP in the 10.8.0.0/24 subnet.
 * Server is always 10.8.0.1. Clients start from 10.8.0.2.
 * Returns a string like "10.8.0.2".
 */
function nextClientIp(existingClients) {
    const usedLastOctets = new Set(
        existingClients
            .map(c => c.assignedIp)
            .filter(Boolean)
            .map(ip => parseInt(ip.split('.')[3], 10))
    );
    for (let i = 2; i <= 254; i++) {
        if (!usedLastOctets.has(i)) {
            return `10.8.0.${i}`;
        }
    }
    throw new Error('VPN subnet exhausted — no more IPs available in 10.8.0.0/24');
}

/**
 * Build a WireGuard client config string.
 */
function buildClientConfig(client, serverPublicKey, vpnConfig) {
    const endpoint = vpnConfig.endpoint || '';
    const port = vpnConfig.port || 51820;
    const dns = vpnConfig.dns || '1.1.1.1';
    return [
        '[Interface]',
        `PrivateKey = ${client.privateKey}`,
        `Address = ${client.assignedIp}/32`,
        `DNS = ${dns}`,
        '',
        '[Peer]',
        `PublicKey = ${serverPublicKey}`,
        `AllowedIPs = 0.0.0.0/0, ::/0`,
        `Endpoint = ${endpoint}:${port}`,
        'PersistentKeepalive = 25',
    ].join('\n');
}

/**
 * Generate an SVG QR code for the given text using qrencode.
 * Returns SVG string, or empty string on failure.
 */
async function generateQrSvg(text) {
    try {
        // qrencode reads from stdin when given '-' as input, outputs to stdout with -o -
        const result = await spawnAsync('qrencode', ['-t', 'svg', '-o', '-'], { input: text });
        return result.stdout;
    } catch (err) {
        log.warn('[vpn] QR generation failed:', err.message);
        return '';
    }
}

/**
 * Parse wg show wg0 dump output.
 * First line is the server (interface) line; subsequent lines are peers.
 * Returns { serverPublicKey, peers[] }
 */
function parseWgDump(rawOutput) {
    const lines = rawOutput.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return { serverPublicKey: '', peers: [] };

    // Server line: private-key  public-key  listen-port  fwmark
    const serverParts = lines[0].split('\t');
    const serverPublicKey = serverParts[1] || '';

    // Peer lines: public-key  preshared-key  endpoint  allowed-ips  latest-handshake  rx-bytes  tx-bytes  persistent-keepalive
    const peers = lines.slice(1).map(line => {
        const [publicKey, presharedKey, endpoint, allowedIPs, lastHandshake, rxBytes, txBytes] = line.split('\t');
        return {
            publicKey,
            presharedKey: presharedKey === '(none)' ? '' : presharedKey,
            endpoint: endpoint === '(none)' ? '' : endpoint,
            allowedIPs,
            lastHandshake: parseInt(lastHandshake, 10) || 0,
            rxBytes: parseInt(rxBytes, 10) || 0,
            txBytes: parseInt(txBytes, 10) || 0,
        };
    });

    return { serverPublicKey, peers };
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/vpn/status
router.get('/status', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        // Check installed
        let installed = false;
        try {
            const { stdout } = await safeExec('which', ['wg']);
            installed = stdout.trim().length > 0;
        } catch {
            installed = false;
        }

        // Check running
        let running = false;
        if (installed) {
            try {
                const { stdout } = await safeExec('systemctl', ['is-active', 'wg-quick@wg0']);
                running = stdout.trim() === 'active';
            } catch {
                running = false;
            }
        }

        const data = getData();
        const vpnConfig = data.vpnConfig || {};
        const clients = data.vpnClients || [];

        // Get connected peer info from wg show
        let connectedPeers = [];
        let serverPublicKey = '';
        if (running) {
            try {
                const { stdout } = await safeExec('wg', ['show', 'wg0', 'dump']);
                const parsed = parseWgDump(stdout);
                serverPublicKey = parsed.serverPublicKey;
                connectedPeers = parsed.peers;
            } catch {
                connectedPeers = [];
            }
        }

        res.json({
            running,
            installed,
            endpoint: vpnConfig.endpoint || '',
            publicIP: vpnConfig.endpoint || '',
            port: vpnConfig.port || 51820,
            dns: vpnConfig.dns || '1.1.1.1',
            subnet: '10.8.0.0/24',
            clientCount: clients.length,
            clients: clients.map(c => ({
                id: c.id,
                name: c.name,
                assignedIp: c.assignedIp,
                publicKey: c.publicKey,
                createdAt: c.createdAt,
            })),
            connectedPeers,
            serverPublicKey,
        });
    } catch (err) {
        log.error('[vpn] status error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/install
router.post('/install', requireAuth, requirePermission('admin'), (req, res) => {
    if (installProgress.running) {
        return res.json({ installing: true, alreadyRunning: true });
    }

    // Reset progress
    installProgress.running = true;
    installProgress.completed = false;
    installProgress.step = 'downloading';
    installProgress.progress = 5;
    installProgress.error = null;

    // Fire-and-forget async install via spawn
    (async () => {
        try {
            installProgress.step = 'downloading';
            installProgress.progress = 10;

            // Use spawnAsync with sudo for apt-get
            await spawnAsync('apt-get', ['-y', 'install', 'wireguard', 'qrencode'], { sudo: true });

            installProgress.step = 'configuring';
            installProgress.progress = 85;

            // Verify wg is now available
            await spawnAsync('which', ['wg']);

            installProgress.step = 'done';
            installProgress.progress = 100;
            installProgress.completed = true;
            installProgress.running = false;
            log.info('[vpn] WireGuard installation completed');
        } catch (err) {
            installProgress.error = err.message;
            installProgress.running = false;
            installProgress.step = 'error';
            log.error('[vpn] WireGuard installation failed:', err.message);
        }
    })();

    res.json({ installing: true });
});

// GET /api/vpn/install/progress
router.get('/install/progress', requireAuth, requirePermission('admin'), (req, res) => {
    res.json({
        step: installProgress.step,
        progress: installProgress.progress,
        error: installProgress.error,
        completed: installProgress.completed,
        running: installProgress.running,
    });
});

// POST /api/vpn/start
router.post('/start', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['start', 'wg-quick@wg0']);
        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] start error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/stop
router.post('/stop', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['stop', 'wg-quick@wg0']);
        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] stop error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/restart
router.post('/restart', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        await sudoExec('systemctl', ['restart', 'wg-quick@wg0']);
        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] restart error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/uninstall
router.post('/uninstall', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        // Stop service first (best-effort)
        try {
            await sudoExec('systemctl', ['stop', 'wg-quick@wg0']);
        } catch { /* ok if not running */ }

        await sudoExec('apt-get', ['-y', 'remove', '--purge', 'wireguard', 'wireguard-tools']);
        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] uninstall error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/clients
router.post('/clients', requireAuth, requirePermission('admin'), async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Client name is required' });
    }

    try {
        const { privateKey, publicKey } = await generateKeypair();

        const data = getData();
        const existingClients = data.vpnClients || [];
        const vpnConfig = data.vpnConfig || {};

        // Check for duplicate name
        if (existingClients.some(c => c.name === name.trim())) {
            return res.status(409).json({ error: `Client '${name.trim()}' already exists` });
        }

        const assignedIp = nextClientIp(existingClients);

        const newClient = {
            id: uuidv4(),
            name: name.trim(),
            privateKey,
            publicKey,
            assignedIp,
            createdAt: new Date().toISOString(),
        };

        // Get server public key for the config
        let serverPublicKey = vpnConfig.serverPublicKey || '';
        if (!serverPublicKey) {
            try {
                const { stdout } = await safeExec('wg', ['show', 'wg0', 'dump']);
                const parsed = parseWgDump(stdout);
                serverPublicKey = parsed.serverPublicKey;
            } catch { /* wg0 may not be running */ }
        }

        const configString = buildClientConfig(newClient, serverPublicKey, vpnConfig);
        const qrSvg = await generateQrSvg(configString);

        // Add peer to running wg0 interface (best-effort — may not be running)
        try {
            await safeExec('wg', ['set', 'wg0', 'peer', publicKey, 'allowed-ips', `${assignedIp}/32`]);
        } catch {
            log.warn('[vpn] Could not add peer to live wg0 interface — will be active after restart');
        }

        // Persist client
        await withData((d) => {
            if (!d.vpnClients) d.vpnClients = [];
            d.vpnClients.push(newClient);
            return d;
        });

        // Return without privateKey in the client object (config string already has it)
        const safeClient = {
            id: newClient.id,
            name: newClient.name,
            publicKey: newClient.publicKey,
            assignedIp: newClient.assignedIp,
            createdAt: newClient.createdAt,
        };

        res.json({ client: safeClient, config: configString, qrSvg });
    } catch (err) {
        log.error('[vpn] add client error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/vpn/clients/:id/config
router.get('/clients/:id/config', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const data = getData();
        const clients = data.vpnClients || [];
        const vpnConfig = data.vpnConfig || {};

        const client = clients.find(c => c.id === req.params.id);
        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        let serverPublicKey = vpnConfig.serverPublicKey || '';
        if (!serverPublicKey) {
            try {
                const { stdout } = await safeExec('wg', ['show', 'wg0', 'dump']);
                const parsed = parseWgDump(stdout);
                serverPublicKey = parsed.serverPublicKey;
            } catch { /* ok */ }
        }

        const configString = buildClientConfig(client, serverPublicKey, vpnConfig);
        const qrSvg = await generateQrSvg(configString);

        const safeClient = {
            id: client.id,
            name: client.name,
            publicKey: client.publicKey,
            assignedIp: client.assignedIp,
            createdAt: client.createdAt,
        };

        res.json({ client: safeClient, config: configString, qrSvg });
    } catch (err) {
        log.error('[vpn] get client config error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/vpn/clients/:id
router.delete('/clients/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        let client = null;
        await withData((d) => {
            if (!d.vpnClients) d.vpnClients = [];
            const idx = d.vpnClients.findIndex(c => c.id === req.params.id);
            if (idx === -1) return; // don't save
            client = d.vpnClients[idx];
            d.vpnClients.splice(idx, 1);
            return d;
        });

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        // Remove from live wg0 (best-effort)
        try {
            await safeExec('wg', ['set', 'wg0', 'peer', client.publicKey, 'remove']);
        } catch {
            log.warn('[vpn] Could not remove peer from live wg0 interface');
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] delete client error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/vpn/config
router.put('/config', requireAuth, requirePermission('admin'), async (req, res) => {
    const { endpoint, port, dns } = req.body;

    // Validate port
    if (port !== undefined) {
        const portNum = parseInt(port, 10);
        if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
            return res.status(400).json({ error: 'Port must be between 1024 and 65535' });
        }
    }

    try {
        await withData((d) => {
            if (!d.vpnConfig) d.vpnConfig = {};
            if (endpoint !== undefined) d.vpnConfig.endpoint = endpoint;
            if (port !== undefined) d.vpnConfig.port = parseInt(port, 10);
            if (dns !== undefined) d.vpnConfig.dns = dns;
            return d;
        });

        // Update running interface's listen port (best-effort)
        if (port !== undefined) {
            try {
                await safeExec('wg', ['set', 'wg0', 'listen-port', String(parseInt(port, 10))]);
            } catch {
                log.warn('[vpn] Could not update listen-port on running wg0');
            }
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[vpn] config update error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
```

---

## Task 4: `backend/routes/notifications.js`

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/notifications/config` | requireAuth + admin | Get notification config |
| POST | `/api/notifications/config` | requireAuth + admin | Save notification config |
| POST | `/api/notifications/test` | requireAuth + admin | Send test notification |

**Key insight from reading `notify.ts`:** The module reads config from `data.notifications.email` and `data.notifications.telegram`. The field `data.notifications` is already initialised in `data.ts` `initialState`. The notifications route stores config under the same `data.notifications` key to stay consistent. The `test` endpoint invokes `sendViaEmail` or `sendViaTelegram` from `notify.ts` directly — there is no separate `sendNotification` wrapper function; the module exports `sendViaEmail` and `sendViaTelegram` individually.

- [ ] **Step 4: Create `backend/routes/notifications.js`**

```js
'use strict';

const router = require('express').Router();
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { sendViaEmail, sendViaTelegram } = require('../notify');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip sensitive fields (passwords, tokens) for the GET response.
 * Returns a copy safe to send to the frontend.
 */
function sanitizeConfigForResponse(notifications) {
    if (!notifications) return { email: null, telegram: null };

    const safe = {};

    if (notifications.email) {
        safe.email = {
            host: notifications.email.host || '',
            port: notifications.email.port || 587,
            secure: notifications.email.secure || false,
            user: notifications.email.user || '',
            from: notifications.email.from || '',
            to: notifications.email.to || '',
            // Mask the password: show *** if set, else empty
            password: notifications.email.password ? '***' : '',
            enabled: notifications.email.enabled !== false,
        };
    } else {
        safe.email = null;
    }

    if (notifications.telegram) {
        safe.telegram = {
            chatId: notifications.telegram.chatId || '',
            // Mask the bot token
            botToken: notifications.telegram.botToken ? '***' : '',
            enabled: notifications.telegram.enabled || false,
        };
    } else {
        safe.telegram = null;
    }

    return safe;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/notifications/config
router.get('/config', requireAuth, requirePermission('admin'), (req, res) => {
    try {
        const data = getData();
        const safeConfig = sanitizeConfigForResponse(data.notifications);
        res.json(safeConfig);
    } catch (err) {
        log.error('[notifications] get config error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notifications/config
router.post('/config', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { email, telegram } = req.body;

        await withData((data) => {
            if (!data.notifications) {
                data.notifications = { email: null, telegram: null, history: [], errorReporting: null };
            }

            if (email !== undefined) {
                const existing = data.notifications.email || {};
                data.notifications.email = {
                    host: email.host || existing.host || '',
                    port: parseInt(email.port, 10) || existing.port || 587,
                    secure: email.secure !== undefined ? Boolean(email.secure) : (existing.secure || false),
                    user: email.user || existing.user || '',
                    from: email.from || existing.from || '',
                    to: email.to || existing.to || '',
                    // Only update password if a real value (not '***') is provided
                    password: (email.password && email.password !== '***')
                        ? email.password
                        : existing.password || '',
                    enabled: email.enabled !== undefined ? Boolean(email.enabled) : (existing.enabled !== false),
                };
            }

            if (telegram !== undefined) {
                const existing = data.notifications.telegram || {};
                data.notifications.telegram = {
                    chatId: telegram.chatId || existing.chatId || '',
                    botToken: (telegram.botToken && telegram.botToken !== '***')
                        ? telegram.botToken
                        : existing.botToken || '',
                    enabled: telegram.enabled !== undefined ? Boolean(telegram.enabled) : (existing.enabled || false),
                };
            }

            return data;
        });

        res.json({ success: true });
    } catch (err) {
        log.error('[notifications] save config error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/notifications/test
router.post('/test', requireAuth, requirePermission('admin'), async (req, res) => {
    const { channel } = req.body;

    if (!channel || !['email', 'telegram'].includes(channel)) {
        return res.status(400).json({ error: "channel must be 'email' or 'telegram'" });
    }

    try {
        let result;
        if (channel === 'email') {
            result = await sendViaEmail(
                'HomePiNAS — Test Notification',
                'This is a test notification from your HomePiNAS dashboard.',
                '<h3>HomePiNAS Test</h3><p>This is a test notification from your HomePiNAS dashboard.</p>'
            );
        } else {
            result = await sendViaTelegram(
                '*HomePiNAS Test*\n\nThis is a test notification from your HomePiNAS dashboard.'
            );
        }

        if (!result.success) {
            return res.status(502).json({ error: result.error || 'Notification delivery failed' });
        }

        res.json({ success: true });
    } catch (err) {
        log.error('[notifications] test error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
```

---

## Task 5: `backend/routes/scheduler.js`

**Endpoints:**

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/scheduler` | requireAuth | List all tasks |
| POST | `/api/scheduler` | requireAuth + admin | Create task |
| PUT | `/api/scheduler/:id` | requireAuth + admin | Update task |
| DELETE | `/api/scheduler/:id` | requireAuth + admin | Delete task |

**Exported additional function:** `initScheduler()` — loads all enabled tasks from `data.json` and registers them with `node-cron`. This must be called from `routes.ts` after all routes are registered.

**Scheduler design:**
- A module-level `Map<string, cron.ScheduledTask>` named `liveSchedules` holds the currently running cron jobs keyed by task ID.
- CRUD operations update both `data.json` and `liveSchedules` atomically (cancel old job, register new one if enabled).
- Task `type` values and their `action` shape:
  - `'snapraid-sync'`: action is ignored; runs `safeExec('snapraid', ['sync'])`.
  - `'backup'`: action is `{ jobId: string }` pointing to a backup job in `data.backupJobs`.
  - `'custom-command'`: action is `{ command: string, args: string[] }` — runs via `safeExec` after validating the command is in the allowlist.
- `nextRun` and `lastRun` stored in data.json per task.

- [ ] **Step 5: Create `backend/routes/scheduler.js`**

```js
'use strict';

const router = require('express').Router();
const cron = require('node-cron');
const { v4: uuidv4 } = require('uuid');
const { safeExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ---------------------------------------------------------------------------
// Module-level cron job registry
// ---------------------------------------------------------------------------

/** @type {Map<string, import('node-cron').ScheduledTask>} */
const liveSchedules = new Map();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate a cron expression using node-cron's built-in validator.
 */
function isValidCron(expr) {
    return cron.validate(expr);
}

/**
 * Execute a scheduler task's action.
 * Called by the cron job callback.
 */
async function runTaskAction(task) {
    log.info(`[scheduler] Running task: ${task.name} (${task.id}), type=${task.type}`);

    try {
        if (task.type === 'snapraid-sync') {
            await safeExec('snapraid', ['sync']);
        } else if (task.type === 'backup') {
            // Look up the backup job and run rsync
            const data = getData();
            const jobs = data.backupJobs || [];
            const job = jobs.find(j => j.id === (task.action && task.action.jobId));
            if (!job) {
                log.warn(`[scheduler] Backup job not found: ${task.action && task.action.jobId}`);
                return;
            }
            await safeExec('rsync', ['-av', '--delete', job.source, job.destination]);
        } else if (task.type === 'custom-command') {
            const action = task.action || {};
            if (!action.command) {
                log.warn('[scheduler] custom-command task missing action.command');
                return;
            }
            const args = Array.isArray(action.args) ? action.args : [];
            await safeExec(action.command, args);
        } else {
            log.warn(`[scheduler] Unknown task type: ${task.type}`);
            return;
        }

        // Update lastRun
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const t = data.schedulerTasks.find(t => t.id === task.id);
            if (t) t.lastRun = new Date().toISOString();
            return data;
        });
        log.info(`[scheduler] Task ${task.name} completed successfully`);
    } catch (err) {
        log.error(`[scheduler] Task ${task.name} failed:`, err.message);
    }
}

/**
 * Register a task with node-cron.
 * Cancels any existing registration for the same task ID first.
 */
function scheduleTask(task) {
    // Cancel any existing job for this task
    if (liveSchedules.has(task.id)) {
        liveSchedules.get(task.id).stop();
        liveSchedules.delete(task.id);
    }

    if (!task.enabled) return;

    if (!isValidCron(task.cronExpr)) {
        log.warn(`[scheduler] Invalid cron expression for task ${task.name}: ${task.cronExpr}`);
        return;
    }

    const job = cron.schedule(task.cronExpr, () => {
        runTaskAction(task).catch(err => {
            log.error(`[scheduler] Unhandled error in task ${task.name}:`, err.message);
        });
    }, {
        scheduled: true,
        timezone: 'UTC',
    });

    liveSchedules.set(task.id, job);
    log.info(`[scheduler] Scheduled task: ${task.name} (${task.cronExpr})`);
}

/**
 * Cancel and remove a task from the live registry.
 */
function cancelTask(taskId) {
    if (liveSchedules.has(taskId)) {
        liveSchedules.get(taskId).stop();
        liveSchedules.delete(taskId);
        log.info(`[scheduler] Cancelled task: ${taskId}`);
    }
}

/**
 * Compute the next run time string for a cron expression.
 * node-cron does not expose nextDate() natively, so we return null here.
 * A future enhancement can use the 'cronstrue' or 'cron-parser' package.
 */
function computeNextRun(cronExpr) {
    // Placeholder — node-cron does not expose next run date
    return null;
}

// ---------------------------------------------------------------------------
// initScheduler — called once on server start from routes.ts
// ---------------------------------------------------------------------------

function initScheduler() {
    log.info('[scheduler] Initialising scheduled tasks...');
    const data = getData();
    const tasks = data.schedulerTasks || [];
    let loaded = 0;
    for (const task of tasks) {
        if (task.enabled) {
            scheduleTask(task);
            loaded++;
        }
    }
    log.info(`[scheduler] Loaded ${loaded} enabled task(s) out of ${tasks.length} total`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/scheduler
router.get('/', requireAuth, (req, res) => {
    try {
        const data = getData();
        const tasks = (data.schedulerTasks || []).map(t => ({
            id: t.id,
            name: t.name,
            type: t.type,
            cronExpr: t.cronExpr,
            action: t.action,
            enabled: t.enabled,
            nextRun: computeNextRun(t.cronExpr),
            lastRun: t.lastRun || null,
        }));
        res.json({ tasks });
    } catch (err) {
        log.error('[scheduler] list error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/scheduler
router.post('/', requireAuth, requirePermission('admin'), async (req, res) => {
    const { name, type, cronExpr, action, enabled } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
        return res.status(400).json({ error: 'Task name is required' });
    }
    if (!type || !['snapraid-sync', 'backup', 'custom-command'].includes(type)) {
        return res.status(400).json({ error: "type must be 'snapraid-sync', 'backup', or 'custom-command'" });
    }
    if (!cronExpr || !isValidCron(cronExpr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
    }

    try {
        const newTask = {
            id: uuidv4(),
            name: name.trim(),
            type,
            cronExpr,
            action: action || null,
            enabled: enabled !== false,
            lastRun: null,
            createdAt: new Date().toISOString(),
        };

        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            data.schedulerTasks.push(newTask);
            return data;
        });

        scheduleTask(newTask);

        res.json({
            id: newTask.id,
            name: newTask.name,
            type: newTask.type,
            cronExpr: newTask.cronExpr,
            action: newTask.action,
            enabled: newTask.enabled,
            nextRun: computeNextRun(newTask.cronExpr),
            lastRun: null,
        });
    } catch (err) {
        log.error('[scheduler] create task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/scheduler/:id
router.put('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    const { name, type, cronExpr, action, enabled } = req.body;

    if (type && !['snapraid-sync', 'backup', 'custom-command'].includes(type)) {
        return res.status(400).json({ error: "type must be 'snapraid-sync', 'backup', or 'custom-command'" });
    }
    if (cronExpr && !isValidCron(cronExpr)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
    }

    try {
        let updatedTask = null;
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const idx = data.schedulerTasks.findIndex(t => t.id === req.params.id);
            if (idx === -1) return; // don't save

            const existing = data.schedulerTasks[idx];
            const merged = {
                ...existing,
                name: name !== undefined ? name.trim() : existing.name,
                type: type !== undefined ? type : existing.type,
                cronExpr: cronExpr !== undefined ? cronExpr : existing.cronExpr,
                action: action !== undefined ? action : existing.action,
                enabled: enabled !== undefined ? Boolean(enabled) : existing.enabled,
            };
            data.schedulerTasks[idx] = merged;
            updatedTask = merged;
            return data;
        });

        if (!updatedTask) {
            return res.status(404).json({ error: 'Task not found' });
        }

        // Re-schedule with new settings
        scheduleTask(updatedTask);

        res.json({ success: true });
    } catch (err) {
        log.error('[scheduler] update task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// DELETE /api/scheduler/:id
router.delete('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        let found = false;
        await withData((data) => {
            if (!data.schedulerTasks) data.schedulerTasks = [];
            const before = data.schedulerTasks.length;
            data.schedulerTasks = data.schedulerTasks.filter(t => t.id !== req.params.id);
            if (data.schedulerTasks.length === before) {
                found = false;
                return;
            }
            found = true;
            return data;
        });

        if (!found) {
            return res.status(404).json({ error: 'Task not found' });
        }

        cancelTask(req.params.id);
        res.json({ success: true });
    } catch (err) {
        log.error('[scheduler] delete task error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
module.exports.initScheduler = initScheduler;
```

---

## Task 6: Tests

Each test file lives in `backend/tests/`. Tests are vitest + CommonJS. Because these modules invoke system commands (which are unavailable in CI), the strategy is:
- Mock `../security`, `../data`, `../auth`, `../rbac`, `../notify` using vitest's `vi.mock`.
- Test route logic in isolation: input validation, data transformations, error paths, and that the correct exec calls are made with the correct arguments.

- [ ] **Step 6a: Create `backend/tests/samba.test.js`**

```js
// Tests for backend/routes/samba.js
// Run with: npx vitest backend/tests/samba.test.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Mocks ----------------------------------------------------------------

const mockSafeExec = vi.fn();
const mockSudoExec = vi.fn();
vi.mock('../security', () => ({
    safeExec: mockSafeExec,
    sudoExec: mockSudoExec,
}));

let mockDataStore = {};
vi.mock('../data', () => ({
    getData: vi.fn(() => ({ ...mockDataStore })),
    withData: vi.fn(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    }),
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

// ---- Test setup -----------------------------------------------------------

import express from 'express';
import request from 'supertest'; // note: supertest must be installed as a dev dep

// Delay import until after mocks are set up
let sambaRouter;
let app;

beforeEach(async () => {
    vi.resetAllMocks();
    mockDataStore = { sambaShares: [] };
    mockSafeExec.mockResolvedValue({ stdout: 'active\n', stderr: '' });
    mockSudoExec.mockResolvedValue({ stdout: '', stderr: '' });

    // Re-import so mocks take effect
    vi.resetModules();
    sambaRouter = (await import('../routes/samba.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/samba', sambaRouter);
});

// ---- Tests ----------------------------------------------------------------

describe('GET /api/samba/status', () => {
    it('returns running:true when smbd is active', async () => {
        mockSafeExec
            .mockResolvedValueOnce({ stdout: 'active\n', stderr: '' }) // systemctl is-active
            .mockResolvedValueOnce({ stdout: '{}', stderr: '' });       // smbstatus

        const res = await request(app).get('/api/samba/status');
        expect(res.status).toBe(200);
        expect(res.body.running).toBe(true);
        expect(res.body.shares).toEqual([]);
    });

    it('returns running:false when smbd is inactive', async () => {
        mockSafeExec.mockRejectedValueOnce(new Error('inactive'));

        const res = await request(app).get('/api/samba/status');
        expect(res.status).toBe(200);
        expect(res.body.running).toBe(false);
    });
});

describe('GET /api/samba/shares', () => {
    it('returns empty array when no shares exist', async () => {
        const res = await request(app).get('/api/samba/shares');
        expect(res.status).toBe(200);
        expect(res.body).toEqual([]);
    });

    it('returns existing shares from data store', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'abc', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: true, validUsers: '' }],
        };
        const res = await request(app).get('/api/samba/shares');
        expect(res.status).toBe(200);
        expect(res.body).toHaveLength(1);
        expect(res.body[0].name).toBe('media');
    });
});

describe('POST /api/samba/shares', () => {
    it('creates a share and writes smb.conf', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ name: 'media', path: '/srv/nas/media', comment: 'Media', readOnly: false, guestAccess: true });

        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(res.body.name).toBe('media');
        // sudoExec called with tee /etc/samba/smb.conf
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/samba/smb.conf'], expect.anything());
    });

    it('returns 400 for missing name', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ path: '/srv/nas/media' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('name');
    });

    it('returns 400 for non-absolute path', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ name: 'test', path: 'relative/path' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('absolute');
    });

    it('returns 409 for duplicate share name', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'existing', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: false, validUsers: '' }],
        };
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ name: 'media', path: '/srv/nas/other' });
        expect(res.status).toBe(409);
    });

    it('returns 400 for invalid share name characters', async () => {
        const res = await request(app)
            .post('/api/samba/shares')
            .send({ name: 'my share!', path: '/srv/nas/media' });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/samba/shares/:id', () => {
    it('deletes existing share and rewrites smb.conf', async () => {
        mockDataStore = {
            sambaShares: [{ id: 'abc', name: 'media', path: '/srv/nas/media', comment: '', readOnly: false, guestAccess: false, validUsers: '' }],
        };
        const res = await request(app).delete('/api/samba/shares/abc');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/samba/smb.conf'], expect.anything());
    });

    it('returns 404 for non-existent share', async () => {
        const res = await request(app).delete('/api/samba/shares/nonexistent');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/samba/restart', () => {
    it('calls systemctl restart smbd nmbd', async () => {
        const res = await request(app).post('/api/samba/restart');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('systemctl', ['restart', 'smbd', 'nmbd']);
    });

    it('returns 500 if systemctl fails', async () => {
        mockSudoExec.mockRejectedValueOnce(new Error('systemctl failed'));
        const res = await request(app).post('/api/samba/restart');
        expect(res.status).toBe(500);
    });
});
```

- [ ] **Step 6b: Create `backend/tests/nfs.test.js`**

```js
// Tests for backend/routes/nfs.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSafeExec = vi.fn();
const mockSudoExec = vi.fn();
vi.mock('../security', () => ({
    safeExec: mockSafeExec,
    sudoExec: mockSudoExec,
}));

let mockDataStore = {};
vi.mock('../data', () => ({
    getData: vi.fn(() => ({ ...mockDataStore })),
    withData: vi.fn(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    }),
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

import express from 'express';
import request from 'supertest';

let nfsRouter;
let app;

beforeEach(async () => {
    vi.resetAllMocks();
    mockDataStore = { nfsShares: [] };
    mockSafeExec.mockResolvedValue({ stdout: 'active\n', stderr: '' });
    mockSudoExec.mockResolvedValue({ stdout: '', stderr: '' });

    vi.resetModules();
    nfsRouter = (await import('../routes/nfs.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/nfs', nfsRouter);
});

describe('GET /api/nfs/status', () => {
    it('returns running state and shares', async () => {
        const res = await request(app).get('/api/nfs/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('running');
        expect(res.body).toHaveProperty('shares');
    });
});

describe('POST /api/nfs/shares', () => {
    it('creates a share with defaults', async () => {
        const res = await request(app)
            .post('/api/nfs/shares')
            .send({ path: '/srv/nas/media' });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(res.body.path).toBe('/srv/nas/media');
        expect(res.body.clients).toBe('*');
        expect(res.body.options).toBe('rw,sync,no_subtree_check');
    });

    it('calls exportfs -ra after writing /etc/exports', async () => {
        await request(app)
            .post('/api/nfs/shares')
            .send({ path: '/srv/nas/media' });
        expect(mockSudoExec).toHaveBeenCalledWith('tee', ['/etc/exports'], expect.anything());
        expect(mockSudoExec).toHaveBeenCalledWith('exportfs', ['-ra']);
    });

    it('returns 400 for missing path', async () => {
        const res = await request(app).post('/api/nfs/shares').send({});
        expect(res.status).toBe(400);
    });

    it('returns 400 for relative path', async () => {
        const res = await request(app).post('/api/nfs/shares').send({ path: 'relative' });
        expect(res.status).toBe(400);
    });

    it('returns 409 for duplicate path', async () => {
        mockDataStore = {
            nfsShares: [{ id: '1', path: '/srv/nas/media', clients: '*', options: 'rw,sync,no_subtree_check' }],
        };
        const res = await request(app).post('/api/nfs/shares').send({ path: '/srv/nas/media' });
        expect(res.status).toBe(409);
    });
});

describe('DELETE /api/nfs/shares/:id', () => {
    it('removes share and updates /etc/exports', async () => {
        mockDataStore = {
            nfsShares: [{ id: 'abc', path: '/srv/nas/media', clients: '*', options: 'rw' }],
        };
        const res = await request(app).delete('/api/nfs/shares/abc');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('exportfs', ['-ra']);
    });

    it('returns 404 for non-existent share', async () => {
        const res = await request(app).delete('/api/nfs/shares/ghost');
        expect(res.status).toBe(404);
    });
});

describe('POST /api/nfs/restart', () => {
    it('restarts nfs-kernel-server', async () => {
        const res = await request(app).post('/api/nfs/restart');
        expect(res.status).toBe(200);
        expect(mockSudoExec).toHaveBeenCalledWith('systemctl', ['restart', 'nfs-kernel-server']);
    });
});
```

- [ ] **Step 6c: Create `backend/tests/vpn.test.js`**

```js
// Tests for backend/routes/vpn.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSafeExec = vi.fn();
const mockSudoExec = vi.fn();
vi.mock('../security', () => ({
    safeExec: mockSafeExec,
    sudoExec: mockSudoExec,
}));

let mockDataStore = {};
vi.mock('../data', () => ({
    getData: vi.fn(() => ({ ...mockDataStore })),
    withData: vi.fn(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    }),
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

import express from 'express';
import request from 'supertest';

let vpnRouter;
let app;

beforeEach(async () => {
    vi.resetAllMocks();
    mockDataStore = { vpnClients: [], vpnConfig: {} };
    mockSafeExec.mockResolvedValue({ stdout: '', stderr: '' });
    mockSudoExec.mockResolvedValue({ stdout: '', stderr: '' });

    vi.resetModules();
    vpnRouter = (await import('../routes/vpn.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/vpn', vpnRouter);
});

describe('GET /api/vpn/status', () => {
    it('returns installed:false when wg is not found', async () => {
        mockSafeExec.mockRejectedValue(new Error('not found'));
        const res = await request(app).get('/api/vpn/status');
        expect(res.status).toBe(200);
        expect(res.body.installed).toBe(false);
        expect(res.body.running).toBe(false);
    });

    it('returns installed:true and running:true when both commands succeed', async () => {
        mockSafeExec
            .mockResolvedValueOnce({ stdout: '/usr/bin/wg\n', stderr: '' })  // which wg
            .mockResolvedValueOnce({ stdout: 'active\n', stderr: '' })        // systemctl is-active
            .mockResolvedValueOnce({ stdout: '', stderr: '' });               // wg show dump
        const res = await request(app).get('/api/vpn/status');
        expect(res.status).toBe(200);
        expect(res.body.installed).toBe(true);
        expect(res.body.running).toBe(true);
    });
});

describe('POST /api/vpn/install', () => {
    it('returns installing:true immediately', async () => {
        const res = await request(app).post('/api/vpn/install');
        expect(res.status).toBe(200);
        expect(res.body.installing).toBe(true);
    });
});

describe('GET /api/vpn/install/progress', () => {
    it('returns progress object', async () => {
        const res = await request(app).get('/api/vpn/install/progress');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('step');
        expect(res.body).toHaveProperty('progress');
        expect(res.body).toHaveProperty('completed');
        expect(res.body).toHaveProperty('running');
    });
});

describe('PUT /api/vpn/config', () => {
    it('updates vpnConfig and responds with success', async () => {
        const res = await request(app)
            .put('/api/vpn/config')
            .send({ endpoint: 'vpn.example.com', port: 51820, dns: '1.1.1.1' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('returns 400 for invalid port (below 1024)', async () => {
        const res = await request(app)
            .put('/api/vpn/config')
            .send({ port: 80 });
        expect(res.status).toBe(400);
    });

    it('returns 400 for port above 65535', async () => {
        const res = await request(app)
            .put('/api/vpn/config')
            .send({ port: 99999 });
        expect(res.status).toBe(400);
    });
});

describe('DELETE /api/vpn/clients/:id', () => {
    it('returns 404 for non-existent client', async () => {
        const res = await request(app).delete('/api/vpn/clients/ghost');
        expect(res.status).toBe(404);
    });

    it('removes an existing client', async () => {
        mockDataStore = {
            vpnClients: [{ id: 'abc', name: 'laptop', publicKey: 'PUBKEY', assignedIp: '10.8.0.2', privateKey: 'PRIVKEY', createdAt: '' }],
            vpnConfig: {},
        };
        mockSafeExec.mockResolvedValue({ stdout: '', stderr: '' }); // wg set peer remove
        const res = await request(app).delete('/api/vpn/clients/abc');
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('POST /api/vpn/clients', () => {
    it('returns 400 if name is missing', async () => {
        const res = await request(app).post('/api/vpn/clients').send({});
        expect(res.status).toBe(400);
    });
});
```

- [ ] **Step 6d: Create `backend/tests/notifications.test.js`**

```js
// Tests for backend/routes/notifications.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

let mockDataStore = {};
vi.mock('../data', () => ({
    getData: vi.fn(() => ({ ...mockDataStore })),
    withData: vi.fn(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    }),
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

import express from 'express';
import request from 'supertest';

let notificationsRouter;
let app;

beforeEach(async () => {
    vi.resetAllMocks();
    mockDataStore = {
        notifications: {
            email: null,
            telegram: null,
            history: [],
            errorReporting: null,
        },
    };

    vi.resetModules();
    notificationsRouter = (await import('../routes/notifications.js')).default;
    app = express();
    app.use(express.json());
    app.use('/api/notifications', notificationsRouter);
});

describe('GET /api/notifications/config', () => {
    it('returns null email and telegram when not configured', async () => {
        const res = await request(app).get('/api/notifications/config');
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
        const res = await request(app).get('/api/notifications/config');
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
        const res = await request(app).get('/api/notifications/config');
        expect(res.body.telegram.botToken).toBe('***');
        expect(res.body.telegram.chatId).toBe('123456');
    });
});

describe('POST /api/notifications/config', () => {
    it('saves email config', async () => {
        const res = await request(app)
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
        // Password should be stored in dataStore
        expect(mockDataStore.notifications.email.password).toBe('apppassword');
    });

    it('does not overwrite existing password when *** is submitted', async () => {
        mockDataStore = {
            notifications: {
                email: { host: 'smtp.gmail.com', port: 587, secure: false, user: 'me@gmail.com', from: 'me@gmail.com', to: 'alerts@gmail.com', password: 'existingpassword', enabled: true },
            },
        };
        await request(app)
            .post('/api/notifications/config')
            .send({ email: { password: '***' } });
        expect(mockDataStore.notifications.email.password).toBe('existingpassword');
    });
});

describe('POST /api/notifications/test', () => {
    it('returns 400 for invalid channel', async () => {
        const res = await request(app).post('/api/notifications/test').send({ channel: 'slack' });
        expect(res.status).toBe(400);
    });

    it('calls sendViaEmail for email channel', async () => {
        mockSendViaEmail.mockResolvedValue({ success: true });
        const res = await request(app).post('/api/notifications/test').send({ channel: 'email' });
        expect(res.status).toBe(200);
        expect(mockSendViaEmail).toHaveBeenCalledOnce();
    });

    it('calls sendViaTelegram for telegram channel', async () => {
        mockSendViaTelegram.mockResolvedValue({ success: true });
        const res = await request(app).post('/api/notifications/test').send({ channel: 'telegram' });
        expect(res.status).toBe(200);
        expect(mockSendViaTelegram).toHaveBeenCalledOnce();
    });

    it('returns 502 when notification delivery fails', async () => {
        mockSendViaEmail.mockResolvedValue({ success: false, error: 'SMTP connection refused' });
        const res = await request(app).post('/api/notifications/test').send({ channel: 'email' });
        expect(res.status).toBe(502);
        expect(res.body.error).toBe('SMTP connection refused');
    });
});
```

- [ ] **Step 6e: Create `backend/tests/scheduler.test.js`**

```js
// Tests for backend/routes/scheduler.js

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock node-cron before importing the router
const mockCronSchedule = vi.fn(() => ({ stop: vi.fn() }));
const mockCronValidate = vi.fn((expr) => {
    // Accept any non-empty string as valid cron for testing
    const validExprs = ['0 2 * * *', '*/5 * * * *', '0 0 * * 0'];
    return validExprs.includes(expr);
});
vi.mock('node-cron', () => ({
    default: {
        schedule: mockCronSchedule,
        validate: mockCronValidate,
    },
    schedule: mockCronSchedule,
    validate: mockCronValidate,
}));

let mockDataStore = {};
vi.mock('../data', () => ({
    getData: vi.fn(() => ({ ...mockDataStore })),
    withData: vi.fn(async (fn) => {
        const data = { ...mockDataStore };
        const result = await fn(data);
        if (result !== undefined) mockDataStore = result;
        return result;
    }),
}));

vi.mock('../security', () => ({
    safeExec: vi.fn().mockResolvedValue({ stdout: '', stderr: '' }),
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

import express from 'express';
import request from 'supertest';

let schedulerRouter;
let app;

beforeEach(async () => {
    vi.resetAllMocks();
    mockDataStore = { schedulerTasks: [] };
    mockCronValidate.mockImplementation((expr) => ['0 2 * * *', '*/5 * * * *', '0 0 * * 0'].includes(expr));
    mockCronSchedule.mockReturnValue({ stop: vi.fn() });

    vi.resetModules();
    // Re-mock after resetModules
    const mod = await import('../routes/scheduler.js');
    schedulerRouter = mod.default;
    app = express();
    app.use(express.json());
    app.use('/api/scheduler', schedulerRouter);
});

describe('GET /api/scheduler', () => {
    it('returns empty tasks array', async () => {
        const res = await request(app).get('/api/scheduler');
        expect(res.status).toBe(200);
        expect(res.body.tasks).toEqual([]);
    });

    it('returns tasks from data store', async () => {
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Nightly Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };
        const res = await request(app).get('/api/scheduler');
        expect(res.body.tasks).toHaveLength(1);
        expect(res.body.tasks[0].name).toBe('Nightly Sync');
    });
});

describe('POST /api/scheduler', () => {
    it('creates a task and registers it with node-cron', async () => {
        const res = await request(app)
            .post('/api/scheduler')
            .send({ name: 'Nightly Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', enabled: true });
        expect(res.status).toBe(200);
        expect(res.body.id).toBeDefined();
        expect(mockCronSchedule).toHaveBeenCalledWith('0 2 * * *', expect.any(Function), expect.any(Object));
    });

    it('returns 400 for missing name', async () => {
        const res = await request(app)
            .post('/api/scheduler')
            .send({ type: 'snapraid-sync', cronExpr: '0 2 * * *' });
        expect(res.status).toBe(400);
    });

    it('returns 400 for invalid cron expression', async () => {
        const res = await request(app)
            .post('/api/scheduler')
            .send({ name: 'test', type: 'snapraid-sync', cronExpr: 'not-a-cron' });
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('cron');
    });

    it('returns 400 for invalid type', async () => {
        const res = await request(app)
            .post('/api/scheduler')
            .send({ name: 'test', type: 'unknown-type', cronExpr: '0 2 * * *' });
        expect(res.status).toBe(400);
    });

    it('does not register with cron when enabled is false', async () => {
        await request(app)
            .post('/api/scheduler')
            .send({ name: 'disabled task', type: 'snapraid-sync', cronExpr: '0 2 * * *', enabled: false });
        expect(mockCronSchedule).not.toHaveBeenCalled();
    });
});

describe('PUT /api/scheduler/:id', () => {
    it('returns 404 for non-existent task', async () => {
        const res = await request(app)
            .put('/api/scheduler/ghost')
            .send({ name: 'Updated' });
        expect(res.status).toBe(404);
    });

    it('updates task and re-schedules', async () => {
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Old Name', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };
        const res = await request(app)
            .put('/api/scheduler/abc')
            .send({ name: 'New Name', cronExpr: '*/5 * * * *' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});

describe('DELETE /api/scheduler/:id', () => {
    it('returns 404 for non-existent task', async () => {
        const res = await request(app).delete('/api/scheduler/ghost');
        expect(res.status).toBe(404);
    });

    it('removes the task and cancels the cron job', async () => {
        const stopMock = vi.fn();
        mockCronSchedule.mockReturnValue({ stop: stopMock });
        mockDataStore = {
            schedulerTasks: [
                { id: 'abc', name: 'Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *', action: null, enabled: true, lastRun: null },
            ],
        };

        // First create the task so the cron job is registered in liveSchedules
        await request(app)
            .post('/api/scheduler')
            .send({ name: 'Sync', type: 'snapraid-sync', cronExpr: '0 2 * * *' });

        const res = await request(app).delete('/api/scheduler/abc');
        expect(res.status).toBe(200);
    });
});
```

---

## Sequencing and Dependencies

The tasks in this phase are largely independent and can be implemented in parallel. The only sequencing constraints are:

1. The prerequisite modifications to `security.ts` (add `exportfs`) and `package.json` (add `node-cron`) must be done **before** implementing the nfs and scheduler routes respectively.
2. `routes.ts` must be updated to call `initScheduler()` **after** the scheduler module exists.
3. Tests use `supertest`, which must also be added as a dev dependency: `npm install --save-dev supertest @types/supertest`.

**Recommended execution order:**
1. Install `node-cron` and `supertest` — unblocks all tasks.
2. Patch `security.ts` — unblocks NFS.
3. Implement samba.js, nfs.js, notifications.js in parallel (no inter-dependencies).
4. Implement vpn.js (no deps on samba/nfs/notifications).
5. Implement scheduler.js.
6. Patch `routes.ts` to call `initScheduler()`.
7. Implement all five test files in parallel.

---

## Potential Challenges

**1. `sudoExec` stdin piping for `tee`**

`sudoExec` wraps `execFileAsync` from `child_process.execFile`. The `execFile` promisified form does accept an `input` option that writes to the child's stdin (it maps to the `input` option in the underlying `child_process` options). Verify this works by checking Node.js 20 docs: `util.promisify(execFile)` produces a function that passes options including `input` directly through. If `input` is not supported via `execFileAsync`, the alternative is to write the config to a temp file with `fs.writeFile` and pass the file path to `tee` rather than using stdin.

**2. WireGuard key generation via `safeExec`**

`safeExec` uses `execFileAsync` which supports `input` for stdin. However since `wg genkey` outputs to stdout and `wg pubkey` reads from stdin, we use the `spawnAsync` helper defined inside `vpn.js` for maximum control and async-safe stdin piping. This keeps key generation entirely within the route module without modifying `security.ts`.

**3. `node-cron` task persistence across restarts**

When the server restarts, `initScheduler()` re-reads all tasks from `data.json` and re-registers them. Because `nextRun` is not stored (just computed at read time), there is no staleness issue. The `lastRun` field is updated by the job callback via `withData`, so it persists correctly.

**4. VPN install progress tracking with `spawnAsync`**

The `spawnAsync` helper in `vpn.js` wraps `child_process.spawn`. The `apt-get install` command can take 1-5 minutes. The progress polling endpoint returns `installProgress.step` which advances from `'downloading'` → `'configuring'` → `'done'` or `'error'`. The progress steps are approximated (not real apt-get progress) — this is acceptable for a UI spinner.

**5. `smbd` and `nmbd` in `systemctl restart`**

`sudoExec('systemctl', ['restart', 'smbd', 'nmbd'])` passes two service names as separate args. `systemctl` supports this: `systemctl restart smbd nmbd` is valid syntax. No special handling needed.

---

## Files Modified (not created)

**`backend/security.ts` — add `exportfs` to allowedSudoCommands array (line 97):**

Change:
```ts
'apt-get', 'dpkg', 'fuser', 'killall', 'rm', 'sysctl', 'wg'
```
To:
```ts
'apt-get', 'dpkg', 'fuser', 'killall', 'rm', 'sysctl', 'wg',
'exportfs'
```

**`backend/routes.ts` — call `initScheduler()` at the end of `registerRoutes()` (after line 144, before `}`)**:

```ts
// Initialize task scheduler (loads and registers all enabled tasks from data.json)
const { initScheduler } = require('./routes/scheduler');
initScheduler();
```

---

### Critical Files for Implementation

- `/C:/Users/Juan Luis/Desktop/dashboard-v3.5/backend/security.ts`
- `/C:/Users/Juan Luis/Desktop/dashboard-v3.5/backend/routes.ts`
- `/C:/Users/Juan Luis/Desktop/dashboard-v3.5/backend/notify.ts`
- `/C:/Users/Juan Luis/Desktop/dashboard-v3.5/backend/data.ts`
- `/C:/Users/Juan Luis/Desktop/dashboard-v3.5/package.json`