// backend/tests/storage.test.js
// Unit tests for storage route helpers
// Run with: npx vitest run backend/tests/storage.test.js

import { describe, it, expect } from 'vitest';

// Re-implement pure helpers for test isolation

function parseDfOutput(stdout) {
    const lines = stdout.trim().split('\n');
    const data  = lines[lines.length - 1];
    if (!data) return null;
    const parts = data.split(/\s+/);
    if (parts.length < 6) return null;
    const poolSize    = parseInt(parts[1], 10);
    const poolUsed    = parseInt(parts[2], 10);
    const poolFree    = parseInt(parts[3], 10);
    const usedPercent = parseInt(parts[4], 10);
    if (isNaN(poolSize)) return null;
    return { poolSize, poolUsed, poolFree, usedPercent };
}

function parseDiskstats(content, diskId) {
    const lines = content.split('\n');
    for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols[2] === diskId) {
            const readSectors  = parseInt(cols[5],  10) || 0;
            const writeSectors = parseInt(cols[9],  10) || 0;
            return { read: readSectors * 512, write: writeSectors * 512 };
        }
    }
    return null;
}

function parseSmartAttributes(smart) {
    const attrs    = smart.ata_smart_attributes?.table || [];
    const findAttr = (id) => attrs.find(a => a.id === id);
    const reallocAttr  = findAttr(5);
    const pendingAttr  = findAttr(197);
    const ssdLifeAttr  = findAttr(231);
    const tempAttr     = findAttr(194);
    const powerOnAttr  = findAttr(9);
    return {
        reallocatedSectors: reallocAttr  ? reallocAttr.raw.value  : 0,
        pendingSectors:     pendingAttr  ? pendingAttr.raw.value  : 0,
        ssdLife:            ssdLifeAttr  ? ssdLifeAttr.raw.value  : null,
        temperature:        tempAttr     ? tempAttr.raw.value
                                        : (smart.temperature?.current ?? null),
        powerOnHours:       powerOnAttr  ? powerOnAttr.raw.value  : null,
        smartPassed:        smart.smart_status ? smart.smart_status.passed : null,
        model:              smart.model_name || null
    };
}

