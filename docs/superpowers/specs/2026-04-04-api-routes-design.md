# API Routes Implementation Design

> **For agentic workers:** This spec drives 26 route modules under `backend/routes/`. Each module is a CommonJS Express Router. Use `superpowers:subagent-driven-development` to implement.

**Goal:** Implement all missing `backend/routes/` modules so the HomePiNAS dashboard server starts and serves every API endpoint the frontend requires.

**Architecture:** CommonJS Express routers, one file per feature domain. All system commands go through `safeExec`/`sudoExec` from `security.ts`. Persistent state lives in `data.json` via `withData` from `data.ts`. Auth enforced via `requireAuth` from `auth.ts` and `requirePermission` from `rbac.ts`.

**Tech Stack:** Node.js 20+, Express 4, TypeScript via tsx, SQLite sessions, better-sqlite3, node-pty (terminal), multer (file upload), node-cron (scheduler).

---

## Prerequisites (must be done before implementing routes)

### npm packages to install
```bash
npm install bcryptjs otplib qrcode multer node-cron
npm install --save-dev @types/bcryptjs @types/multer @types/node-cron
```

### security.ts allowlist additions
Add to `allowedCommands` in `safeExec`:
```
'docker', 'git', 'find', 'badblocks', 'npm'
```

Add to `allowedSudoCommands` in `sudoExec`:
```
'exportfs', 'ip'
```

### routes.ts additions
The storage router handles `/api/cache/move-now`. Add this mount after the existing storage mount:
```ts
app.use('/api/cache', storageRoutes);
```

---

## Conventions (apply to ALL modules)

```js
// Every route module follows this structure:
const router = require('express').Router();
const { safeExec, sudoExec } = require('../security');
const { withData, getData, saveData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

// ... route handlers ...

module.exports = router;
```

- Error responses: `res.status(4xx).json({ error: 'message' })`
- Success with resource: `res.json(resource)`
- Success no body: `res.json({ success: true })`
- All routes require `requireAuth` except public ones (auth module only)
- Write operations require `requirePermission('write')`, destructive ops `requirePermission('delete')`
- Admin-only ops require `requirePermission('admin')`

---

## Module 1: auth (`routes/auth.js`)

