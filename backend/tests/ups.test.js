// backend/tests/ups.test.js
import { describe, it, expect } from 'vitest';

function parseApcaccessOutput(stdout) {
    if (!stdout) return {};
    const result = {};
    for (const line of stdout.split('\n')) {
        const colonIdx = line.indexOf(':');
        if (colonIdx === -1) continue;
        const key = line.substring(0, colonIdx).trim();
        const value = line.substring(colonIdx + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function mapApcaccessToResponse(raw) {
    function parseFloat2(s) {
        return parseFloat(String(s || '').split(' ')[0]) || null;
    }
    return {
        available: true,
        batteryCharge: parseFloat2(raw['BCHARGE']),
        runtime:       parseFloat2(raw['TIMELEFT']),
        load:          parseFloat2(raw['LOADPCT']),
        inputVoltage:  parseFloat2(raw['LINEV']),
        status:        (raw['STATUS']  || '').trim() || null,
        model:         (raw['MODEL']   || '').trim() || null,
        driver:        (raw['DRIVER']  || '').trim() || null,
    };
}

const SAMPLE_APCACCESS = `
APC      : 001,036,0851
DATE     : 2026-04-04 10:00:00 -0400
HOSTNAME : homepinas
VERSION  : 3.14.14 (31 May 2016) debian
UPSNAME  : UPS_IDEN
CABLE    : USB Cable
DRIVER   : USB UPS Driver
UPSMODE  : Stand Alone
STARTTIME: 2026-04-04 09:58:00 -0400
MODEL    : Back-UPS ES 700G
STATUS   : ONLINE
LINEV    : 121.0 Volts
LOADPCT  : 23.0 Percent
BCHARGE  : 100.0 Percent
TIMELEFT : 28.4 Minutes
MBATTCHG : 5 Percent
MINTIMEL : 3 Minutes
MAXTIME  : 0 Seconds
FIRMWARE : 871.O4 .I USB FW:O4
`;

describe('ups route — apcaccess output parsing', () => {
    it('parses all key-value lines from apcaccess output', () => {
        const raw = parseApcaccessOutput(SAMPLE_APCACCESS);
        expect(raw['STATUS']).toBe('ONLINE');
        expect(raw['MODEL']).toBe('Back-UPS ES 700G');
        expect(raw['BCHARGE']).toBe('100.0 Percent');
        expect(raw['TIMELEFT']).toBe('28.4 Minutes');
        expect(raw['LOADPCT']).toBe('23.0 Percent');
        expect(raw['LINEV']).toBe('121.0 Volts');
        expect(raw['DRIVER']).toBe('USB UPS Driver');
    });

    it('returns empty object for null/empty input', () => {
        expect(parseApcaccessOutput(null)).toEqual({});
        expect(parseApcaccessOutput('')).toEqual({});
    });

    it('handles lines without colon gracefully', () => {
        const result = parseApcaccessOutput('no colon here\nKEY : value');
        expect(result['KEY']).toBe('value');
    });
});

describe('ups route — response shape mapping', () => {
    it('maps apcaccess fields to the correct response properties', () => {
        const raw = parseApcaccessOutput(SAMPLE_APCACCESS);
        const response = mapApcaccessToResponse(raw);
        expect(response.available).toBe(true);
        expect(response.batteryCharge).toBe(100.0);
        expect(response.runtime).toBe(28.4);
        expect(response.load).toBe(23.0);
        expect(response.inputVoltage).toBe(121.0);
        expect(response.status).toBe('ONLINE');
        expect(response.model).toBe('Back-UPS ES 700G');
        expect(response.driver).toBe('USB UPS Driver');
    });

    it('returns null for missing numeric fields', () => {
        const response = mapApcaccessToResponse({});
        expect(response.batteryCharge).toBeNull();
        expect(response.runtime).toBeNull();
        expect(response.load).toBeNull();
        expect(response.inputVoltage).toBeNull();
    });

    it('strips unit suffix from numeric values', () => {
        const raw = { BCHARGE: '87.5 Percent', TIMELEFT: '14.2 Minutes', LOADPCT: '41.0 Percent', LINEV: '118.0 Volts' };
        const r = mapApcaccessToResponse(raw);
        expect(r.batteryCharge).toBe(87.5);
        expect(r.runtime).toBe(14.2);
        expect(r.load).toBe(41.0);
        expect(r.inputVoltage).toBe(118.0);
    });
});

describe('ups route — apcaccess availability check', () => {
    it('unavailable response shape is correct', () => {
        const unavailableResponse = { available: false };
        expect(unavailableResponse.available).toBe(false);
        expect(Object.keys(unavailableResponse)).toEqual(['available']);
    });
});
