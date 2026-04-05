/**
 * middleware.ts — Express middleware setup for HomePiNAS
 *
 * Exports applyMiddleware(app) which wires up all middleware, static file
 * serving, SPA routes, and the global error handler in the correct order.
 */

'use strict';

import type { Express, Request, Response, NextFunction } from 'express-serve-static-core';

const fs   = require('fs');
const path = require('path');

const cors    = require('cors');
const helmet  = require('helmet');

const log = require('./logger');

const { generalLimiter }  = require('./rateLimit');
const { csrfProtection }  = require('./csrf');
const { errorHandler }    = require('./error-handler');

const cloudSyncRoutes   = require('./routes/cloud-sync');
const cloudBackupRoutes = require('./routes/cloud-backup');

// ---------------------------------------------------------------------------

function applyMiddleware(app: Express): void {
    // -------------------------------------------------------------------------
    // Security headers — hardened configuration (Phase 3 security audit)
    // -------------------------------------------------------------------------
    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "https://cdn.jsdelivr.net"],
                // All inline onclick handlers migrated to data-action event delegation
                scriptSrcAttr: ["'none'"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
                fontSrc: ["'self'", "https://fonts.gstatic.com"],
                imgSrc: ["'self'", "data:", "https://api.qrserver.com", "https://cdn.jsdelivr.net"],
                connectSrc: ["'self'", "ws:", "wss:", "https://cdn.jsdelivr.net"],
                frameSrc: ["'self'", "blob:"], // Allow same-origin + blob URLs for PDF preview
                objectSrc: ["'none'"],      // Block Flash/plugins
                baseUri: ["'self'"],        // Prevent <base> tag hijacking
                formAction: ["'self'"],     // Forms can only submit to same origin
                frameAncestors: ["'none'"], // Prevent clickjacking (embedding this site)
                upgradeInsecureRequests: null, // Allow HTTP for local network
            },
        },
        hsts: false, // Disabled for local network (self-signed certs)
        crossOriginEmbedderPolicy: false,
        crossOriginOpenerPolicy: { policy: "same-origin" }, // Isolate browsing context
        crossOriginResourcePolicy: { policy: "same-origin" },
        originAgentCluster: true,   // Request origin-keyed agent cluster
        xFrameOptions: { action: "deny" }, // Additional clickjacking protection
        dnsPrefetchControl: { allow: false }, // Prevent DNS prefetch leaks
        ieNoOpen: true,             // Force IE downloads to save, not open
        noSniff: true,              // X-Content-Type-Options: nosniff (explicit)
        referrerPolicy: { policy: "strict-origin-when-cross-origin" }, // Balanced referrer policy
    }));

    // SECURITY: Permissions-Policy — restrict unnecessary browser APIs
    app.use((req: Request, res: Response, next: NextFunction) => {
        res.setHeader('Permissions-Policy',
            'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
            'accelerometer=(), gyroscope=(), magnetometer=(), ' +
            'display-capture=(), screen-wake-lock=()');
        next();
    });

    // CORS - Configured for local network NAS with origin validation
    // SECURITY: Restrict to same-origin and local network patterns
    app.use(cors({
        origin: function(origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
            // Allow requests with no origin (same-origin, mobile apps, curl, etc.)
            if (!origin) return callback(null, true);

            // Allow local network IPs, localhost, and mDNS (.local) hostnames
            const allowedPatterns = [
                /^https?:\/\/localhost(:\d+)?$/,
                /^https?:\/\/127\.0\.0\.1(:\d+)?$/,
                /^https?:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
                /^https?:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
                /^https?:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}(:\d+)?$/,
                /^https?:\/\/\[::1\](:\d+)?$/,
                /^https?:\/\/[a-zA-Z0-9-]+\.local(:\d+)?$/,  // mDNS hostnames (homepinas.local, etc.)
            ];

            const isAllowed = allowedPatterns.some(pattern => pattern.test(origin));
            if (isAllowed) {
                callback(null, true);
            } else {
                log.warn(`CORS blocked origin: ${origin}`);
                callback(new Error('CORS not allowed'));
            }
        },
        credentials: true,
    }));

    // Rate limiting
    app.use(generalLimiter);

    // Body parsing
    // 256kb allows docker-compose files and larger configs while still limiting abuse
    app.use(require('express').json({ limit: '256kb' }));

    // CSRF protection for state-changing requests
    app.use(csrfProtection);

    // Prevent caching of API mutation responses (BUG-01 fix)
    // POST/PUT/DELETE/PATCH must never be served from browser cache
    app.use('/api', (req: Request, res: Response, next: NextFunction) => {
        if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
            res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
            res.set('Pragma', 'no-cache');
            res.set('Expires', '0');
        }
        next();
    });

    // Cloud Sync/Backup routes (after CSRF for proper protection)
    app.use('/api/cloud-sync',   cloudSyncRoutes);
    app.use('/api/cloud-backup', cloudBackupRoutes);

    // -------------------------------------------------------------------------
    // COMPRESSION
    // -------------------------------------------------------------------------

    // gzip/deflate compression for all responses (significant for unminified fallback)
    try {
        const compression = require('compression');
        app.use(compression({ threshold: 1024 })); // compress responses > 1KB
    } catch (e) {
        log.warn('[PERF] compression module not installed — responses will not be compressed');
        log.warn('[PERF] Run: npm install compression');
    }

    // -------------------------------------------------------------------------
    // STATIC FILES
    // -------------------------------------------------------------------------

    // SECURITY: Serve only specific directories - NOT the project root
    // This prevents exposure of backend source, config, package.json, etc.

    // Serve minified assets from dist/ in production, fallback to frontend/ in dev
    const distFrontend = path.join(__dirname, '../dist/frontend');
    const srcFrontend  = path.join(__dirname, '../frontend');
    const frontendDir  = (process.env.NODE_ENV === 'production' && fs.existsSync(distFrontend))
        ? distFrontend
        : srcFrontend;

    if (frontendDir === distFrontend) {
        log.info('[STATIC] Serving minified assets from dist/frontend');
    } else {
        log.info('[STATIC] Serving unminified assets from frontend/');
    }

    // Static options: aggressive caching for hashed/minified files
    const staticOpts = {
        maxAge: frontendDir === distFrontend ? '7d' : 0,
        etag: true,
        lastModified: true,
    };

    const express = require('express');
    app.use('/frontend',  express.static(frontendDir, staticOpts));
    app.use('/icons',     express.static(path.join(__dirname, '../icons')));
    app.use('/downloads', express.static(path.join(__dirname, '../public/downloads')));
    app.use('/docs',      express.static(path.join(__dirname, '../docs')));

    // Serve only specific root-level files needed by the browser
    const allowedRootFiles = ['index.html', 'manifest.json', 'service-worker.js'];
    allowedRootFiles.forEach(file => {
        app.get(`/${file}`, (req: Request, res: Response) => {
            res.sendFile(path.join(__dirname, '..', file));
        });
    });

    // Serve i18n files
    app.use('/frontend/i18n', express.static(path.join(__dirname, '../frontend/i18n')));

    // SPA routes - serve index.html for frontend views
    // Route list is maintained in ./spa-routes.js (keep in sync with frontend/modules/registry.js)
    const spaRoutes = require('./spa-routes');
    spaRoutes.forEach((route: string) => {
        app.get(route, (req: Request, res: Response) => {
            res.sendFile(path.join(__dirname, '../index.html'));
        });
    });

    // -------------------------------------------------------------------------
    // GLOBAL ERROR HANDLER
    // -------------------------------------------------------------------------

    // Centralized error handler (see middleware/error-handler.js)
    app.use(errorHandler);
}

module.exports = { applyMiddleware };