Mounted at root (`/api`). **No auth required** on these endpoints.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/status` | — | `{ requireSetup: boolean }` |
| POST | `/api/setup` | `{ username, password }` | `{ success, sessionId, csrfToken, user }` |
| POST | `/api/login` | `{ username, password }` | `{ success, sessionId, csrfToken, user }` or `{ requires2FA: true, pendingToken }` |
| POST | `/api/login/2fa` | `{ pendingToken, totpCode }` | `{ success, sessionId, csrfToken, user }` |
| POST | `/api/verify-session` | — (uses `X-Session-Id` header) | `{ csrfToken, user }` |

**Implementation notes:**
- `GET /api/status`: reads `data.json`, returns `{ requireSetup: !data.user }` (no user = first run)
- `POST /api/setup`: validates username (sanitizeUsername), hashes password (bcrypt), saves to `data.user`, creates session, returns tokens. Fails with 409 if already set up.
- `POST /api/login`: bcrypt.compare against `data.user.password`. If user has TOTP enabled, skip full session creation and return `{ requires2FA: true, pendingToken }` (pendingToken is a short-lived JWT or stored in a temp map keyed by random token).
- `POST /api/login/2fa`: validates pendingToken + TOTP code via `decryptTotpSecret` + speakeasy/otplib. On success creates full session.
- `POST /api/verify-session`: returns fresh CSRF token and user info. Used by frontend on page load.

---

## Module 2: users (`routes/users.js`)

Mounted at `/api/users`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| PUT | `/api/users/me/password` | `{ currentPassword, newPassword }` | `{ success: true }` |

**Implementation notes:**
- Requires `requireAuth`. Verifies `currentPassword` against stored hash. Hashes new password with bcrypt (cost 12). Updates `data.user.password` (or `data.users[username].password` for non-primary users). Invalidates all other sessions for this user.
- Validates new password: min 8 chars.

---

## Module 3: totp (`routes/totp.js`)

Mounted at `/api/totp`. All routes require `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/totp/status` | — | `{ enabled: boolean }` |
| POST | `/api/totp/setup` | — | `{ qrCode: string (data URI), secret: string (Base32) }` |
| POST | `/api/totp/verify` | `{ token: string }` | `{ success: true }` |
| DELETE | `/api/totp/disable` | `{ password: string }` | `{ success: true }` |

**Implementation notes:**
- Uses `otplib` (or `speakeasy`) for TOTP generation/verification and `qrcode` for QR data URI.
- `POST /setup`: generates new Base32 secret, stores **unconfirmed** secret temporarily in session (not in data.json yet). Returns QR and plain secret.
- `POST /verify`: verifies the token against the pending secret. On success, encrypts via `encryptTotpSecret` from `totp-crypto.ts` and saves to `data.user.totpSecret`. Marks `data.user.totpEnabled = true`.
- `DELETE /disable`: verifies password, clears `totpSecret` and `totpEnabled` from user record.

---

## Module 4: system (`routes/system.js`)

Mounted at `/api/system`. All routes require `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/system/stats` | — | `{ cpuLoad, cpuTemp, ramUsed, ramTotal, uptime, hostname, publicIP }` |
| GET | `/api/dashboard` | — | same as `/api/system/stats` |
| GET | `/api/system/disks` | — | `[{ id, model, type, size, temp, serial, usage }]` |
| GET | `/api/system/fan/mode` | — | `{ mode: 'silent'|'balanced'|'performance' }` |
| POST | `/api/system/fan/mode` | `{ mode }` | `{ success: true }` |
| POST | `/api/system/fan` | `{ mode, rpm? }` | `{ success: true }` |
| GET | `/api/system/dashboard-updates` | — | `{ hasUpdate: boolean, latestVersion: string }` |
| POST | `/api/system/apply-dashboard-update` | — | `{ success: true }` |
| GET | `/api/system/os-updates` | — | `{ hasUpdate: boolean, updateCount: number }` |
| POST | `/api/system/apply-os-updates` | — | `{ success: true }` |
| POST | `/api/system/action` | `{ action: 'reboot'|'shutdown' }` | `{ success: true }` |
| POST | `/api/system/factory-reset` | — | `{ success: true }` |

**Implementation notes:**
- `stats`: CPU load from `os.loadavg()[0]` / `os.cpus().length`. RAM from `os.freemem()` / `os.totalmem()`. Uptime from `os.uptime()`. CPU temp from `/sys/class/thermal/thermal_zone0/temp` (divide by 1000). Hostname from `os.hostname()`. PublicIP from `data.publicIp` (cached by polling).
- `disks`: `safeExec('lsblk', ['-J', '-o', 'NAME,MODEL,TYPE,SIZE,SERIAL'])` + `safeExec('smartctl', ['-A', '/dev/<disk>'])` for temp.
- Fan mode: persisted in `data.fanMode`. Actual fan control via `systemctl` if fan service exists, otherwise best-effort.
- `dashboard-updates`: `safeExec('git', ['fetch', '--tags'])` + compare current tag to latest. Read current version from `package.json`.
- `apply-dashboard-update`: `safeExec('git', ['pull'])` + `safeExec('npm', ['install'])` + `sudoExec('systemctl', ['restart', 'homepinas'])`.
- `os-updates`: `sudoExec('apt-get', ['-s', 'upgrade'])` parse output for upgrade count.
- `apply-os-updates`: `sudoExec('apt-get', ['-y', 'upgrade'])`.
- `action`: delegates to power module logic (`systemctl reboot` / `systemctl poweroff`). Requires `requirePermission('admin')`.
- `factory-reset`: clears `config/data.json` (reset to `{}`), requires `requirePermission('admin')`.

---

## Module 5: power (`routes/power.js`)

Mounted at `/api/power`. Requires `requireAuth` + `requirePermission('admin')`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/power/reboot` | — | `{ success: true }` |
| POST | `/api/power/shutdown` | — | `{ success: true }` |
| POST | `/api/power/:action` | — | `{ success: true }` |

