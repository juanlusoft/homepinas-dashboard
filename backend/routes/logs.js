// backend/routes/logs.js
'use strict';

const router = require('express').Router();
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const log = require('../logger');

function mapPriority(priority) {
    const p = parseInt(priority, 10);
    if (isNaN(p)) return 'info';
    if (p <= 3) return 'error';
    if (p === 4) return 'warn';
    if (p <= 6) return 'info';
    return 'debug';
}

function parseJournalLine(line) {
    if (!line || !line.trim()) return null;
    let obj;
    try {
        obj = JSON.parse(line);
    } catch {
        return null;
    }
    const tsUs = parseInt(obj.__REALTIME_TIMESTAMP, 10);
    const timestamp = isNaN(tsUs) ? null : new Date(tsUs / 1000).toISOString();
    const rawMsg = obj.MESSAGE;
    const message = Array.isArray(rawMsg)
        ? Buffer.from(rawMsg).toString('utf8')
        : String(rawMsg || '');
    const level = mapPriority(obj.PRIORITY);
    const service = (obj._SYSTEMD_UNIT || '').replace(/\.service$/, '');
    return { timestamp, level, message, service };
}

function clampLines(raw) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 1) return 200;
    return Math.min(n, 5000);
}

function parseServiceList(stdout) {
    if (!stdout) return [];
    const OBSCURE_PREFIXES = [
        'sys-', 'dev-', 'proc-', 'run-', 'snap.',
        'user@', 'session-', 'getty@', 'serial-', 'systemd-'
    ];
    const lines = stdout.split('\n').slice(1);
    const services = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('UNIT') || trimmed.startsWith('Legend')) continue;
        const parts = trimmed.split(/\s+/);
        const unit = parts[0];
        if (!unit || !unit.endsWith('.service')) continue;
        const name = unit.replace(/\.service$/, '');
        if (OBSCURE_PREFIXES.some(prefix => name.startsWith(prefix))) continue;
        services.push(name);
    }
    return services.slice(0, 50);
}

router.get('/', requireAuth, async (req, res) => {
    try {
        const lines = clampLines(req.query.lines);

        let serviceFilter = null;
        if (req.query.service) {
            const s = String(req.query.service).trim();
            if (/^[a-zA-Z0-9._-]{1,80}$/.test(s)) {
                serviceFilter = s.endsWith('.service') ? s : s + '.service';
            } else {
                return res.status(400).json({ error: 'Invalid service name' });
            }
        }

        const args = ['-n', String(lines), '--output', 'json', '--no-pager'];
        if (serviceFilter) args.push('-u', serviceFilter);
        if (req.query.since) {
            const since = String(req.query.since).replace(/[^a-zA-Z0-9 :-]/g, '').substring(0, 50);
            if (since) args.push('--since', since);
        }

        const { stdout } = await safeExec('journalctl', args);
        const entries = stdout.split('\n').map(parseJournalLine).filter(Boolean);
        return res.json({ entries });
    } catch (err) {
        log.error('[logs] Failed to fetch journal logs:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve logs' });
    }
});

router.get('/services', requireAuth, async (req, res) => {
    try {
        const { stdout } = await safeExec('systemctl', [
            'list-units', '--type=service', '--state=loaded', '--no-pager', '--plain',
        ]);
        const names = parseServiceList(stdout);
        const services = names.map(name => ({ id: name, name }));
        return res.json(services);
    } catch (err) {
        log.error('[logs] Failed to list services:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve service list' });
    }
});

module.exports = router;
