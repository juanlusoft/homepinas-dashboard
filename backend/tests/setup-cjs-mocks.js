/**
 * vitest setupFile: Bridge vi.mock() to CJS require()
 *
 * In vitest forks pool with tsx/cjs, vi.mock() only intercepts ESM import().
 * CJS require() calls in route handlers bypass vitest's mock system entirely.
 *
 * Solution:
 * 1. Install a Module._load hook to serve from our registry
 * 2. In beforeEach, use ESM import() — which IS intercepted by vi.mock —
 *    to get factory mock results, then seed Module._cache via the hook
 */

import { vi, beforeEach } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

const Module = require('module');

// Registry: absolute resolved path -> mock exports object
const _registry = new Map();

// Install Module._load hook once
if (!Module._load.__vitestCjsBridge) {
    const _orig = Module._load;
    Module._load = function vitestCjsBridge(request, parent, isMain) {
        if (parent && _registry.size > 0) {
            let resolved;
            try {
                resolved = Module._resolveFilename(request, parent, isMain);
            } catch (_e) { /* unresolvable */ }
            if (resolved && _registry.has(resolved)) {
                return _registry.get(resolved);
            }
        }
        return _orig.apply(this, arguments);
    };
    Module._load.__vitestCjsBridge = true;
}

const SETUP_DIR = path.dirname(fileURLToPath(import.meta.url));

// Route files to flush from Module._cache (so they reload with fresh mock deps)
const ROUTE_FILES = [
    path.resolve(SETUP_DIR, '../routes/auth.js'),
    path.resolve(SETUP_DIR, '../routes/users.js'),
    path.resolve(SETUP_DIR, '../routes/totp.js'),
];

/**
 * Seed the CJS registry by trying ESM import() for each module spec.
 * If the module is vi.mock()'d, import() returns the factory result.
 * If not mocked, import() returns the real module — we detect and skip those.
 *
 * @param {string[]} specs  module specifiers (relative to setup file == relative to test files)
 */
async function seedRegistry(specs) {
    _registry.clear();

    for (const spec of specs) {
        try {
            // ESM import() IS intercepted by vi.mock. If the module was vi.mock()'d
            // with a factory, the returned object will contain vi.fn() spies.
            const imported = await import(/* @vite-ignore */ spec);

            // Always register: if vi.mock was used, import() returns the mock;
            // if not, it returns the real module — either way we cache it.
            // This ensures route handlers always get the mocked version when
            // vi.mock() was declared in the test file.
            let resolvedPath;
            if (spec.startsWith('.')) {
                resolvedPath = require.resolve(path.resolve(SETUP_DIR, spec));
            } else {
                resolvedPath = require.resolve(spec);
            }

            // Register: when CJS require(spec) runs, return this imported result
            _registry.set(resolvedPath, imported);
            const noExt = resolvedPath.replace(/\.(ts|js|tsx|jsx|cjs|mjs)$/, '');
            _registry.set(noExt, imported);

            // Remove cached version so subsequent require() goes through our hook
            delete Module._cache[resolvedPath];
            delete Module._cache[noExt];
        } catch (_e) {
            // Not importable or not mocked — skip silently
        }
    }

    // Flush route modules so they get fresh dependency bindings
    for (const routePath of ROUTE_FILES) {
        delete Module._cache[routePath];
    }
}

// Module specs to check before each test
// These match the vi.mock() specifiers used in route test files
const ALL_MOCK_CANDIDATES = [
    '../data',
    '../session',
    '../csrf',
    '../sanitize',
    '../totp-crypto',
    '../auth',
    'bcryptjs',
    'otplib',
    'qrcode',
];

beforeEach(async () => {
    await seedRegistry(ALL_MOCK_CANDIDATES);
});