**Implementation notes:**
- Maps `reboot` → `sudoExec('systemctl', ['reboot'])`, `shutdown`/`poweroff` → `sudoExec('systemctl', ['poweroff'])`.
- Generic `/:action` handler normalises to `reboot` or `shutdown`, rejects anything else with 400.
- Response is sent before the command executes (fire-and-forget with 1s delay).

---

## Module 6: update (`routes/update.js`)

Mounted at `/api/update`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/update/check` | — | `{ updateAvailable, currentVersion, latestVersion, changelog, localChanges, localChangesFiles }` |
| POST | `/api/update/apply` | — | `{ success: true, message }` |
| GET | `/api/update/check-os` | — | `{ updatesAvailable, securityUpdates, packages }` |
| POST | `/api/update/apply-os` | — | `{ success: true }` |

**Implementation notes:**
- `check`: reads `package.json` for `currentVersion`. Runs `safeExec('git', ['fetch', '--tags', '--quiet'])` then `safeExec('git', ['tag', '-l'])` to find latest semver tag. `localChanges` from `safeExec('git', ['status', '--porcelain'])`. `changelog` from `safeExec('git', ['log', '--oneline', `${currentVersion}..${latestVersion}`])`. Apply requires `requirePermission('admin')`.
- `check-os`: parses output of `sudoExec('apt-get', ['--dry-run', '-s', 'upgrade'])`. Counts packages, identifies security updates (from `security.ubuntu.com` or `debian.org/security`).
- `apply-os`: `sudoExec('apt-get', ['-y', '--no-install-recommends', 'upgrade'])`. Requires `requirePermission('admin')`.

---

## Module 7: network (`routes/network.js`)

Mounted at `/api/network`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/network/interfaces` | — | `[{ id, name, status, dhcp, ip, subnet, gateway, dns }]` |
| POST | `/api/network/configure` | `{ id, dhcp, ip?, subnet?, gateway?, dns? }` | `{ success: true, message }` |
| GET | `/api/network/public-ip` | — | `{ ip: string }` |

**Implementation notes:**
- `interfaces`: `safeExec('ip', ['-j', 'addr'])` parses JSON output. Read DHCP status from `/etc/network/interfaces` or `NetworkManager` config.
- `configure`: validates IP/subnet/gateway with regex. Writes `/etc/network/interfaces` entry via `sudoExec('tee', ...)`. Runs `sudoExec('ip', ['link', 'set', id, 'up'])`. Requires `requirePermission('admin')`.
- `public-ip`: caches result in `data.publicIp` with 10-min TTL. Fetches `https://api.ipify.org?format=json`.

---

## Module 8: storage (`routes/storage.js`)

