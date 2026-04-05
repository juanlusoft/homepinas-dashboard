/**
 * STORAGE WIZARD MODULE — Entry Point / Orchestrator
 * ════════════════════════════════════════════════════════════════════════════════
 * Storage pool configuration, dashboard, and management.
 *
 * Sub-modules:
 *   wizard-state.js           — shared wizardState + localStorage helpers
 *   wizard-disk-selection.js  — disk card UI, selection handling, filtering
 *   wizard-navigation.js      — step navigation, progress dots, summary step
 *   wizard-pool.js            — pool creation API, task progress, legacy modal
 *   wizard-storage-dashboard.js — renderStorageDashboard (storage telemetry view)
 */

import { authFetch, saveSession } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { escapeHtml, formatBytes, formatUptime } from '../utils.js';
import { navigateTo } from '../router.js';
import { renderDockerManager } from '../docker/index.js';
import { renderFilesView } from '../files/index.js';
import { renderTerminalView } from '../terminal/index.js';
import { renderNetworkManager } from '../network/index.js';
import { renderBackupView, renderActiveBackupView } from '../backup/index.js';
import { renderActiveDirectoryView } from '../active-directory/index.js';
import { renderCloudSyncView } from '../cloud-sync/index.js';
import { renderCloudBackupView } from '../cloud-backup/index.js';
import { renderVPNView } from '../vpn/index.js';
import { renderHomeStoreView } from '../homestore/index.js';
import { renderLogsView } from '../logs/index.js';
import { renderUsersView } from '../users/index.js';
import { renderSystemView } from '../system/index.js';
import { renderUPSSection } from '../ups/index.js';
import { t } from '/frontend/i18n.js';

// Sub-module imports
import { wizardState, loadWizardState, saveWizardState, clearWizardState } from './wizard-state.js';
import {
    getDiskIcon,
    populateWizardDiskLists,
    restoreWizardSelections,
    updateParityDiskOptions
} from './wizard-disk-selection.js';
import {
    setupWizardNavigation,
    navigateWizard,
    updateWizardProgress
} from './wizard-navigation.js';
import { createStoragePool, showProgressModal, hideProgressModal, updateProgressStep, updateSyncProgress, pollSyncProgress } from './wizard-pool.js';
import { renderStorageDashboard } from './wizard-storage-dashboard.js';

// ════════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ════════════════════════════════════════════════════════════════════════════════

const _moduleListeners = [];
const API_BASE = `${window.location.origin}/api`;
const dashboardContent = document.getElementById('dashboard-content');

function switchView(viewName) {
    if (typeof window.switchView === 'function') {
        window.switchView(viewName);
    }
}

function _trackListener(element, event, handler) {
    _moduleListeners.push({ element, event, handler });
}

// ════════════════════════════════════════════════════════════════════════════════
// STORAGE WIZARD — Initialization
// ════════════════════════════════════════════════════════════════════════════════

