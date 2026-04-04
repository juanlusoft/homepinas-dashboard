/**
 * HomePiNAS - Network Routes
 * Mounted at /api/network
 */

'use strict';

const router = require('express').Router();
const fs = require('fs');

const { safeExec, sudoExec } = require('../security');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const { validateInterfaceName, validateIPv4, validateSubnetMask } = require('../sanitize');
const log = require('../logger');

const PUBLIC_IP_TTL_MS = 10 * 60 * 1000;

function prefixToSubnet(prefixlen) {
    const mask = prefixlen === 0 ? 0 : (0xFFFFFFFF << (32 - prefixlen)) >>> 0;
    return [
        (mask >>> 24) & 0xFF,
        (mask >>> 16) & 0xFF,
        (mask >>> 8) & 0xFF,
        mask & 0xFF,
    ].join('.');
}

function detectDhcp(ifname) {
    try {
        if (fs.existsSync(`/var/lib/dhcp/dhclient.${ifname}.leases`)) return true;
    } catch { /* ignore */ }

    try {
        const content = fs.readFileSync('/etc/network/interfaces', 'utf8');
        const lines = content.split('\n');
        let inIface = false;
        for (const line of lines) {
            if (line.trim().startsWith(`iface ${ifname}`)) { inIface = true; continue; }
            if (inIface && line.trim().startsWith('iface ')) break;
            if (inIface && line.includes('dhcp')) return true;
        }
    } catch { /* ignore */ }

    return false;
}

function parseIpAddrEntry(entry) {
    const isUp = (entry.flags || []).includes('UP') && (entry.flags || []).includes('LOWER_UP');
    const inet = (entry.addr_info || []).find(a => a.family === 'inet');

    return {
        id: entry.ifname,
        name: entry.ifname,
        status: isUp ? 'connected' : 'disconnected',
        dhcp: detectDhcp(entry.ifname),
        ip: inet ? inet.local : null,
        subnet: inet ? prefixToSubnet(inet.prefixlen) : null,
        gateway: null,
        dns: null,
    };
}

function buildInterfacesStanza(id, dhcp, ip, subnet, gateway, dns) {
    if (dhcp) {
        return `auto ${id}\niface ${id} inet dhcp\n`;
    }
    let stanza = `auto ${id}\niface ${id} inet static\n`;
    stanza += `    address ${ip}\n`;
    stanza += `    netmask ${subnet}\n`;
    if (gateway) stanza += `    gateway ${gateway}\n`;
    if (dns) stanza += `    dns-nameservers ${dns}\n`;
    return stanza;
}

async function _interfacesHandler(req, res) {
    try {
        const { stdout } = await safeExec('ip', ['-j', 'addr', 'show']);
        const entries = JSON.parse(stdout);
        const interfaces = entries
            .filter(e => e.ifname !== 'lo' && !e.ifname.startsWith('lo:'))
            .map(parseIpAddrEntry);
        res.json(interfaces);
    } catch (err) {
        log.error('[network/interfaces] Error:', err.message);
        res.status(500).json({ error: 'Failed to list network interfaces' });
    }
}

async function _configureHandler(req, res) {
    const { id, dhcp, ip, subnet, gateway, dns } = req.body;

    if (!validateInterfaceName(id)) {
        return res.status(400).json({ error: 'Invalid interface name' });
    }

    if (!dhcp) {
        if (!ip || !validateIPv4(ip)) {
            return res.status(400).json({ error: 'Invalid or missing IP address' });
        }
        if (!subnet || !validateSubnetMask(subnet)) {
            return res.status(400).json({ error: 'Invalid or missing subnet mask' });
        }
        if (gateway && !validateIPv4(gateway)) {
            return res.status(400).json({ error: 'Invalid gateway address' });
        }
        if (dns && !validateIPv4(dns)) {
            return res.status(400).json({ error: 'Invalid DNS address' });
        }
    }

    try {
        const stanza = buildInterfacesStanza(id, dhcp, ip, subnet, gateway, dns);
        const destFile = `/etc/network/interfaces.d/${id}`;

        await sudoExec('tee', [destFile], { input: stanza });
        await sudoExec('ip', ['link', 'set', id, 'up']);

        log.info(`[network/configure] Interface ${id} configured by ${req.user?.username}`);
        res.json({ success: true, message: `Interface ${id} configured` });
    } catch (err) {
        log.error('[network/configure] Error:', err.message);
        res.status(500).json({ error: 'Failed to configure interface: ' + err.message });
    }
}

async function _publicIpHandler(req, res) {
    // Read cache once — reuse in catch to avoid stale-mock re-read
    const cachedData = getData() || {};
    const cachedAt = cachedData.publicIpCachedAt || 0;
    const age = Date.now() - cachedAt;
    const hasFreshCache = !!(cachedData.publicIp && age < PUBLIC_IP_TTL_MS);

    if (hasFreshCache) {
        return res.json({ ip: cachedData.publicIp });
    }

    try {
        const response = await fetch('https://api.ipify.org?format=json');
        if (!response.ok) throw new Error(`ipify returned ${response.status}`);
        const json = await response.json();
        const freshIp = json.ip;

        await withData((d) => {
            d.publicIp = freshIp;
            d.publicIpCachedAt = Date.now();
            return d;
        });

        res.json({ ip: freshIp });
    } catch (err) {
        log.error('[network/public-ip] Error:', err.message);
        res.status(502).json({ error: 'Failed to determine public IP' });
    }
}

router.get('/interfaces',  requireAuth, _interfacesHandler);
router.post('/configure',  requireAuth, requirePermission('admin'), _configureHandler);
router.get('/public-ip',   requireAuth, _publicIpHandler);

module.exports = router;
module.exports._interfacesHandler = _interfacesHandler;
module.exports._configureHandler  = _configureHandler;
module.exports._publicIpHandler   = _publicIpHandler;
