/**
 * HomePiNAS - Health Monitor
 * v2.0.0 - Optimized polling with SMART cache
 *
 * Periodic background checks with Telegram alerts:
 * - Disk health (SMART status, sectors, life remaining) — every 30 min (cached)
 * - Temperature monitoring — every 5 min (lightweight)
 * - Pool usage — every 5 min (lightweight)
 * - SnapRAID sync status — every 30 min
 * - Disk mount status — every 5 min
 *
 * SMART data is cached because:
 *   - smartctl takes 1-3s per disk (blocking execFileSync)
 *   - SMART attributes change very slowly (hours/days)
 *   - On a 6-disk NAS, that's 6-18s of blocking every interval
 */

const log = require('./logger');
const { execFileSync } = require('child_process');
const { sendViaTelegram } = require('./notify');
const { getData } = require('./data');
const fs = require('fs');

// ═══════════════════════════════════════════════════════════════════════
// ALERT STATE (prevents spam)
// ═══════════════════════════════════════════════════════════════════════

const alertState = {
    lastAlerts: {},      // key -> timestamp of last alert
    cooldownMs: 3600000  // 1 hour between repeated alerts for same issue
};

function shouldAlert(key) {
    const now = Date.now();
    const last = alertState.lastAlerts[key] || 0;
    if (now - last < alertState.cooldownMs) return false;
    alertState.lastAlerts[key] = now;
    return true;
}

function formatAlert(emoji, title, details) {
    return `${emoji} *HomePiNAS — ${title}*\n\n${details}`;
}

// ═══════════════════════════════════════════════════════════════════════
// SMART CACHE
// ═══════════════════════════════════════════════════════════════════════

const smartCache = {
    data: {},           // diskId -> { smart, timestamp }
    maxAgeMs: 1800000,  // 30 minutes — SMART data doesn't change fast
};

/**
 * Get list of physical disks (cached for the lifetime of the process).
 */
let _diskListCache = null;
let _diskListCacheTime = 0;
const DISK_LIST_CACHE_MS = 300000; // 5 min

function getPhysicalDisks() {
    const now = Date.now();
    if (_diskListCache && (now - _diskListCacheTime) < DISK_LIST_CACHE_MS) {
        return _diskListCache;
    }
    try {
        const lsblkJson = execFileSync('lsblk', ['-J', '-d', '-o', 'NAME,TYPE,SIZE,MODEL,ROTA,TRAN'], {
            encoding: 'utf8', timeout: 10000
        });
        const lsblk = JSON.parse(lsblkJson);
        _diskListCache = (lsblk.blockdevices || []).filter(dev => {
            if (dev.type !== 'disk') return false;
            if (/^(loop|zram|ram|mmcblk)/.test(dev.name)) return false;
            const sizeStr = String(dev.size || '0');
            return sizeStr !== '0' && sizeStr !== '0B';
        });
        _diskListCacheTime = now;
        return _diskListCache;
    } catch (e) {
        log.error('Health check - lsblk error:', e.message);
        return _diskListCache || [];
    }
}

/**
 * Get SMART data for a disk, using cache when fresh enough.
 * Returns parsed JSON or null if unavailable.
 */
