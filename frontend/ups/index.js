/**
 * UPS Module - Uninterruptible Power Supply management
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { t } from '/frontend/i18n.js';

let _listeners = [];
function _track(el, evt, fn) { _listeners.push({element: el, event: evt, handler: fn}); }

async function renderUPSSection(container) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.cssText = 'grid-column: 1 / -1;';

    const title = document.createElement('h3');
    title.textContent = '🔋 Monitor UPS';
    title.style.marginBottom = '15px';
    card.appendChild(title);

    const content = document.createElement('div');
    content.id = 'ups-content';
    content.innerHTML = '<p class="ups-loading-text">Cargando estado del UPS...</p>';
    card.appendChild(content);
    container.appendChild(card);

    try {
        const res = await authFetch(`${API_BASE}/ups/status`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();

        if (!data.available) {
            content.innerHTML = `
                <div class="ups-not-detected">
                    <span style="font-size: 2rem;">🔌</span>
                    <div>
                        <p style="font-weight: 500;">No se detectó UPS</p>
                        <p class="ups-not-detected-description">Instala <code>apcupsd</code> o <code>nut</code> para monitorizar tu UPS.</p>
                    </div>
                </div>
            `;
            return;
        }

        const batteryColor = data.batteryCharge > 50 ? '#10b981' : data.batteryCharge > 20 ? '#f59e0b' : '#ef4444';
        content.innerHTML = `
            <div class="ups-stats-grid">
                <div class="ups-stat-card">
                    <div class="ups-stat-icon">🔋</div>
                    <div class="ups-stat-value" style="color: ${batteryColor};">${data.batteryCharge || '—'}%</div>
                    <div class="ups-stat-label">Batería</div>
                </div>
                <div class="ups-stat-card">
                    <div class="ups-stat-icon">⏱️</div>
                    <div class="ups-stat-value">${data.runtime || '—'}</div>
                    <div class="ups-stat-label">Autonomía</div>
                </div>
                <div class="ups-stat-card">
                    <div class="ups-stat-icon">⚡</div>
                    <div class="ups-stat-value">${data.load || '—'}%</div>
                    <div class="ups-stat-label">Carga</div>
                </div>
                <div class="ups-stat-card">
                    <div class="ups-stat-icon">🔌</div>
                    <div class="ups-stat-value">${data.inputVoltage || '—'}V</div>
                    <div class="ups-stat-label">Voltaje</div>
                </div>
            </div>
            <div class="ups-details-container">
                <span><strong>Estado:</strong> ${escapeHtml(data.status || t('common.unknown', 'Desconocido'))}</span>
                <span><strong>Modelo:</strong> ${escapeHtml(data.model || t('common.unknown', 'Desconocido'))}</span>
                <span><strong>Driver:</strong> ${escapeHtml(data.driver || t('common.unknown', 'Desconocido'))}</span>
            </div>
        `;
    } catch (e) {
        content.innerHTML = '<p style="color: #ef4444;">Error al cargar estado del UPS</p>';
    }
}

// =============================================================================
// NOTIFICATIONS CONFIG (added to System view)
// =============================================================================


export function cleanup() {
    _listeners.forEach(({element, event, handler}) => {
        element.removeEventListener(event, handler);
    });
    _listeners = [];
}

export { renderUPSSection };
