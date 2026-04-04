/**
 * HomePiNAS - Premium NAS Dashboard for Raspberry Pi CM5
 * Homelabs.club Edition
 *
 * Version is read from package.json at runtime.
 * See CHANGELOG.md for feature history.
 */

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const helmet = require('helmet');

// Import utilities
const log = require('./utils/logger');
const { validateEnv } = require('./utils/validate-env');
const { initSessionDb, startSessionCleanup } = require('./utils/session');
const { startErrorMonitor } = require('./utils/error-monitor');
const { errorHandler } = require('./middleware/error-handler');

// Import middleware
const { generalLimiter } = require('./middleware/rateLimit');
const { csrfProtection } = require('./middleware/csrf');
const { metricsMiddleware, generateMetrics } = require('./utils/metrics');

// Import routes
const systemRoutes = require('./routes/system');
const storageRoutes = require('./routes/storage');
const dockerRoutes = require('./routes/docker');
const authRoutes = require('./routes/auth');
const networkRoutes = require('./routes/network');
const powerRoutes = require('./routes/power');
const updateRoutes = require('./routes/update');
const terminalRoutes = require('./routes/terminal');
const shortcutsRoutes = require('./routes/shortcuts');
const filesRoutes = require('./routes/files');
const usersRoutes = require('./routes/users');
const sambaRoutes = require('./routes/samba');
const nfsRoutes = require('./routes/nfs');
const notificationsRoutes = require('./routes/notifications');
const totpRoutes = require('./routes/totp');
const logsRoutes = require('./routes/logs');
const backupRoutes = require('./routes/backup');
const schedulerRoutes = require('./routes/scheduler');
const upsRoutes = require('./routes/ups');
const ddnsRoutes = require('./routes/ddns');
const activeBackupRoutes = require('./routes/active-backup');
const cloudSyncRoutes = require('./routes/cloud-sync');
const cloudBackupRoutes = require('./routes/cloud-backup');
const homestoreRoutes = require('./routes/homestore');
const stacksRoutes = require('./routes/stacks');
const activeDirectoryRoutes = require('./routes/active-directory');
const vpnRoutes = require('./routes/vpn');

// Import terminal WebSocket handler
let setupTerminalWebSocket;
try {
    setupTerminalWebSocket = require('./utils/terminal-ws').setupTerminalWebSocket;
} catch (e) {
    log.warn('[WARN] Terminal WebSocket not available - node-pty may not be installed');
    setupTerminalWebSocket = null;
}

// Configuration
// Read version from package.json (single source of truth)
const VERSION = require('../package.json').version;
const HTTPS_PORT = process.env.HTTPS_PORT || 443;
const HTTP_PORT = process.env.HTTP_PORT || 80;
const SSL_CERT_PATH = path.join(__dirname, 'certs', 'server.crt');
const SSL_KEY_PATH = path.join(__dirname, 'certs', 'server.key');

// Auto-generate SSL certificates if they don't exist
function ensureSSLCerts() {
    const certsDir = path.join(__dirname, 'certs');
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
                for (const addr of iface) {
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
            log.error('[SSL] Failed to generate certificates:', e.message);
        }
    }
}
// Ensure config directory exists
const configDir = path.join(__dirname, 'config');
if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
}

// Ensure temp directories exist on storage (not eMMC)
// IMPORTANT: Must run BEFORE ensureSSLCerts() which writes to /mnt/storage/.tmp/
const storageTmpDirs = ['/mnt/storage/.tmp', '/mnt/storage/.uploads-tmp'];
for (const dir of storageTmpDirs) {
    try {
        if (fs.existsSync('/mnt/storage') && !fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {
        log.warn(`Could not create ${dir}:`, e.message);
    }
}

ensureSSLCerts();

// Initialize Express app
// Validate environment variables before anything else
validateEnv();

const app = express();

// Initialize session database
initSessionDb();
startSessionCleanup();

// =============================================================================
// METRICS & HEALTH (before auth — must be public)
// =============================================================================

// Request timing middleware (must be first to capture all requests)
app.use(metricsMiddleware);

// Prometheus metrics endpoint
app.get('/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(generateMetrics());
});

// Health check endpoint (lightweight, no auth)
app.get('/health', (req, res) => {
    const memUsage = process.memoryUsage();
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        version: VERSION,
        memory: {
            rss: Math.round(memUsage.rss / 1024 / 1024),      // MB
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        },
        timestamp: new Date().toISOString(),
    });
});

// =============================================================================
// MIDDLEWARE
// =============================================================================

// Security headers — hardened configuration (Phase 3 security audit)
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
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy',
        'camera=(), microphone=(), geolocation=(), payment=(), usb=(), ' +
        'accelerometer=(), gyroscope=(), magnetometer=(), ' +
        'display-capture=(), screen-wake-lock=()');
    next();
});

