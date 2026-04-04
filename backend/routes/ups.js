// backend/routes/ups.js
'use strict';

const router = require('express').Router();
const { safeExec } = require('../security');
const { requireAuth } = require('../auth');
const log = require('../logger');

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
    function extractFloat(s) {
        const n = parseFloat(String(s || '').split(' ')[0]);
        return isNaN(n) ? null : n;
    }
    return {
        available:     true,
        batteryCharge: extractFloat(raw['BCHARGE']),
        runtime:       extractFloat(raw['TIMELEFT']),
        load:          extractFloat(raw['LOADPCT']),
        inputVoltage:  extractFloat(raw['LINEV']),
        status:        (raw['STATUS']  || '').trim() || null,
        model:         (raw['MODEL']   || '').trim() || null,
        driver:        (raw['DRIVER']  || '').trim() || null,
    };
}

router.get('/status', requireAuth, async (req, res) => {
    try {
        try {
            await safeExec('which', ['apcaccess']);
        } catch {
            return res.json({ available: false });
        }

        const { stdout } = await safeExec('apcaccess', ['status']);
        const raw = parseApcaccessOutput(stdout);
        return res.json(mapApcaccessToResponse(raw));
    } catch (err) {
        log.error('[ups] Failed to get UPS status:', err.message);
        return res.status(500).json({ error: 'Failed to retrieve UPS status' });
    }
});

module.exports = router;