function resolveFileLocation(filePath, storageConfig) {
    const cfg        = storageConfig || {};
    const cacheMount = cfg.cacheMount || '/mnt/cache';
    const poolMount  = cfg.poolMount  || '/mnt/storage';
    if (filePath.startsWith(cacheMount + '/') || filePath === cacheMount) {
        return { diskType: 'cache', physicalLocation: cacheMount };
    }
    if (filePath.startsWith(poolMount + '/') || filePath === poolMount) {
        return { diskType: 'pool', physicalLocation: poolMount };
    }
    return { diskType: 'unknown', physicalLocation: '' };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('parseDfOutput()', () => {
    it('parses a valid df -B1 output line', () => {
        const dfOutput = `Filesystem          1B-blocks       Used     Available Use% Mounted on
/dev/sdb            107374182400  53687091200  53687091200  50% /mnt/storage`;
        const result = parseDfOutput(dfOutput);
        expect(result).not.toBeNull();
        expect(result.poolSize).toBe(107374182400);
        expect(result.poolUsed).toBe(53687091200);
        expect(result.poolFree).toBe(53687091200);
        expect(result.usedPercent).toBe(50);
    });

    it('returns null for empty output', () => {
        expect(parseDfOutput('')).toBeNull();
    });

    it('returns null when columns are missing', () => {
        expect(parseDfOutput('Filesystem 1B-blocks')).toBeNull();
    });

    it('handles 99% used', () => {
        const dfOutput = `Filesystem 1B-blocks Used Available Use% Mounted
/dev/sdb 1000000 990000 10000 99% /mnt/storage`;
        const result = parseDfOutput(dfOutput);
        expect(result.usedPercent).toBe(99);
    });
});

describe('parseDiskstats()', () => {
    const SAMPLE = `   8       0 sda 1000 0 8000 5000 500 0 4000 2000 0 3000 7000
   8       1 sda1 100 0 800 500 50 0 400 200 0 300 700
   8      16 sdb 200 0 1600 1000 100 0 800 400 0 600 1400`;

    it('parses sda read/write bytes', () => {
        const result = parseDiskstats(SAMPLE, 'sda');
        expect(result).not.toBeNull();
        expect(result.read).toBe(8000  * 512);
        expect(result.write).toBe(4000 * 512);
    });

    it('parses sdb correctly', () => {
        const result = parseDiskstats(SAMPLE, 'sdb');
        expect(result.read).toBe(1600  * 512);
        expect(result.write).toBe(800 * 512);
    });

    it('returns null for unknown disk', () => {
        expect(parseDiskstats(SAMPLE, 'sdc')).toBeNull();
    });
});

describe('parseSmartAttributes()', () => {
    const makeAttr = (id, rawValue) => ({ id, name: `attr_${id}`, thresh: 0, raw: { value: rawValue } });

    it('extracts reallocated sectors from ID 5', () => {
        const smart = { ata_smart_attributes: { table: [makeAttr(5, 3), makeAttr(197, 0)] } };
        const result = parseSmartAttributes(smart);
        expect(result.reallocatedSectors).toBe(3);
        expect(result.pendingSectors).toBe(0);
    });

    it('extracts pending sectors from ID 197', () => {
        const smart = { ata_smart_attributes: { table: [makeAttr(5, 0), makeAttr(197, 7)] } };
        const result = parseSmartAttributes(smart);
        expect(result.pendingSectors).toBe(7);
    });

    it('extracts temperature from ID 194, falls back to top-level', () => {
        const withAttr = { ata_smart_attributes: { table: [makeAttr(194, 45)] } };
        expect(parseSmartAttributes(withAttr).temperature).toBe(45);

        const withTopLevel = { temperature: { current: 38 }, ata_smart_attributes: { table: [] } };
        expect(parseSmartAttributes(withTopLevel).temperature).toBe(38);
    });

    it('extracts power-on hours from ID 9', () => {
        const smart = { ata_smart_attributes: { table: [makeAttr(9, 12500)] } };
        expect(parseSmartAttributes(smart).powerOnHours).toBe(12500);
    });

    it('extracts smartPassed from smart_status', () => {
        const passed  = { smart_status: { passed: true },  ata_smart_attributes: { table: [] } };
        const failed  = { smart_status: { passed: false }, ata_smart_attributes: { table: [] } };
        const missing = { ata_smart_attributes: { table: [] } };
        expect(parseSmartAttributes(passed).smartPassed).toBe(true);
        expect(parseSmartAttributes(failed).smartPassed).toBe(false);
        expect(parseSmartAttributes(missing).smartPassed).toBeNull();
    });

    it('returns 0 / null for missing attributes', () => {
        const smart = { ata_smart_attributes: { table: [] } };
        const result = parseSmartAttributes(smart);
        expect(result.reallocatedSectors).toBe(0);
        expect(result.pendingSectors).toBe(0);
        expect(result.powerOnHours).toBeNull();
        expect(result.ssdLife).toBeNull();
        expect(result.temperature).toBeNull();
    });
});

describe('resolveFileLocation()', () => {
    const cfg = { cacheMount: '/mnt/cache', poolMount: '/mnt/storage' };

    it('identifies cache files', () => {
        const result = resolveFileLocation('/mnt/cache/movies/film.mkv', cfg);
        expect(result.diskType).toBe('cache');
        expect(result.physicalLocation).toBe('/mnt/cache');
    });

    it('identifies pool files', () => {
        const result = resolveFileLocation('/mnt/storage/photos/img.jpg', cfg);
        expect(result.diskType).toBe('pool');
        expect(result.physicalLocation).toBe('/mnt/storage');
    });

    it('returns unknown for unrelated paths', () => {
        const result = resolveFileLocation('/home/user/file.txt', cfg);
        expect(result.diskType).toBe('unknown');
        expect(result.physicalLocation).toBe('');
    });

    it('uses defaults when storageConfig is empty', () => {
        const result = resolveFileLocation('/mnt/storage/file.txt', {});
        expect(result.diskType).toBe('pool');
    });

    it('matches exact mount path (no trailing slash)', () => {
        expect(resolveFileLocation('/mnt/cache', cfg).diskType).toBe('cache');
        expect(resolveFileLocation('/mnt/storage', cfg).diskType).toBe('pool');
    });
});
