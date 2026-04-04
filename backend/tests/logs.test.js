// backend/tests/logs.test.js
import { describe, it, expect } from 'vitest';

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

function parseServiceList(stdout) {
    if (!stdout) return [];
    const OBSCURE = [
        'sys-', 'dev-', 'proc-', 'run-', 'snap.', 'user@',
        'session-', 'getty@', 'serial-', 'systemd-'
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
        if (OBSCURE.some(prefix => name.startsWith(prefix))) continue;
        services.push(name);
    }
    return services.slice(0, 50);
}

describe('logs route — PRIORITY mapping', () => {
    it('maps 0 (emerg) to error', () => expect(mapPriority('0')).toBe('error'));
    it('maps 1 (alert) to error', () => expect(mapPriority('1')).toBe('error'));
    it('maps 2 (crit) to error',  () => expect(mapPriority('2')).toBe('error'));
    it('maps 3 (err) to error',   () => expect(mapPriority('3')).toBe('error'));
    it('maps 4 (warning) to warn', () => expect(mapPriority('4')).toBe('warn'));
    it('maps 5 (notice) to info', () => expect(mapPriority('5')).toBe('info'));
    it('maps 6 (info) to info',   () => expect(mapPriority('6')).toBe('info'));
    it('maps 7 (debug) to debug', () => expect(mapPriority('7')).toBe('debug'));
    it('maps non-numeric to info', () => expect(mapPriority('xyz')).toBe('info'));
    it('maps undefined to info',  () => expect(mapPriority(undefined)).toBe('info'));
});

describe('logs route — journalctl line parsing', () => {
    it('parses a valid journalctl JSON line', () => {
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000',
            MESSAGE: 'Service started successfully',
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'sshd.service'
        });
        const result = parseJournalLine(line);
        expect(result).not.toBeNull();
        expect(result.message).toBe('Service started successfully');
        expect(result.level).toBe('info');
        expect(result.service).toBe('sshd');
        expect(result.timestamp).toBe(new Date(1712188800000).toISOString());
    });

    it('strips .service suffix from _SYSTEMD_UNIT', () => {
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000',
            MESSAGE: 'ok',
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'nginx.service'
        });
        expect(parseJournalLine(line).service).toBe('nginx');
    });

    it('returns null for empty/whitespace lines', () => {
        expect(parseJournalLine('')).toBeNull();
        expect(parseJournalLine('   ')).toBeNull();
        expect(parseJournalLine(null)).toBeNull();
    });

    it('returns null for invalid JSON lines', () => {
        expect(parseJournalLine('-- Journal begins --')).toBeNull();
        expect(parseJournalLine('{broken json')).toBeNull();
    });

    it('handles array-type MESSAGE field (binary log)', () => {
        const line = JSON.stringify({
            __REALTIME_TIMESTAMP: '1712188800000000',
            MESSAGE: [72, 101, 108, 108, 111],
            PRIORITY: '6',
            _SYSTEMD_UNIT: 'myapp.service'
        });
        const result = parseJournalLine(line);
        expect(result).not.toBeNull();
        expect(typeof result.message).toBe('string');
    });
});

describe('logs route — service list parsing', () => {
    const sampleOutput = `UNIT                        LOAD   ACTIVE SUB     DESCRIPTION
sshd.service                loaded active running OpenSSH server daemon
nginx.service               loaded active running A high performance web server
docker.service              loaded active running Docker Application Container Engine
systemd-journald.service    loaded active running Journal Service
sys-kernel-config.service   loaded active running Kernel Config
user@1000.service           loaded active running User Manager for UID 1000

Legend: LOAD   = Reflects whether the unit definition was properly loaded.`;

    it('extracts service names from systemctl output', () => {
        const result = parseServiceList(sampleOutput);
        expect(result).toContain('sshd');
        expect(result).toContain('nginx');
        expect(result).toContain('docker');
    });

    it('filters out obscure systemd units', () => {
        const result = parseServiceList(sampleOutput);
        expect(result).not.toContain('systemd-journald');
        expect(result).not.toContain('sys-kernel-config');
        expect(result).not.toContain('user@1000');
    });

    it('returns at most 50 services', () => {
        let big = 'UNIT LOAD ACTIVE SUB DESCRIPTION\n';
        for (let i = 0; i < 80; i++) {
            big += `service${i}.service loaded active running Desc\n`;
        }
        expect(parseServiceList(big).length).toBeLessThanOrEqual(50);
    });

    it('returns empty array for empty/null stdout', () => {
        expect(parseServiceList('')).toEqual([]);
        expect(parseServiceList(null)).toEqual([]);
    });
});

describe('logs route — lines param validation', () => {
    it('clamps lines param to safe range', () => {
        function clampLines(raw) {
            const n = parseInt(raw, 10);
            if (isNaN(n) || n < 1) return 200;
            return Math.min(n, 5000);
        }
        expect(clampLines('100')).toBe(100);
        expect(clampLines('200')).toBe(200);
        expect(clampLines('9999')).toBe(5000);
        expect(clampLines('0')).toBe(200);
        expect(clampLines('-5')).toBe(200);
        expect(clampLines(undefined)).toBe(200);
        expect(clampLines('abc')).toBe(200);
    });
});