// CORS - Configured for local network NAS with origin validation
// SECURITY: Restrict to same-origin and local network patterns
app.use(cors({
    origin: function(origin, callback) {
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
app.use(express.json({ limit: '256kb' }));

// CSRF protection for state-changing requests
app.use(csrfProtection);

// Prevent caching of API mutation responses (BUG-01 fix)
// POST/PUT/DELETE/PATCH must never be served from browser cache
app.use('/api', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
    }
    next();
});

// Cloud Sync/Backup routes (after CSRF for proper protection)
app.use('/api/cloud-sync', cloudSyncRoutes);
app.use('/api/cloud-backup', cloudBackupRoutes);

// =============================================================================
// COMPRESSION
// =============================================================================

// gzip/deflate compression for all responses (significant for unminified fallback)
try {
    const compression = require('compression');
    app.use(compression({ threshold: 1024 })); // compress responses > 1KB
} catch (e) {
    log.warn('[PERF] compression module not installed — responses will not be compressed');
    log.warn('[PERF] Run: npm install compression');
}

// =============================================================================
// STATIC FILES
// =============================================================================

// SECURITY: Serve only specific directories - NOT the project root
// This prevents exposure of backend source, config, package.json, etc.

// Serve minified assets from dist/ in production, fallback to frontend/ in dev
const distFrontend = path.join(__dirname, '../dist/frontend');
const srcFrontend = path.join(__dirname, '../frontend');
const frontendDir = (process.env.NODE_ENV === 'production' && fs.existsSync(distFrontend))
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

app.use('/frontend', express.static(frontendDir, staticOpts));
app.use('/icons', express.static(path.join(__dirname, '../icons')));
app.use('/downloads', express.static(path.join(__dirname, '../public/downloads')));
app.use('/docs', express.static(path.join(__dirname, '../docs')));

// Serve only specific root-level files needed by the browser
const allowedRootFiles = ['index.html', 'manifest.json', 'service-worker.js'];
allowedRootFiles.forEach(file => {
    app.get(`/${file}`, (req, res) => {
        res.sendFile(path.join(__dirname, '..', file));
    });
});

// Serve i18n files
app.use('/frontend/i18n', express.static(path.join(__dirname, '../frontend/i18n')));

// SPA routes - serve index.html for frontend views
const spaRoutes = ['/', '/dashboard', '/docker', '/storage', '/files', '/network', '/system', '/terminal', '/shortcuts', '/backup', '/logs', '/users', '/active-backup', '/active-directory', '/cloud-sync', '/cloud-backup', '/homestore', '/stacks', '/setup', '/login', '/setup/storage', '/vpn'];
spaRoutes.forEach(route => {
    app.get(route, (req, res) => {
        res.sendFile(path.join(__dirname, '../index.html'));
    });
});

// =============================================================================
// API ROUTES
// =============================================================================

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
app.use('/api/nfs', nfsRoutes);

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
app.use('/api/homestore', homestoreRoutes);
app.use('/api/stacks', stacksRoutes);
app.use('/api/ad', activeDirectoryRoutes);

// VPN Server (WireGuard)
app.use('/api/vpn', vpnRoutes);

// =============================================================================
// GLOBAL ERROR HANDLER
// =============================================================================

// Centralized error handler (see middleware/error-handler.js)
app.use(errorHandler);

// =============================================================================
// SERVER STARTUP
// =============================================================================

log.info(`HomePiNAS v${VERSION} — Premium NAS Dashboard for Raspberry Pi (Homelabs.club)`);

// Start HTTPS server if certificates exist
let httpsServer = null;
if (fs.existsSync(SSL_CERT_PATH) && fs.existsSync(SSL_KEY_PATH)) {
    try {
        const sslOptions = {
            key: fs.readFileSync(SSL_KEY_PATH),
            cert: fs.readFileSync(SSL_CERT_PATH)
        };
        httpsServer = https.createServer(sslOptions, app);
        httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
            log.info(`[HTTPS] Secure server running on https://0.0.0.0:${HTTPS_PORT}`);
        });
    } catch (e) {
        log.error('[HTTPS] Failed to start:', e.message);
    }
}

// HTTP server - redirect to HTTPS if available, otherwise serve app
let httpApp;
if (httpsServer) {
    // Create a simple redirect app for HTTP
    httpApp = express();
    httpApp.use((req, res) => {
        // Redirect to HTTPS (omit port if using standard 443)
        const host = req.headers.host?.split(':')[0] || req.hostname;
        const portSuffix = HTTPS_PORT == 443 ? '' : `:${HTTPS_PORT}`;
        const httpsUrl = `https://${host}${portSuffix}${req.url}`;
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
            log.warn('[WARN]  Terminal WebSocket setup failed:', e.message);
        }
    }

    // Start error monitoring (if enabled in config)
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
        log.warn('[WARN]  Terminal WebSocket (HTTPS) setup failed:', e.message);
    }
}

module.exports = app;