// Initialize the storage wizard
export function initStorageSetup() {
    console.log('[Wizard] Initializing storage setup wizard');

    // Setup network config toggle in wizard
    const netToggle = document.getElementById('wizard-net-toggle');
    const netForm = document.getElementById('wizard-network-form');
    if (netToggle && netForm) {
        netToggle.addEventListener('click', async () => {
            const isOpen = netForm.style.display !== 'none';
            netForm.style.display = isOpen ? 'none' : 'block';
            netToggle.textContent = isOpen ? '🌐 Configurar Red (opcional) ▸' : '🌐 Configurar Red (opcional) ▾';
            if (!isOpen && !netForm.dataset.loaded) {
                try {
                    const res = await authFetch(`${API_BASE}/network/interfaces`);
                    if (res.ok) {
                        const ifaces = await res.json();
                        const container = document.getElementById('wizard-net-iface-container');
                        if (container && ifaces.length > 0) {
                            const iface = ifaces[0]; // Primary interface
                            if (!iface || !iface.id) {
                                container.innerHTML = '<p style="color:var(--text-secondary);">⚠️ No se detectó interfaz de red válida</p>';
                                netForm.dataset.loaded = '1';
                                return;
                            }
                            const interfaceId = iface.id; // Store in local const for closure safety
                            const isDhcp = iface.dhcp !== false;
                            container.innerHTML = `
                                <div class="input-group">
                                    <label style="display:flex;align-items:center;gap:8px;margin-bottom:12px;">
                                        <input type="checkbox" id="wizard-net-dhcp" ${isDhcp ? 'checked' : ''}>
                                        DHCP (automático)
                                    </label>
                                </div>
                                <div id="wizard-net-static" style="display:${isDhcp ? 'none' : 'block'}">
                                    <div class="input-group"><input type="text" id="wizard-net-ip" value="${escapeHtml(iface.ip || '')}" placeholder=" "><label>IP</label></div>
                                    <div class="input-group"><input type="text" id="wizard-net-subnet" value="${escapeHtml(iface.subnet || '255.255.255.0')}" placeholder=" "><label>Máscara</label></div>
                                    <div class="input-group"><input type="text" id="wizard-net-gw" value="${escapeHtml(iface.gateway || '')}" placeholder=" "><label>Puerta de Enlace</label></div>
                                    <div class="input-group"><input type="text" id="wizard-net-dns" value="${escapeHtml(iface.dns || '')}" placeholder=" "><label>DNS</label></div>
                                </div>
                                <button class="wizard-btn wizard-btn-next" id="wizard-net-save" style="margin-top:14px;padding:12px 24px;font-size:1rem;font-weight:600;background:var(--accent);color:#fff;border:none;border-radius:8px;cursor:pointer;width:100%;transition:opacity 0.2s;">🌐 Aplicar Configuración de Red</button>
                                <span id="wizard-net-status" style="display:block;margin-top:8px;text-align:center;"></span>
                            `;
                            document.getElementById('wizard-net-dhcp').addEventListener('change', (e) => {
                                document.getElementById('wizard-net-static').style.display = e.target.checked ? 'none' : 'block';
                            });
                            document.getElementById('wizard-net-save').addEventListener('click', async () => {
                                const statusEl = document.getElementById('wizard-net-status');
                                const isDhcpChecked = document.getElementById('wizard-net-dhcp').checked;
                                const config = { dhcp: isDhcpChecked };
                                if (!isDhcpChecked) {
                                    config.ip = document.getElementById('wizard-net-ip').value.trim();
                                    config.subnet = document.getElementById('wizard-net-subnet').value.trim();
                                    config.gateway = document.getElementById('wizard-net-gw').value.trim();
                                    config.dns = document.getElementById('wizard-net-dns').value.trim();
                                }
                                try {
                                    statusEl.textContent = '⏳ Aplicando...';
                                    const r = await authFetch(`${API_BASE}/network/configure`, {
                                        method: 'POST',
                                        body: JSON.stringify({ id: interfaceId, config })
                                    });
                                    const d = await r.json();
                                    if (r.ok) {
                                        statusEl.textContent = '✅ Aplicado';
                                        if (!isDhcpChecked && config.ip && config.ip !== window.location.hostname) {
                                            setTimeout(async () => {
                                                const goToNew = await showConfirmModal(
                                                    t('network.ipChanged', 'IP cambiada'),
                                                    t('network.goToNewIP', `IP cambiada a ${config.ip}. ¿Ir a la nueva dirección?`),
                                                    t('common.yes', 'Sí'),
                                                    t('common.no', 'No')
                                                );
                                                if (goToNew) {
                                                    const url = new URL(window.location);
                                                    url.hostname = config.ip;
                                                    window.location.href = url.toString();
                                                }
                                            }, 1000);
                                        }
                                    } else {
                                        statusEl.textContent = '❌ ' + (d.error || 'Error');
                                    }
                                } catch (err) {
                                    statusEl.textContent = '❌ ' + err.message;
                                }
                            });
                            netForm.dataset.loaded = '1';
                        }
                    }
                } catch (e) {
                    console.error('Wizard network load error:', e);
                }
            }
        });
    }

    // Load any saved state
    const hasSavedState = loadWizardState();

    // IMPORTANT: Reset all wizard steps to ensure only one is active
    document.querySelectorAll('.wizard-step').forEach(step => {
        step.classList.remove('active', 'exit');
    });

    // Set only step 1 as active initially (or saved step)
    const targetStep = (hasSavedState && wizardState.currentStep >= 1 && wizardState.currentStep <= 5)
        ? wizardState.currentStep
        : 1;
    const targetStepEl = document.querySelector(`.wizard-step[data-step="${targetStep}"]`);
    if (targetStepEl) {
        targetStepEl.classList.add('active');
    }
    wizardState.currentStep = targetStep;
    updateWizardProgress(targetStep);

    // Start disk detection
    detectDisksForWizard();

    // Setup wizard navigation
    setupWizardNavigation();

    // Bind pool creation button (requires import from wizard-pool.js)
    document.getElementById('wizard-create-pool')?.addEventListener('click', createStoragePool);

    setupNetworkConfiguration();
}

// Legacy hook kept for compatibility with previous wizard flow.
// Network setup is already initialized inside initStorageSetup().
function setupNetworkConfiguration() {
    return;
}

// ════════════════════════════════════════════════════════════════════════════════
// DISK DETECTION
// ════════════════════════════════════════════════════════════════════════════════

