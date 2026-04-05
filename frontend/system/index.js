/**
 * System Module - Node management, updates, and system information
 * Extracted from main.js lines 9853-10016
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { t } from '/frontend/i18n.js';
import { escapeHtml } from '../utils.js';

let _systemListeners = [];

/**
 * Track event listeners for cleanup
 */
function _trackListener(element, event, handler) {
    _systemListeners.push({ element, event, handler });
}

/**
 * Render System Management View
 * Displays node management, system info, and update controls
 */
function renderSystemView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;

    // Format uptime intelligently
    const uptimeSeconds = Number(state.globalStats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }
    const hostname = escapeHtml(state.globalStats.hostname || 'raspberrypi');

    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Management card
    const mgmtCard = document.createElement('div');
    mgmtCard.className = 'glass-card';
    mgmtCard.style.gridColumn = '1 / -1';

    const mgmtTitle = document.createElement('h3');
    mgmtTitle.textContent = 'CM5 ' + t('system.nodeManagement', 'Gestión del Nodo');

    const mgmtDesc = document.createElement('p');
    mgmtDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    mgmtDesc.textContent = t('system.executeActions', 'Ejecutar acciones físicas en el hardware del NAS.');

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 20px; margin-top: 30px;';

    const rebootBtn = document.createElement('button');
    rebootBtn.className = 'btn-primary';
    rebootBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);';
    rebootBtn.textContent = t('system.restartNode', 'Reiniciar Nodo');
    rebootBtn.addEventListener('click', () => systemAction('reboot'));
    _trackListener(rebootBtn, 'click', () => systemAction('reboot'));

    const shutdownBtn = document.createElement('button');
    shutdownBtn.className = 'btn-primary';
    shutdownBtn.style.cssText = 'background: #ef4444; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);';
    shutdownBtn.textContent = t('system.powerOff', 'Apagar');
    shutdownBtn.addEventListener('click', () => systemAction('shutdown'));
    _trackListener(shutdownBtn, 'click', () => systemAction('shutdown'));

    btnContainer.appendChild(rebootBtn);
    btnContainer.appendChild(shutdownBtn);

    mgmtCard.appendChild(mgmtTitle);
    mgmtCard.appendChild(mgmtDesc);
    mgmtCard.appendChild(btnContainer);

    // Info card
    const infoCard = document.createElement('div');
    infoCard.className = 'glass-card';

    const infoTitle = document.createElement('h3');
    infoTitle.textContent = t('system.systemInfo', 'Información del Sistema');

    const uptimeRow = document.createElement('div');
    uptimeRow.className = 'stat-row';
    uptimeRow.innerHTML = `<span>${t('system.logicUptime', 'Tiempo Activo Lógico')}</span> <span>${escapeHtml(uptimeStr)}</span>`;

    const hostnameRow = document.createElement('div');
    hostnameRow.className = 'stat-row';
    hostnameRow.innerHTML = `<span>${t('system.nodeName', 'Nombre del Nodo')}</span> <span>${escapeHtml(hostname)}</span>`;

    infoCard.appendChild(infoTitle);
    infoCard.appendChild(uptimeRow);
    infoCard.appendChild(hostnameRow);

    // Dashboard Update card
    const dashUpdateCard = document.createElement('div');
    dashUpdateCard.className = 'glass-card';

    const dashUpdateTitle = document.createElement('h3');
    dashUpdateTitle.textContent = t('system.dashboardUpdate', 'Actualización HomePiNAS');

    const dashUpdateDesc = document.createElement('p');
    dashUpdateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    dashUpdateDesc.textContent = t('system.dashboardUpdateDesc', 'Buscar e instalar actualizaciones del dashboard desde GitHub.');

    const updateStatus = document.createElement('div');
    updateStatus.id = 'update-status';
    updateStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    updateStatus.innerHTML = `<span class="misc-status-placeholder">${t('system.clickToCheck', 'Haz clic en "Buscar" para verificar...')}</span>`;

    const dashBtnContainer = document.createElement('div');
    dashBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkUpdateBtn = document.createElement('button');
    checkUpdateBtn.className = 'btn-primary';
    checkUpdateBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkUpdateBtn.textContent = t('system.checkUpdates', 'Buscar Actualizaciones');
    checkUpdateBtn.addEventListener('click', checkForUpdates);
    _trackListener(checkUpdateBtn, 'click', checkForUpdates);

    const applyUpdateBtn = document.createElement('button');
    applyUpdateBtn.className = 'btn-primary';
    applyUpdateBtn.id = 'apply-update-btn';
    applyUpdateBtn.style.cssText = 'background: #10b981; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); display: none;';
    applyUpdateBtn.textContent = t('system.installUpdate', 'Instalar Actualización');
    applyUpdateBtn.addEventListener('click', applyUpdate);
    _trackListener(applyUpdateBtn, 'click', applyUpdate);

    dashBtnContainer.appendChild(checkUpdateBtn);
    dashBtnContainer.appendChild(applyUpdateBtn);

    dashUpdateCard.appendChild(dashUpdateTitle);
    dashUpdateCard.appendChild(dashUpdateDesc);
    dashUpdateCard.appendChild(updateStatus);
    dashUpdateCard.appendChild(dashBtnContainer);

    // OS Update card
    const osUpdateCard = document.createElement('div');
    osUpdateCard.className = 'glass-card';

    const osUpdateTitle = document.createElement('h3');
    osUpdateTitle.textContent = t('system.osUpdate', 'Actualización del Sistema');

    const osUpdateDesc = document.createElement('p');
    osUpdateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    osUpdateDesc.textContent = t('system.osUpdateDesc', 'Buscar e instalar actualizaciones de paquetes del sistema operativo.');

    const osStatus = document.createElement('div');
    osStatus.id = 'os-update-status';
    osStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    osStatus.innerHTML = `<span class="misc-status-placeholder">${t('system.clickToCheck', 'Haz clic en "Buscar" para verificar...')}</span>`;

    const osBtnContainer = document.createElement('div');
    osBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkOsBtn = document.createElement('button');
    checkOsBtn.className = 'btn-primary';
    checkOsBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkOsBtn.textContent = t('system.checkOsUpdates', 'Buscar Actualizaciones');
    checkOsBtn.addEventListener('click', checkOsUpdates);
    _trackListener(checkOsBtn, 'click', checkOsUpdates);

    const applyOsBtn = document.createElement('button');
    applyOsBtn.className = 'btn-primary';
    applyOsBtn.id = 'apply-os-update-btn';
    applyOsBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4); display: none;';
    applyOsBtn.textContent = t('system.installOsUpdate', 'Instalar Actualizaciones');
    applyOsBtn.addEventListener('click', applyOsUpdate);
    _trackListener(applyOsBtn, 'click', applyOsUpdate);

    osBtnContainer.appendChild(checkOsBtn);
    osBtnContainer.appendChild(applyOsBtn);

    osUpdateCard.appendChild(osUpdateTitle);
    osUpdateCard.appendChild(osUpdateDesc);
    osUpdateCard.appendChild(osStatus);
    osUpdateCard.appendChild(osBtnContainer);

    // Update grid (2 columns)
    const updateGrid = document.createElement('div');
    updateGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px;';
    dashUpdateCard.style.width = 'auto';
    osUpdateCard.style.width = 'auto';
    updateGrid.appendChild(dashUpdateCard);
    updateGrid.appendChild(osUpdateCard);

    dashboardContent.appendChild(mgmtCard);
    dashboardContent.appendChild(infoCard);
    dashboardContent.appendChild(updateGrid);
}