Mounted at `/api/storage` (plus `/api/cache`). Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/storage/pool/status` | — | `{ configured, running, poolMount, poolSize, poolUsed, poolFree, usedPercent }` |
| POST | `/api/storage/pool/configure` | `{ disks: [{id, role, format, filesystem}] }` | `{ success, poolMount }` |
| POST | `/api/storage/snapraid/sync` | — | `{ success, jobId }` |
| GET | `/api/storage/snapraid/sync/progress` | — | `{ progress, status, running, error }` |
| GET | `/api/storage/cache/status` | — | `{ hasCache, cacheDisks, fileCounts, policy, mover }` |
| POST | `/api/cache/move-now` | — | `{ message }` |
| GET | `/api/storage/disks/health` | — | `{ summary, disks }` |
| GET | `/api/storage/disks/iostats` | — | `{ [diskId]: { read, write } }` |
| POST | `/api/storage/disks/remove-from-pool` | `{ diskId }` | `{ success, message }` |
| POST | `/api/storage/badblocks/:diskId` | — | `{ success, estimatedHours }` |
| GET | `/api/storage/badblocks/:diskId/status` | — | `{ running, progress, badBlocksFound, result }` |
| DELETE | `/api/storage/badblocks/:diskId` | — | `{ success }` |
| POST | `/api/storage/smart/:diskId/test` | `{ type: 'short'|'long' }` | `{ success }` |
| GET | `/api/storage/smart/:diskId/status` | — | `{ testInProgress, remainingPercent }` |
| GET | `/api/storage/file-location` | query: `path` | `{ diskType, physicalLocation }` |
| POST | `/api/storage/file-locations` | `{ paths: string[] }` | `{ locations }` |

**Implementation notes:**
- Pool status: `safeExec('df', ['-h', poolMount])` + read `data.storageConfig`.
- Pool configure: `requirePermission('admin')`. For each disk with `format:true`: `sudoExec('mkfs.ext4', ['-F', `/dev/${id}`])`. Then build mergerfs mount command and write to `/etc/fstab` via `sudoExec('tee', ...)`.
- SnapRAID: spawn `safeExec('snapraid', ['sync'])` async. Store job progress in memory map keyed by jobId.
- Disk health: `safeExec('smartctl', ['-A', '-j', `/dev/${id}`])` for each disk. Parse reallocated sectors, pending sectors, power-on time, temperature.
- IO stats: `safeExec('cat', ['/proc/diskstats'])` parsed.
- Badblocks: spawn `safeExec('badblocks', ['-sv', `/dev/${id}`])` async. Track in memory.
- SMART test: `safeExec('smartctl', ['-t', type, `/dev/${id}`])`.
- File location: check if path is under cache mount vs data mount (read from `data.storageConfig`).

---

## Module 9: docker (`routes/docker.js`)

Mounted at `/api/docker`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/docker/containers` | — | `[{ id, name, image, status, cpu, ram, ports, mounts, notes, hasUpdate, compose }]` |
| GET | `/api/docker/update-status` | — | `{ lastCheck, updatesAvailable }` |
| POST | `/api/docker/action` | `{ id, action }` | `{ success: true }` |
| POST | `/api/docker/check-updates` | — | `{ totalImages, updatesAvailable }` |
| POST | `/api/docker/update` | `{ containerId }` | `{ success: true }` |
| GET | `/api/docker/compose/list` | — | `[{ name, modified }]` |
| POST | `/api/docker/compose/import` | `{ name, content }` | `{ success: true }` |
| POST | `/api/docker/compose/up` | `{ name }` | `{ success: true, output? }` |
| POST | `/api/docker/compose/down` | `{ name }` | `{ success: true }` |
| GET | `/api/docker/compose/:name` | — | `{ content: string }` |
| PUT | `/api/docker/compose/:name` | `{ content }` | `{ success: true }` |
| DELETE | `/api/docker/compose/:name` | — | `{ success: true }` |
| POST | `/api/docker/containers/:id/notes` | `{ notes }` | `{ success: true }` |

**Implementation notes:**
- Uses `safeExec('docker', [...])` — `docker` must be in the safeExec allowlist (or added).
- `containers`: `docker ps --format '{{json .}}'` + `docker stats --no-stream --format '{{json .}}'`.
- `action`: validates action ∈ `['start','stop','restart']`. Runs `docker {action} {id}`.
- `check-updates`: for each image, `docker pull --dry-run` or compare local digest vs registry. Store result in `data.dockerUpdateStatus`.
- `update`: `docker pull {image}` + `docker stop {id}` + `docker rm {id}` + `docker run` with same config (or `docker compose up -d` if compose-managed).
- Compose files stored in `config/compose/{name}.yml`. `validateComposeContent` from `sanitize.ts` before saving.
- Notes stored in `data.containerNotes[id]`.
- Write ops require `requirePermission('write')`.

---

## Module 10: files (`routes/files.js`)

