'use strict';
const router = require('express').Router();
const crypto = require('crypto');
const https = require('https');
const { withData, getData } = require('../data');
const { requireAuth } = require('../auth');
const { requirePermission } = require('../rbac');
const log = require('../logger');

const VALID_PROVIDERS = ['duckdns', 'cloudflare', 'noip'];

function validateProvider(provider) {
    return VALID_PROVIDERS.includes(provider);
}

function httpsRequest(url, options = {}, body) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.setTimeout(10000, () => { req.destroy(new Error('DDNS request timed out')); });
        if (body) req.write(body);
        req.end();
    });
}

async function getPublicIp() {
    const { body } = await httpsRequest('https://api.ipify.org?format=json');
    const parsed = JSON.parse(body);
    if (!parsed.ip) throw new Error('No IP in ipify response');
    return parsed.ip;
}

async function updateDuckDns(entry, ip) {
    const url = `https://www.duckdns.org/update?domains=${encodeURIComponent(entry.domain)}&token=${encodeURIComponent(entry.token)}&ip=${encodeURIComponent(ip)}`;
    const { body } = await httpsRequest(url);
    if (!body.startsWith('OK')) throw new Error(`DuckDNS update failed: ${body}`);
}

async function updateCloudflare(entry, ip) {
    if (!entry.zoneId || !entry.recordId) throw new Error('Cloudflare entry missing zoneId or recordId.');
    const payload = JSON.stringify({ type: 'A', name: entry.domain, content: ip, ttl: 120, proxied: false });
    const { statusCode, body } = await httpsRequest(
        `https://api.cloudflare.com/client/v4/zones/${entry.zoneId}/dns_records/${entry.recordId}`,
        { method: 'PUT', headers: { 'Authorization': `Bearer ${entry.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
        payload
    );
    const result = JSON.parse(body);
    if (!result.success) throw new Error(`Cloudflare update failed (${statusCode}): ${JSON.stringify(result.errors)}`);
}

async function updateNoIp(entry, ip) {
    const authBase64 = Buffer.from(entry.token).toString('base64');
    const url = `https://dynupdate.no-ip.com/nic/update?hostname=${encodeURIComponent(entry.domain)}&myip=${encodeURIComponent(ip)}`;
    const { body } = await httpsRequest(url, { headers: { 'Authorization': `Basic ${authBase64}`, 'User-Agent': 'HomePiNAS/1.0 admin@homepinas.local' } });
    if (!body.startsWith('good') && !body.startsWith('nochg')) throw new Error(`No-IP update failed: ${body}`);
}

async function updateEntry(entry) {
    let ip;
    try {
        ip = await getPublicIp();
    } catch (err) {
        log.error(`[ddns] Failed to get public IP for entry ${entry.id}:`, err.message);
        await withData(data => {
            const entries = data.ddnsEntries || [];
            const idx = entries.findIndex(e => e.id === entry.id);
            if (idx !== -1) { entries[idx].status = 'error'; entries[idx].lastError = `IP fetch failed: ${err.message}`; data.ddnsEntries = entries; }
            return data;
        });
        return;
    }
    try {
        if (entry.provider === 'duckdns') await updateDuckDns(entry, ip);
        else if (entry.provider === 'cloudflare') await updateCloudflare(entry, ip);
        else if (entry.provider === 'noip') await updateNoIp(entry, ip);
        else throw new Error(`Unknown provider: ${entry.provider}`);
        await withData(data => {
            const entries = data.ddnsEntries || [];
            const idx = entries.findIndex(e => e.id === entry.id);
            if (idx !== -1) { entries[idx].lastUpdate = new Date().toISOString(); entries[idx].lastIp = ip; entries[idx].status = 'ok'; entries[idx].lastError = null; data.ddnsEntries = entries; }
            return data;
        });
        log.info(`[ddns] Updated ${entry.provider}/${entry.domain} → ${ip}`);
    } catch (err) {
        log.error(`[ddns] Update failed for ${entry.id}:`, err.message);
        await withData(data => {
            const entries = data.ddnsEntries || [];
            const idx = entries.findIndex(e => e.id === entry.id);
            if (idx !== -1) { entries[idx].status = 'error'; entries[idx].lastError = err.message; data.ddnsEntries = entries; }
            return data;
        });
    }
}

async function updateAllEnabled() {
    const data = getData();
    const entries = (data.ddnsEntries || []).filter(e => e.enabled);
    await Promise.allSettled(entries.map(updateEntry));
}

const DDNS_INTERVAL_MS = 10 * 60 * 1000;
let _intervalHandle = setInterval(() => {
    updateAllEnabled().catch(err => { log.error('[ddns] Background update error:', err); });
}, DDNS_INTERVAL_MS);
if (_intervalHandle.unref) _intervalHandle.unref();

function stopDdnsInterval() { clearInterval(_intervalHandle); }

router.get('/', requireAuth, (req, res) => {
    try {
        const data = getData();
        const entries = (data.ddnsEntries || []).map(({ token, ...rest }) => ({ ...rest, token: token ? '***' : null }));
        res.json(entries);
    } catch (err) {
        log.error('[ddns] GET failed:', err);
        res.status(500).json({ error: 'Failed to load DDNS entries' });
    }
});

router.post('/', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { provider, domain, token, enabled = true, zoneId, recordId } = req.body || {};
        if (!validateProvider(provider)) return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
        if (!domain || typeof domain !== 'string' || domain.trim().length === 0) return res.status(400).json({ error: 'domain is required' });
        if (!token || typeof token !== 'string' || token.trim().length === 0) return res.status(400).json({ error: 'token is required' });

        const entry = {
            id: crypto.randomUUID(),
            provider,
            domain: domain.trim(),
            token: token.trim(),
            enabled: Boolean(enabled),
            lastUpdate: null,
            lastIp: null,
            status: 'pending',
            lastError: null,
            createdAt: new Date().toISOString(),
            ...(zoneId ? { zoneId } : {}),
            ...(recordId ? { recordId } : {})
        };
        await withData(data => { data.ddnsEntries = [...(data.ddnsEntries || []), entry]; return data; });
        const { token: _t, ...safeEntry } = entry;
        res.status(201).json({ ...safeEntry, token: '***' });
    } catch (err) {
        log.error('[ddns] POST failed:', err);
        res.status(500).json({ error: 'Failed to create DDNS entry' });
    }
});

router.put('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const updates = req.body || {};
        if (updates.provider !== undefined && !validateProvider(updates.provider)) return res.status(400).json({ error: `provider must be one of: ${VALID_PROVIDERS.join(', ')}` });
        let found = false;
        await withData(data => {
            const entries = data.ddnsEntries || [];
            const idx = entries.findIndex(e => e.id === id);
            if (idx === -1) return data;
            found = true;
            const { id: _id, createdAt: _c, ...allowed } = updates;
            entries[idx] = { ...entries[idx], ...allowed };
            data.ddnsEntries = entries;
            return data;
        });
        if (!found) return res.status(404).json({ error: 'Entry not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('[ddns] PUT failed:', err);
        res.status(500).json({ error: 'Failed to update DDNS entry' });
    }
});

router.delete('/:id', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        let found = false;
        await withData(data => {
            const entries = data.ddnsEntries || [];
            const filtered = entries.filter(e => e.id !== id);
            found = filtered.length < entries.length;
            data.ddnsEntries = filtered;
            return data;
        });
        if (!found) return res.status(404).json({ error: 'Entry not found' });
        res.json({ success: true });
    } catch (err) {
        log.error('[ddns] DELETE failed:', err);
        res.status(500).json({ error: 'Failed to delete DDNS entry' });
    }
});

router.post('/:id/update', requireAuth, requirePermission('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const data = getData();
        const entry = (data.ddnsEntries || []).find(e => e.id === id);
        if (!entry) return res.status(404).json({ error: 'Entry not found' });
        updateEntry(entry).catch(err => { log.error('[ddns] Manual update error:', err); });
        let ip = null;
        try { ip = await getPublicIp(); } catch { /* ignore */ }
        res.json({ success: true, ip });
    } catch (err) {
        log.error('[ddns] POST /:id/update failed:', err);
        res.status(500).json({ error: 'Failed to trigger DDNS update' });
    }
});

router.stopDdnsInterval = stopDdnsInterval;
router.validateProvider = validateProvider;
module.exports = router;
