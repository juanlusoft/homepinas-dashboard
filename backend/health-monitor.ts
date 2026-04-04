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
// TYPE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════

interface DiskInfo {
  name: string;
  type: string;
  size?: string;
  model?: string;
  rota?: boolean;
  tran?: string;
}

interface SmartAttribute {
  id: number;
  name: string;
  thresh: number;
  raw: { value: number };
  when_failed?: string;
}

interface SmartData {
  model_name?: string;
  smart_status?: { passed: boolean };
  temperature?: { current: number };
  ata_smart_attributes?: { table: SmartAttribute[] };
  nvme_smart_health_information_log?: { percentage_used: number };
}

interface CachedSmart {
  smart: SmartData;
  timestamp: number;
}

interface AlertState {
  lastAlerts: { [key: string]: number };
  cooldownMs: number;
}

/** Represents a health alert emitted to the notification system. */
interface HealthAlert {
  emoji: string;
  title: string;
  message: string;
}

interface BadblocksResult {
  device: string;
  result: 'passed' | 'cancelled' | 'failed';
  badBlocksFound: number;
  durationMs: number;
}

// ═══════════════════════════════════════════════════════════════════════
// CONFIGURATION CONSTANTS (ENV-backed with defaults)
// ═══════════════════════════════════════════════════════════════════════

const TEMP_THRESHOLD_C = (() => {
  const v = parseInt(process.env.TEMP_THRESHOLD_C ?? '', 10);
  if (process.env.TEMP_THRESHOLD_C && (isNaN(v) || v < 0 || v > 150)) {
    console.warn(`[health-monitor] Invalid TEMP_THRESHOLD_C: "${process.env.TEMP_THRESHOLD_C}", using default 55`);
    return 55;
  }
  return isNaN(v) ? 55 : v;
})();
const POOL_USAGE_THRESHOLD = (() => {
  const v = parseInt(process.env.POOL_USAGE_THRESHOLD ?? '', 10);
  if (process.env.POOL_USAGE_THRESHOLD && (isNaN(v) || v < 0 || v > 100)) {
    console.warn(`[health-monitor] Invalid POOL_USAGE_THRESHOLD: "${process.env.POOL_USAGE_THRESHOLD}", using default 95`);
    return 95;
  }
  return isNaN(v) ? 95 : v;
})();

// ═══════════════════════════════════════════════════════════════════════
// ALERT STATE (prevents spam)
// ═══════════════════════════════════════════════════════════════════════

const alertState: AlertState = {
    lastAlerts: {},      // key -> timestamp of last alert
    cooldownMs: 3600000  // 1 hour between repeated alerts for same issue
};

function shouldAlert(key: string): boolean {
    const now = Date.now();
    const last = alertState.lastAlerts[key] || 0;
    if (now - last < alertState.cooldownMs) return false;
    alertState.lastAlerts[key] = now;
    return true;
}

function formatAlert(emoji: string, title: string, details: string): string {
    return `${emoji} *HomePiNAS — ${title}*\n\n${details}`;
}

// ═══════════════════════════════════════════════════════════════════════
// SMART CACHE
// ═══════════════════════════════════════════════════════════════════════

const smartCache: { data: { [diskId: string]: CachedSmart }; maxAgeMs: number } = {
    data: {},           // diskId -> { smart, timestamp }
    maxAgeMs: 1800000,  // 30 minutes — SMART data doesn't change fast
};

/**
 * Get list of physical disks (cached for the lifetime of the process).
 */
let _diskListCache: DiskInfo[] | null = null;
let _diskListCacheTime: number = 0;
const DISK_LIST_CACHE_MS = 300000; // 5 min

