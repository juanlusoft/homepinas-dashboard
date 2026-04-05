/**
 * DISK MANAGEMENT MODULE
 * Polls for new disks and provides quick actions.
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { escapeHtml } from '../utils.js';
import { t } from '/frontend/i18n.js';

const API_BASE = `${window.location.origin}/api`;
let _diskListeners = [];
let _pollTimer = null;
let _lastDetectedSignature = '';
let detectedNewDisks = [];

function _trackListener(element, event, handler) {
    element.addEventListener(event, handler);
    _diskListeners.push({ element, event, handler });
}

function _getDashboardContent() {
    return document.getElementById('dashboard-content');
}

function _ensureBanner() {
    const root = _getDashboardContent();
    if (!root) return null;

    let banner = document.getElementById('disk-detection-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'disk-detection-banner';
        banner.className = 'glass-card';
        banner.style.gridColumn = '1 / -1';
        root.prepend(banner);
    }
    return banner;
}

export async function checkForNewDisks() {
    try {
        const res = await authFetch(`${API_BASE}/storage/disks/detect`);
        if (!res.ok) return [];

        const disks = await res.json();
        if (!Array.isArray(disks)) return [];

        const candidates = disks.filter((d) => d && d.id);
        detectedNewDisks = candidates;
        const signature = candidates.map((d) => d.id).sort().join('|');

        if (signature && signature !== _lastDetectedSignature) {
            _lastDetectedSignature = signature;
            showDiskNotification(candidates);
        }

        return candidates;
    } catch {
        return [];
    }
}

export function showDiskNotification(disks) {
    const banner = _ensureBanner();
    if (!banner) return;

    const items = disks
        .map((d) => `<li><strong>${escapeHtml(d.model || d.id)}</strong> - ${escapeHtml(d.size || 'N/A')}</li>`)
        .join('');

    banner.innerHTML = `
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap;">
            <div>
                <h4 style="margin:0 0 8px 0;">${t('storage.newDisksDetected', 'Nuevos discos detectados')}</h4>
                <ul style="margin:0;padding-left:18px;">${items}</ul>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn-primary" id="disk-banner-configure">${t('storage.configure', 'Configurar')}</button>
                <button class="btn-primary" id="disk-banner-hide" style="background:#64748b;">${t('common.close', 'Cerrar')}</button>
            </div>
        </div>
    `;

    const configureBtn = banner.querySelector('#disk-banner-configure');
    const hideBtn = banner.querySelector('#disk-banner-hide');

    if (configureBtn) _trackListener(configureBtn, 'click', showDiskActionModal);
    if (hideBtn) _trackListener(hideBtn, 'click', hideDiskNotification);
}

export function hideDiskNotification() {
    const banner = document.getElementById('disk-detection-banner');
    if (banner) banner.remove();
}

export function showDiskActionModal() {
    const modalId = 'disk-action-modal';
    const existing = document.getElementById(modalId);
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = modalId;
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content">
            <header class="modal-header">
                <h3>${t('storage.configureDisks', 'Configurar discos detectados')}</h3>
                <button class="btn-close" data-role="close">&times;</button>
            </header>
            <div class="modal-body">
                <p>${t('storage.quickAddHint', 'Se anadiran al pool como discos de datos sin formateo automatico.')}</p>
                <ul>${detectedNewDisks.map((d) => `<li>${escapeHtml(d.model || d.id)} - ${escapeHtml(d.size || 'N/A')}</li>`).join('')}</ul>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn-primary" data-role="cancel">${t('common.cancel', 'Cancelar')}</button>
                    <button class="btn-primary" data-role="apply">${t('common.apply', 'Aplicar')}</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const close = () => modal.remove();
    const closeBtn = modal.querySelector('[data-role="close"]');
    const cancelBtn = modal.querySelector('[data-role="cancel"]');
    const applyBtn = modal.querySelector('[data-role="apply"]');

    if (closeBtn) _trackListener(closeBtn, 'click', close);
    if (cancelBtn) _trackListener(cancelBtn, 'click', close);
    if (applyBtn) {
        _trackListener(applyBtn, 'click', async () => {
            applyBtn.disabled = true;
            await applyDiskActions();
            close();
        });
    }
}

export function closeDiskActionModal() {
    const modal = document.getElementById('disk-action-modal');
    if (modal) modal.remove();
}

export function minimizeDiskModal() {
    const modal = document.getElementById('disk-action-modal');
    if (modal) modal.classList.toggle('minimized');
}

export function updateDiskWidget(status = '', isDone = false) {
    const banner = _ensureBanner();
    if (!banner) return;

    banner.dataset.done = isDone ? 'true' : 'false';
    if (!status) return;

    const statusEl = document.createElement('div');
    statusEl.style.marginTop = '8px';
    statusEl.style.color = isDone ? 'var(--success)' : 'var(--text-dim)';
    statusEl.textContent = status;
    banner.appendChild(statusEl);
}

export function removeDiskProgressWidget() {
    hideDiskNotification();
}

export function updateDiskProgressStep() {
    // Progress is represented via banner updates in this module.
}

export async function applyDiskActions() {
    if (!detectedNewDisks.length) return [];

    const results = [];
    for (const disk of detectedNewDisks) {
        try {
            const res = await authFetch(`${API_BASE}/storage/disks/add-to-pool`, {
                method: 'POST',
                body: JSON.stringify({ diskId: disk.id, role: 'data', format: false })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('common.error', 'Error'));
            results.push({ disk: disk.id, success: true, message: data.message || 'OK' });
        } catch (e) {
            results.push({ disk: disk.id, success: false, message: e.message || 'Error' });
        }
    }

    const ok = results.filter((r) => r.success).length;
    const fail = results.length - ok;
    if (ok > 0) showNotification(t('storage.disksConfigured', `${ok} disco(s) configurado(s) correctamente`), 'success');
    if (fail > 0) showNotification(t('storage.disksConfigError', `${fail} disco(s) con error`), 'error');

    return results;
}

export async function ignoreDiskNotification() {
    hideDiskNotification();
    detectedNewDisks = [];
}

export function startDiskDetectionPolling() {
    stopGlobalPolling();
    checkForNewDisks();
    _pollTimer = setInterval(checkForNewDisks, 30000);
}

export function stopGlobalPolling() {
    if (_pollTimer) {
        clearInterval(_pollTimer);
        _pollTimer = null;
    }
}

export function cleanup() {
    stopGlobalPolling();
    _diskListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _diskListeners = [];
}
