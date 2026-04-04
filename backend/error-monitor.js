/**
 * HomePiNAS - Error Monitor
 *
 * Periodically scans system logs for errors and sends
 * notifications via email/telegram when new errors are found.
 */

const log = require('./logger');
const { execFile } = require('child_process');
const { promisify } = require('util');
const crypto = require('crypto');
const os = require('os');
const { getData, saveData } = require('./data');
const { sendViaEmail, sendViaTelegram } = require('./notify');

const execFileAsync = promisify(execFile);

// Frequency intervals in milliseconds
const INTERVALS = {
    immediate: 5 * 60 * 1000,   // 5 minutes
    hourly: 60 * 60 * 1000,     // 1 hour
    daily: 24 * 60 * 60 * 1000  // 24 hours
};

// journalctl unit mapping per source
const SOURCE_UNITS = {
    system: null,                // No unit filter = all system
    app: 'homepinas.service',
    auth: 'ssh.service',
    docker: 'docker.service'
};

// False-positive patterns to exclude
const EXCLUDE_PATTERNS = [
    /error:\s*0/i,
    /0\s+error/i,
    /no\s+error/i,
    /without\s+error/i,
    /error_log/i,
    /errors?\s*=\s*0/i
];

let monitorTimer = null;

/**
 * Format a Date as "YYYY-MM-DD HH:MM:SS" for journalctl --since
 */
