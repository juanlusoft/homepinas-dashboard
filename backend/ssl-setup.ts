/**
 * ssl-setup.ts — HTTPS/HTTP server creation for HomePiNAS
 *
 * Exports createServer(app, opts) which:
 *   1. Ensures SSL certificates exist (auto-generates self-signed if missing).
 *   2. Creates an HTTPS server when certs are present, plus an HTTP server
 *      that either redirects to HTTPS or serves the app directly.
 *   3. Starts listening on both ports, wires up Terminal WebSocket(s), and
 *      kicks off background services (error monitor, health monitor).
 *
 * opts: { VERSION, HTTPS_PORT, HTTP_PORT, SSL_CERT_PATH, SSL_KEY_PATH,
 *          setupTerminalWebSocket }
 */

'use strict';

import type { Express, Request, Response } from 'express-serve-static-core';
import type { Server as HttpServer } from 'http';
import type { Server as HttpsServer } from 'https';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const http  = require('http');

const log = require('./utils/logger');

// ---------------------------------------------------------------------------
// Type definitions
// ---------------------------------------------------------------------------

interface ServerOptions {
    VERSION: string;
    HTTPS_PORT: number;
    HTTP_PORT: number;
    SSL_CERT_PATH: string;
    SSL_KEY_PATH: string;
    setupTerminalWebSocket?: ((server: HttpServer | HttpsServer) => void) | null;
}

interface ServerResult {
    httpServer: HttpServer;
    httpsServer: HttpsServer | null;
}

// ---------------------------------------------------------------------------
// SSL certificate auto-generation
// ---------------------------------------------------------------------------

function ensureSSLCerts(SSL_CERT_PATH: string, SSL_KEY_PATH: string): void {
    const certsDir = path.dirname(SSL_CERT_PATH);
    if (!fs.existsSync(certsDir)) {
        fs.mkdirSync(certsDir, { recursive: true });
    }

    if (!fs.existsSync(SSL_CERT_PATH) || !fs.existsSync(SSL_KEY_PATH)) {
        log.info('[SSL] Certificates not found, generating self-signed certificates...');
        try {
            const { execFileSync } = require('child_process');
            const os = require('os');
            const hostname = os.hostname();
            const interfaces = os.networkInterfaces();
            let localIP = '127.0.0.1';
            for (const iface of Object.values(interfaces)) {
                for (const addr of ((iface || []) as { family: string; address: string; internal: boolean }[])) {
                    if (addr.family === 'IPv4' && !addr.internal) {
                        localIP = addr.address;
                        break;
                    }
                }
            }

            const sslConfig = `[req]
distinguished_name = req_distinguished_name
x509_extensions = v3_req
prompt = no

[req_distinguished_name]
C = ES
ST = Local
L = HomeLab
O = HomePiNAS
OU = NAS
CN = ${hostname}

[v3_req]
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName = @alt_names

[alt_names]
DNS.1 = ${hostname}
DNS.2 = homepinas.local
DNS.3 = localhost
IP.1 = ${localIP}
IP.2 = 127.0.0.1
`;
            const configPath = '/mnt/storage/.tmp/homepinas-ssl.cnf';
            fs.writeFileSync(configPath, sslConfig);

            execFileSync('openssl', [
                'req', '-x509', '-nodes', '-days', '3650',
                '-newkey', 'rsa:2048',
                '-keyout', SSL_KEY_PATH,
                '-out', SSL_CERT_PATH,
                '-config', configPath
            ], { stdio: 'pipe' });
            fs.chmodSync(SSL_KEY_PATH, 0o600);
            fs.unlinkSync(configPath);

            log.info('[SSL] Self-signed certificates generated successfully');
        } catch (e) {
            log.error('[SSL] Failed to generate certificates:', e instanceof Error ? e.message : String(e));
        }
    }
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

function createServer(app: Express, opts: ServerOptions): ServerResult {
    const {
        VERSION,
        HTTPS_PORT,
        HTTP_PORT,
        SSL_CERT_PATH,
        SSL_KEY_PATH,
        setupTerminalWebSocket,
    } = opts;

    // Ensure certs exist (generates self-signed if absent)
    ensureSSLCerts(SSL_CERT_PATH, SSL_KEY_PATH);

    log.info(`HomePiNAS v${VERSION} — Premium NAS Dashboard for Raspberry Pi (Homelabs.club)`);

    // ------------------------------------------------------------------
    // HTTPS server
    // ------------------------------------------------------------------
    let httpsServer: HttpsServer | null = null;
    if (fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
        try {
            const sslOptions = {
                key:  fs.readFileSync(SSL_KEY_PATH),
                cert: fs.readFileSync(SSL_CERT_PATH),
            };
            httpsServer = https.createServer(sslOptions, app) as HttpsServer;
            httpsServer!.listen(HTTPS_PORT, '0.0.0.0', () => {
                log.info(`[HTTPS] Secure server running on https://0.0.0.0:${HTTPS_PORT}`);
            });
        } catch (e) {
            log.error('[HTTPS] Failed to start:', e instanceof Error ? e.message : String(e));
        }
    }

    // ------------------------------------------------------------------
    // HTTP server — redirect to HTTPS if available, otherwise serve app
    // ------------------------------------------------------------------
    let httpApp: Express;
    if (httpsServer) {
        // Create a simple redirect app for HTTP
        const express = require('express');
        httpApp = express();
        httpApp.use((req: Request, res: Response) => {
            // Redirect to HTTPS (omit port if using standard 443)
            const host       = req.headers.host?.split(':')[0] || req.hostname;
            const portSuffix = HTTPS_PORT === 443 ? '' : `:${HTTPS_PORT}`;
            const httpsUrl   = `https://${host}${portSuffix}${req.url}`;
            res.redirect(302, httpsUrl);
        });
        log.info('[HTTP]  Will redirect all traffic to HTTPS');
    } else {
        // No HTTPS, serve app on HTTP
        httpApp = app;
    }

    const httpServer = http.createServer(httpApp);
    httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
        log.info(`[HTTP]  Server running on http://0.0.0.0:${HTTP_PORT}`);
        if (httpsServer) {
            log.info('[HTTP]  → Redirecting to HTTPS on port ' + HTTPS_PORT);
        } else {
            log.info('\n[WARN]  HTTPS not configured. Run install.sh to generate SSL certificates.');
        }
        log.info('All route modules loaded');

        // Setup Terminal WebSocket on HTTP server
        if (setupTerminalWebSocket) {
            try {
                setupTerminalWebSocket(httpServer);
                log.info('[WS]    Terminal WebSocket available at /api/terminal/ws');
            } catch (e) {
                log.warn('[WARN]  Terminal WebSocket setup failed:', e instanceof Error ? e.message : String(e));
            }
        }

        // Start error monitoring (if enabled in config)
        const { startErrorMonitor } = require('./utils/error-monitor');
        startErrorMonitor();

        // Start health monitor with two-tier intervals:
        //   Fast (pool, mounts, cached temps): every 5 min
        //   Slow (SMART refresh, SnapRAID):    every 30 min
        const { startHealthMonitor } = require('./utils/health-monitor');
        startHealthMonitor(300000, 1800000);
    });

    // Setup Terminal WebSocket on HTTPS server if available
    if (httpsServer && setupTerminalWebSocket) {
        try {
            setupTerminalWebSocket(httpsServer);
        } catch (e) {
            log.warn('[WARN]  Terminal WebSocket (HTTPS) setup failed:', e instanceof Error ? e.message : String(e));
        }
    }

    return { httpServer, httpsServer };
}

module.exports = { createServer };