/**
 * System action handler (reboot, shutdown, etc.)
 * @param {string} action - The action to perform
 */
async function systemAction(action) {
    const message = action === 'reboot'
        ? t('system.confirmReboot', '¿Estás seguro de que deseas reiniciar el sistema?')
        : t('system.confirmShutdown', '¿Estás seguro de que deseas apagar el sistema?');

    const confirmed = await showConfirmModal(message);
    if (!confirmed) return;

    try {
        const response = await authFetch('/api/system/action', {
            method: 'POST',
            body: JSON.stringify({ action })
        });

        if (response.ok) {
            const msg = action === 'reboot'
                ? t('system.rebooting', 'Sistema reiniciando...')
                : t('system.shuttingDown', 'Sistema apagándose...');
            showNotification(msg, 'info');
        } else {
            showNotification(t('common.error', 'Error'), 'error');
        }
    } catch (error) {
        showNotification(t('common.error', 'Error: ' + error.message), 'error');
    }
}

/**
 * Check for dashboard updates
 */
async function checkForUpdates() {
    try {
        const statusDiv = document.getElementById('update-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<span class="misc-status-placeholder">${t('system.checking', 'Verificando...')}</span>`;
        }

        const response = await authFetch('/api/system/dashboard-updates');
        const data = await response.json();

        if (statusDiv) {
            if (data.hasUpdate) {
                statusDiv.innerHTML = `<span style="color: #10b981;">${t('system.updateAvailable', 'Actualización disponible: v' + data.latestVersion)}</span>`;
                const btn = document.getElementById('apply-update-btn');
                if (btn) btn.style.display = 'block';
            } else {
                statusDiv.innerHTML = `<span style="color: #6b7280;">${t('system.upToDate', 'Sistema actualizado')}</span>`;
            }
        }
    } catch (error) {
        const statusDiv = document.getElementById('update-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<span style="color: #ef4444;">${t('common.error', 'Error al verificar')}</span>`;
        }
    }
}

