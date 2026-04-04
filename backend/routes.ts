/**
 * routes.ts — API route registration for HomePiNAS
 *
 * Exports registerRoutes(app, version) which wires up the metrics middleware,
 * public endpoints (/metrics, /health), and all /api/* route modules.
 */

'use strict';

import type { Express, Request, Response } from 'express-serve-static-core';

const { metricsMiddleware, generateMetrics } = require('./utils/metrics');

// API route modules
const systemRoutes          = require('./routes/system');
const storageRoutes         = require('./routes/storage');
const dockerRoutes          = require('./routes/docker');
const authRoutes            = require('./routes/auth');
const networkRoutes         = require('./routes/network');
const powerRoutes           = require('./routes/power');
const updateRoutes          = require('./routes/update');
const terminalRoutes        = require('./routes/terminal');
const shortcutsRoutes       = require('./routes/shortcuts');
const filesRoutes           = require('./routes/files');
const usersRoutes           = require('./routes/users');
const sambaRoutes           = require('./routes/samba');
const nfsRoutes             = require('./routes/nfs');
const notificationsRoutes   = require('./routes/notifications');
const totpRoutes            = require('./routes/totp');
const logsRoutes            = require('./routes/logs');
const backupRoutes          = require('./routes/backup');
const schedulerRoutes       = require('./routes/scheduler');
const upsRoutes             = require('./routes/ups');
const ddnsRoutes            = require('./routes/ddns');
const activeBackupRoutes    = require('./routes/active-backup');
const homestoreRoutes       = require('./routes/homestore');
const stacksRoutes          = require('./routes/stacks');
const activeDirectoryRoutes = require('./routes/active-directory');
const vpnRoutes             = require('./routes/vpn');

// ---------------------------------------------------------------------------

function registerRoutes(app: Express, version: string): void {
    // -------------------------------------------------------------------------
    // METRICS & HEALTH (before auth — must be public)
    // -------------------------------------------------------------------------

    // Request timing middleware (must be first to capture all requests)
    app.use(metricsMiddleware);

    // Prometheus metrics endpoint
    app.get('/metrics', (req: Request, res: Response) => {
        res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(generateMetrics());
    });

    // Health check endpoint (lightweight, no auth)
    app.get('/health', (req: Request, res: Response) => {
        const memUsage = process.memoryUsage();
        res.json({
            status: 'ok',
            uptime: Math.round(process.uptime()),
            version: version,
            memory: {
                rss:       Math.round(memUsage.rss       / 1024 / 1024), // MB
                heapUsed:  Math.round(memUsage.heapUsed  / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            },
            timestamp: new Date().toISOString(),
        });
    });

    // -------------------------------------------------------------------------
    // API ROUTES
    // -------------------------------------------------------------------------

    // System routes (stats, fans, disks, status)
    app.use('/api/system', systemRoutes);

    // Storage routes (pool, snapraid)
    app.use('/api/storage', storageRoutes);

    // Docker routes
    app.use('/api/docker', dockerRoutes);

    // Authentication routes (setup, login, logout)
    app.use('/api', authRoutes);

    // Network routes
    app.use('/api/network', networkRoutes);

    // Power routes (reset, reboot, shutdown)
    app.use('/api/power', powerRoutes);

    // Update routes (check, apply)
    app.use('/api/update', updateRoutes);

    // Terminal routes (PTY sessions)
    app.use('/api/terminal', terminalRoutes);

    // Shortcuts routes (configurable program shortcuts)
    app.use('/api/shortcuts', shortcutsRoutes);

    // File Manager routes (File Station)
    app.use('/api/files', filesRoutes);

    // User Management routes
    app.use('/api/users', usersRoutes);

    // Samba Share Management routes
    app.use('/api/samba', sambaRoutes);
    app.use('/api/nfs',   nfsRoutes);

    // Notification routes (email + Telegram)
    app.use('/api/notifications', notificationsRoutes);

    // TOTP 2FA routes
    app.use('/api/totp', totpRoutes);

    // Log Viewer routes
    app.use('/api/logs', logsRoutes);

    // Backup Management routes
    app.use('/api/backup', backupRoutes);

    // Task Scheduler routes
    app.use('/api/scheduler', schedulerRoutes);

    // UPS Monitor routes
    app.use('/api/ups', upsRoutes);

    // Dynamic DNS routes
    app.use('/api/ddns', ddnsRoutes);

    // Active Backup for Business
    app.use('/api/active-backup', activeBackupRoutes);

    // HomeStore - App marketplace
    app.use('/api/homestore',  homestoreRoutes);
    app.use('/api/stacks',     stacksRoutes);
    app.use('/api/ad',         activeDirectoryRoutes);

    // VPN Server (WireGuard)
    app.use('/api/vpn', vpnRoutes);
}

module.exports = { registerRoutes };
