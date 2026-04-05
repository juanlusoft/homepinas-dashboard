/**
 * NETWORK MODULE
 * Renders and applies network interface configuration.
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { t } from '/frontend/i18n.js';

const API_BASE = `${window.location.origin}/api`;
let _networkListeners = [];

function _trackListener(element, event, handler) {
    element.addEventListener(event, handler);
    _networkListeners.push({ element, event, handler });
}

function _getDashboardContent() {
    return document.getElementById('dashboard-content');
}

function _renderInterfaceCard(iface) {
    const card = document.createElement('div');
    card.className = 'glass-card interface-card';

    const isConnected = iface.status === 'connected';
    const isDhcp = Boolean(iface.dhcp);

    card.innerHTML = `
        <div class="interface-header" style="display:flex;justify-content:space-between;align-items:center;gap:12px;">
            <div>
                <h4 style="margin:0;">${escapeHtml(iface.name || iface.id || t('common.unknown', 'Desconocido'))}</h4>
                <small style="color:var(--text-dim);">${escapeHtml(iface.id || 'N/A')}</small>
            </div>
            <span style="font-size:0.8rem;color:${isConnected ? '#10b981' : '#94a3b8'};">${isConnected ? t('terminal.connected', 'CONECTADO') : t('terminal.disconnected', 'DESCONECTADO')}</span>
        </div>

        <div style="display:grid;gap:10px;margin-top:14px;">
            <label style="display:flex;align-items:center;gap:8px;">
                <input type="checkbox" data-role="dhcp" ${isDhcp ? 'checked' : ''}>
                <span>DHCP</span>
            </label>
            <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
                <input data-role="ip" type="text" value="${escapeHtml(iface.ip || '')}" placeholder="IP" ${isDhcp ? 'disabled' : ''}>
                <input data-role="subnet" type="text" value="${escapeHtml(iface.subnet || '255.255.255.0')}" placeholder="M�scara" ${isDhcp ? 'disabled' : ''}>
                <input data-role="gateway" type="text" value="${escapeHtml(iface.gateway || '')}" placeholder="Gateway" ${isDhcp ? 'disabled' : ''}>
                <input data-role="dns" type="text" value="${escapeHtml(iface.dns || '')}" placeholder="DNS" ${isDhcp ? 'disabled' : ''}>
            </div>
            <button class="btn-primary" data-role="apply">${t('common.apply', 'Aplicar')}</button>
        </div>
    `;

    const dhcpInput = card.querySelector('[data-role="dhcp"]');
    const staticFields = [
        card.querySelector('[data-role="ip"]'),
        card.querySelector('[data-role="subnet"]'),
        card.querySelector('[data-role="gateway"]'),
        card.querySelector('[data-role="dns"]')
    ];
    const applyBtn = card.querySelector('[data-role="apply"]');

    _trackListener(dhcpInput, 'change', () => {
        const useDhcp = dhcpInput.checked;
        staticFields.forEach(f => { if (f) f.disabled = useDhcp; });
    });

    _trackListener(applyBtn, 'click', async () => {
        applyBtn.disabled = true;
        const payload = {
            interface: iface.id,
            dhcp: dhcpInput.checked,
            ip: staticFields[0]?.value?.trim() || '',
            subnet: staticFields[1]?.value?.trim() || '',
            gateway: staticFields[2]?.value?.trim() || '',
            dns: staticFields[3]?.value?.trim() || ''
        };

        try {
            const res = await authFetch(`${API_BASE}/network/configure`, {
                method: 'POST',
                body: JSON.stringify(payload)
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || t('common.error', 'Error'));
            showNotification(data.message || t('network.configSaved', 'Configuraci�n aplicada'), 'success');
        } catch (e) {
            showNotification(e.message || t('common.error', 'Error'), 'error');
        } finally {
            applyBtn.disabled = false;
        }
    });

    return card;
}

export async function renderNetworkManager() {
    const dashboardContent = _getDashboardContent();
    if (!dashboardContent) return;

    dashboardContent.innerHTML = `<div class="glass-card" style="grid-column:1 / -1;"><h3>${t('common.loading', 'Cargando...')}</h3></div>`;

    try {
        const res = await authFetch(`${API_BASE}/network/interfaces`);
        if (!res.ok) throw new Error('Failed to fetch interfaces');

        const interfaces = await res.json();
        state.network.interfaces = Array.isArray(interfaces) ? interfaces : [];

        dashboardContent.innerHTML = '';
        const title = document.createElement('h3');
        title.textContent = `CM5 ${t('network.adapters', 'Adaptadores de Red')}`;
        title.style.gridColumn = '1 / -1';
        dashboardContent.appendChild(title);

        if (!state.network.interfaces.length) {
            const empty = document.createElement('div');
            empty.className = 'glass-card';
            empty.style.gridColumn = '1 / -1';
            empty.textContent = t('network.noInterfaces', 'No se detectaron interfaces');
            dashboardContent.appendChild(empty);
            return;
        }

        state.network.interfaces.forEach((iface) => {
            dashboardContent.appendChild(_renderInterfaceCard(iface));
        });
    } catch (e) {
        dashboardContent.innerHTML = `<div class="glass-card" style="grid-column:1 / -1;"><h3>${t('common.error', 'Error al cargar datos de red')}</h3><p>${escapeHtml(e.message || '')}</p></div>`;
    }
}

export async function render(container) {
    await renderNetworkManager();
}

export function cleanup() {
    _networkListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _networkListeners = [];
}