/**
 * Apply dashboard update
 */
async function applyUpdate() {
    const confirmed = await showConfirmModal(t('system.confirmDashboardUpdate', '¿Instalar actualización del dashboard?'));
    if (!confirmed) return;

    try {
        const response = await authFetch('/api/system/apply-dashboard-update', { method: 'POST' });
        if (response.ok) {
            showNotification(t('system.updatingDashboard', 'Actualizando dashboard...'), 'info');
            setTimeout(() => location.reload(), 2000);
        } else {
            showNotification(t('common.error', 'Error'), 'error');
        }
    } catch (error) {
        showNotification(t('common.error', 'Error: ' + error.message), 'error');
    }
}

/**
 * Check for OS updates
 */
async function checkOsUpdates() {
    try {
        const statusDiv = document.getElementById('os-update-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<span class="misc-status-placeholder">${t('system.checking', 'Verificando...')}</span>`;
        }

        const response = await authFetch('/api/system/os-updates');
        const data = await response.json();

        if (statusDiv) {
            if (data.hasUpdate) {
                statusDiv.innerHTML = `<span style="color: #10b981;">${data.updateCount} ${t('system.updatesAvailable', 'actualizaciones disponibles')}</span>`;
                const btn = document.getElementById('apply-os-update-btn');
                if (btn) btn.style.display = 'block';
            } else {
                statusDiv.innerHTML = `<span style="color: #6b7280;">${t('system.osUpToDate', 'Sistema operativo actualizado')}</span>`;
            }
        }
    } catch (error) {
        const statusDiv = document.getElementById('os-update-status');
        if (statusDiv) {
            statusDiv.innerHTML = `<span style="color: #ef4444;">${t('common.error', 'Error al verificar')}</span>`;
        }
    }
}

/**
 * Apply OS updates
 */
async function applyOsUpdate() {
    const confirmed = await showConfirmModal(t('system.confirmOsUpdate', '¿Instalar actualizaciones del sistema operativo? Esto puede tomar varios minutos.'));
    if (!confirmed) return;

    try {
        const response = await authFetch('/api/system/apply-os-updates', { method: 'POST' });
        if (response.ok) {
            showNotification(t('system.updatingOS', 'Actualizando sistema operativo...'), 'info');
        } else {
            showNotification(t('common.error', 'Error'), 'error');
        }
    } catch (error) {
        showNotification(t('common.error', 'Error: ' + error.message), 'error');
    }
}

/**
 * Cleanup function - remove all event listeners
 */
export function cleanup() {
    _systemListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _systemListeners = [];
}

export async function render(container) {
    await renderSystemView();
}

export { renderSystemView };
