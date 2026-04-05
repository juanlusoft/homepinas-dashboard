/**
 * HomePiNAS - Premium NAS Dashboard for Raspberry Pi CM5
 * Homelabs.club Edition
 *
 * Version is read from package.json at runtime.
 * See CHANGELOG.md for feature history.
 */

'use strict';

const express = require('express');
const fs      = require('fs');
const path    = require('path');

// Core utilities
const log = require('./logger');
const { validateEnv }                           = require('./validate-env');
const { initSessionDb, startSessionCleanup }   = require('./session');

// Split modules
const { applyMiddleware } = require('./middleware');
const { registerRoutes }  = require('./routes');
const { createServer }    = require('./ssl-setup');

// Type imports
import type { Express } from 'express-serve-static-core';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Read version from package.json (single source of truth)
const VERSION: string      = require('../package.json').version;
const HTTPS_PORT: number = Number(process.env.HTTPS_PORT) || 443;
const HTTP_PORT: number  = Number(process.env.HTTP_PORT)  || 80;
const SSL_CERT_PATH = path.join(__dirname, 'certs', 'server.crt');
const SSL_KEY_PATH  = path.join(__dirname, 'certs', 'server.key');

// ---------------------------------------------------------------------------
// Pre-flight: ensure required directories exist
// ---------------------------------------------------------------------------

// Ensure config directory exists
const configDir = path.join(__dirname, 'config');
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

// Ensure temp directories exist on storage (not eMMC)
// IMPORTANT: Must run BEFORE ssl-setup which writes to /mnt/storage/.tmp/
const storageTmpDirs = ['/mnt/storage/.tmp', '/mnt/storage/.uploads-tmp'];
for (const dir of storageTmpDirs) {
    try {
        if (fs.existsSync('/mnt/storage') && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {
        log.warn(`Could not create ${dir}:`, e instanceof Error ? e.message : String(e));
    }
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

// Validate environment variables before anything else
validateEnv();

const app: Express = express();

// Initialize session database
initSessionDb();
startSessionCleanup();

// Terminal WebSocket handler (optional — requires node-pty)
let setupTerminalWebSocket: ((server: import('http').Server | import('https').Server) => void) | null;
try {
    setupTerminalWebSocket = require('./terminal-ws').setupTerminalWebSocket;
} catch (e) {
    log.warn('[WARN] Terminal WebSocket not available - node-pty may not be installed');
    setupTerminalWebSocket = null;
}

// Wire up middleware stack (helmet, cors, rate limit, CSRF, static, SPA, …)
applyMiddleware(app);

// Register API routes (/metrics, /health, /api/*)
registerRoutes(app, VERSION);

// Create HTTP(S) servers and start listening
createServer(app, {
    VERSION,
    HTTPS_PORT,
    HTTP_PORT,
    SSL_CERT_PATH,
    SSL_KEY_PATH,
    setupTerminalWebSocket,
});

module.exports = app;
