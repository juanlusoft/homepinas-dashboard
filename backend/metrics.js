/**
 * HomePiNAS - Prometheus Metrics
 * v1.0.0 - Lightweight metrics collection
 *
 * Provides a /metrics endpoint compatible with Prometheus scraping.
 * Uses prom-client if available, otherwise a minimal built-in collector.
 *
 * Metrics exposed:
 *   - homepinas_http_requests_total (counter) — by method, route, status
 *   - homepinas_http_request_duration_seconds (histogram) — by method, route
 *   - homepinas_process_cpu_seconds_total (gauge)
 *   - homepinas_process_resident_memory_bytes (gauge)
 *   - homepinas_process_heap_used_bytes (gauge)
 *   - homepinas_nodejs_active_handles (gauge)
 *   - homepinas_nodejs_active_requests (gauge)
 *   - homepinas_uptime_seconds (gauge)
 *   - homepinas_smart_cache_size (gauge)
 *   - homepinas_smart_cache_age_seconds (gauge)
 */

const log = require('./logger');

// ═══════════════════════════════════════════════════════════════════════
// BUILT-IN METRICS COLLECTOR (no external dependency needed)
// ═══════════════════════════════════════════════════════════════════════

const PREFIX = 'homepinas';

// Request counters: { "GET:/api/system/stats:200": count }
const requestCounters = {};

// Request durations: { "GET:/api/system/stats": [durations...] }
const requestDurations = {};

// Histogram buckets (seconds)
const BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

// Keep only last N durations per route to prevent memory growth
const MAX_DURATIONS_PER_ROUTE = 1000;

/**
 * Normalize route path for metric labels.
 * Replaces dynamic segments (IDs, hashes) with placeholders.
 */
function normalizeRoute(path) {
    if (!path) return 'unknown';
    return path
        .replace(/\/[0-9a-f]{12,64}/gi, '/:id')   // container IDs, hashes
        .replace(/\/\d+/g, '/:num')                  // numeric IDs
        .replace(/\?.*/g, '');                        // strip query params
}

/**
 * Record an HTTP request.
 */
function recordRequest(method, path, statusCode, durationMs) {
    const route = normalizeRoute(path);
    const durationS = durationMs / 1000;

    // Counter
    const counterKey = `${method}:${route}:${statusCode}`;
    requestCounters[counterKey] = (requestCounters[counterKey] || 0) + 1;

    // Duration histogram
    const durKey = `${method}:${route}`;
    if (!requestDurations[durKey]) {
        requestDurations[durKey] = [];
    }
    const durations = requestDurations[durKey];
    durations.push(durationS);

    // Trim to prevent memory growth
    if (durations.length > MAX_DURATIONS_PER_ROUTE) {
        durations.splice(0, durations.length - MAX_DURATIONS_PER_ROUTE);
    }
}

/**
 * Calculate percentile from sorted array.
 */
function percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
}

/**
 * Generate Prometheus text format output.
 */