Mounted at `/api/files`. Requires `requireAuth`.

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| GET | `/api/files/list` | query: `path` | `{ items: [{name,type,size,modified,permissions}] }` |
| GET | `/api/files/download` | query: `path` | binary stream |
| POST | `/api/files/upload` | FormData: `files`, `path` | `{ success: true }` |
| POST | `/api/files/delete` | `{ path }` | `{ success: true }` |
| POST | `/api/files/rename` | `{ oldPath, newPath }` | `{ success: true }` |
| POST | `/api/files/copy` | `{ srcPath, destPath }` | `{ success: true }` |
| POST | `/api/files/move` | `{ source, destination }` | `{ success: true }` |
| POST | `/api/files/mkdir` | `{ path }` | `{ success: true }` |
| GET | `/api/files/search` | query: `path`, `query` | `{ results: [{path,name,type,size}] }` |
| GET | `/api/files/user-home` | — | `{ homePath, hasRestrictions, allowedPaths }` |

**Implementation notes:**
- All paths validated with `sanitizePath` and checked against `dangerousPaths` blocklist before any fs operation.
- `list`: `fs.readdir` with `withFileTypes: true` + `fs.stat` per entry. Returns sorted (dirs first).
- `download`: `fs.createReadStream(safePath).pipe(res)` with `Content-Disposition: attachment`.
- `upload`: multer `diskStorage` to temp dir, then move to target path. Max 10GB per file.
- `delete`: `fs.rm(path, { recursive: true })`.
- `rename`/`copy`/`move`: use `fs.rename`, `fs.cp` (Node 16+) respectively.
- `search`: `safeExec('find', [basePath, '-iname', `*${query}*`, '-maxdepth', '10'])`.
- `user-home`: returns `{ homePath: '/srv/nas', hasRestrictions: false, allowedPaths: ['/srv/nas'] }` by default. Reads from `data.users[username].homePath` if set.
- Upload/delete/rename/mkdir/copy/move require `requirePermission('write')`.

---

## Module 11: vpn (`routes/vpn.js`)

Mounted at `/api/vpn`. Requires `requireAuth` + `requirePermission('admin')`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/vpn/status` | — | `{ running, installed, endpoint, publicIP, port, dns, subnet, clientCount, clients, connectedPeers }` |
| POST | `/api/vpn/install` | — | `{ installing: true }` |
| GET | `/api/vpn/install/progress` | — | `{ step, progress, error?, completed, running }` |
| POST | `/api/vpn/start` | — | `{ success: true }` |
| POST | `/api/vpn/stop` | — | `{ success: true }` |
| POST | `/api/vpn/restart` | — | `{ success: true }` |
| POST | `/api/vpn/uninstall` | — | `{ success: true }` |
| POST | `/api/vpn/clients` | `{ name }` | `{ client, config, qrSvg }` |
| GET | `/api/vpn/clients/:id/config` | — | `{ client, config, qrSvg }` |
| DELETE | `/api/vpn/clients/:id` | — | `{ success: true }` |
| PUT | `/api/vpn/config` | `{ endpoint, port, dns }` | `{ success: true }` |

**Implementation notes:**
- `installed`: check `safeExec('which', ['wg'])` exits 0.
- `running`: check `safeExec('systemctl', ['is-active', 'wg-quick@wg0'])`.
- `install`: spawn `sudoExec('apt-get', ['-y', 'install', 'wireguard', 'qrencode'])` async. Track progress in memory.
- Client keys: `safeExec('wg', ['genkey'])` → private key, pipe to `safeExec('wg', ['pubkey'])` → public key. Assign IP from subnet (e.g. `10.0.0.2/32` onwards). Write to `wg0.conf` and `config/wireguard/clients.json`.
- QR: `safeExec('qrencode', ['-t', 'svg', '-o', '-', configString])`.
- `config`: validates port (1024-65535), updates `wg0.conf`, `wg set wg0 listen-port {port}`.

---

## Module 12: samba (`routes/samba.js`)

Mounted at `/api/samba`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/samba/status` | — | `{ running, shares, connectedUsers }` |
| GET | `/api/samba/shares` | — | `[{ id, name, path, comment, readOnly, guestAccess, validUsers }]` |
| POST | `/api/samba/shares` | share fields | `{ id, ...share }` |
| PUT | `/api/samba/shares/:id` | share fields | `{ success: true }` |
| DELETE | `/api/samba/shares/:id` | — | `{ success: true }` |
| POST | `/api/samba/restart` | — | `{ success: true }` |