// Detect disks and populate the wizard
async function detectDisksForWizard() {
    const detectionContainer = document.getElementById('wizard-disk-detection');
    if (!detectionContainer) return;

    // Show loading spinner
    detectionContainer.innerHTML = `
        <div class="wizard-detecting">
            <div class="wizard-spinner"></div>
            <p class="wizard-detecting-text">${t('wizard.detectingDisks', 'Detectando discos conectados...')}</p>
        </div>
    `;

    try {
        const res = await authFetch(`${API_BASE}/system/disks`);
        if (!res.ok) throw new Error('Failed to fetch disks');

        wizardState.disks = await res.json();
        state.disks = wizardState.disks; // Keep global state in sync

        // Short delay for UX (show the spinner briefly)
        await new Promise(r => setTimeout(r, 800));

        if (wizardState.disks.length === 0) {
            detectionContainer.innerHTML = `
                <div class="wizard-no-disks">
                    <div class="wizard-no-disks-icon">💿</div>
                    <p>${t('wizard.noDisks', 'No se detectaron discos disponibles')}</p>
                    <button class="wizard-btn wizard-btn-next storage-retry-btn" data-action="retry-detect">
                        🔄 ${t('wizard.retry', 'Reintentar')}
                    </button>
                </div>
            `;
            detectionContainer.querySelector('[data-action="retry-detect"]')?.addEventListener('click', () => detectDisksForWizard());
            return;
        }

        // Show detected disks summary
        detectionContainer.innerHTML = `
            <div class="storage-detection-success">
                <div class="storage-success-icon">✅</div>
                <p class="storage-detection-summary">
                    <strong>${wizardState.disks.length}</strong> ${t('wizard.disksDetected', 'disco(s) detectado(s)')}
                </p>
                <div class="storage-detected-disks">
                    ${wizardState.disks.map(d => `
                        <div class="storage-disk-badge">
                            ${getDiskIcon(d.type)} ${escapeHtml(d.model || d.id)} <span class="storage-disk-size-highlight">${escapeHtml(d.size)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        // Enable next button
        const nextBtn = document.getElementById('wizard-next-1');
        if (nextBtn) nextBtn.disabled = false;

        // Populate disk lists for other steps
        populateWizardDiskLists();

        // Restore selections if we have saved state
        if (wizardState.selectedDataDisks.length > 0 || wizardState.selectedParityDisk || wizardState.selectedCacheDisk) {
            restoreWizardSelections();
        }

    } catch (e) {
        console.error('[Wizard] Disk detection error:', e);
        detectionContainer.innerHTML = `
            <div class="wizard-no-disks">
                <div class="wizard-no-disks-icon">❌</div>
                <p>${t('wizard.detectionError', 'Error al detectar discos')}</p>
                <button class="wizard-btn wizard-btn-next storage-retry-btn" data-action="retry-detect">
                    🔄 ${t('wizard.retry', 'Reintentar')}
                </button>
            </div>
        `;
        detectionContainer.querySelector('[data-action="retry-detect"]')?.addEventListener('click', () => detectDisksForWizard());
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY SAVE STORAGE BUTTON (role-selector UI)
// ════════════════════════════════════════════════════════════════════════════════

const saveStorageBtn = document.getElementById('save-storage-btn');
if (saveStorageBtn) {
    saveStorageBtn.addEventListener('click', async () => {
        const selections = [];
        document.querySelectorAll('.role-selector').forEach(sel => {
            const diskId = sel.dataset.disk;
            const activeBtn = sel.querySelector('.role-btn.active');
            const role = activeBtn ? activeBtn.dataset.role : 'none';
            if (role !== 'none') {
                selections.push({
                    id: diskId,
                    role,
                    format: true
                });
            }
        });

        const dataDisks = selections.filter(s => s.role === 'data');
        const parityDisks = selections.filter(s => s.role === 'parity');

        if (dataDisks.length === 0) {
            showNotification(t('wizard.assignDataDisk', 'Debes asignar al menos un disco como "Datos" para crear un pool.'), 'warning');
            return;
        }

        // Parity is optional, but if selected, must be >= largest data disk
        if (parityDisks.length > 0) {
            // Helper function to parse disk size to bytes
            const parseSize = (sizeStr) => {
                if (!sizeStr) return 0;
                const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
                if (!match) return 0;
                const num = parseFloat(match[1]);
                const unit = (match[2] || 'B').toUpperCase();
                const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
                return num * (multipliers[unit] || 1);
            };

            // Get disk sizes from state
            const getDiskSize = (diskId) => {
                const disk = state.disks.find(d => d.id === diskId);
                return disk ? parseSize(disk.size) : 0;
            };

            const largestDataSize = Math.max(...dataDisks.map(d => getDiskSize(d.id)));
            const smallestParitySize = Math.min(...parityDisks.map(d => getDiskSize(d.id)));

            if (smallestParitySize < largestDataSize) {
                showNotification(t('wizard.parityTooSmall', 'El disco de paridad debe ser igual o mayor que el disco de datos más grande.'), 'warning');
                return;
            }
        }

        const diskList = selections.map(s => `${s.id} (${s.role})`).join(', ');
        const confirmed = await showConfirmModal(t('storage.formatDisks', 'Formatear discos'), `Se formatearán: ${diskList}\n\n¡Todos los datos serán BORRADOS!`);
        if (!confirmed) return;

        saveStorageBtn.disabled = true;
        showProgressModal();

        try {
            // Step 1: Format
            updateProgressStep('format', 'active');
            await new Promise(r => setTimeout(r, 500));

            // Call configure endpoint
            const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
                method: 'POST',
                body: JSON.stringify({ disks: selections })
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || 'Configuration failed');
            }

            // Update steps based on results
            updateProgressStep('format', 'completed');
            await new Promise(r => setTimeout(r, 300));

            updateProgressStep('mount', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mount', 'completed');

            updateProgressStep('snapraid', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('snapraid', 'completed');

            updateProgressStep('mergerfs', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('mergerfs', 'completed');

            updateProgressStep('fstab', 'active');
            await new Promise(r => setTimeout(r, 500));
            updateProgressStep('fstab', 'completed');

            // Step 6: SnapRAID initial sync
            updateProgressStep('sync', 'active');
            updateSyncProgress(0, 'Starting initial sync...');

            // Start sync in background
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for progress
                const syncResult = await pollSyncProgress();

                if (!syncResult.success) {
                    console.warn('Sync warning:', syncResult.error);
                    // Don't fail the whole process, sync can be run later
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Sync will complete in background');
                }
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateProgressStep('sync', 'completed');
                updateSyncProgress(100, 'Sync scheduled for later');
            }

            state.storageConfig = selections;

            // Update progress message
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                // SECURITY: Escape poolMount to prevent XSS
                progressMsg.innerHTML = `✅ <strong>Storage Pool Created!</strong><br>Pool mounted at: ${escapeHtml(data.poolMount)}`;
            }

            // Show continue button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const continueBtn = document.createElement('button');
                continueBtn.className = 'btn-primary';
                continueBtn.textContent = t('progress.continueToDashboard', 'Continuar al Panel');
                continueBtn.onclick = () => {
                    hideProgressModal();
                    if (state.sessionId) {
                        state.isAuthenticated = true;
                        switchView('dashboard');
                    } else {
                        switchView('login');
                    }
                };
                progressFooter.appendChild(continueBtn);
            }

        } catch (e) {
            console.error('Storage config error:', e);
            const progressMsg = document.getElementById('progress-message');
            if (progressMsg) {
                progressMsg.innerHTML = `❌ <strong>${t('progress.configurationFailed', 'Configuración Fallida')}:</strong><br>${escapeHtml(e.message)}`;
            }

            // Add retry button
            const progressFooter = document.querySelector('.progress-footer');
            if (progressFooter) {
                progressFooter.classList.add('complete');
                const retryBtn = document.createElement('button');
                retryBtn.className = 'btn-primary';
                retryBtn.textContent = t('progress.closeAndRetry', 'Cerrar y Reintentar');
                retryBtn.onclick = () => {
                    hideProgressModal();
                    saveStorageBtn.disabled = false;
                };
                progressFooter.appendChild(retryBtn);
            }
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// AUTHENTICATION
// ════════════════════════════════════════════════════════════════════════════════

const loginForm = document.getElementById('login-form');
if (loginForm) {
    // Track pending 2FA state
    let pending2FAToken = null;

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const totpCode = document.getElementById('login-totp-code')?.value.trim();
        const btn = e.target.querySelector('button[type="submit"]');
        const totpGroup = document.getElementById('totp-input-group');

        btn.textContent = t('auth.hardwareAuth', 'Autenticando...');
        btn.disabled = true;

        try {
            // If we have a pending 2FA token, complete 2FA verification
            if (pending2FAToken && totpCode) {
                const res = await fetch(`${API_BASE}/login/2fa`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ pendingToken: pending2FAToken, totpCode })
                });
                const data = await res.json();

                if (!res.ok || !data.success) {
                    showNotification(data.message || t('auth.invalid2FA', 'Código 2FA incorrecto'), 'error');
                    btn.textContent = t('auth.verify2FA', 'Verificar 2FA');
                    btn.disabled = false;
                    return;
                }

                // 2FA verified - save session and proceed
                saveSession(data.sessionId, data.csrfToken);
                state.isAuthenticated = true;
                state.user = data.user;
                pending2FAToken = null;
                if (totpGroup) totpGroup.style.display = 'none';
                switchView('dashboard');
                return;
            }

            // Regular login
            const res = await fetch(`${API_BASE}/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                showNotification(data.message || t('common.error', 'Error de seguridad: Credenciales rechazadas.'), 'error');
                btn.textContent = t('auth.accessGateway', 'Acceder al Sistema');
                btn.disabled = false;
                return;
            }

            // Check if 2FA is required
            if (data.requires2FA) {
                pending2FAToken = data.pendingToken;
                if (totpGroup) {
                    totpGroup.style.display = 'block';
                    document.getElementById('login-totp-code').focus();
                }
                btn.textContent = t('auth.verify2FA', 'Verificar 2FA');
                btn.disabled = false;
                return;
            }

            // No 2FA - save session and proceed
            if (data.sessionId) {
                saveSession(data.sessionId, data.csrfToken);
            }

            state.isAuthenticated = true;
            state.user = data.user;
            switchView('dashboard');
        } catch (e) {
            console.error('Login error:', e);
            showNotification(t('common.error', 'Servidor de seguridad no disponible o conexión interrumpida'), 'error');
            btn.textContent = t('auth.accessGateway', 'Acceder al Sistema');
            btn.disabled = false;
        }
    });
}

// ════════════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ════════════════════════════════════════════════════════════════════════════════

// Navigation - supports multiple nav-links groups (Synology-style layout)
const allNavLinks = document.querySelectorAll('.nav-links li[data-view]');

function activateNavItem(link) {
    // Remove active from ALL nav items across all groups
    allNavLinks.forEach(l => {
        l.classList.remove('active');
        l.setAttribute('aria-selected', 'false');
    });
    link.classList.add('active');
    link.setAttribute('aria-selected', 'true');
    const view = link.dataset.view;

    // Update URL
    const path = view === 'dashboard' ? '/' : '/' + view;
    navigateTo(path);

    const viewTitle = document.getElementById('view-title');
    if (viewTitle) viewTitle.textContent = view || 'HomePiNAS';
    renderContent(view);
    if (typeof window.updateHeaderIPVisibility === 'function') {
        window.updateHeaderIPVisibility();
    }
}

allNavLinks.forEach(link => {
    link.addEventListener('click', () => activateNavItem(link));
    // Keyboard: Enter or Space activates nav item
    link.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            activateNavItem(link);
        }
        // Arrow key navigation within sidebar
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = Array.from(allNavLinks);
            const idx = items.indexOf(link);
            const next = e.key === 'ArrowDown'
                ? items[(idx + 1) % items.length]
                : items[(idx - 1 + items.length) % items.length];
            next.focus();
        }
    });
});

// Sidebar Toggle (Synology-style)
const sidebarToggle = document.getElementById('sidebar-toggle');
const mainSidebar = document.getElementById('main-sidebar');
const mainContent = document.getElementById('main-content');

if (sidebarToggle && mainSidebar) {
    sidebarToggle.addEventListener('click', () => {
        mainSidebar.classList.toggle('collapsed');
        if (mainContent) mainContent.classList.toggle('sidebar-collapsed');
        // Save preference
        localStorage.setItem('sidebarCollapsed', mainSidebar.classList.contains('collapsed'));
    });

    // Restore preference
    if (localStorage.getItem('sidebarCollapsed') === 'true') {
        mainSidebar.classList.add('collapsed');
        if (mainContent) mainContent.classList.add('sidebar-collapsed');
    }
}

// Header theme toggle
const headerThemeToggle = document.getElementById('header-theme-toggle');
if (headerThemeToggle) {
    headerThemeToggle.addEventListener('click', () => {
        const html = document.documentElement;
        const currentTheme = html.getAttribute('data-theme') || 'light';
        const newTheme = currentTheme === 'light' ? 'dark' : 'light';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('homepinas-theme', newTheme);
        headerThemeToggle.textContent = newTheme === 'dark' ? '☀️' : '🌙';
    });

    // Set initial icon from saved theme
    const currentTheme = localStorage.getItem('homepinas-theme') || document.documentElement.getAttribute('data-theme') || 'light';
    document.documentElement.setAttribute('data-theme', currentTheme);
    headerThemeToggle.textContent = currentTheme === 'dark' ? '☀️' : '🌙';
}

// Update user avatar letter
function updateUserAvatar() {
    const avatarEl = document.getElementById('user-avatar-letter');
    const usernameEl = document.getElementById('username-display');
    if (avatarEl && state.username) {
        avatarEl.textContent = state.username.charAt(0).toUpperCase();
    }
    if (usernameEl && state.username) {
        usernameEl.textContent = state.username;
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// CONTENT ROUTER
// ════════════════════════════════════════════════════════════════════════════════

// Render generation counter to prevent race conditions between async renders
let renderGeneration = 0;

async function renderContent(view) {
    const thisRender = ++renderGeneration;
    state.currentView = view;
    dashboardContent.innerHTML = '';

    // Clear storage polling when leaving storage view
    if (state.pollingIntervals.storage) {
        clearInterval(state.pollingIntervals.storage);
        state.pollingIntervals.storage = null;
    }

    if (view === 'dashboard') await renderDashboard();
    else if (view === 'docker') {
        // Use modularized docker view
        await renderDockerManager();
    }
    else if (view === 'storage') await renderStorageDashboard();
    else if (view === 'files') {
        // Use modularized files view
        await renderFilesView();
    }
    else if (view === 'terminal') {
        // Use modularized terminal view
        await renderTerminalView(dashboardContent);
    }
    else if (view === 'network') {
        await renderNetworkManager();
    }
    else if (view === 'backup') await renderBackupView();
    else if (view === 'active-backup') await renderActiveBackupView();
    else if (view === 'active-directory') await renderActiveDirectoryView();
    else if (view === 'cloud-sync') await renderCloudSyncView();
    else if (view === 'cloud-backup') await renderCloudBackupView();
    else if (view === 'vpn') {
        // Use modularized VPN view
        await renderVPNView();
    }
    else if (view === 'homestore') await renderHomeStoreView();
    else if (view === 'logs') await renderLogsView();
    else if (view === 'users') await renderUsersView();
    else if (view === 'system') {
        await renderSystemView();
        // Append UPS after system view
        setTimeout(async () => {
            await renderUPSSection(dashboardContent);
        }, 100);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// MAIN DASHBOARD
// ════════════════════════════════════════════════════════════════════════════════

// Real-Time Dashboard
async function renderDashboard(quickRefresh) {
    if (state.currentView !== 'dashboard') return;
    const currentGen = renderGeneration;

    // Save scroll position for quick refreshes
    const dashboardContent = document.getElementById('dashboard-content');
    const scrollParent = dashboardContent?.closest('.view-content') || document.querySelector('.main-content');
    const savedScroll = quickRefresh && scrollParent ? scrollParent.scrollTop : 0;
    const stats = state.globalStats;
    const cpuTemp = Number(stats.cpuTemp) || 0;
    const cpuLoad = Number(stats.cpuLoad) || 0;
    const ramUsedPercent = Number(stats.ramUsedPercent) || 0;
    const publicIP = escapeHtml(state.publicIP);

    // Fetch real LAN IP if not already loaded
    if (!state.network.interfaces || state.network.interfaces.length === 0 || state.network.interfaces[0]?.ip === '192.168.1.100') {
        try {
            const res = await authFetch(`${API_BASE}/network/interfaces`);
            if (res.ok) {
                state.network.interfaces = await res.json();
            }
        } catch (e) {
            console.warn('Could not fetch network interfaces:', e);
        }
    }

    const lanIP = escapeHtml(state.network.interfaces[0]?.ip || 'No disponible');
    const ddnsCount = (state.network.ddns || []).filter(d => d.enabled).length;

    // CPU Model - save once and reuse (CPU doesn't change)
    if (stats.cpuModel && stats.cpuModel !== 'Unknown CPU') {
        localStorage.setItem('cpuModel', stats.cpuModel);
    }
    const cpuModel = localStorage.getItem('cpuModel') || stats.cpuModel || t('common.unknown', 'CPU Desconocido');

    // Format uptime intelligently
    const uptimeSeconds = Number(stats.uptime) || 0;
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

    // Generate core loads HTML (compact version)
    let coreLoadsHtml = '';
    if (stats.coreLoads && stats.coreLoads.length > 0) {
        coreLoadsHtml = stats.coreLoads.map((core, i) => `
            <div class="core-bar-mini">
                <span>C${i}</span>
                <div class="core-progress-mini">
                    <div class="core-fill-mini" style="width: ${core.load}%; background: ${core.load > 80 ? '#ef4444' : core.load > 50 ? '#f59e0b' : '#10b981'}"></div>
                </div>
                <span>${core.load}%</span>
            </div>
        `).join('');
    }

    // Fetch fan mode
    let fanMode = 'balanced';
    try {
        const fanModeRes = await authFetch(`${API_BASE}/system/fan/mode`);
        if (fanModeRes.ok) {
            const fanModeData = await fanModeRes.json();
            fanMode = fanModeData.mode || 'balanced';
        }
    } catch (e) {
        console.error('Error fetching fan mode:', e);
    }

    // Generate fan mode selector HTML (only mode buttons, no RPM display)
    const fansFullHtml = `
        <div class="fan-mode-selector">
            <button class="fan-mode-btn ${fanMode === 'silent' ? 'active' : ''}" data-mode="silent">
                <span class="mode-icon">🤫</span>
                <span class="mode-name">Silent</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'balanced' ? 'active' : ''}" data-mode="balanced">
                <span class="mode-icon">⚖️</span>
                <span class="mode-name">Balanced</span>
            </button>
            <button class="fan-mode-btn ${fanMode === 'performance' ? 'active' : ''}" data-mode="performance">
                <span class="mode-icon">🚀</span>
                <span class="mode-name">Performance</span>
            </button>
        </div>
    `;

    // Fetch disks for storage section
    let disksHtml = '';
    try {
        const disksRes = await authFetch(`${API_BASE}/system/disks`);
        if (disksRes.ok) {
            const disks = await disksRes.json();

            // Group disks by role
            const disksByRole = { data: [], parity: [], cache: [], none: [] };
            disks.forEach(disk => {
                const config = state.storageConfig.find(s => s.id === disk.id);
                const role = config ? config.role : 'none';
                if (disksByRole[role]) {
                    disksByRole[role].push({ ...disk, role });
                } else {
                    disksByRole.none.push({ ...disk, role: 'none' });
                }
            });

            // Generate HTML for each role section
            const roleLabels = { data: '💾 ' + t('storage.data', 'Datos'), parity: '🛡️ ' + t('storage.parity', 'Paridad'), cache: '⚡ ' + t('storage.cache', 'Caché'), none: '📦 ' + t('storage.none', 'Sin asignar') };
            const roleColors = { data: '#6366f1', parity: '#f59e0b', cache: '#10b981', none: '#64748b' };

            for (const [role, roleDisks] of Object.entries(disksByRole)) {
                if (roleDisks.length > 0) {
                    disksHtml += `
                        <div class="disk-role-section">
                            <div class="disk-role-header dash-role-border--${role}">
                                <span>${roleLabels[role]}</span>
                                <span class="disk-count">${roleDisks.length} ${t('wizard.disksDetected', 'disco(s)')}</span>
                            </div>
                            <div class="disk-role-items">
                                ${roleDisks.map(disk => `
                                    <div class="disk-item-compact">
                                        <div class="disk-item-info">
                                            <span class="disk-name">${escapeHtml(disk.model || t('common.unknown', 'Desconocido'))}</span>
                                            <span class="disk-details">${escapeHtml(disk.id)} • ${escapeHtml(disk.size)} • ${escapeHtml(disk.type)}</span>
                                        </div>
                                        <div class="disk-item-temp ${disk.temp > 45 ? 'hot' : disk.temp > 38 ? 'warm' : 'cool'}">
                                            ${disk.temp || 0}°C
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        </div>
                    `;
                }
            }
        }
    } catch (e) {
        console.error('Error fetching disks:', e);
        disksHtml = `<div class="no-disks">${t('storage.unableToLoad', 'No se pudo cargar la información de discos')}</div>`;
    }


    // Restore scroll position on quick refresh
    if (quickRefresh && scrollParent && savedScroll > 0) {
        scrollParent.scrollTop = savedScroll;
    }

    // Skip heavy widget fetches on quick refresh (polling)
    if (!quickRefresh) {

    // Fetch I/O stats for disks
    try {
        const ioRes = await authFetch(`${API_BASE}/storage/disks/iostats`);
        if (renderGeneration !== currentGen) return;
        if (ioRes.ok) {
            const ioData = await ioRes.json();
            if (ioData.disks && ioData.disks.length > 0) {
                // We'll store this and use it after innerHTML is set
                window._pendingIoStats = ioData.disks;
            }
        }
    } catch (e) {
        console.warn('I/O stats fetch error:', e);
    }

    // Abort if user navigated away from dashboard during async fetches
    if (renderGeneration !== currentGen) return;

    dashboardContent.innerHTML = `
        <div class="glass-card overview-card dash-overview-full">
            <div class="overview-header">
                <h3>${t('dashboard.systemOverview', 'Resumen del Sistema')}</h3>
                <div class="system-info-badge">
                    <span>${escapeHtml(stats.hostname || 'HomePiNAS')}</span>
                    <span class="separator">|</span>
                    <span>${escapeHtml(stats.distro || 'Linux')}</span>
                    <span class="separator">|</span>
                    <span>${t('dashboard.uptime', 'Tiempo Activo')}: ${uptimeStr}</span>
                </div>
            </div>
        </div>

        <div class="dashboard-grid-4">
            <div class="glass-card card-compact">
                <h3>🖥️ ${t('dashboard.cpu', 'CPU')}</h3>
                <div class="cpu-model-compact">${escapeHtml(cpuModel)}</div>
                <div class="cpu-specs-row">
                    <span>${stats.cpuPhysicalCores || 0} ${t('dashboard.cores', 'Núcleos')}</span>
                    <span>${stats.cpuCores || 0} ${t('dashboard.threads', 'Hilos')}</span>
                    <span>${stats.cpuSpeed || 0} GHz</span>
                    <span class="temp-badge ${cpuTemp > 70 ? 'hot' : cpuTemp > 55 ? 'warm' : 'cool'}">${cpuTemp}°C</span>
                </div>
                <div class="load-section">
                    <div class="load-header">
                        <span>${t('dashboard.load', 'Carga')}</span>
                        <span style="color: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : '#10b981'}">${cpuLoad}%</span>
                    </div>
                    <div class="progress-bar-mini">
                        <div class="progress-fill-mini" style="width: ${Math.min(cpuLoad, 100)}%; background: ${cpuLoad > 80 ? '#ef4444' : cpuLoad > 50 ? '#f59e0b' : 'var(--primary)'}"></div>
                    </div>
                </div>
                ${coreLoadsHtml ? `<div class="core-loads-mini">${coreLoadsHtml}</div>` : ''}
            </div>

            <div class="glass-card card-compact">
                <h3>💾 ${t('dashboard.memory', 'Memoria')}</h3>
                <div class="memory-compact">
                    <div class="memory-circle-small">
                        <svg viewBox="0 0 36 36">
                            <path class="circle-bg" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                            <path class="circle-fill" stroke="${ramUsedPercent > 80 ? '#ef4444' : ramUsedPercent > 60 ? '#f59e0b' : '#10b981'}"
                                  stroke-dasharray="${ramUsedPercent}, 100"
                                  d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"/>
                        </svg>
                        <span class="memory-percent-small">${ramUsedPercent}%</span>
                    </div>
                    <div class="memory-details-compact">
                        <div class="mem-row"><span>${t('dashboard.used', 'Usado')}</span><span>${stats.ramUsed || 0} GB</span></div>
                        <div class="mem-row"><span>${t('dashboard.free', 'Libre')}</span><span>${stats.ramFree || 0} GB</span></div>
                        <div class="mem-row"><span>${t('dashboard.total', 'Total')}</span><span>${stats.ramTotal || 0} GB</span></div>
                        ${stats.swapTotal && parseFloat(stats.swapTotal) > 0 ? `<div class="mem-row swap"><span>${t('dashboard.swap', 'Swap')}</span><span>${stats.swapUsed || 0}/${stats.swapTotal || 0} GB</span></div>` : ''}
                    </div>
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌀 ${t('dashboard.fans', 'Ventiladores')}</h3>
                <div class="fans-compact">
                    ${fansFullHtml}
                </div>
            </div>

            <div class="glass-card card-compact">
                <h3>🌐 ${t('dashboard.network', 'Red')}</h3>
                <div class="network-compact">
                    <div class="net-row"><span>${t('dashboard.publicIP', 'IP Pública')}</span><span class="ip-value">${publicIP}</span></div>
                    <div class="net-row"><span>${t('dashboard.lanIP', 'IP Local')}</span><span>${lanIP}</span></div>
                    <div class="net-row"><span>${t('dashboard.ddns', 'DDNS')}</span><span>${ddnsCount} ${t('dashboard.services', 'Servicio(s)')}</span></div>
                </div>
            </div>
        </div>

        <div class="glass-card storage-overview dash-storage-full">
            <h3>💿 ${t('storage.connectedDisks', 'Discos Conectados')}</h3>
            <div class="disks-by-role">
                ${disksHtml || `<div class="no-disks">${t('storage.noDisksDetected', 'No se detectaron discos')}</div>`}
            </div>
        </div>

        <div id="cache-status-widget" class="glass-card storage-overview dash-storage-full" style="display: none;">
            <div class="storage-array-header">
                <h3>⚡ ${t('dashboard.cache', 'Estado de la Caché')}</h3>
                <button id="cache-mover-btn" class="btn-primary" style="padding: 6px 14px; font-size: 13px; border-radius: 6px;">
                    🚀 ${t('dashboard.moveNow', 'Mover Ahora')}
                </button>
            </div>
            <div id="cache-status-content" style="padding: 12px;">
                <div style="text-align: center; color: var(--text-dim);">${t('dashboard.loading', 'Cargando...')}</div>
            </div>
        </div>

        <div id="docker-containers-widget" class="glass-card storage-overview dash-storage-full" style="display: none;">
            <div class="storage-array-header">
                <h3>🐳 Docker</h3>
            </div>
            <div id="docker-containers-content" style="padding: 12px;">
                <div style="text-align: center; color: var(--text-dim);">${t('dashboard.loading', 'Cargando...')}</div>
            </div>
        </div>
    `;

    // Add fan mode button event listeners
    dashboardContent.querySelectorAll('.fan-mode-btn[data-mode]').forEach(btn => {
        btn.addEventListener('click', () => setFanMode(btn.dataset.mode));
    });


    // Inject I/O stats into disk cards
    if (window._pendingIoStats) {
        window._pendingIoStats.forEach(io => {
            const diskEls = dashboardContent.querySelectorAll('.disk-item-compact');
            diskEls.forEach(el => {
                const detailsSpan = el.querySelector('.disk-details');
                if (detailsSpan && detailsSpan.textContent.includes(io.diskId)) {
                    const ioDiv = document.createElement('div');
                    ioDiv.className = 'disk-io-stats';
                    ioDiv.innerHTML = `<span class="io-read">↓ ${escapeHtml(String(io.readMBs))} MB/s</span> <span class="io-write">↑ ${escapeHtml(String(io.writeMBs))} MB/s</span>` +
                        (io.utilization > 0 ? ` <span class="io-util">${escapeHtml(io.utilization.toFixed(0))}%</span>` : '');
                    el.appendChild(ioDiv);
                }
            });
        });
        delete window._pendingIoStats;
    }

    // Fetch and update cache status widget
    try {
        const cacheRes = await authFetch(`${API_BASE}/storage/cache/status`);
        if (renderGeneration !== currentGen) return;
        if (cacheRes.ok) {
            const cacheData = await cacheRes.json();
            if (renderGeneration !== currentGen) return;
            const cacheWidget = document.getElementById('cache-status-widget');
            const cacheContent = document.getElementById('cache-status-content');

            if (cacheWidget && cacheData && cacheData.hasCache) {
                cacheWidget.style.display = 'block';
                let html = '';
                if (cacheData.cacheDisks) {
                    html = cacheData.cacheDisks.map(disk => {
                        const pct = disk.usagePercent || 0;
                        const fillClass = pct > 90 ? 'high' : pct > 70 ? 'medium' : 'low';
                        return `
                            <div class="storage-mount-row cache" style="margin-bottom: 10px;">
                                <div class="mount-info">
                                    <span class="mount-path">${escapeHtml(disk.mountPoint || '')}</span>
                                    <span class="mount-device">${escapeHtml(disk.disk || '')}</span>
                                </div>
                                <div class="mount-bar-container">
                                    <div class="mount-bar">
                                        <div class="mount-bar-fill ${fillClass}" style="width: ${pct}%"></div>
                                    </div>
                                    <div class="mount-bar-text">
                                        <span>${pct}% usado</span>
                                        <span>${escapeHtml(disk.availableFormatted || 'N/A')} disponible</span>
                                    </div>
                                </div>
                            </div>`;
                    }).join('');
                }
                if (cacheData.fileCounts) {
                    html += `<div style="margin-top: 8px; font-size: 13px; color: var(--text-dim);">
                        ⚡ Caché: <strong>${cacheData.fileCounts.cache || 0}</strong> archivos |
                        🌐 Datos: <strong>${cacheData.fileCounts.data || 0}</strong> archivos
                    </div>`;
                }
                if (cacheContent) cacheContent.innerHTML = html;

                // Cache mover button
                const moverBtn = document.getElementById('cache-mover-btn');
                if (moverBtn) {
                    moverBtn.onclick = async () => {
                        moverBtn.disabled = true;
                        moverBtn.textContent = '⏳ Moviendo...';
                        try {
                            const res = await authFetch(`${API_BASE}/cache/move-now`, { method: 'POST' });
                            if (res.ok) {
                                const r = await res.json();
                                showNotification(r.message || t('storage.cacheMoverStarted', 'Cache mover iniciado'), 'success');
                                setTimeout(() => renderDashboard(), 2000);
                            } else {
                                showNotification(t('storage.moveCacheError', 'Error al iniciar mover'), 'error');
                            }
                        } catch (e) {
                            showNotification(t('storage.moveCacheError', 'Error al iniciar mover'), 'error');
                        } finally {
                            moverBtn.disabled = false;
                            moverBtn.textContent = '🚀 Mover Ahora';
                        }
                    };
                }
            }
        }
    } catch (e) {
        console.warn('Cache status fetch error:', e);
    }

    // Fetch and update Docker containers widget
    try {
        const dockerRes = await authFetch(`${API_BASE}/docker/containers`);
        if (renderGeneration !== currentGen) return;
        if (dockerRes.ok) {
            const containers = await dockerRes.json();
            if (renderGeneration !== currentGen) return;
            const dockerWidget = document.getElementById('docker-containers-widget');
            const dockerContent = document.getElementById('docker-containers-content');

            if (dockerWidget && Array.isArray(containers) && containers.length > 0) {
                dockerWidget.style.display = 'block';
                const html = containers.slice(0, 8).map(c => {
                    const stateColor = c.State === 'running' ? 'var(--success)' : 'var(--danger)';
                    const name = (c.Names && c.Names[0] || c.name || 'unknown').replace(/^\//, '');
                    const image = c.Image || '';
                    const shortImage = image.split(':')[0].split('/').pop();
                    return `<div class="net-row">
                        <span><span style="color:${stateColor};">●</span> ${escapeHtml(name)}</span>
                        <span style="font-size:12px;color:var(--text-dim);">${escapeHtml(shortImage)}</span>
                    </div>`;
                }).join('');
                if (dockerContent) dockerContent.innerHTML = html;
            }
        }
    } catch (e) {
        console.warn('Docker containers fetch error:', e);
    }

    } // end !quickRefresh
}

// ════════════════════════════════════════════════════════════════════════════════
// FAN CONTROL
// ════════════════════════════════════════════════════════════════════════════════

// Fan speed control - update percentage display while dragging
function updateFanPercent(fanId, value) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${value}%`;
    }
}

// Fan speed control - apply speed when released
async function setFanSpeed(fanId, speed) {
    const percentEl = document.getElementById(`fan-percent-${fanId}`);
    if (percentEl) {
        percentEl.textContent = `${speed}% ⏳`;
    }

    try {
        const res = await authFetch(`${API_BASE}/system/fan`, {
            method: 'POST',
            body: JSON.stringify({ fanId, speed: parseInt(speed) })
        });
        const data = await res.json();

        if (percentEl) {
            if (res.ok) {
                percentEl.textContent = `${speed}% ✓`;
                setTimeout(() => {
                    percentEl.textContent = `${speed}%`;
                }, 1500);
            } else {
                percentEl.textContent = `${speed}% ✗`;
                console.error('Fan control error:', data.error);
            }
        }
    } catch (e) {
        console.error('Fan control error:', e);
        if (percentEl) {
            percentEl.textContent = `${speed}% ✗`;
        }
    }
}

window.updateFanPercent = updateFanPercent;
window.setFanSpeed = setFanSpeed;

// Fan mode control
async function setFanMode(mode) {
    // Update UI immediately
    document.querySelectorAll('.fan-mode-btn').forEach(btn => {
        btn.classList.remove('active');
        if (btn.dataset.mode === mode) {
            btn.classList.add('active');
            btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">⏳</span>`;
        }
    });

    try {
        const res = await authFetch(`${API_BASE}/system/fan/mode`, {
            method: 'POST',
            body: JSON.stringify({ mode })
        });
        const data = await res.json();

        if (res.ok) {
            // Update button to show success
            document.querySelectorAll('.fan-mode-btn').forEach(btn => {
                if (btn.dataset.mode === mode) {
                    const modeNames = { silent: 'Silent', balanced: 'Balanced', performance: 'Performance' };
                    btn.innerHTML = `<span class="mode-icon">${btn.querySelector('.mode-icon').textContent}</span><span class="mode-name">${modeNames[mode]} ✓</span>`;
                    setTimeout(() => {
                        btn.innerHTML = `<span class="mode-icon">${mode === 'silent' ? '🤫' : mode === 'balanced' ? '⚖️' : '🚀'}</span><span class="mode-name">${modeNames[mode]}</span>`;
                    }, 1500);
                }
            });
        } else {
            console.error('Fan mode error:', data.error);
            // Revert UI on error
            renderDashboard();
        }
    } catch (e) {
        console.error('Fan mode error:', e);
        renderDashboard();
    }
}

window.setFanMode = setFanMode;

// ════════════════════════════════════════════════════════════════════════════════
// MODULE EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Clean up all event listeners and resources
 */
export function cleanup() {
    _moduleListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _moduleListeners.length = 0;
}

export async function render(container) {
    await renderStorageDashboard();
}

export { renderStorageDashboard, createStoragePool };
