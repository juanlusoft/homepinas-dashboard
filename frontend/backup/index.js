/**
 * Backup Module - Cloud and Local Backup Management
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal, celebrateWithConfetti } from '../notifications.js';
import { state } from '../state.js';
import { t } from '../../i18n.js';
import { escapeHtml } from '../utils.js';

let _backupListeners = [];

function _trackListener(element, event, handler) {
    _backupListeners.push({ element, event, handler });
}

// ════════════════════════════════════════════════════════════════════════════════
// BACKUP VIEW
// ════════════════════════════════════════════════════════════════════════════════

async function renderBackupView() {
    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // === Backup Jobs Card ===
    const backupCard = document.createElement('div');
    backupCard.className = 'glass-card';
    backupCard.style.cssText = 'grid-column: 1 / -1;';

    const bHeader = document.createElement('div');
    bHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const bTitle = document.createElement('h3');
    bTitle.textContent = '💾 Trabajos de Backup';
    const addJobBtn = document.createElement('button');
    addJobBtn.className = 'btn-primary btn-sm';
    addJobBtn.textContent = '+ Nuevo Backup';
    addJobBtn.addEventListener('click', () => showBackupJobForm());
    bHeader.appendChild(bTitle);
    bHeader.appendChild(addJobBtn);
    backupCard.appendChild(bHeader);

    const jobsList = document.createElement('div');
    jobsList.id = 'backup-jobs-list';
    backupCard.appendChild(jobsList);
    container.appendChild(backupCard);

    // === Task Scheduler Card ===
    const schedCard = document.createElement('div');
    schedCard.className = 'glass-card';
    schedCard.style.cssText = 'grid-column: 1 / -1;';

    const sHeader = document.createElement('div');
    sHeader.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;';
    const sTitle = document.createElement('h3');
    sTitle.textContent = '⏰ Programador de Tareas';
    const addTaskBtn = document.createElement('button');
    addTaskBtn.className = 'btn-primary btn-sm';
    addTaskBtn.textContent = '+ Nueva Tarea';
    addTaskBtn.addEventListener('click', () => showTaskForm());
    sHeader.appendChild(sTitle);
    sHeader.appendChild(addTaskBtn);
    schedCard.appendChild(sHeader);

    const tasksList = document.createElement('div');
    tasksList.id = 'scheduler-tasks-list';
    schedCard.appendChild(tasksList);
    container.appendChild(schedCard);

    dashboardContent.appendChild(container);
    await loadBackupJobs();
    await loadSchedulerTasks();
}


// ════════════════════════════════════════════════════════════════════════════════
// ACTIVE BACKUP VIEW
// ════════════════════════════════════════════════════════════════════════════════

async function renderActiveBackupView() {
    const container = document.createElement('div');
    container.className = 'abk-container';

    // ── Stats summary card ────────────────────────────────────────────────
    const statsCard = document.createElement('div');
    statsCard.className = 'glass-card abk-stats-card';
    statsCard.innerHTML = `
        <div class="abk-stats-header">
            <div class="abk-stats-title-group">
                <h3 class="abk-stats-title">🖥️ Active Backup</h3>
                <p class="abk-stats-subtitle">Backups automáticos de equipos remotos — el agente es invisible para el usuario</p>
            </div>
            <div class="abk-header-actions"><a href="/downloads/HomePiNAS-Agent-v2.tar.gz" class="btn-secondary btn-sm" download>⬇️ Descargar Agente</a> <a href="/docs/active-backup-agent-install.html" target="_blank" class="btn-secondary btn-sm">📖 Guía Instalación</a> <a href="/docs/active-backup-restore.html" target="_blank" class="btn-secondary btn-sm">🔧 Guía Restauración</a> <button class="btn-primary btn-sm" id="ab-add-btn">＋ Añadir Dispositivo</button></div>
        </div>
        <div class="abk-stats-grid">
            <div class="abk-stat-item">
                <span class="abk-stat-num" id="ab-stat-total">—</span>
                <span class="abk-stat-label">Dispositivos</span>
            </div>
            <div class="abk-stat-item">
                <span class="abk-stat-num abk-stat-ok" id="ab-stat-online">—</span>
                <span class="abk-stat-label">En línea</span>
            </div>
            <div class="abk-stat-item">
                <span class="abk-stat-num abk-stat-warn" id="ab-stat-pending-count">—</span>
                <span class="abk-stat-label">Pendientes</span>
            </div>
            <div class="abk-stat-item">
                <span class="abk-stat-num abk-stat-dim" id="ab-stat-last">—</span>
                <span class="abk-stat-label">Último backup</span>
            </div>
        </div>
    `;
    container.appendChild(statsCard);

    // ── Main card with tabs ───────────────────────────────────────────────
    const mainCard = document.createElement('div');
    mainCard.className = 'glass-card abk-main-card';
    mainCard.innerHTML = `
        <div class="abk-tab-bar">
            <button class="abk-tab abk-tab-active" data-tab="devices">
                <span class="abk-tab-icon">🖥️</span><span>Dispositivos</span>
            </button>
            <button class="abk-tab" data-tab="pending">
                <span class="abk-tab-icon">🔔</span><span>Pendientes</span>
                <span class="abk-tab-badge" id="ab-pending-badge" style="display:none">0</span>
            </button>
            <button class="abk-tab" data-tab="recovery">
                <span class="abk-tab-icon">🔧</span><span>USB Recovery</span>
            </button>
        </div>

        <div id="ab-tab-devices" class="abk-tab-pane">
            <div id="ab-devices-grid" class="abk-devices-grid">
                <div class="abk-loading-text">Cargando dispositivos...</div>
            </div>
        </div>

        <div id="ab-tab-pending" class="abk-tab-pane" style="display:none">
            <div id="ab-pending-agents" class="abk-pending-pane"></div>
        </div>

        <div id="ab-tab-recovery" class="abk-tab-pane" style="display:none">
            <div class="abk-recovery-pane">
                <div class="abk-recovery-pane-header">
                    <h4 class="abk-recovery-title">🔧 USB de Recuperación</h4>
                    <p class="abk-recovery-subtitle">Crea un USB bootable para restaurar backups sin necesitar sistema operativo</p>
                </div>
                <div id="ab-recovery-status" class="abk-recovery-status">
                    <p class="vpn-loading-placeholder">Cargando...</p>
                </div>
            </div>
        </div>
    `;
    container.appendChild(mainCard);

    // ── Detail panel (shown when a device row is opened) ─────────────────
    const detailCard = document.createElement('div');
    detailCard.className = 'glass-card abk-detail-panel';
    detailCard.id = 'ab-detail-panel';
    container.appendChild(detailCard);

    dashboardContent.appendChild(container);

    // Tab switching
    mainCard.querySelectorAll('.abk-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            mainCard.querySelectorAll('.abk-tab').forEach(t => t.classList.remove('abk-tab-active'));
            mainCard.querySelectorAll('.abk-tab-pane').forEach(p => { p.style.display = 'none'; });
            tab.classList.add('abk-tab-active');
            const pane = document.getElementById('ab-tab-' + tab.dataset.tab);
            if (pane) pane.style.display = '';
        });
    });

    statsCard.querySelector('#ab-add-btn').addEventListener('click', () => showAddDeviceForm());

    await loadABPendingAgents();
    await loadABDevices();
    await loadRecoveryStatus();
}


/**
 * Cleanup function
 */
export function cleanup() {
    _backupListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _backupListeners = [];
}

export async function render(container) {
    await renderBackupView();
}

export { renderBackupView, renderActiveBackupView };