**Implementation notes:**
- `running`: `safeExec('systemctl', ['is-active', 'smbd'])`.
- `connectedUsers`: `safeExec('smbstatus', ['-b', '-j'])` parse JSON.
- Shares config stored in `data.sambaShares`. Write `/etc/samba/smb.conf` via `sudoExec('tee', ...)` template. Then `safeExec('testparm', ['-s'])` to validate.
- Restart: `sudoExec('systemctl', ['restart', 'smbd', 'nmbd'])`.
- CRUD requires `requirePermission('admin')`.

---

## Module 13: nfs (`routes/nfs.js`)

Mounted at `/api/nfs`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/nfs/status` | — | `{ running, shares }` |
| GET | `/api/nfs/shares` | — | `[{ id, path, clients, options }]` |
| POST | `/api/nfs/shares` | `{ path, clients, options }` | `{ id, ...share }` |
| DELETE | `/api/nfs/shares/:id` | — | `{ success: true }` |
| POST | `/api/nfs/restart` | — | `{ success: true }` |

**Implementation notes:**
- `running`: check `systemctl is-active nfs-kernel-server`.
- Shares stored in `data.nfsShares`. Write `/etc/exports` via `sudoExec('tee', ...)`.
- After write: `sudoExec('exportfs', ['-ra'])` to reload without full restart.
- Restart: `sudoExec('systemctl', ['restart', 'nfs-kernel-server'])`.
- CRUD requires `requirePermission('admin')`.

---

## Module 14: logs (`routes/logs.js`)

Mounted at `/api/logs`. Requires `requireAuth`.

| Method | Path | Query | Response |
|--------|------|-------|----------|
| GET | `/api/logs` | `service?`, `lines?` (default 200), `since?` | `{ entries: [{timestamp, level, message, service}] }` |
| GET | `/api/logs/services` | — | `[{ id, name }]` |

**Implementation notes:**
- `logs`: `safeExec('journalctl', ['-n', lines, '--output', 'json', ...(service ? ['-u', service] : [])])`. Parse each JSON line. Level mapped from journald `PRIORITY` field (0-7 → error/warn/info/debug).
- `services`: `safeExec('systemctl', ['list-units', '--type=service', '--output', 'json'])` parse to get unit names.

---

## Module 15: notifications (`routes/notifications.js`)

Mounted at `/api/notifications`. Requires `requireAuth` + `requirePermission('admin')`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/notifications/config` | — | `{ email: {...}, telegram: {...} }` |
| POST | `/api/notifications/config` | config object | `{ success: true }` |
| POST | `/api/notifications/test` | `{ channel: 'email'|'telegram' }` | `{ success: true }` |

**Implementation notes:**
- Config stored in `data.notificationConfig` (already persisted by `notify.ts`).
- `test`: calls `sendNotification('Test', 'Test message')` from `notify.ts`.

---

## Module 16: scheduler (`routes/scheduler.js`)

Mounted at `/api/scheduler`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/scheduler` | — | `{ tasks: [{id, name, type, cronExpr, nextRun, lastRun, enabled}] }` |
| POST | `/api/scheduler` | `{ name, type, cronExpr, action }` | `{ id, ...task }` |
| PUT | `/api/scheduler/:id` | task fields | `{ success: true }` |
| DELETE | `/api/scheduler/:id` | — | `{ success: true }` |

**Implementation notes:**
- Tasks stored in `data.schedulerTasks`. On server start, register all enabled tasks with `node-cron`.
- `type` ∈ `['backup', 'snapraid-sync', 'custom-command']`. `action` is the command/config for the type.
- CRUD requires `requirePermission('admin')`.

---

## Module 17: ups (`routes/ups.js`)

Mounted at `/api/ups`. Requires `requireAuth`.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/ups/status` | `{ available, batteryCharge, runtime, load, inputVoltage, status, model, driver }` |