function generateMetrics() {
    const lines = [];
    const now = Date.now();

    // ── HTTP Request Counter ──
    lines.push(`# HELP ${PREFIX}_http_requests_total Total HTTP requests`);
    lines.push(`# TYPE ${PREFIX}_http_requests_total counter`);
    for (const [key, count] of Object.entries(requestCounters)) {
        const [method, route, status] = key.split(':');
        lines.push(`${PREFIX}_http_requests_total{method="${method}",route="${route}",status="${status}"} ${count}`);
    }

    // ── HTTP Request Duration Histogram ──
    lines.push(`# HELP ${PREFIX}_http_request_duration_seconds HTTP request duration in seconds`);
    lines.push(`# TYPE ${PREFIX}_http_request_duration_seconds histogram`);
    for (const [key, durations] of Object.entries(requestDurations)) {
        const [method, route] = key.split(':');
        const sorted = [...durations].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        const count = sorted.length;

        const labels = `method="${method}",route="${route}"`;

        // Buckets
        for (const bucket of BUCKETS) {
            const bucketCount = sorted.filter(d => d <= bucket).length;
            lines.push(`${PREFIX}_http_request_duration_seconds_bucket{${labels},le="${bucket}"} ${bucketCount}`);
        }
        lines.push(`${PREFIX}_http_request_duration_seconds_bucket{${labels},le="+Inf"} ${count}`);
        lines.push(`${PREFIX}_http_request_duration_seconds_sum{${labels}} ${sum.toFixed(6)}`);
        lines.push(`${PREFIX}_http_request_duration_seconds_count{${labels}} ${count}`);

        // Quantiles (for human readability — not standard Prometheus histogram but useful)
        lines.push(`${PREFIX}_http_request_p50_seconds{${labels}} ${percentile(sorted, 0.5).toFixed(6)}`);
        lines.push(`${PREFIX}_http_request_p95_seconds{${labels}} ${percentile(sorted, 0.95).toFixed(6)}`);
        lines.push(`${PREFIX}_http_request_p99_seconds{${labels}} ${percentile(sorted, 0.99).toFixed(6)}`);
    }

    // ── Process Metrics ──
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    lines.push(`# HELP ${PREFIX}_process_cpu_user_seconds_total Total user CPU time`);
    lines.push(`# TYPE ${PREFIX}_process_cpu_user_seconds_total counter`);
    lines.push(`${PREFIX}_process_cpu_user_seconds_total ${(cpuUsage.user / 1e6).toFixed(3)}`);

    lines.push(`# HELP ${PREFIX}_process_cpu_system_seconds_total Total system CPU time`);
    lines.push(`# TYPE ${PREFIX}_process_cpu_system_seconds_total counter`);
    lines.push(`${PREFIX}_process_cpu_system_seconds_total ${(cpuUsage.system / 1e6).toFixed(3)}`);

    lines.push(`# HELP ${PREFIX}_process_resident_memory_bytes Resident memory size`);
    lines.push(`# TYPE ${PREFIX}_process_resident_memory_bytes gauge`);
    lines.push(`${PREFIX}_process_resident_memory_bytes ${memUsage.rss}`);

    lines.push(`# HELP ${PREFIX}_process_heap_used_bytes V8 heap used`);
    lines.push(`# TYPE ${PREFIX}_process_heap_used_bytes gauge`);
    lines.push(`${PREFIX}_process_heap_used_bytes ${memUsage.heapUsed}`);

    lines.push(`# HELP ${PREFIX}_process_heap_total_bytes V8 heap total`);
    lines.push(`# TYPE ${PREFIX}_process_heap_total_bytes gauge`);
    lines.push(`${PREFIX}_process_heap_total_bytes ${memUsage.heapTotal}`);

    lines.push(`# HELP ${PREFIX}_process_external_memory_bytes V8 external memory`);
    lines.push(`# TYPE ${PREFIX}_process_external_memory_bytes gauge`);
    lines.push(`${PREFIX}_process_external_memory_bytes ${memUsage.external}`);

    // ── Node.js Runtime ──
    lines.push(`# HELP ${PREFIX}_nodejs_active_handles Active libuv handles`);
    lines.push(`# TYPE ${PREFIX}_nodejs_active_handles gauge`);
    lines.push(`${PREFIX}_nodejs_active_handles ${process._getActiveHandles?.().length || 0}`);

    lines.push(`# HELP ${PREFIX}_nodejs_active_requests Active libuv requests`);
    lines.push(`# TYPE ${PREFIX}_nodejs_active_requests gauge`);
    lines.push(`${PREFIX}_nodejs_active_requests ${process._getActiveRequests?.().length || 0}`);

    // ── Uptime ──
    lines.push(`# HELP ${PREFIX}_uptime_seconds Process uptime in seconds`);
    lines.push(`# TYPE ${PREFIX}_uptime_seconds gauge`);
    lines.push(`${PREFIX}_uptime_seconds ${process.uptime().toFixed(0)}`);

    // ── Node.js version info ──
    lines.push(`# HELP ${PREFIX}_nodejs_version_info Node.js version`);
    lines.push(`# TYPE ${PREFIX}_nodejs_version_info gauge`);
    lines.push(`${PREFIX}_nodejs_version_info{version="${process.version}"} 1`);

    return lines.join('\n') + '\n';
}

/**
 * Express middleware to track request metrics.
 */
function metricsMiddleware(req, res, next) {
    // Skip metrics/health endpoints to avoid self-referential noise
    if (req.path === '/metrics' || req.path === '/health') {
        return next();
    }

    const start = process.hrtime.bigint();

    // Hook into response finish
    const onFinish = () => {
        const durationNs = Number(process.hrtime.bigint() - start);
        const durationMs = durationNs / 1e6;
        recordRequest(req.method, req.path, res.statusCode, durationMs);
        res.removeListener('finish', onFinish);
    };

    res.on('finish', onFinish);
    next();
}

/**
 * Get summary stats for a specific route (for performance reports).
 */
function getRouteStats(method, route) {
    const key = `${method}:${route}`;
    const durations = requestDurations[key];
    if (!durations || durations.length === 0) {
        return null;
    }

    const sorted = [...durations].sort((a, b) => a - b);
    return {
        count: sorted.length,
        min: sorted[0] * 1000,          // ms
        max: sorted[sorted.length - 1] * 1000,
        mean: (sorted.reduce((a, b) => a + b, 0) / sorted.length) * 1000,
        p50: percentile(sorted, 0.5) * 1000,
        p95: percentile(sorted, 0.95) * 1000,
        p99: percentile(sorted, 0.99) * 1000,
    };
}

/**
 * Reset all metrics (useful for testing).
 */
function resetMetrics() {
    Object.keys(requestCounters).forEach(k => delete requestCounters[k]);
    Object.keys(requestDurations).forEach(k => delete requestDurations[k]);
}

module.exports = {
    metricsMiddleware,
    generateMetrics,
    recordRequest,
    getRouteStats,
    resetMetrics,
};