function formatForJournalctl(date) {
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * Compute a short hash for an error line (strips leading timestamp for dedup)
 */
function hashError(line) {
    // Remove ISO timestamp prefix (e.g., "Feb 17 12:34:56 hostname")
    const stripped = line.replace(/^[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\S+\s+/, '');
    return crypto.createHash('md5').update(stripped).digest('hex').substring(0, 12);
}

/**
 * Scan a single log source for errors since a timestamp.
 * @param {string} source - system|app|auth|docker
 * @param {string|null} since - ISO timestamp or null
 * @returns {Promise<string[]>} Error lines found
 */
async function scanSource(source, since) {
    const args = ['--no-pager', '--output=short-iso', '--priority=err..crit', '-n', '200'];

    if (since) {
        args.push('--since', formatForJournalctl(since));
    } else {
        args.push('--since', '5 minutes ago');
    }

    const unit = SOURCE_UNITS[source];
    if (unit) {
        args.push('-u', unit);
    }

    try {
        const { stdout } = await execFileAsync('journalctl', args, {
            maxBuffer: 2 * 1024 * 1024,
            timeout: 10000
        });

        if (!stdout || !stdout.trim()) return [];

        return stdout.trim().split('\n').filter(line => {
            // Filter out common false-positive patterns
            return !EXCLUDE_PATTERNS.some(pattern => pattern.test(line));
        });
    } catch (err) {
        // journalctl might fail on systems without systemd
        log.error(`[ERROR-MONITOR] Failed to scan ${source}:`, err.message);
        return [];
    }
}

/**
 * Build HTML email body from collected errors.
 */
function buildHtmlReport(errorsBySource, hostname) {
    const timestamp = new Date().toLocaleString();
    let html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto;">
    <div style="background: #dc3545; color: white; padding: 16px 24px; border-radius: 12px 12px 0 0;">
        <h2 style="margin: 0;">HomePiNAS Error Report</h2>
        <p style="margin: 4px 0 0; opacity: 0.9; font-size: 14px;">${hostname} &mdash; ${timestamp}</p>
    </div>
    <div style="background: #f8f9fa; padding: 24px; border-radius: 0 0 12px 12px; border: 1px solid #e0e0e0;">`;

    for (const [source, lines] of Object.entries(errorsBySource)) {
        if (lines.length === 0) continue;
        const label = source.charAt(0).toUpperCase() + source.slice(1);
        html += `
        <h3 style="margin: 20px 0 8px; color: #333;">${label} (${lines.length} error${lines.length > 1 ? 's' : ''})</h3>
        <pre style="background: #1a1a2e; color: #e0e0e0; padding: 14px; border-radius: 8px; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 400px; overflow-y: auto;">${lines.map(l => escapeHtml(l)).join('\n')}</pre>`;
    }

    html += `
        <p style="color: #999; font-size: 12px; margin-top: 24px; border-top: 1px solid #e0e0e0; padding-top: 12px;">
            This report was generated automatically by HomePiNAS Error Monitor.
        </p>
    </div>
</div>`;

    return html;
}

/**
 * Build plain text for Telegram.
 */
function buildTelegramReport(errorsBySource, hostname) {
    const timestamp = new Date().toLocaleString();
    let text = `*HomePiNAS Error Report*\n${hostname} — ${timestamp}\n`;

    for (const [source, lines] of Object.entries(errorsBySource)) {
        if (lines.length === 0) continue;
        const label = source.charAt(0).toUpperCase() + source.slice(1);
        text += `\n*${label}* (${lines.length}):\n`;
        // Limit lines to avoid Telegram 4096 char limit
        const shown = lines.slice(0, 10);
        text += '```\n' + shown.join('\n') + '\n```';
        if (lines.length > 10) {
            text += `\n... and ${lines.length - 10} more`;
        }
    }

    return text;
}

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Main scan cycle.
 * @param {boolean} forceReport - Send report even if no errors (for testing)
 * @returns {Promise<{errorsFound: number, sent: boolean}>}
 */
async function runErrorScan(forceReport = false) {
    const data = getData();
    const config = data.notifications?.errorReporting;

    if (!config?.enabled && !forceReport) {
        return { errorsFound: 0, sent: false };
    }

    const sources = config?.logSources || ['system', 'app', 'docker'];
    const channels = config?.channels || ['email'];
    const cooldown = (config?.cooldownMinutes || 30) * 60 * 1000;
    const since = config?.lastCheck || null;
    const sentHashes = config?.sentHashes || [];
    const now = Date.now();

    // Scan all configured sources
    const errorsBySource = {};
    let totalNew = 0;

    for (const source of sources) {
        const lines = await scanSource(source, since);
        const newLines = lines.filter(line => {
            const h = hashError(line);
            const existing = sentHashes.find(e => e.hash === h);
            if (existing && (now - existing.ts) < cooldown) return false;
            return true;
        });
        if (newLines.length > 0) {
            errorsBySource[source] = newLines;
            totalNew += newLines.length;
        }
    }

    // Update lastCheck
    if (!data.notifications) data.notifications = {};
    if (!data.notifications.errorReporting) data.notifications.errorReporting = {};
    data.notifications.errorReporting.lastCheck = new Date().toISOString();

    if (totalNew === 0 && !forceReport) {
        saveData(data);
        return { errorsFound: 0, sent: false };
    }

    // Update sent hashes
    const newHashes = [];
    for (const lines of Object.values(errorsBySource)) {
        for (const line of lines) {
            newHashes.push({ hash: hashError(line), ts: now });
        }
    }
    const merged = [...newHashes, ...sentHashes].slice(0, 200);
    data.notifications.errorReporting.sentHashes = merged;
    saveData(data);

    // Build reports
    const hostname = os.hostname();
    const subject = `HomePiNAS: ${totalNew} error${totalNew !== 1 ? 's' : ''} detected on ${hostname}`;

    const htmlReport = totalNew > 0
        ? buildHtmlReport(errorsBySource, hostname)
        : `<p>No errors found on ${hostname}. This is a test scan.</p>`;

    const plainText = totalNew > 0
        ? Object.entries(errorsBySource).map(([s, l]) => `[${s}]\n${l.join('\n')}`).join('\n\n')
        : `No errors found on ${hostname}. This is a test scan.`;

    // Send via configured channels
    let sent = false;
    if (channels.includes('email')) {
        const result = await sendViaEmail(subject, plainText, htmlReport);
        if (result.success) sent = true;
        else log.error('[ERROR-MONITOR] Email send failed:', result.error);
    }
    if (channels.includes('telegram')) {
        const telegramText = totalNew > 0
            ? buildTelegramReport(errorsBySource, hostname)
            : `*HomePiNAS*: No errors found on ${hostname}. Test scan complete.`;
        const result = await sendViaTelegram(telegramText);
        if (result.success) sent = true;
        else log.error('[ERROR-MONITOR] Telegram send failed:', result.error);
    }

    if (sent) {
        log.info(`[ERROR-MONITOR] Report sent: ${totalNew} errors via ${channels.join(', ')}`);
    }

    return { errorsFound: totalNew, sent };
}

/**
 * Start the error monitoring interval.
 */
function startErrorMonitor() {
    stopErrorMonitor();

    const data = getData();
    const config = data.notifications?.errorReporting;

    if (!config?.enabled) {
        log.info('[ERROR-MONITOR] Disabled or not configured');
        return;
    }

    const interval = INTERVALS[config.frequency] || INTERVALS.immediate;
    log.info(`[ERROR-MONITOR] Started (frequency: ${config.frequency}, interval: ${interval / 60000} min)`);

    monitorTimer = setInterval(async () => {
        try {
            await runErrorScan();
        } catch (err) {
            log.error('[ERROR-MONITOR] Scan error:', err.message);
        }
    }, interval);
}

/**
 * Stop the error monitoring interval.
 */
function stopErrorMonitor() {
    if (monitorTimer) {
        clearInterval(monitorTimer);
        monitorTimer = null;
    }
}

module.exports = { startErrorMonitor, stopErrorMonitor, runErrorScan };