**Implementation notes:**
- Check `safeExec('which', ['apcaccess'])` → if not found, return `{ available: false }`.
- `safeExec('apcaccess', ['status'])` → parse key: value lines. Map field names to response shape.
- Key mappings: `BCHARGE` → `batteryCharge` (strip `%`), `TIMELEFT` → `runtime`, `LOADPCT` → `load`, `LINEV` → `inputVoltage`, `STATUS` → `status`, `MODEL` → `model`, `DRIVER` → `driver`.

---

## Module 18: ddns (`routes/ddns.js`)

Mounted at `/api/ddns`. Requires `requireAuth` + `requirePermission('admin')`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/ddns` | — | `[{ id, provider, domain, enabled, lastUpdate, status }]` |
| POST | `/api/ddns` | `{ provider, domain, token, enabled }` | `{ id, ...entry }` |
| PUT | `/api/ddns/:id` | entry fields | `{ success: true }` |
| DELETE | `/api/ddns/:id` | — | `{ success: true }` |
| POST | `/api/ddns/:id/update` | — | `{ success: true, ip }` |

**Implementation notes:**
- Configs stored in `data.ddnsEntries`. Tokens stored encrypted (AES-256-GCM same approach as TOTP).
- Supported providers: `duckdns`, `cloudflare`, `noip`. Each has a URL template for IP update.
- On `POST /ddns/:id/update`: fetch current public IP, call provider's update API via `https` module. Store `lastUpdate` + `status` in data.
- Background: on server start, schedule all enabled entries to update every 10 minutes via `setInterval`.

---

## Module 19: backup (`routes/backup.js`)

Mounted at `/api/backup`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/backup` | — | `{ jobs: [{id, name, type, source, destination, schedule, lastRun, status}] }` |
| POST | `/api/backup` | `{ name, type, source, destination, schedule?, retention? }` | `{ id, ...job }` |
| DELETE | `/api/backup/:id` | — | `{ success: true }` |
| POST | `/api/backup/:id/run` | — | `{ jobId, status: 'running' }` |
| GET | `/api/backup/:id/status` | — | `{ running, progress, lastRun, error? }` |

**Implementation notes:**
- Jobs in `data.backupJobs`. `type` ∈ `['rsync', 'tar']`.
- `run`: spawn `safeExec('rsync', ['-av', '--delete', source, destination])` async. Track progress in memory.
- `schedule`: if set, register with `node-cron`. Cron expression validated.
- CRUD requires `requirePermission('admin')`.

---

## Module 20: homestore (`routes/homestore.js`)

Mounted at `/api/homestore`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/homestore` | — | `{ apps: [{id, name, description, icon, category, composeContent, installed, running, arch}] }` |
| POST | `/api/homestore/install` | `{ appId }` | `{ success: true }` |
| POST | `/api/homestore/uninstall` | `{ appId }` | `{ success: true }` |

**Implementation notes:**
- App catalogue is a **static JSON** embedded in the module (no external API dependency). Curated list of ~20 popular self-hosted apps: Jellyfin, Nextcloud, Pi-hole, Home Assistant, Portainer, Grafana, etc.
- Each app has a pre-written `composeContent` (docker-compose YAML).
- `install`: saves compose file to `config/compose/{appId}.yml` + calls docker compose up.
- `uninstall`: docker compose down + removes compose file.
- `installed`/`running` determined by checking `docker ps` output.

---

## Module 21: shortcuts (`routes/shortcuts.js`)

Mounted at `/api/shortcuts`. Requires `requireAuth`.

| Method | Path | Body | Response |
|--------|------|------|----------|
| GET | `/api/shortcuts` | — | `{ defaults: [...], custom: [...] }` |
| POST | `/api/shortcuts` | `{ name, command, description, icon }` | `{ id, ...shortcut }` |
| DELETE | `/api/shortcuts/:id` | — | `{ success: true }` |

**Implementation notes:**
- Defaults: hardcoded array of 10 system shortcuts (disk usage, services status, network info, etc.).
- Custom: stored in `data.shortcuts` array. Max 50 custom shortcuts.
- Create: sanitize `name` (max 40 chars), validate `icon` is a single emoji or empty, `command` validated via `sanitizeShellArg`.

---

## Module 22: stacks (`routes/stacks.js`)

Mounted at `/api/stacks`. Requires `requireAuth`. Alias over docker compose files.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/stacks` | `[{ name, status, modified }]` |