function getPhysicalDisks(): DiskInfo[] {
    const now = Date.now();
    if (_diskListCache && (now - _diskListCacheTime) < DISK_LIST_CACHE_MS) {
        return _diskListCache;
    }
    try {
        const lsblkJson = execFileSync('lsblk', ['-J', '-d', '-o', 'NAME,TYPE,SIZE,MODEL,ROTA,TRAN'], {
            encoding: 'utf8', timeout: 10000
        });
        const lsblk = JSON.parse(lsblkJson);
        _diskListCache = (lsblk.blockdevices || []).filter((dev: DiskInfo) => {
            if (dev.type !== 'disk') return false;
            if (/^(loop|zram|ram|mmcblk)/.test(dev.name)) return false;
            const sizeStr = String(dev.size || '0');
            return sizeStr !== '0' && sizeStr !== '0B';
        });
        _diskListCacheTime = now;
        return _diskListCache!;
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        const fallbackCount = (_diskListCache || []).length;
        log.error(`Health check - lsblk error (returning ${fallbackCount} cached disks):`, msg, {
            code: e instanceof Error && 'code' in e ? e.code : undefined,
            fallbackAge: _diskListCacheTime ? `${Math.round((Date.now() - _diskListCacheTime) / 1000)}s ago` : 'no cache'
        });
        return _diskListCache || [];
    }
}

/**
 * Get SMART data for a disk, using cache when fresh enough.
 * Returns parsed JSON or null if unavailable.
 */
