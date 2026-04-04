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

// GET /api/vpn/clients
router.get('/clients', requireAuth, requirePermission('admin'), (req, res) => {
    try {
        const data = getData();
        const clients = (data.vpnClients || []).map(c => ({
            id: c.id,
            name: c.name,
            assignedIp: c.assignedIp,
            publicKey: c.publicKey,
            createdAt: c.createdAt,
        }));
        res.json(clients);
    } catch (err) {
        log.error('[vpn] list clients error:', err.message);
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

// GET /api/vpn/clients/:id/qr
router.get('/clients/:id/qr', requireAuth, requirePermission('admin'), async (req, res) => {
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

        res.set('Content-Type', 'image/svg+xml');
        res.send(qrSvg);
    } catch (err) {
        log.error('[vpn] get client QR error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /api/vpn/clients/:id/toggle
router.post('/clients/:id/toggle', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        let client = null;
        await withData((d) => {
            if (!d.vpnClients) d.vpnClients = [];
            const c = d.vpnClients.find(c => c.id === req.params.id);
            if (!c) return;
            c.enabled = !c.enabled;
            client = c;
            return d;
        });

        if (!client) {
            return res.status(404).json({ error: 'Client not found' });
        }

        res.json({ success: true, enabled: client.enabled });
    } catch (err) {
        log.error('[vpn] toggle client error:', err.message);
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

// GET /api/vpn/config
router.get('/config', requireAuth, requirePermission('admin'), (req, res) => {
    try {
        const data = getData();
        const vpnConfig = data.vpnConfig || {};
        res.json({
            endpoint: vpnConfig.endpoint || '',
            port: vpnConfig.port || 51820,
            dns: vpnConfig.dns || '1.1.1.1',
        });
    } catch (err) {
        log.error('[vpn] get config error:', err.message);
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