**Implementation notes:**
- Lists all files in `config/compose/`. For each, checks if stack is running via `docker compose -f {file} ps --format json`. Thin alias — full CRUD is in `/api/docker/compose/*`.

---

## Module 23: terminal (`routes/terminal.js`)

Mounted at `/api/terminal`. Requires `requireAuth`.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/terminal/sessions` | `[{ id, command, user, startTime }]` |

**Implementation notes:**
- WebSocket PTY is already handled by `terminal-ws.ts`. This module only exposes the REST endpoint that lists active sessions from `getActiveSessions()`.

---

## Module 24: cloud-backup (`routes/cloud-backup.js`)

Mounted at `/api/cloud-backup`. Requires `requireAuth`.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/cloud-backup` | `{ status: 'Inactive', lastBackup: 'Never' }` |

**Implementation notes:**
- Stub returning static inactive status. Full implementation is future work. Returns valid JSON that frontend can render without errors.

---

## Module 25: cloud-sync (`routes/cloud-sync.js`)

Mounted at `/api/cloud-sync`. Requires `requireAuth`.

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/cloud-sync/status` | `{ enabled: false, lastSync: null, nextScheduledSync: null, queuedFiles: 0, syncingFiles: 0, bytesRemaining: 0, errorCount: 0 }` |

**Implementation notes:**
- Stub returning inactive status. Frontend polls every 5s — stub prevents errors.

---

## Module 26: active-backup + active-directory (`routes/active-backup.js`, `routes/active-directory.js`)

Both return `402 Payment Required` for all routes.

```js
router.all('*', requireAuth, (req, res) => {
  res.status(402).json({ error: 'license_required' });
});
```

---

## File structure to create

```
backend/routes/
  auth.js
  users.js
  totp.js
  system.js
  power.js
  update.js
  network.js
  storage.js
  docker.js
  files.js
  vpn.js
  samba.js
  nfs.js
  logs.js
  notifications.js
  scheduler.js
  ups.js
  ddns.js
  backup.js
  homestore.js
  shortcuts.js
  stacks.js
  terminal.js
  cloud-backup.js
  cloud-sync.js
  active-backup.js
  active-directory.js
```

Also needed:
- `multer` npm package for file upload
- `otplib` or `speakeasy` for TOTP generation
- `qrcode` npm package for QR data URIs
- `node-cron` npm package for scheduler
- `bcryptjs` or `bcrypt` for password hashing (check if already installed)

---

## Implementation phases (parallel)

| Phase | Modules | Rationale |
|-------|---------|-----------|
| 1 | auth, users, totp | Zero system calls, pure data + crypto |
| 2 | system, power, update, network | Read-only system info + simple commands |
| 3 | storage, docker | Complex async operations |
| 4 | files, logs, ups | File I/O + log parsing |
| 5 | samba, nfs, vpn, notifications, scheduler | Service management |
| 6 | backup, homestore, shortcuts, ddns, stacks, terminal, cloud-backup, cloud-sync, active-backup, active-directory | Data store + stubs |