function getSmartData(diskId: string): SmartData | null {
    const now = Date.now();
    const cached = smartCache.data[diskId];
    if (cached && (now - cached.timestamp) < smartCache.maxAgeMs) {
        return cached.smart;
    }

    const devicePath = `/dev/${diskId}`;
    try {
        let smartJson: string | null = null;
        try {
            smartJson = execFileSync('sudo', ['smartctl', '-j', '-a', devicePath], {
                encoding: 'utf8', timeout: 15000, stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (e: unknown) {
            // smartctl exits non-zero for some warnings but still outputs JSON
            smartJson = e instanceof Error && 'stdout' in e ? (e.stdout as any)?.toString() : null;
            if (!smartJson) return null;
        }

        const smart = JSON.parse(smartJson!);
        smartCache.data[diskId] = { smart, timestamp: now };
        return smart;
    } catch (e: unknown) {
        return null;
    }
}

/**
 * Force-refresh SMART cache for all disks.
 * Called on the slow interval (30 min).
 */
function refreshSmartCache(): void {
    const devices = getPhysicalDisks();
    for (const device of devices) {
        getSmartData(device.name); // populates cache
    }
    log.debug(`[HEALTH] SMART cache refreshed for ${devices.length} disks`);
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: SMART (runs on slow interval, uses cache)
// ═══════════════════════════════════════════════════════════════════════

function _checkSmartFailure(alerts: string[], diskId: string, model: string, smart: SmartData): void {
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
}

function _checkDiskSectors(alerts: string[], diskId: string, model: string, smart: SmartData): void {
    if (!smart.ata_smart_attributes?.table) return;
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

function _checkSsdLife(alerts: string[], diskId: string, model: string, smart: SmartData): void {
    if (!smart.nvme_smart_health_information_log) return;
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

function checkSmartHealth(alerts: string[]): void {
    const devices = getPhysicalDisks();
    for (const device of devices) {
        const diskId = device.name;
        const smart = getSmartData(diskId);
        if (!smart) continue;
        const model = smart.model_name || device.model || diskId;
        _checkSmartFailure(alerts, diskId, model, smart);
        _checkDiskSectors(alerts, diskId, model, smart);
        _checkSsdLife(alerts, diskId, model, smart);
    }
}

// ═══════════════════════════════════════════════════════════════════════
// HEALTH CHECK: TEMPERATURE (runs on fast interval, uses cached SMART)
// ═══════════════════════════════════════════════════════════════════════

function checkTemperatures(alerts: string[]): void {
    const devices = getPhysicalDisks();

    for (const device of devices) {
        const diskId = device.name;
        // Use cached SMART data — don't trigger new smartctl calls
        const cached = smartCache.data[diskId];
        if (!cached) continue;

        const smart = cached.smart;
        const model = smart.model_name || device.model || diskId;
        const temp = smart.temperature?.current || 0;

        if (temp > TEMP_THRESHOLD_C) {
            if (shouldAlert(`temp-hot-${diskId}`)) {
                alerts.push(formatAlert('🔴', 'Temperatura crítica',
                    `Disco *${model}* (${diskId}): *${temp}°C*\nUmbral crítico: ${TEMP_THRESHOLD_C}°C`));
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

function checkPoolUsage(alerts: string[]): void {
    try {
        const dfRaw = execFileSync('df', ['--output=pcent', '/mnt/storage'], {
            encoding: 'utf8', timeout: 5000
        });
        const pctMatch = dfRaw.match(/(\d+)%/);
        if (pctMatch) {
            const usedPct = parseInt(pctMatch[1]);
            if (usedPct > POOL_USAGE_THRESHOLD) {
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
    } catch (e: unknown) {
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

function checkSnapraid(alerts: string[]): void {
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

function checkMountStatus(alerts: string[]): void {
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
async function runFastChecks(): Promise<number> {
    const alerts: string[] = [];
    try {
        checkPoolUsage(alerts);
        checkMountStatus(alerts);
        checkTemperatures(alerts); // reads from cache, no smartctl calls
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('Health monitor fast check error:', msg);
    }
    await sendAlerts(alerts);
    return alerts.length;
}

/**
 * Slow checks — run every 30 minutes.
 * Includes SMART refresh (heavy) + SnapRAID log parsing.
 */
async function runSlowChecks(): Promise<number> {
    const alerts: string[] = [];
    try {
        refreshSmartCache();       // refresh all SMART data (heavy)
        checkSmartHealth(alerts);   // analyze cached data
        checkSnapraid(alerts);
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        log.error('Health monitor slow check error:', msg);
    }
    await sendAlerts(alerts);
    return alerts.length;
}

/**
 * Run ALL health checks (backward compat + manual trigger).
 */
async function runHealthChecks(): Promise<number> {
    const fast = await runFastChecks();
    const slow = await runSlowChecks();
    return fast + slow;
}

/**
 * Send collected alerts via Telegram.
 */
async function sendAlerts(alerts: string[]): Promise<void> {
    for (const alert of alerts) {
        try {
            await sendViaTelegram(alert);
            await new Promise(r => setTimeout(r, 500)); // rate limit
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            log.error('Failed to send alert:', msg);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════
// BADBLOCKS NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════

async function notifyBadblocksComplete(device: string, result: 'passed' | 'cancelled' | 'failed', badBlocksFound: number, durationMs: number): Promise<void> {
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

let fastInterval: NodeJS.Timeout | null = null;
let slowInterval: NodeJS.Timeout | null = null;

/**
 * Start health monitoring with two-tier intervals:
 *   - Fast (pool, mounts, cached temps): every 5 min (300,000 ms)
 *   - Slow (SMART refresh, SnapRAID):    every 30 min (1,800,000 ms)
 *
 * @param fastMs - Fast interval (default 5 min)
 * @param slowMs - Slow interval (default 30 min)
 */
function startHealthMonitor(fastIntervalMs: number = 300000, slowIntervalMs: number = 1800000): void {
    if (fastInterval) return; // already running

    log.info(`[HEALTH] Monitor started (fast: ${fastIntervalMs / 1000}s, slow: ${slowIntervalMs / 1000}s)`);

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
    }, fastIntervalMs);

    // Slow checks (SMART + SnapRAID) every 30 min
    slowInterval = setInterval(() => {
        runSlowChecks().then(count => {
            if (count > 0) log.info(`[HEALTH] Slow check: ${count} alerts`);
        });
    }, slowIntervalMs);
}

function stopHealthMonitor(): void {
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
