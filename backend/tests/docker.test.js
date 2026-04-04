// backend/tests/docker.test.js
// Unit tests for docker route helpers and input validation reuse
// Run with: npx vitest run backend/tests/docker.test.js

import { describe, it, expect } from 'vitest';
import {
    validateDockerAction,
    validateContainerId,
    sanitizeComposeName,
    validateComposeContent
} from '../sanitize.ts';

// ─── Re-implement pure helpers for isolation ─────────────────────────────────

function parseDockerLines(stdout) {
    return stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean);
}

function parseMemString(mem) {
    if (!mem || typeof mem !== 'string') return 0;
    const m = mem.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|B)/i);
    if (!m) return 0;
    const value = parseFloat(m[1]);
    const unit  = m[2].toUpperCase();
    const multipliers = { B: 1, KIB: 1024, MIB: 1024**2, GIB: 1024**3, TIB: 1024**4 };
    return Math.round(value * (multipliers[unit] || 1));
}

function parseDockerStats(stdout) {
    const statsMap = new Map();
    for (const s of parseDockerLines(stdout)) {
        const id = (s.ID || s.id || '').slice(0, 12);
        if (id) statsMap.set(id, s);
    }
    return statsMap;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('parseDockerLines()', () => {
    it('parses multiple JSON lines', () => {
        const output = `{"ID":"abc123","Names":"/nginx","Image":"nginx:latest","Status":"Up"}\n{"ID":"def456","Names":"/redis","Image":"redis:7","Status":"Exited"}`;
        const result = parseDockerLines(output);
        expect(result).toHaveLength(2);
        expect(result[0].ID).toBe('abc123');
        expect(result[1].Image).toBe('redis:7');
    });

    it('skips malformed JSON lines', () => {
        const output = `{"ID":"abc"}\nNOT_JSON\n{"ID":"def"}`;
        const result = parseDockerLines(output);
        expect(result).toHaveLength(2);
    });

    it('returns empty array for blank output', () => {
        expect(parseDockerLines('')).toHaveLength(0);
        expect(parseDockerLines('   \n   ')).toHaveLength(0);
    });
});

describe('parseMemString()', () => {
    it('parses MiB', () => {
        expect(parseMemString('256MiB')).toBe(256 * 1024 ** 2);
    });

    it('parses GiB', () => {
        expect(parseMemString('1.5GiB')).toBe(Math.round(1.5 * 1024 ** 3));
    });

    it('parses KiB', () => {
        expect(parseMemString('512KiB')).toBe(512 * 1024);
    });

    it('parses bytes (B)', () => {
        expect(parseMemString('1024B')).toBe(1024);
    });

    it('returns 0 for invalid input', () => {
        expect(parseMemString(null)).toBe(0);
        expect(parseMemString('unknown')).toBe(0);
        expect(parseMemString('')).toBe(0);
    });
});

describe('parseDockerStats()', () => {
    it('keys stats by 12-char container ID', () => {
        const stdout = `{"ID":"abc123def456789","CPUPerc":"1.5%","MemUsage":"100MiB / 2GiB"}`;
        const statsMap = parseDockerStats(stdout);
        expect(statsMap.has('abc123def456')).toBe(true);
        const entry = statsMap.get('abc123def456');
        expect(entry.CPUPerc).toBe('1.5%');
    });

    it('returns empty map for empty output', () => {
        expect(parseDockerStats('').size).toBe(0);
    });
});

// ─── Input validation (from sanitize.ts) ─────────────────────────────────────

describe('validateDockerAction()', () => {
    it('allows start, stop, restart', () => {
        expect(validateDockerAction('start')).toBe(true);
        expect(validateDockerAction('stop')).toBe(true);
        expect(validateDockerAction('restart')).toBe(true);
    });

    it('rejects arbitrary commands', () => {
        expect(validateDockerAction('rm')).toBe(false);
        expect(validateDockerAction('exec')).toBe(false);
        expect(validateDockerAction('kill')).toBe(false);
        expect(validateDockerAction('')).toBe(false);
        expect(validateDockerAction('start; rm -rf /')).toBe(false);
    });
});

describe('validateContainerId()', () => {
    it('accepts 12-char hex IDs', () => {
        expect(validateContainerId('abc123def456')).toBe(true);
    });

    it('accepts 64-char full IDs', () => {
        expect(validateContainerId('a'.repeat(64))).toBe(true);
    });

    it('rejects IDs with non-hex characters', () => {
        expect(validateContainerId('abc123xyz000')).toBe(false);
        expect(validateContainerId('abc123def45')).toBe(false); // 11 chars
    });

    it('rejects null/empty', () => {
        expect(validateContainerId(null)).toBe(false);
        expect(validateContainerId('')).toBe(false);
    });
});

describe('sanitizeComposeName()', () => {
    it('allows alphanumeric names with hyphens and underscores', () => {
        expect(sanitizeComposeName('my-app')).toBe('my-app');
        expect(sanitizeComposeName('my_app_v2')).toBe('my_app_v2');
        expect(sanitizeComposeName('homeassistant')).toBe('homeassistant');
    });

    it('strips special characters', () => {
        const result = sanitizeComposeName('my app!');
        expect(result).toBe('myapp');
    });

    it('rejects names that do not start with alphanumeric', () => {
        expect(sanitizeComposeName('-invalid')).toBeNull();
        expect(sanitizeComposeName('_bad')).toBeNull();
    });

    it('rejects names longer than 50 chars', () => {
        expect(sanitizeComposeName('a'.repeat(51))).toBeNull();
    });

    it('rejects empty name', () => {
        expect(sanitizeComposeName('')).toBeNull();
        expect(sanitizeComposeName(null)).toBeNull();
    });
});

describe('validateComposeContent()', () => {
    const validYaml = `version: '3.8'\nservices:\n  web:\n    image: nginx:latest\n`;

    it('accepts valid docker-compose YAML', () => {
        const result = validateComposeContent(validYaml);
        expect(result.valid).toBe(true);
    });

    it('rejects YAML without a services key', () => {
        const noServices = `version: '3'\nnetworks:\n  default:\n`;
        const result = validateComposeContent(noServices);
        expect(result.valid).toBe(false);
        expect(result.error).toMatch(/services/i);
    });

    it('rejects content longer than 100KB', () => {
        const huge = 'a'.repeat(100001);
        expect(validateComposeContent(huge).valid).toBe(false);
    });

    it('rejects empty content', () => {
        expect(validateComposeContent('').valid).toBe(false);
        expect(validateComposeContent(null).valid).toBe(false);
    });

    it('rejects invalid YAML syntax', () => {
        const badYaml = `services:\n  web: [\nunclosed`;
        const result = validateComposeContent(badYaml);
        expect(result.valid).toBe(false);
    });
});
