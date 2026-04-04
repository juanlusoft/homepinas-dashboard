# HomePiNAS Dashboard

Premium NAS management dashboard for Raspberry Pi CM5 and similar ARM single-board computers. Self-hosted, no cloud dependency.

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | System overview — CPU, RAM, temps, uptime, network |
| **Storage** | mergerfs pools, disk health (SMART), SnapRAID sync, badblocks |
| **Docker** | Container management, compose editor, update checker |
| **Homestore** | One-click self-hosted app catalog (15 apps via Docker Compose) |
| **Stacks** | Compose stack listing + status |
| **Files** | File browser with upload/download/rename/move/copy/search |
| **Backup** | Async rsync jobs with status polling |
| **Samba** | SMB/CIFS share management — create/edit/delete shares, restart |
| **NFS** | NFS export management — create/edit/delete exports, restart |
| **VPN** | WireGuard VPN — install, manage clients, QR codes |
| **DDNS** | Dynamic DNS (DuckDNS, Cloudflare, No-IP) with background polling |
| **Notifications** | Email (SMTP) + Telegram alerts with test delivery |
| **Scheduler** | Cron-based task scheduler (snapraid-sync, backup, custom) |
| **Network** | Interface stats, public IP |
| **Logs** | Live journalctl log viewer with service filter |
| **Users** | Multi-user RBAC with 2FA (TOTP) |
| **Terminal** | Browser-based PTY terminal over WebSocket |
| **Shortcuts** | Custom terminal command shortcuts with defaults |
| **UPS** | APC UPS status monitoring (apcupsd) |
| **Updates** | Dashboard self-update (git pull) + OS apt upgrades |

## Stack

- **Backend** — Node.js 20+ / Express 4, TypeScript (tsx, no compile step)
- **Frontend** — Vanilla JS ES Modules SPA, no build step, lazy-loaded modules
- **Auth** — Session-based + CSRF + RBAC + TOTP 2FA
- **Security** — helmet, rate limiting, input sanitization, command allowlist
- **Storage** — SQLite (sessions) + JSON (config/data)
- **Realtime** — WebSocket (terminal PTY, polling)

## Requirements

- Node.js >= 20
- npm >= 10
- Linux host (Raspberry Pi OS, Debian, Ubuntu) — commands use Linux paths/tools
- Optional: `openssl` for auto-generated self-signed certs

## Installation

```bash
npm install
```

> `better-sqlite3` requires a C++ toolchain to compile. On Raspberry Pi OS run `apt install build-essential` first.
> For development on Windows/macOS, use `npm install --ignore-scripts` (SQLite sessions won't work, but typecheck and tests will).

## Development

```bash
# Start with hot reload (nodemon + tsx)
npm run dev

# TypeScript type check (no emit)
npm run typecheck

# Tests (vitest)
npm test

# Lint
npm run lint
npm run lint:fix
```

## Production

```bash
npm start
```

The server listens on `0.0.0.0:443` (HTTPS) and `0.0.0.0:80` (HTTP → HTTPS redirect).
SSL certificates are auto-generated (self-signed) on first run if not present in `backend/certs/`.

Override ports via environment variables:

```bash
HTTPS_PORT=8443 HTTP_PORT=8080 npm start
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `HTTPS_PORT` | `443` | HTTPS port |
| `HTTP_PORT` | `80` | HTTP port |
| `SESSION_DURATION` | `86400000` | Session max age (ms) |
| `SESSION_IDLE_TIMEOUT` | `3600000` | Session idle timeout (ms) |
| `TEMP_THRESHOLD_C` | `75` | Disk temperature alert threshold (°C) |
| `POOL_USAGE_THRESHOLD` | `85` | Storage pool usage alert (%) |
| `TOTP_SERVER_KEY` | *(file)* | AES-256-GCM key for TOTP secret encryption |

## Project Structure

```
backend/               # TypeScript — Express API + utilities
  ├─ index.ts          # Entry point (bootstrap)
  ├─ middleware.ts      # Helmet, CORS, CSRF, rate limit, static files
  ├─ routes.ts         # Route registration
  ├─ ssl-setup.ts      # HTTPS server + WebSocket setup
  ├─ auth.ts / rbac.ts # Authentication + role-based access control
  ├─ session.ts        # SQLite session store
  ├─ security.ts       # safeExec() command allowlist + injection prevention
  ├─ sanitize.ts       # Input validation and sanitization
  ├─ data.ts           # JSON data store (withData mutex)
  ├─ health-monitor.ts # SMART, temps, pool health checks
  ├─ error-monitor.ts  # Journalctl error scanning + alerts
  ├─ terminal-ws.ts    # PTY WebSocket (node-pty)
  ├─ metrics.ts        # Prometheus-style metrics endpoint
  ├─ notify.ts         # Email + Telegram notifications
  ├─ totp-crypto.ts    # AES-256-GCM TOTP secret encryption
  ├─ routes/           # API route modules (/api/*)
  └─ tests/            # Vitest unit tests

frontend/              # Vanilla JS ES Modules SPA
  ├─ main.js           # Module loader (lazy, error boundary, paid overlay)
  ├─ modules/          # One directory per feature module
  │   ├─ dashboard/
  │   ├─ storage/
  │   ├─ docker/
  │   ├─ files/
  │   ├─ network/
  │   └─ ...
  ├─ core/             # Auth, polling, 2FA, state
  └─ style-base.css    # Shared styles (per-module styles in modules/*/style.css)

docs/
  └─ superpowers/      # Architecture specs and implementation plans
```

## Security

- All commands go through an allowlist (`security.ts`) — no arbitrary shell execution
- TOTP secrets encrypted at rest with AES-256-GCM (key in `TOTP_SERVER_KEY` env var)
- CSRF tokens on all state-changing requests
- Per-endpoint rate limiting (auth, password reset, 2FA, API)
- Input sanitization on all user-supplied data
- Path traversal prevention with `dangerousPaths` blocklist
- Helmet security headers + strict CSP
- Sessions expire and rotate on privilege change

## License

MIT
