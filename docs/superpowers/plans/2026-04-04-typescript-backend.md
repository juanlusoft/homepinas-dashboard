# Backend TypeScript Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all `backend/*.js` files to TypeScript using `tsx` (no compile step required) and add explicit types to all exported functions.

**Architecture:** Rename each `.js` → `.ts`, add type annotations, fix TypeScript errors. Use `tsx` to run TS directly — no `outDir`, no build step. `allowJs: true` lets JS and TS coexist during migration. The project continues to run with `tsx backend/index.ts` after each task.

**Tech Stack:** TypeScript 5, tsx, @types/node, @types/express, @types/better-sqlite3, @types/ws, @types/cors, @types/compression, @types/nodemailer, @types/js-yaml

---

## File Structure

Files modified in order (leaf → root):

| File | Change |
|---|---|
| `package.json` | Add all missing runtime deps + TS devDeps |
| `backend/tsconfig.json` | New — TS config for backend |
| `backend/logger.js` → `logger.ts` | Add Logger interface |
| `backend/validate-env.js` → `.ts` | Add return types |
| `backend/spa-routes.js` → `.ts` | Trivial — string array |
| `backend/data.js` → `.ts` | Generic `withData<T>` |
| `backend/sanitize.js` → `.ts` | Type all 22 exports |
| `backend/security.js` → `.ts` | Typed exec functions |
| `backend/rateLimit.js` → `.ts` | Express middleware types |
| `backend/csrf.js` → `.ts` | Express middleware types |
| `backend/error-handler.js` → `.ts` | ErrorRequestHandler type |
| `backend/rbac.js` → `.ts` | Role enum, middleware types |
| `backend/auth.js` → `.ts` | RequestHandler type |
| `backend/metrics.js` → `.ts` | Type counters, middleware |
| `backend/notify.js` → `.ts` | Typed email/telegram helpers |
| `backend/session.js` → `.ts` | Session interface, SQLite types |
| `backend/totp-crypto.js` → `.ts` | Crypto types |
| `backend/health-monitor.js` → `.ts` | Disk/alert interfaces |
| `backend/error-monitor.js` → `.ts` | ErrorEntry interface |
| `backend/terminal-ws.js` → `.ts` | node-pty + ws types |
| `backend/middleware.js` → `.ts` | Express app types |
| `backend/routes.js` → `.ts` | Express app types |
| `backend/ssl-setup.js` → `.ts` | ServerOptions interface |
| `backend/index.js` → `.ts` | Entry point |

---

## Task 1: Add dependencies + TypeScript infrastructure

**Files:**
- Modify: `package.json`
- Create: `backend/tsconfig.json`

- [ ] **Step 1: Add all missing dependencies to package.json**

Replace `package.json` with:

```json
{
  "name": "homepinas-dashboard-v3.5",
  "version": "3.5.0",
  "description": "HomePiNAS Dashboard v3.5 - Clean refactored version",
  "main": "backend/index.js",
  "scripts": {
    "start": "tsx backend/index.ts",
    "dev": "nodemon --exec tsx backend/index.ts",
    "build": "echo 'Build process TBD'",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p backend/tsconfig.json",
    "lint": "eslint backend/ frontend/",
    "lint:fix": "eslint backend/ frontend/ --fix"
  },
  "repository": {
    "type": "git",
    "url": "git+https://github.com/juanlusoft/dashboard-v3.5.git"
  },
  "keywords": ["homepinas", "nas", "dashboard", "management"],
  "author": "HomeLabs Club",
  "license": "MIT",
  "private": true,
  "engines": {
    "node": ">=20.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^9.0.0",
    "compression": "^1.7.4",
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "express-rate-limit": "^7.0.0",
    "helmet": "^7.0.0",
    "js-yaml": "^4.1.0",
    "node-pty": "^1.0.0",
    "nodemailer": "^6.9.0",
    "uuid": "^9.0.0",
    "ws": "^8.14.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/compression": "^1.7.0",
    "@types/cors": "^2.8.0",
    "@types/express": "^4.17.0",
    "@types/js-yaml": "^4.0.0",
    "@types/node": "^20.0.0",
    "@types/nodemailer": "^6.4.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd /path/to/dashboard-v3.5
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "baseUrl": ".",
    "paths": {}
  },
  "include": ["backend/**/*.ts", "backend/**/*.js"],
  "exclude": ["node_modules", "frontend", "backend/tests"]
}
```