function getSmartData(diskId) {
    const now = Date.now();
    const cached = smartCache.data[diskId];
    if (cached && (now - cached.timestamp) < smartCache.maxAgeMs) {
        return cached.smart;
    }

    const devicePath = `/dev/${diskId}`;
    try {
        let smartJson;
        try {
            smartJson = execFileSync('sudo', ['smartctl', '-j', '-a', devicePath], {
                encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (e) {
            // smartctl exits non-zero for some warnings but still outputs JSON
            smartJson = e.stdout ? e.stdout.toString() : null;
            if (!smartJson) return null;
        }

        const smart = JSON.parse(smartJson);
        smartCache.data[diskId] = { smart, timestamp: now };
        return smart;
    } catch (e) {
        return null;
    }
}

/**
 * Force-refresh SMART cache for all disks.
 * Called on the slow interval (30 min).
 */
function refreshSmartCache() {
    const devices = getPhysicalDisks();
    for (const device of devices) {
        getSmartData(device.name); // populates cache
    }
    log.debug(`[HEALTH] SMART cache refreshed for ${devices.length} disks`);
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: SMART (runs on slow interval, uses cache)
// ═══════════════════════════════════════════════════════════════════════

function checkSmartHealth(alerts) {
    const devices = getPhysicalDisks();

    for (const device of devices) {
        const diskId = device.name;
        const smart = getSmartData(diskId);
        if (!smart) continue;

        const model = smart.model_name || device.model || diskId;

        // SMART health failed
        if (smart.smart_status && smart.smart_status.passed === false) {
            if (shouldAlert(`smart-failed-${diskId}`)) {
                let failReason = '';
                const attrs = smart.ata_smart_attributes?.table || [];
                for (const attr of attrs) {
                    if (attr.when_failed && attr.when_failed !== '-') {
                        failReason += `\n  • ${attr.name}: ${attr.raw.value} (umbral: ${attr.thresh})`;
                    }
                }
                alerts.push(formatAlert('🔴', 'SMART FAILED',
                    `Disco *${model}* (${diskId}) reporta fallo SMART.\n${failReason}\n\n⚠️ El fabricante recomienda hacer backup inmediato.`));
            }
        }

        // Reallocated / pending sectors (HDD)
        if (smart.ata_smart_attributes?.table) {
            const attrs = smart.ata_smart_attributes.table;
            const reallocated = attrs.find(a => a.id === 5);
            const pending = attrs.find(a => a.id === 197);

            if (reallocated && reallocated.raw.value > 0) {
                if (shouldAlert(`reallocated-${diskId}`)) {
                    const severity = reallocated.raw.value > 10 ? '🔴' : '🟡';
                    alerts.push(formatAlert(severity, 'Sectores reasignados',
                        `Disco *${model}* (${diskId}): ${reallocated.raw.value} sectores reasignados.`));
                }
            }

            if (pending && pending.raw.value > 0) {
                if (shouldAlert(`pending-${diskId}`)) {
                    alerts.push(formatAlert('🔴', 'Sectores pendientes',
                        `Disco *${model}* (${diskId}): ${pending.raw.value} sectores pendientes de reasignación.`));
                }
            }
        }

        // SSD/NVMe life remaining
        if (smart.nvme_smart_health_information_log) {
            const pctUsed = smart.nvme_smart_health_information_log.percentage_used || 0;
            const lifeRemaining = 100 - pctUsed;
            if (lifeRemaining < 10) {
                if (shouldAlert(`life-critical-${diskId}`)) {
                    alerts.push(formatAlert('🔴', 'Vida SSD crítica',
                        `Disco *${model}* (${diskId}): solo *${lifeRemaining}%* de vida restante.`));
                }
            } else if (lifeRemaining < 20) {
                if (shouldAlert(`life-low-${diskId}`)) {
                    alerts.push(formatAlert('🟡', 'Vida SSD baja',
                        `Disco *${model}* (${diskId}): *${lifeRemaining}%* de vida restante.`));
                }
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: TEMPERATURE (runs on fast interval, uses cached SMART)
// ═══════════════════════════════════════════════════════════════════════

function checkTemperatures(alerts) {
    const devices = getPhysicalDisks();

    for (const device of devices) {
        const diskId = device.name;
        // Use cached SMART data — don't trigger new smartctl calls
        const cached = smartCache.data[diskId];
        if (!cached) continue;

        const smart = cached.smart;
        const model = smart.model_name || device.model || diskId;
        const temp = smart.temperature?.current || 0;

        if (temp > 55) {
            if (shouldAlert(`temp-hot-${diskId}`)) {
                alerts.push(formatAlert('🔴', 'Temperatura crítica',
                    `Disco *${model}* (${diskId}): *${temp}°C*\nUmbral crítico: 55°C`));
            }
        } else if (temp > 50) {
            if (shouldAlert(`temp-warm-${diskId}`)) {
                alerts.push(formatAlert('🟡', 'Temperatura alta',
                    `Disco *${model}* (${diskId}): *${temp}°C*\nUmbral atención: 50°C`));
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: POOL USAGE (lightweight — runs on fast interval)
// ═══════════════════════════════════════════════════════════════════════

function checkPoolUsage(alerts) {
    try {
        const dfRaw = execFileSync('df', ['--output=pcent', '/mnt/storage'], {
            encoding: 'utf8', timeout: 5000
        });
        const pctMatch = dfRaw.match(/(\d+)%/);
        if (pctMatch) {
            const usedPct = parseInt(pctMatch[1]);
            if (usedPct > 95) {
                if (shouldAlert('pool-critical')) {
                    alerts.push(formatAlert('🔴', 'Pool casi llena',
                        `El pool de almacenamiento está al *${usedPct}%*.\n\n⚠️ Libera espacio urgentemente.`));
                }
            } else if (usedPct > 90) {
                if (shouldAlert('pool-90')) {
                    alerts.push(formatAlert('🟡', 'Pool >90%',
                        `El pool de almacenamiento está al *${usedPct}%*.`));
                }
            } else if (usedPct > 80) {
                if (shouldAlert('pool-80')) {
                    alerts.push(formatAlert('🟡', 'Pool >80%',
                        `El pool de almacenamiento está al *${usedPct}%*.`));
                }
            }
        }
    } catch (e) {
        // Pool not mounted — check if it should be
        try {
            const data = getData();
            if (data.storageConfig && data.storageConfig.length > 0) {
                if (shouldAlert('pool-offline')) {
                    alerts.push(formatAlert('🔴', 'Pool no disponible',
                        'El pool de almacenamiento no está montado pero hay discos configurados.'));
                }
            }
        } catch (e2) { /* skip */ }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: SNAPRAID (runs on slow interval)
// ═══════════════════════════════════════════════════════════════════════

function checkSnapraid(alerts) {
    try {
        if (fs.existsSync('/var/log/snapraid-sync.log')) {
            const snapLog = fs.readFileSync('/var/log/snapraid-sync.log', 'utf8');
            const lastLines = snapLog.split('\n').slice(-20).join('\n');

            if (lastLines.includes('ERROR') && !lastLines.includes('completed successfully')) {
                if (shouldAlert('snapraid-error')) {
                    alerts.push(formatAlert('🔴', 'SnapRAID Error',
                        'El último sync de SnapRAID tuvo errores. Revisa los logs.'));
                }
            }
        }
    } catch (e) { /* No SnapRAID, skip */ }
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: DISK MOUNT STATUS (lightweight — runs on fast interval)
// ═══════════════════════════════════════════════════════════════════════

function checkMountStatus(alerts) {
    try {
        const data = getData();
        const configuredDisks = data.storageConfig || [];

        for (const disk of configuredDisks) {
            if (disk.mountPoint) {
                try {
                    execFileSync('mountpoint', ['-q', disk.mountPoint], { stdio: 'ignore' });
                } catch (e) {
                    if (shouldAlert(`unmounted-${disk.id}`)) {
                        alerts.push(formatAlert('🔴', 'Disco desmontado',
                            `El disco *${disk.id}* no está montado en ${disk.mountPoint}.`));
                    }
                }
            }
        }
    } catch (e) { /* skip */ }
}

// ═══════════════════════════════════════════════════════════════════════
// COMBINED CHECKS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Fast checks — run every 5 minutes.
 * Only lightweight operations (df, mountpoint, cached temp reads).
 */
async function runFastChecks() {
    const alerts = [];
    try {
        checkPoolUsage(alerts);
        checkMountStatus(alerts);
        checkTemperatures(alerts); // reads from cache, no smartctl calls
    } catch (e) {
        log.error('Health monitor fast check error:', e);
    }
    await sendAlerts(alerts);
    return alerts.length;
}

/**
 * Slow checks — run every 30 minutes.
 * Includes SMART refresh (heavy) + SnapRAID log parsing.
 */
async function runSlowChecks() {
    const alerts = [];
    try {
        refreshSmartCache();       // refresh all SMART data (heavy)
        checkSmartHealth(alerts);   // analyze cached data
        checkSnapraid(alerts);
    } catch (e) {
        log.error('Health monitor slow check error:', e);
    }
    await sendAlerts(alerts);
    return alerts.length;
}

/**
 * Run ALL health checks (backward compat + manual trigger).
 */
async function runHealthChecks() {
    const fast = await runFastChecks();
    const slow = await runSlowChecks();
    return fast + slow;
}

/**
 * Send collected alerts via Telegram.
 */
async function sendAlerts(alerts) {
    for (const alert of alerts) {
        try {
            await sendViaTelegram(alert);
            await new Promise(r => setTimeout(r, 500)); // rate limit
        } catch (e) {
            log.error('Failed to send alert:', e.message);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// BADBLOCKS NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════

async function notifyBadblocksComplete(device, result, badBlocksFound, durationMs) {
    const hours = (durationMs / 3600000).toFixed(1);

    if (badBlocksFound === 0 && result === 'passed') {
        await sendViaTelegram(formatAlert('✅', 'Test de disco completado',
            `Disco *${device}* escaneado en ${hours}h.\n\n*Resultado: Sin errores* — Disco OK.`));
    } else if (result === 'cancelled') {
        await sendViaTelegram(formatAlert('⏹', 'Test de disco cancelado',
            `El test de *${device}* fue cancelado tras ${hours}h.`));
    } else {
        await sendViaTelegram(formatAlert('❌', 'Test de disco — Errores encontrados',
            `Disco *${device}* escaneado en ${hours}h.\n\n*${badBlocksFound} sectores defectuosos encontrados.*\n\n⚠️ Considera reemplazar este disco.`));
    }
}

// ═══════════════════════════════════════════════════════════════════════
// MONITOR LIFECYCLE
// ═══════════════════════════════════════════════════════════════════════

let fastInterval = null;
let slowInterval = null;

/**
 * Start health monitoring with two-tier intervals:
 *   - Fast (pool, mounts, cached temps): every 5 min (300,000 ms)
 *   - Slow (SMART refresh, SnapRAID):    every 30 min (1,800,000 ms)
 *
 * @param {number} fastMs - Fast interval (default 5 min)
 * @param {number} slowMs - Slow interval (default 30 min)
 */
function startHealthMonitor(fastMs = 300000, slowMs = 1800000) {
    if (fastInterval) return; // already running

    log.info(`[HEALTH] Monitor started (fast: ${fastMs / 1000}s, slow: ${slowMs / 1000}s)`);

    // Initial SMART cache populate after 30s (let server boot)
    setTimeout(() => {
        runSlowChecks().then(count => {
            if (count > 0) log.info(`[HEALTH] Initial scan: ${count} alerts`);
        });
    }, 30000);

    // Fast checks every 5 min
    fastInterval = setInterval(() => {
        runFastChecks().then(count => {
            if (count > 0) log.info(`[HEALTH] Fast check: ${count} alerts`);
        });
    }, fastMs);

    // Slow checks (SMART + SnapRAID) every 30 min
    slowInterval = setInterval(() => {
        runSlowChecks().then(count => {
            if (count > 0) log.info(`[HEALTH] Slow check: ${count} alerts`);
        });
    }, slowMs);
}

function stopHealthMonitor() {
    if (fastInterval) {
        clearInterval(fastInterval);
        fastInterval = null;
    }
    if (slowInterval) {
        clearInterval(slowInterval);
        slowInterval = null;
    }
    log.info('[HEALTH] Monitor stopped');
}

module.exports = {
    runHealthChecks,
    runFastChecks,
    runSlowChecks,
    startHealthMonitor,
    stopHealthMonitor,
    notifyBadblocksComplete
};
