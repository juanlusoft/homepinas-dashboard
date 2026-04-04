/**
 * STORAGE DASHBOARD
 * ════════════════════════════════════════════════════════════════════════════════
 * Real-time storage telemetry view: pool status, cache, disk health panel,
 * SMART / badblocks tests, and per-disk detail cards.
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { t } from '../../i18n.js';

const API_BASE = `${window.location.origin}/api`;
const dashboardContent = document.getElementById('dashboard-content');

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function getRoleColor(role) {
    switch (role) {
        case 'data': return '#6366f1';
        case 'parity': return '#f59e0b';
        case 'cache': return '#10b981';
        default: return '#475569';
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// STORAGE DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════

// Real Storage Telemetry
export async function renderStorageDashboard() {
    // Clear content to prevent duplication on refresh
    dashboardContent.innerHTML = '';

    try {
        // Fetch disks and pool status
        const [disksRes, poolRes, cacheRes] = await Promise.all([
            authFetch(`${API_BASE}/system/disks`),
            authFetch(`${API_BASE}/storage/pool/status`),
            authFetch(`${API_BASE}/storage/cache/status`).catch(() => null)
        ]);

        if (disksRes.ok) state.disks = await disksRes.json();
        let poolStatus = {};
        let cacheStatus = null;
        if (cacheRes && cacheRes.ok) cacheStatus = await cacheRes.json();
        if (poolRes.ok) poolStatus = await poolRes.json();

        // Storage Array Header (Cockpit style)
        const arrayCard = document.createElement('div');
        arrayCard.className = 'glass-card storage-array-view dash-overview-full';

        const arrayHeader = document.createElement('div');
        arrayHeader.className = 'storage-array-header';
        arrayHeader.innerHTML = `
            <h3>💾 ${t('storage.storageArray', 'Array de Almacenamiento')}</h3>
            <div class="storage-total-stats">
                <div class="storage-total-stat">
                    <span class="label">${t('storage.total', 'Total')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.used', 'Usado')}</span>
                    <span class="value">${escapeHtml(poolStatus.poolUsed || 'N/A')}</span>
                </div>
                <div class="storage-total-stat">
                    <span class="label">${t('storage.available', 'Disponible')}</span>
                    <span class="value dash-pool-free-value">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                </div>
            </div>
        `;
        arrayCard.appendChild(arrayHeader);

        // Mount points grid
        const mountsGrid = document.createElement('div');
        mountsGrid.className = 'storage-array-grid';

        // Pool mount (if configured)
        if (poolStatus.configured && poolStatus.running) {
            // Use backend-calculated percentage (avoids GB/TB unit mismatch)
            const poolPercent = poolStatus.usedPercent || 0;
            const poolFillClass = poolPercent > 90 ? 'high' : poolPercent > 70 ? 'medium' : 'low';

            const poolRow = document.createElement('div');
            poolRow.className = 'storage-mount-row pool';
            poolRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(poolStatus.poolMount || '/mnt/storage')}</span>
                    <span class="mount-device">MergerFS Pool</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${poolFillClass}" style="width: ${poolPercent}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${poolPercent}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(poolStatus.poolFree || 'N/A')} ${t('storage.available', 'disponible')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(poolStatus.poolFree || 'N/A')}</span>
                    <span class="total">de ${escapeHtml(poolStatus.poolSize || 'N/A')}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge mergerfs">MergerFS</span>
                </div>
            `;
            mountsGrid.appendChild(poolRow);
        }

        // Individual disk mounts
        state.disks.forEach((disk, index) => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            if (role === 'none') return;

            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);
            const fillClass = usage > 90 ? 'high' : usage > 70 ? 'medium' : 'low';
            const mountPoint = role === 'data' ? `/mnt/disks/disk${index + 1}` :
                              role === 'parity' ? `/mnt/parity${index + 1}` :
                              `/mnt/disks/cache${index + 1}`;

            const diskRow = document.createElement('div');
            diskRow.className = `storage-mount-row ${role}`;
            diskRow.innerHTML = `
                <div class="mount-info">
                    <span class="mount-path">${escapeHtml(mountPoint)}</span>
                    <span class="mount-device">/dev/${escapeHtml(disk.id)} • ${escapeHtml(disk.model || t('common.unknown', 'Desconocido'))}</span>
                </div>
                <div class="mount-bar-container">
                    <div class="mount-bar">
                        <div class="mount-bar-fill ${fillClass}" style="width: ${usage}%"></div>
                    </div>
                    <div class="mount-bar-text">
                        <span>${usage}% ${t('storage.used', 'usado')}</span>
                        <span>${escapeHtml(disk.size || 'N/A')}</span>
                    </div>
                </div>
                <div class="mount-size">
                    <span class="available">${escapeHtml(disk.size || 'N/A')}</span>
                    <span class="total">${role.toUpperCase()}</span>
                </div>
                <div class="mount-type">
                    <span class="mount-type-badge ext4">ext4</span>
                </div>
            `;
            mountsGrid.appendChild(diskRow);
        });

        arrayCard.appendChild(mountsGrid);
        dashboardContent.appendChild(arrayCard);

        // Cache status card (if cache disks present)
        if (cacheStatus && cacheStatus.hasCache) {
            const cacheCard = document.createElement('div');
            cacheCard.className = 'glass-card dash-overview-full';
            cacheCard.style.gridColumn = '1 / -1';

            let cacheDiskHtml = cacheStatus.cacheDisks.map(c => {
                if (c.error) return `<div class="cache-disk-item" style="color: var(--text-dim);">⚠️ ${escapeHtml(c.disk)}: ${escapeHtml(c.error)}</div>`;
                const pct = c.usagePercent || 0;
                const barColor = pct > 85 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#10b981';
                return `
                    <div class="cache-disk-item" style="margin-bottom: 12px;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                            <span style="font-weight: 600;">⚡ ${escapeHtml(c.disk)}</span>
                            <span style="font-size: 0.85rem; color: var(--text-dim);">${escapeHtml(c.usedFormatted)} / ${escapeHtml(c.totalFormatted)}</span>
                        </div>
                        <div style="background: rgba(255,255,255,0.1); border-radius: 6px; height: 8px; overflow: hidden;">
                            <div style="background: ${barColor}; height: 100%; width: ${pct}%; border-radius: 6px; transition: width 0.3s;"></div>
                        </div>
                        <div style="display: flex; justify-content: space-between; font-size: 0.75rem; color: var(--text-dim); margin-top: 4px;">
                            <span>${pct}% usado</span>
                            <span>${escapeHtml(c.availableFormatted)} libre</span>
                        </div>
                    </div>
                `;
            }).join('');

            const policyHtml = cacheStatus.policy ? `
                <div style="display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--card-border, rgba(255,255,255,0.1));">
                    <span style="font-size: 0.8rem; padding: 4px 10px; background: rgba(99,102,241,0.15); border-radius: 6px; color: var(--primary, #6366f1);">
                        📝 Escritura: <strong>${escapeHtml(cacheStatus.policy.createPolicy || '?')}</strong>
                    </span>
                    ${cacheStatus.policy.moveOnNoSpace ? '<span style="font-size: 0.8rem; padding: 4px 10px; background: rgba(16,185,129,0.15); border-radius: 6px; color: #10b981;">✅ Auto-mover si caché llena</span>' : ''}
                    ${cacheStatus.policy.minFreeSpace ? `<span style="font-size: 0.8rem; padding: 4px 10px; background: rgba(245,158,11,0.15); border-radius: 6px; color: #f59e0b;">📏 Min libre: ${escapeHtml(cacheStatus.policy.minFreeSpace)}</span>` : ''}
                </div>
            ` : '';

            const fileCountHtml = cacheStatus.fileCounts ? `
                <div style="display: flex; gap: 20px; margin-top: 10px; font-size: 0.85rem;">
                    <span>⚡ Caché: <strong>${cacheStatus.fileCounts.cache}</strong> archivos</span>
                    <span>💿 Datos: <strong>${cacheStatus.fileCounts.data}</strong> archivos</span>
                </div>
            ` : '';

            const moverHtml = cacheStatus.mover ? `
                <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; align-items: center;">
                    <span style="font-size: 0.8rem; padding: 4px 10px; background: ${cacheStatus.mover.enabled ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'}; border-radius: 6px; color: ${cacheStatus.mover.enabled ? '#10b981' : '#ef4444'};">
                        ${cacheStatus.mover.enabled ? '🔄 Mover activo' : '⏸️ Mover inactivo'}
                    </span>
                    ${cacheStatus.mover.ageMinutes ? `<span style="font-size: 0.8rem; color: var(--text-dim);">Mueve archivos >${Math.floor(cacheStatus.mover.ageMinutes / 60)}h a HDD</span>` : ''}
                    ${cacheStatus.mover.usageThreshold ? `<span style="font-size: 0.8rem; color: var(--text-dim);">Emergencia al ${cacheStatus.mover.usageThreshold}%</span>` : ''}
                </div>
                ${cacheStatus.mover.lastLog && cacheStatus.mover.lastLog.length > 0 ? `
                    <div style="margin-top: 8px; font-size: 0.75rem; color: var(--text-dim); font-family: monospace; max-height: 60px; overflow-y: auto;">
                        ${cacheStatus.mover.lastLog.map(l => escapeHtml(l)).join('<br>')}
                    </div>
                ` : ''}
            ` : '';

            cacheCard.innerHTML = `
                <div style="margin-bottom: 15px;">
                    <h3 style="margin: 0 0 4px 0;">⚡ Estado de la Caché</h3>
                    <span style="font-size: 0.8rem; color: var(--text-dim);">${cacheStatus.cacheDisks.length} disco(s) SSD/NVMe como caché de escritura</span>
                </div>
                ${cacheDiskHtml}
                ${fileCountHtml}
                ${policyHtml}
                ${moverHtml}
            `;

            dashboardContent.appendChild(cacheCard);
        }

        // =================================================================
        // DISK HEALTH PANEL - Global health status for all disks
        // =================================================================
        try {
            const healthRes = await authFetch(`${API_BASE}/storage/disks/health`);
            if (healthRes.ok) {
                const healthData = await healthRes.json();

                // Create health panel card
                const healthCard = document.createElement('div');
                healthCard.className = 'glass-card dash-overview-full';
                healthCard.style.marginTop = '20px';

                // Header with summary badge
                const healthHeader = document.createElement('div');
                healthHeader.className = 'storage-array-header';
                const summaryParts = [`${healthData.summary.healthy} OK`];
                if (healthData.summary.warning > 0) summaryParts.push(`${healthData.summary.warning} ${t('diskHealth.warning', 'Atención')}`);
                if (healthData.summary.critical > 0) summaryParts.push(`${healthData.summary.critical} ${t('diskHealth.critical', 'Crítico')}`);
                const summaryClass = healthData.summary.critical > 0 ? 'critical' : healthData.summary.warning > 0 ? 'warning' : 'ok';
                const summaryBadge = `<span class="health-summary-badge ${escapeHtml(summaryClass)}">${escapeHtml(summaryParts.join(' · '))}</span>`;
                healthHeader.innerHTML = `<h3>🏥 ${t('diskHealth.title', 'Salud de Discos')}</h3>${summaryBadge}`;
                healthCard.appendChild(healthHeader);

                // Check if no disks detected
                if (healthData.disks.length === 0) {
                    const noDiskMsg = document.createElement('p');
                    noDiskMsg.style.cssText = 'text-align: center; color: var(--text-dim); padding: 20px;';
                    noDiskMsg.textContent = t('diskHealth.noDisks', 'No se detectaron discos');
                    healthCard.appendChild(noDiskMsg);
                } else {
                    // Disk health grid
                    const healthGrid = document.createElement('div');
                    healthGrid.className = 'disk-health-grid';
                    healthGrid.style.cssText = 'display: flex; flex-direction: column; gap: 12px; margin-top: 15px;';

                    for (const disk of healthData.disks) {
                        const diskRow = document.createElement('div');
                        diskRow.className = 'disk-health-row';
                        diskRow.style.cssText = 'display: grid; grid-template-columns: auto 1fr auto auto auto; gap: 15px; align-items: center; padding: 12px; background: rgba(255,255,255,0.03); border-radius: 8px; border-left: 3px solid var(--health-color);';

                        // Set health color CSS variable
                        const healthColors = { ok: '#4ade80', warning: '#fbbf24', critical: '#ef4444' };
                        diskRow.style.setProperty('--health-color', healthColors[disk.health.status] || '#888');

                        // Icon + Model + Serial
                        const diskIcon = disk.type === 'nvme' ? '🔌' : (disk.type === 'ssd' ? '⚡' : '💿');
                        const infoDiv = document.createElement('div');
                        infoDiv.style.cssText = 'display: flex; flex-direction: column;';
                        infoDiv.innerHTML = `
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span style="font-size: 1.3rem;">${diskIcon}</span>
                                <div>
                                    <div style="font-weight: 600;">${escapeHtml(disk.model)}</div>
                                    <div style="font-size: 0.85rem; color: var(--text-dim);">${escapeHtml(disk.id)} · SN: ${escapeHtml(disk.serial.substring(0, 12)) || 'N/A'}</div>
                                </div>
                            </div>
                        `;
                        diskRow.appendChild(infoDiv);

                        // Health status indicator
                        const healthIndicator = document.createElement('div');
                        healthIndicator.style.cssText = 'display: flex; align-items: center; gap: 6px;';
                        const healthIcons = { ok: '🟢', warning: '🟡', critical: '🔴' };
                        const healthTexts = {
                            ok: t('diskHealth.healthy', 'Saludable'),
                            warning: t('diskHealth.warning', 'Atención'),
                            critical: t('diskHealth.critical', 'Crítico')
                        };
                        healthIndicator.innerHTML = `
                            <span>${healthIcons[disk.health.status] || '⚪'}</span>
                            <span class="health-${disk.health.status}">${healthTexts[disk.health.status] || 'Unknown'}</span>
                        `;
                        diskRow.appendChild(healthIndicator);

                        // Metrics (type-specific)
                        const metricsDiv = document.createElement('div');
                        metricsDiv.style.cssText = 'display: flex; gap: 15px; font-size: 0.9rem;';

                        if (disk.type === 'hdd' && disk.sectors) {
                            metricsDiv.innerHTML = `
                                <div><span style="color: var(--text-dim);">${t('diskHealth.reallocated', 'Sectores reasignados')}:</span> <strong>${disk.sectors.reallocated}</strong></div>
                                <div><span style="color: var(--text-dim);">${t('diskHealth.pending', 'Pendientes')}:</span> <strong>${disk.sectors.pending}</strong></div>
                            `;
                        } else if (disk.ssdLife) {
                            metricsDiv.innerHTML = `
                                <div><span style="color: var(--text-dim);">${t('diskHealth.tbw', 'TBW')}:</span> <strong>${disk.ssdLife.tbw} TB</strong></div>
                                <div><span style="color: var(--text-dim);">${t('diskHealth.lifeRemaining', 'Vida')}:</span> <strong>${disk.ssdLife.lifeRemainingFormatted}</strong></div>
                            `;
                        }

                        metricsDiv.innerHTML += `
                            <div><span style="color: var(--text-dim);">${t('diskHealth.powerOn', 'Encendido')}:</span> <strong>${escapeHtml(disk.powerOnTime.formatted)}</strong></div>
                            <div><span style="color: var(--text-dim);">${t('diskHealth.temperature', 'Temp')}:</span> <strong class="temp-${disk.temperature.status}">${disk.temperature.current}°C</strong></div>
                        `;
                        diskRow.appendChild(metricsDiv);

                        // Test button
                        const testBtn = document.createElement('button');
                        testBtn.className = 'disk-health-test-btn';
                        testBtn.style.cssText = 'padding: 6px 12px; border-radius: 6px; background: rgba(78, 205, 196, 0.2); color: #4ecdc4; border: 1px solid rgba(78, 205, 196, 0.3); cursor: pointer; font-size: 0.85rem; white-space: nowrap;';

                        // Check if badblocks is running on this disk
                        const bbStatusRes = await authFetch(`${API_BASE}/storage/badblocks/${disk.id}/status`);
                        const bbStatus = bbStatusRes.ok ? await bbStatusRes.json() : { running: false };

                        if (bbStatus.running) {
                            testBtn.textContent = `🔍 Escaneando ${bbStatus.progress}%`;
                            testBtn.disabled = true;
                            testBtn.style.opacity = '0.8';
                            testBtn.style.background = 'rgba(251, 191, 36, 0.2)';
                            testBtn.style.color = '#fbbf24';
                            testBtn.style.borderColor = 'rgba(251, 191, 36, 0.3)';

                            // Add info line
                            const infoSpan = document.createElement('div');
                            infoSpan.style.cssText = 'font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;';
                            infoSpan.textContent = `${bbStatus.elapsedHours}h de ~${bbStatus.estimatedHours}h · ${bbStatus.badBlocksFound} errores`;
                            diskRow.appendChild(infoSpan);

                            // Add cancel button
                            const cancelBtn = document.createElement('button');
                            cancelBtn.textContent = '✕ Cancelar';
                            cancelBtn.style.cssText = 'padding: 4px 8px; border-radius: 4px; background: rgba(239,68,68,0.2); color: #ef4444; border: 1px solid rgba(239,68,68,0.3); cursor: pointer; font-size: 0.75rem; margin-left: 8px;';
                            cancelBtn.addEventListener('click', async () => {
                                const cancel = await showConfirmModal(
                                    t('diskHealth.cancelTest', 'Cancelar test'),
                                    t('diskHealth.confirmCancelTest', '¿Cancelar el test de disco?'),
                                    t('common.yes', 'Sí'),
                                    t('common.no', 'No')
                                );
                                if (cancel) {
                                    await authFetch(`${API_BASE}/storage/badblocks/${disk.id}`, { method: 'DELETE' });
                                    renderStorageDashboard();
                                }
                            });
                            diskRow.appendChild(cancelBtn);

                        } else if (bbStatus.hasResult) {
                            // Show last result
                            const resultColor = bbStatus.badBlocksFound === 0 ? '#4ade80' : '#ef4444';
                            const resultText = bbStatus.result === 'cancelled' ? '⏹ Cancelado' :
                                bbStatus.badBlocksFound === 0 ? '✅ Sin errores' : `❌ ${bbStatus.badBlocksFound} sectores defectuosos`;
                            testBtn.textContent = resultText;
                            testBtn.style.color = resultColor;
                            testBtn.style.borderColor = resultColor;
                            testBtn.addEventListener('click', async () => {
                                const runTest = await showConfirmModal(
                                    t('diskHealth.fullTestTitle', 'Test completo de disco'),
                                    t('diskHealth.fullTestMsg', `Se escanearan TODOS los sectores de ${disk.id}. Tiempo estimado: ~${Math.round((parseInt(disk.capacity) || 1) * 5.5 / 1024)}h. El NAS seguirá funcionando pero más lento.`),
                                    t('diskHealth.startTest', 'Iniciar test'),
                                    t('common.cancel', 'Cancelar')
                                );
                                if (runTest) {
                                    await startBadblocks(disk.id, testBtn);
                                }
                            });
                        } else {
                            testBtn.textContent = '🔍 Test de disco';
                            testBtn.addEventListener('click', () => {
                                // Show dropdown with test options
                                const existing = document.getElementById(`test-menu-${disk.id}`);
                                if (existing) { existing.remove(); return; }

                                const menu = document.createElement('div');
                                menu.id = `test-menu-${disk.id}`;
                                menu.style.cssText = 'position: absolute; right: 0; top: 100%; background: rgba(30,30,50,0.95); border: 1px solid rgba(255,255,255,0.15); border-radius: 8px; padding: 6px 0; z-index: 100; min-width: 220px; backdrop-filter: blur(10px); box-shadow: 0 8px 24px rgba(0,0,0,0.4);';

                                const optSmartShort = document.createElement('div');
                                optSmartShort.style.cssText = 'padding: 10px 16px; cursor: pointer; font-size: 0.85rem; color: #e0e0e0; transition: background 0.2s;';
                                optSmartShort.innerHTML = '<b>⚡ Test rápido SMART</b><br><span style="font-size:0.75rem;color:rgba(255,255,255,0.5)">~2 minutos · Autodiagnóstico del disco</span>';
                                optSmartShort.addEventListener('mouseenter', () => optSmartShort.style.background = 'rgba(255,255,255,0.1)');
                                optSmartShort.addEventListener('mouseleave', () => optSmartShort.style.background = 'none');
                                optSmartShort.addEventListener('click', async () => {
                                    menu.remove();
                                    testBtn.disabled = true;
                                    testBtn.textContent = '⏳ SMART...';
                                    try {
                                        const r = await authFetch(`${API_BASE}/storage/smart/${disk.id}/test`, {
                                            method: 'POST',
                                            body: JSON.stringify({ type: 'short' })
                                        });
                                        const result = await r.json();
                                        if (r.ok && result.success) {
                                            showNotification(t('diskHealth.smartStarted', `Test SMART rápido iniciado en ${disk.id} (~2 min)`), 'success');
                                            testBtn.textContent = '⚡ SMART en curso...';
                                            const pollSmart = async () => {
                                                try {
                                                    const sRes = await authFetch(`${API_BASE}/storage/smart/${disk.id}/status`);
                                                    if (sRes.ok) {
                                                        const s = await sRes.json();
                                                        if (s.testInProgress) {
                                                            testBtn.textContent = `⚡ SMART ${100 - (s.remainingPercent || 0)}%`;
                                                            setTimeout(pollSmart, 15000);
                                                        } else {
                                                            showNotification(t('diskHealth.smartCompleted', `Test SMART completado en ${disk.id}`), 'success');
                                                            renderStorageDashboard();
                                                        }
                                                    }
                                                } catch (e) { setTimeout(pollSmart, 15000); }
                                            };
                                            setTimeout(pollSmart, 10000);
                                        } else {
                                            showNotification(result.error || t('common.error', 'Error'), 'error');
                                            testBtn.disabled = false;
                                            testBtn.textContent = '🔍 Test de disco';
                                        }
                                    } catch (e) {
                                        showNotification(`Error: ${e.message}`, 'error');
                                        testBtn.disabled = false;
                                        testBtn.textContent = '🔍 Test de disco';
                                    }
                                });

                                const divider = document.createElement('div');
                                divider.style.cssText = 'height: 1px; background: rgba(255,255,255,0.1); margin: 4px 0;';

                                const optBadblocks = document.createElement('div');
                                optBadblocks.style.cssText = 'padding: 10px 16px; cursor: pointer; font-size: 0.85rem; color: #e0e0e0; transition: background 0.2s;';
                                optBadblocks.innerHTML = '<b>🔍 Test completo (badblocks)</b><br><span style="font-size:0.75rem;color:rgba(255,255,255,0.5)">Horas · Escaneo sector a sector</span>';
                                optBadblocks.addEventListener('mouseenter', () => optBadblocks.style.background = 'rgba(255,255,255,0.1)');
                                optBadblocks.addEventListener('mouseleave', () => optBadblocks.style.background = 'none');
                                optBadblocks.addEventListener('click', async () => {
                                    menu.remove();
                                    const runBB = await showConfirmModal(
                                        t('diskHealth.badblocksTitle', 'Test completo (badblocks)'),
                                        t('diskHealth.badblocksMsg', `Escanea TODOS los sectores de ${disk.id} buscando errores. El NAS seguirá funcionando pero más lento. Puede tardar muchas horas.`),
                                        t('diskHealth.startTest', 'Iniciar test'),
                                        t('common.cancel', 'Cancelar')
                                    );
                                    if (runBB) {
                                        await startBadblocks(disk.id, testBtn);
                                    }
                                });

                                menu.appendChild(optSmartShort);
                                menu.appendChild(divider);
                                menu.appendChild(optBadblocks);

                                // Position relative to button
                                testBtn.parentElement.style.position = 'relative';
                                testBtn.parentElement.appendChild(menu);

                                // Close on outside click
                                const closeMenu = (e) => { if (!menu.contains(e.target) && e.target !== testBtn) { menu.remove(); document.removeEventListener('click', closeMenu); } };
                                setTimeout(() => document.addEventListener('click', closeMenu), 0);
                            });
                        }

                        diskRow.appendChild(testBtn);
                        healthGrid.appendChild(diskRow);
                    }

                    healthCard.appendChild(healthGrid);
                }

                dashboardContent.appendChild(healthCard);
            }
        } catch (e) {
            console.error('Disk health panel error:', e);
            // Continue rendering without health panel if it fails
        }
        // =================================================================

        // Disk cards grid (detailed view)
        const grid = document.createElement('div');
        grid.className = 'telemetry-grid dash-telemetry-grid';

        state.disks.forEach(disk => {
            const config = state.storageConfig.find(s => s.id === disk.id);
            const role = config ? config.role : 'none';
            const temp = Number(disk.temp) || 0;
            const tempClass = temp > 45 ? 'hot' : (temp > 38 ? 'warm' : 'cool');
            const usage = Math.min(Math.max(Number(disk.usage) || 0, 0), 100);

            const card = document.createElement('div');
            card.className = 'glass-card disk-card-advanced';

            // Create header
            const header = document.createElement('div');
            header.className = 'disk-header-adv';

            const headerInfo = document.createElement('div');
            const h4 = document.createElement('h4');
            h4.textContent = disk.model || t('common.unknown', 'Desconocido');
            const infoSpan = document.createElement('span');
            infoSpan.className = 'dash-disk-info-detail';
            infoSpan.textContent = `${disk.id || 'N/A'} • ${disk.type || t('common.unknown', 'Desconocido')} • ${disk.size || 'N/A'}`;
            const serialSpan2 = document.createElement('span');
            serialSpan2.className = 'dash-disk-serial';
            serialSpan2.textContent = `SN: ${disk.serial || 'N/A'}`;
            headerInfo.appendChild(h4);
            headerInfo.appendChild(infoSpan);
            headerInfo.appendChild(serialSpan2);

            const roleBadge = document.createElement('span');
            roleBadge.className = `role-badge ${escapeHtml(role)}`;
            const roleTranslations = { data: t('storage.data', 'Data'), parity: t('storage.parity', 'Parity'), cache: t('storage.cache', 'Cache'), none: t('storage.none', 'None') };
            roleBadge.textContent = roleTranslations[role] || role;

            header.appendChild(headerInfo);
            header.appendChild(roleBadge);

            // Create progress container
            const progressContainer = document.createElement('div');
            progressContainer.className = 'disk-progress-container';
            progressContainer.innerHTML = `
                <div class="telemetry-stats-row"><span>${t('storage.healthStatus', 'Estado de Salud')}</span><span class="dash-health-ok">${t('storage.optimal', 'Óptimo')}</span></div>
                <div class="disk-usage-bar"><div class="disk-usage-fill" style="width: ${usage}%; background: ${getRoleColor(role)}"></div></div>
            `;

            // Create telemetry row (only temperature, SN is in header)
            const telemetryRow = document.createElement('div');
            telemetryRow.className = 'telemetry-stats-row';

            const tempIndicator = document.createElement('div');
            tempIndicator.className = `temp-indicator ${tempClass}`;
            tempIndicator.innerHTML = `<span>🌡️</span><span>${escapeHtml(String(temp))}°C</span>`;

            telemetryRow.appendChild(tempIndicator);

            // Add configure button for unconfigured disks
            if (role === 'none') {
                const configBtn = document.createElement('button');
                configBtn.className = 'dash-disk-configure-btn';
                configBtn.textContent = '⚙️ Configurar';
                configBtn.addEventListener('click', () => {
                    // Normalize disk object for showDiskActionModal (same format as /disks/detect)
                    // detectedNewDisks and showDiskActionModal are globals set by disk-management/index.js
                    if (typeof window.detectedNewDisks !== 'undefined') {
                        window.detectedNewDisks = [{
                            id: disk.id,
                            model: disk.model || 'Disco',
                            size: disk.size,
                            sizeFormatted: disk.size || 'N/A',
                            transport: disk.type || 'unknown',
                            serial: disk.serial,
                            hasData: true,
                            partitions: []
                        }];
                    }
                    if (typeof window.showDiskActionModal === 'function') {
                        window.showDiskActionModal();
                    }
                });
                telemetryRow.appendChild(configBtn);
            }

            // Add "Remove from pool" button for disks in pool
            if (role !== 'none') {
                const removeBtn = document.createElement('button');
                removeBtn.className = 'dash-disk-remove-btn';
                removeBtn.textContent = '🗑️ Quitar del pool';
                removeBtn.addEventListener('click', async () => {
                    const confirmRemove = await showConfirmModal(
                        t('storage.removeFromPool', 'Quitar del pool'),
                        t('storage.confirmRemoveFromPool', `¿Seguro que quieres quitar ${disk.model || disk.id} del pool? El disco seguirá montado pero no formará parte del almacenamiento compartido.`),
                        t('storage.remove', 'Quitar'),
                        t('common.cancel', 'Cancelar')
                    );
                    if (!confirmRemove) {
                        return;
                    }

                    removeBtn.disabled = true;
                    removeBtn.textContent = '⏳ Quitando...';

                    try {
                        const res = await authFetch(`${API_BASE}/storage/disks/remove-from-pool`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ diskId: disk.id })
                        });

                        const data = await res.json();

                        if (res.ok && data.success) {
                            showNotification(data.message, 'success');
                            renderStorageDashboard(); // Refresh view
                        } else {
                            showNotification(data.error || t('common.unknown', 'Error desconocido'), 'error');
                            removeBtn.disabled = false;
                            removeBtn.textContent = '🗑️ Quitar del pool';
                        }
                    } catch (e) {
                        showNotification(e.message, 'error');
                        removeBtn.disabled = false;
                        removeBtn.textContent = '🗑️ Quitar del pool';
                    }
                });
                telemetryRow.appendChild(removeBtn);
            }

            card.appendChild(header);
            card.appendChild(progressContainer);
            card.appendChild(telemetryRow);
            grid.appendChild(card);
        });

        dashboardContent.appendChild(grid);
    } catch (e) {
        console.error('Storage dashboard error:', e);
        dashboardContent.innerHTML = `<div class="glass-card"><h3>${t('common.error', 'Error al cargar datos de almacenamiento')}</h3></div>`;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// BADBLOCKS HELPER (used inside health panel loop)
// ════════════════════════════════════════════════════════════════════════════════

async function startBadblocks(diskId, testBtn) {
    testBtn.disabled = true;
    testBtn.textContent = '⏳ Iniciando...';
    try {
        const res = await authFetch(`${API_BASE}/storage/badblocks/${diskId}`, {
            method: 'POST'
        });
        const result = await res.json();
        if (res.ok && result.success) {
            showNotification(t('diskHealth.testStarted', `Test de disco iniciado en ${diskId} (~${result.estimatedHours}h estimadas)`), 'success');
            // Poll progress
            const pollBadblocks = async () => {
                try {
                    const sRes = await authFetch(`${API_BASE}/storage/badblocks/${diskId}/status`);
                    if (sRes.ok) {
                        const s = await sRes.json();
                        if (s.running) {
                            testBtn.textContent = `🔍 Escaneando ${s.progress}%`;
                            setTimeout(pollBadblocks, 30000);
                        } else {
                            const msg = s.badBlocksFound === 0 ?
                                `Test completado en ${diskId}: disco OK ✅` :
                                `Test completado en ${diskId}: ${s.badBlocksFound} sectores defectuosos ❌`;
                            showNotification(msg, s.badBlocksFound === 0 ? 'success' : 'error');
                            renderStorageDashboard();
                        }
                    }
                } catch (e) { setTimeout(pollBadblocks, 30000); }
            };
            setTimeout(pollBadblocks, 15000);
        } else {
            showNotification(result.error || t('diskHealth.startTestError', 'Error al iniciar test'), 'error');
            testBtn.disabled = false;
            testBtn.textContent = '🔍 Test de disco';
        }
    } catch (e) {
        showNotification(`Error: ${e.message}`, 'error');
        testBtn.disabled = false;
        testBtn.textContent = '🔍 Test de disco';
    }
}