- [ ] **Step 4: Verify typecheck runs (will show errors — that's expected)**

```bash
npm run typecheck
```

Expected: Many errors about missing types — OK, we'll fix them in subsequent tasks.

- [ ] **Step 5: Commit**

```bash
git add package.json backend/tsconfig.json
git commit -m "chore: add TypeScript infrastructure and missing dependencies"
```

---

## Task 2: Migrate logger, validate-env, spa-routes

**Files:**
- Rename: `backend/logger.js` → `backend/logger.ts`
- Rename: `backend/validate-env.js` → `backend/validate-env.ts`
- Rename: `backend/spa-routes.js` → `backend/spa-routes.ts`

These three files have no internal project imports, making them safe to migrate first.

- [ ] **Step 1: Migrate logger.ts**

Rename `backend/logger.js` → `backend/logger.ts` and add the Logger interface:

```typescript
'use strict';

interface Logger {
  debug: (...args: unknown[]) => void;
  info:  (...args: unknown[]) => void;
  warn:  (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const isDev = process.env.NODE_ENV !== 'production';

// ... keep existing implementation, just add the interface above
// and type the exported `log` object:

const log: Logger = {
  // ... existing implementation
};

module.exports = log;
```

The key change is adding `interface Logger` before the implementation and typing `const log: Logger = { ... }`.

- [ ] **Step 2: Migrate validate-env.ts**

Rename `backend/validate-env.js` → `backend/validate-env.ts`. Add return types:

```typescript
'use strict';

function validateEnv(): void {
  // existing implementation unchanged
}

module.exports = { validateEnv };
```

- [ ] **Step 3: Migrate spa-routes.ts**

Rename `backend/spa-routes.js` → `backend/spa-routes.ts`. Add type:

```typescript
'use strict';

// Keep sync comment about frontend/modules/registry.js
const spaRoutes: string[] = [
  // existing array unchanged
];

module.exports = spaRoutes;
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

Expected: Fewer errors than before (logger, validate-env, spa-routes are clean now).

- [ ] **Step 5: Commit**

```bash
git add backend/logger.ts backend/validate-env.ts backend/spa-routes.ts
git rm backend/logger.js backend/validate-env.js backend/spa-routes.js
git commit -m "chore(ts): migrate logger, validate-env, spa-routes to TypeScript"
```

---

## Task 3: Migrate data.js

**Files:**
- Rename: `backend/data.js` → `backend/data.ts`

`data.js` is a leaf module (only imports `fs`, `path`) but has a generic `withData` that benefits significantly from TypeScript generics.

- [ ] **Step 1: Read the current file**

Read `backend/data.js` to understand the full implementation before modifying.

- [ ] **Step 2: Rename and type data.ts**

Key types to add:

```typescript
'use strict';

import type { PathLike } from 'fs';

// Shape of the application data object (extend as needed)
export interface AppData {
  notifications?: {
    email?: {
      host?: string;
      port?: number;
      user?: string;
      pass?: string;
      to?: string;
      enabled?: boolean;
    };
    telegram?: {
      botToken?: string;
      chatId?: string;
      enabled?: boolean;
    };
  };
  shortcuts?: Array<{ id: string; name: string; url: string; icon?: string }>;
  users?: Record<string, { passwordHash: string; role: string }>;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
}

// getData returns a deep copy of current data
function getData(): AppData { /* existing impl */ }

// saveData writes atomically
function saveData(data: AppData): void { /* existing impl */ }

// withData: read-modify-write with mutex. fn receives data, returns modified data.
async function withData<T = void>(
  fn: (data: AppData) => Promise<T> | T
): Promise<T> { /* existing impl */ }
```

Note: Keep `require()` syntax for the imports at the top — only add type annotations.

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

Expected: data.ts errors resolved; other errors remain for unmigrated files.

- [ ] **Step 4: Commit**

```bash
git add backend/data.ts
git rm backend/data.js
git commit -m "chore(ts): migrate data.js to TypeScript with AppData interface"
```

---

## Task 4: Migrate sanitize.js

**Files:**
- Rename: `backend/sanitize.js` → `backend/sanitize.ts`

Sanitize has 22 exported functions. All take strings, return strings/booleans/objects.

- [ ] **Step 1: Read the current file**

Read `backend/sanitize.js` to get all 22 exported function signatures.

- [ ] **Step 2: Add types to all exported functions**

Pattern: add parameter types and return types to each `function`. No logic changes.

Key types:
```typescript
// Return type for validateComposeContent
interface ComposeValidationResult {
  valid: boolean;
  error?: string;
}

function sanitizePath(inputPath: string): string | null { ... }
function sanitizePathWithinBase(inputPath: string, basePath: string): string | null { ... }
function sanitizeString(str: string): string { ... }
function sanitizeShellArg(arg: string): string | null { ... }
function sanitizeDiskId(id: string): string | null { ... }
function sanitizeDiskPath(diskPath: string): string | null { ... }
function sanitizeComposeName(name: string): string | null { ... }
function sanitizeCommand(cmd: string): string | null { ... }
function sanitizeUsername(username: string): string | null { ... }
function validateUsername(username: string): boolean { ... }
function validatePassword(password: string): boolean { ... }
function validateDockerAction(action: string): boolean { ... }
function validateContainerId(id: string): boolean { ... }
function validateSystemAction(action: string): boolean { ... }
function validateFanId(id: string): boolean { ... }
function validateFanSpeed(speed: number): boolean { ... }
function validateFanMode(mode: string): boolean { ... }
function validateInterfaceName(name: string): boolean { ... }
function validateIPv4(ip: string): boolean { ... }
function validateSubnetMask(mask: string): boolean { ... }
function validateDiskRole(role: string): boolean { ... }
function validateDiskConfig(config: unknown): boolean { ... }
function validatePositiveInt(value: unknown): boolean { ... }
function validateNonNegativeInt(value: unknown): boolean { ... }
function validateComposeContent(content: string): ComposeValidationResult { ... }
function sanitizeForLog(str: string): string { ... }
function escapeShellArg(arg: string): string { ... }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/sanitize.ts
git rm backend/sanitize.js
git commit -m "chore(ts): migrate sanitize.js to TypeScript"
```

---

## Task 5: Migrate security.js + rateLimit.js + csrf.js + error-handler.js

**Files:**
- Rename: `backend/security.js` → `backend/security.ts`
- Rename: `backend/rateLimit.js` → `backend/rateLimit.ts`
- Rename: `backend/csrf.js` → `backend/csrf.ts`
- Rename: `backend/error-handler.js` → `backend/error-handler.ts`

- [ ] **Step 1: Read each file**

Read all 4 files before starting.

- [ ] **Step 2: Migrate security.ts**

Key types:
```typescript
import { ExecFileOptions } from 'child_process';

interface ExecResult {
  stdout: string;
  stderr: string;
}

async function safeExec(command: string, args: string[], options?: ExecFileOptions): Promise<ExecResult> { ... }
async function sudoExec(command: string, args: string[], options?: ExecFileOptions): Promise<ExecResult> { ... }
function safeRemove(filePath: string, baseDir: string): Promise<void> { ... }
function logSecurityEvent(event: string, details: Record<string, unknown>, ip?: string): void { ... }
```

- [ ] **Step 3: Migrate rateLimit.ts**

```typescript
import type { RateLimitRequestHandler } from 'express-rate-limit';

const generalLimiter: RateLimitRequestHandler = rateLimit({ ... });
const authLimiter: RateLimitRequestHandler = rateLimit({ ... });
const passwordLimiter: RateLimitRequestHandler = rateLimit({ ... });
```

- [ ] **Step 4: Migrate csrf.ts**

```typescript
import type { RequestHandler } from 'express';

const csrfProtection: RequestHandler = (req, res, next) => { ... };
```

- [ ] **Step 5: Migrate error-handler.ts**

```typescript
import type { ErrorRequestHandler } from 'express';

const errorHandler: ErrorRequestHandler = (err, req, res, next) => { ... };
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add backend/security.ts backend/rateLimit.ts backend/csrf.ts backend/error-handler.ts
git rm backend/security.js backend/rateLimit.js backend/csrf.js backend/error-handler.js
git commit -m "chore(ts): migrate security, rateLimit, csrf, error-handler to TypeScript"
```

---

## Task 6: Migrate rbac.js + auth.js + metrics.js + notify.js

**Files:**
- Rename: `backend/rbac.js` → `backend/rbac.ts`
- Rename: `backend/auth.js` → `backend/auth.ts`
- Rename: `backend/metrics.js` → `backend/metrics.ts`
- Rename: `backend/notify.js` → `backend/notify.ts`

- [ ] **Step 1: Read each file**

- [ ] **Step 2: Migrate rbac.ts**

```typescript
import type { RequestHandler } from 'express';

type Role = 'admin' | 'user' | 'readonly';

function requireRole(role: Role): RequestHandler { ... }
function hasPermission(userRole: Role, requiredRole: Role): boolean { ... }
```

- [ ] **Step 3: Migrate auth.ts**

```typescript
import type { RequestHandler } from 'express';

const requireAuth: RequestHandler = (req, res, next) => { ... };
```

Note: `auth.js` currently has `require('../utils/session')` — fix this to `require('./session')` (the file is in backend root, not a subdirectory).

- [ ] **Step 4: Migrate metrics.ts**

```typescript
import type { RequestHandler } from 'express';

function recordRequest(method: string, path: string, statusCode: number, durationMs: number): void { ... }
function generateMetrics(): string { ... }
const metricsMiddleware: RequestHandler = (req, res, next) => { ... };
```

- [ ] **Step 5: Migrate notify.ts**

```typescript
interface NotifyResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

async function sendViaEmail(subject: string, text: string, html?: string): Promise<NotifyResult> { ... }
async function sendViaTelegram(message: string): Promise<NotifyResult> { ... }
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git add backend/rbac.ts backend/auth.ts backend/metrics.ts backend/notify.ts
git rm backend/rbac.js backend/auth.js backend/metrics.js backend/notify.js
git commit -m "chore(ts): migrate rbac, auth, metrics, notify to TypeScript"
```

---

## Task 7: Migrate session.js + totp-crypto.js

**Files:**
- Rename: `backend/session.js` → `backend/session.ts`
- Rename: `backend/totp-crypto.js` → `backend/totp-crypto.ts`

- [ ] **Step 1: Read both files**

- [ ] **Step 2: Migrate session.ts**

Key interfaces:
```typescript
import Database from 'better-sqlite3';

export interface SessionData {
  username: string;
  expiresAt: number;
  lastActivity: number;
}

function initSessionDb(): boolean { ... }
function createSession(username: string): string | null { ... }
function validateSession(sessionId: string): SessionData | null { ... }
function destroySession(sessionId: string): void { ... }
function clearAllSessions(): void { ... }
function cleanExpiredSessions(): void { ... }
function startSessionCleanup(): void { ... }
function storeCsrfToken(sessionId: string, token: string): void { ... }
function getCsrfTokenFromDb(sessionId: string): string | null { ... }
function deleteCsrfToken(sessionId: string): void { ... }
function cleanExpiredCsrfTokens(): void { ... }
```

- [ ] **Step 3: Migrate totp-crypto.ts**

```typescript
interface EncryptedSecret {
  iv: string;
  tag: string;
  data: string;
  version: number;
}

function encryptTotpSecret(secret: string): string { ... }
function decryptTotpSecret(encrypted: string): string { ... }
function isEncrypted(secret: string): boolean { ... }
async function migrateToEncrypted(secret: string): Promise<string> { ... }
async function getServerSecret(): Promise<string> { ... }
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/session.ts backend/totp-crypto.ts
git rm backend/session.js backend/totp-crypto.js
git commit -m "chore(ts): migrate session, totp-crypto to TypeScript"
```

---

## Task 8: Migrate health-monitor.js + error-monitor.js

**Files:**
- Rename: `backend/health-monitor.js` → `backend/health-monitor.ts`
- Rename: `backend/error-monitor.js` → `backend/error-monitor.ts`

- [ ] **Step 1: Read both files**

- [ ] **Step 2: Migrate health-monitor.ts**

Key interfaces:
```typescript
export interface DiskInfo {
  name: string;
  size: string;
  type: string;
  model?: string;
  serial?: string;
  mountpoint?: string;
}

export interface SmartData {
  model_name?: string;
  ata_smart_attributes?: { table: SmartAttribute[] };
  nvme_smart_health_information_log?: { percentage_used?: number };
  temperature?: { current?: number };
  smart_status?: { passed: boolean };
}

export interface SmartAttribute {
  name: string;
  value: number;
  raw: { value: number };
  when_failed: string;
}

export interface HealthAlert {
  type: string;
  disk: string;
  message: string;
  severity: 'warning' | 'critical';
  timestamp: number;
}

function startHealthMonitor(checkIntervalMs: number, alertCooldownMs: number): void { ... }
function getPhysicalDisks(): DiskInfo[] { ... }
function getSmartData(diskId: string): SmartData | null { ... }
function checkSmartHealth(alerts: HealthAlert[]): void { ... }
```

- [ ] **Step 3: Migrate error-monitor.ts**

```typescript
export interface ErrorEntry {
  timestamp: string;
  source: string;
  message: string;
  unit?: string;
  level: 'error' | 'warning' | 'critical';
}

function startErrorMonitor(): void { ... }
function getRecentErrors(): ErrorEntry[] { ... }
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add backend/health-monitor.ts backend/error-monitor.ts
git rm backend/health-monitor.js backend/error-monitor.js
git commit -m "chore(ts): migrate health-monitor, error-monitor to TypeScript"
```

---

## Task 9: Migrate terminal-ws.js

**Files:**
- Rename: `backend/terminal-ws.js` → `backend/terminal-ws.ts`

`terminal-ws` uses both `node-pty` and `ws` — the most external-type-heavy file.

- [ ] **Step 1: Read the file**

- [ ] **Step 2: Migrate terminal-ws.ts**

```typescript
import type { IPty } from 'node-pty';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';
import type { WebSocket, WebSocketServer } from 'ws';

interface TerminalSession {
  pty: IPty;
  ws: WebSocket;
}

function setupTerminalWebSocket(server: HttpServer | HttpsServer): WebSocketServer { ... }
```

- [ ] **Step 3: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add backend/terminal-ws.ts
git rm backend/terminal-ws.js
git commit -m "chore(ts): migrate terminal-ws to TypeScript"
```

---

## Task 10: Migrate middleware.js + routes.js + ssl-setup.js

**Files:**
- Rename: `backend/middleware.js` → `backend/middleware.ts`
- Rename: `backend/routes.js` → `backend/routes.ts`
- Rename: `backend/ssl-setup.js` → `backend/ssl-setup.ts`

- [ ] **Step 1: Read all three files**

- [ ] **Step 2: Migrate middleware.ts**

```typescript
import type { Express } from 'express';

function applyMiddleware(app: Express): void { ... }
```

- [ ] **Step 3: Migrate routes.ts**

```typescript
import type { Express } from 'express';

function registerRoutes(app: Express, version: string): void { ... }
```

- [ ] **Step 4: Migrate ssl-setup.ts**

```typescript
import type { Express } from 'express';

interface ServerOptions {
  VERSION: string;
  HTTPS_PORT: number | string;
  HTTP_PORT: number | string;
  SSL_CERT_PATH: string;
  SSL_KEY_PATH: string;
  setupTerminalWebSocket: ((server: unknown) => void) | null;
}

function createServer(app: Express, opts: ServerOptions): void { ... }
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add backend/middleware.ts backend/routes.ts backend/ssl-setup.ts
git rm backend/middleware.js backend/routes.js backend/ssl-setup.js
git commit -m "chore(ts): migrate middleware, routes, ssl-setup to TypeScript"
```

---

## Task 11: Migrate index.js — entry point

**Files:**
- Rename: `backend/index.js` → `backend/index.ts`

- [ ] **Step 1: Read the file**

- [ ] **Step 2: Rename and add types**

The main change is the `require()` calls and the Express app type:

```typescript
import type { Express } from 'express';

const app: Express = express();
```

All other code remains the same.

- [ ] **Step 3: Run typecheck — should be clean**

```bash
npm run typecheck
```

Expected: 0 errors (all files migrated).

- [ ] **Step 4: Update package.json main field**

In `package.json`, change:
```json
"main": "backend/index.ts"
```

- [ ] **Step 5: Test that the app starts**

```bash
npm start
```

Expected: Server starts on the configured ports, no runtime errors.

- [ ] **Step 6: Run lint**

```bash
npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add backend/index.ts package.json
git rm backend/index.js
git commit -m "chore(ts): migrate index.js — backend migration complete"
```

---

## Final verification

After all tasks:

```bash
npm run typecheck   # 0 errors
npm run lint        # 0 errors  
npm start           # server boots
npm test            # tests pass
```

```bash
git log --oneline -12
```

Expected: 11 commits, one per task.

---

_Plan created: 2026-04-04_
