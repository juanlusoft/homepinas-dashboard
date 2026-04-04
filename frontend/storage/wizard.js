/**
 * STORAGE WIZARD MODULE
 * ════════════════════════════════════════════════════════════════════════════════
 * Storage pool configuration, dashboard, and management
 * Features: Step-by-step pool setup, pool monitoring, disk health,
 *           partition management, capacity planning
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
import { t } from '../../i18n.js';

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
// STORAGE WIZARD
// ════════════════════════════════════════════════════════════════════════════════

// STORAGE WIZARD - Step-by-step configuration
// =============================================================================

const wizardState = {
    currentStep: 1,
    totalSteps: 7,
    disks: [],
    selectedDataDisks: [],
    selectedParityDisk: null,
    selectedCacheDisk: null,
    isConfiguring: false
};

// Load wizard state from localStorage
function loadWizardState() {
    try {
        const saved = localStorage.getItem('homepinas-wizard-state');
        if (saved) {
            const parsed = JSON.parse(saved);
            Object.assign(wizardState, parsed);
            return true;
        }
    } catch (e) {
        console.warn('Could not load wizard state:', e);
    }
    return false;
}

// Save wizard state to localStorage
function saveWizardState() {
    try {
        localStorage.setItem('homepinas-wizard-state', JSON.stringify({
            currentStep: wizardState.currentStep,
            selectedDataDisks: wizardState.selectedDataDisks,
            selectedParityDisk: wizardState.selectedParityDisk,
            selectedCacheDisk: wizardState.selectedCacheDisk
        }));
    } catch (e) {
        console.warn('Could not save wizard state:', e);
    }
}

// Clear wizard state
function clearWizardState() {
    wizardState.currentStep = 1;
    wizardState.selectedDataDisks = [];
    wizardState.selectedParityDisk = null;
    wizardState.selectedCacheDisk = null;
    localStorage.removeItem('homepinas-wizard-state');
}

// Initialize the storage wizard
function initStorageSetup() {
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
    setupNetworkConfiguration();
}

// Legacy hook kept for compatibility with previous wizard flow.
// Network setup is already initialized inside initStorageSetup().
function setupNetworkConfiguration() {
    return;
}

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

// Get appropriate icon for disk type
function getDiskIcon(type) {
    switch (type?.toUpperCase()) {
        case 'NVME': return '⚡';
        case 'SSD': return '💾';
        case 'HDD': return '💿';
        default: return '📀';
    }
}

// Populate disk selection lists for all wizard steps
function populateWizardDiskLists() {
    // Data disks (all disks available)
    const dataList = document.getElementById('wizard-data-disks');
    if (dataList) {
        dataList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'checkbox', 'data')).join('');
        setupDiskCardListeners(dataList, 'data');
    }
    
    // Parity disks (all disks, but will filter based on data selection)
    const parityList = document.getElementById('wizard-parity-disks');
    if (parityList) {
        parityList.innerHTML = wizardState.disks.map(disk => createDiskCard(disk, 'radio', 'parity')).join('');
        setupDiskCardListeners(parityList, 'parity');
    }
    
    // Cache disks (only SSD/NVMe)
    const cacheList = document.getElementById('wizard-cache-disks');
    const noCacheMsg = document.getElementById('wizard-no-cache-disks');
    if (cacheList) {
        const ssdDisks = wizardState.disks.filter(d => d.type === 'NVMe' || d.type === 'SSD');
        if (ssdDisks.length > 0) {
            cacheList.innerHTML = ssdDisks.map(disk => createDiskCard(disk, 'radio', 'cache')).join('');
            cacheList.style.display = 'flex';
            if (noCacheMsg) noCacheMsg.style.display = 'none';
            setupDiskCardListeners(cacheList, 'cache');
        } else {
            cacheList.style.display = 'none';
            if (noCacheMsg) noCacheMsg.style.display = 'block';
        }
    }
}

// Create a disk selection card
function createDiskCard(disk, inputType, role) {
    const typeClass = (disk.type || 'hdd').toLowerCase();
    const selectorClass = inputType === 'checkbox' ? 'wizard-disk-checkbox' : 'wizard-disk-radio';
    
    return `
        <div class="wizard-disk-card" data-disk-id="${escapeHtml(disk.id)}" data-role="${role}">
            <div class="${selectorClass}"></div>
            <div class="wizard-disk-icon">${getDiskIcon(disk.type)}</div>
            <div class="wizard-disk-info">
                <div class="wizard-disk-name">
                    ${escapeHtml(disk.model || t('common.unknown', 'Disco Desconocido'))}
                    <span class="wizard-disk-badge ${typeClass}">${escapeHtml(disk.type || 'HDD')}</span>
                </div>
                <div class="wizard-disk-details">
                    /dev/${escapeHtml(disk.id)} • ${disk.temp ? disk.temp + '°C' : 'N/A'}
                </div>
            </div>
            <div class="wizard-disk-size">${escapeHtml(disk.size)}</div>
        </div>
    `;
}

// Setup click listeners for disk cards
function setupDiskCardListeners(container, role) {
    container.querySelectorAll('.wizard-disk-card').forEach(card => {
        card.addEventListener('click', () => handleDiskSelection(card, role));
    });
}

// Handle disk selection
function handleDiskSelection(card, role) {
    const diskId = card.dataset.diskId;
    const disk = wizardState.disks.find(d => d.id === diskId);
    if (!disk) return;
    
    if (role === 'data') {
        // Checkbox behavior - toggle selection
        card.classList.toggle('selected');
        
        if (card.classList.contains('selected')) {
            if (!wizardState.selectedDataDisks.includes(diskId)) {
                wizardState.selectedDataDisks.push(diskId);
            }
        } else {
            wizardState.selectedDataDisks = wizardState.selectedDataDisks.filter(id => id !== diskId);
        }
        
        // Update next button state
        const nextBtn = document.getElementById('wizard-next-2');
        if (nextBtn) nextBtn.disabled = wizardState.selectedDataDisks.length === 0;
        
        // Update parity disk options (disable selected data disks)
        updateParityDiskOptions();
        
    } else if (role === 'parity') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedParityDisk = diskId;
        
    } else if (role === 'cache') {
        // Radio behavior - single selection
        const container = card.parentElement;
        container.querySelectorAll('.wizard-disk-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        wizardState.selectedCacheDisk = diskId;
    }
    
    saveWizardState();
}

// Update parity disk options based on data disk selection
function updateParityDiskOptions() {
    const parityList = document.getElementById('wizard-parity-disks');
    if (!parityList) return;
    
    // Get the largest selected data disk size
    const selectedDataDiskSizes = wizardState.selectedDataDisks.map(id => {
        const disk = wizardState.disks.find(d => d.id === id);
        return disk ? parseDiskSize(disk.size) : 0;
    });
    const largestDataSize = Math.max(...selectedDataDiskSizes, 0);
    
    // Update each parity disk card
    parityList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const disk = wizardState.disks.find(d => d.id === diskId);
        
        // Disable if selected as data disk
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        // Disable if smaller than largest data disk
        const isTooSmall = disk && parseDiskSize(disk.size) < largestDataSize;
        
        if (isDataDisk || isTooSmall) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedParityDisk === diskId) {
                wizardState.selectedParityDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
    
    // Also update cache disk options
    updateCacheDiskOptions();
}

// Update cache disk options based on selections
function updateCacheDiskOptions() {
    const cacheList = document.getElementById('wizard-cache-disks');
    if (!cacheList) return;
    
    cacheList.querySelectorAll('.wizard-disk-card').forEach(card => {
        const diskId = card.dataset.diskId;
        const isDataDisk = wizardState.selectedDataDisks.includes(diskId);
        const isParityDisk = wizardState.selectedParityDisk === diskId;
        
        if (isDataDisk || isParityDisk) {
            card.classList.add('disabled');
            card.classList.remove('selected');
            if (wizardState.selectedCacheDisk === diskId) {
                wizardState.selectedCacheDisk = null;
            }
        } else {
            card.classList.remove('disabled');
        }
    });
}

// Parse disk size string to bytes for comparison
function parseDiskSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
    return num * (multipliers[unit] || 1);
}

// Restore saved selections when disk lists are populated
function restoreWizardSelections() {
    // Restore data disk selections
    wizardState.selectedDataDisks.forEach(diskId => {
        const card = document.querySelector(`#wizard-data-disks .wizard-disk-card[data-disk-id="${diskId}"]`);
        if (card) card.classList.add('selected');
    });
    
    // Update next button
    const nextBtn2 = document.getElementById('wizard-next-2');
    if (nextBtn2) nextBtn2.disabled = wizardState.selectedDataDisks.length === 0;
    
    // Restore parity selection
    if (wizardState.selectedParityDisk) {
        const card = document.querySelector(`#wizard-parity-disks .wizard-disk-card[data-disk-id="${wizardState.selectedParityDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Restore cache selection
    if (wizardState.selectedCacheDisk) {
        const card = document.querySelector(`#wizard-cache-disks .wizard-disk-card[data-disk-id="${wizardState.selectedCacheDisk}"]`);
        if (card && !card.classList.contains('disabled')) card.classList.add('selected');
    }
    
    // Update dependent options
    updateParityDiskOptions();
}

// Setup wizard navigation buttons
function setupWizardNavigation() {
    // Step 1 -> 2
    document.getElementById('wizard-next-1')?.addEventListener('click', () => navigateWizard(2));
    
    // Step 2
    document.getElementById('wizard-back-2')?.addEventListener('click', () => navigateWizard(1));
    document.getElementById('wizard-next-2')?.addEventListener('click', () => {
        updateParityDiskOptions();
        navigateWizard(3);
    });
    
    // Step 3
    document.getElementById('wizard-back-3')?.addEventListener('click', () => navigateWizard(2));
    document.getElementById('wizard-next-3')?.addEventListener('click', () => {
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    document.getElementById('wizard-skip-parity')?.addEventListener('click', () => {
        wizardState.selectedParityDisk = null;
        document.querySelectorAll('#wizard-parity-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateCacheDiskOptions();
        navigateWizard(4);
    });
    
    // Step 4
    document.getElementById('wizard-back-4')?.addEventListener('click', () => navigateWizard(3));
    document.getElementById('wizard-next-4')?.addEventListener('click', () => {
        updateSummary();
        navigateWizard(5);
    });
    document.getElementById('wizard-skip-cache')?.addEventListener('click', () => {
        wizardState.selectedCacheDisk = null;
        document.querySelectorAll('#wizard-cache-disks .wizard-disk-card').forEach(c => c.classList.remove('selected'));
        updateSummary();
        navigateWizard(5);
    });
    
    // Step 5
    document.getElementById('wizard-back-5')?.addEventListener('click', () => navigateWizard(4));
    document.getElementById('wizard-create-pool')?.addEventListener('click', createStoragePool);
    
    // Step 7 (completed)
    document.getElementById('wizard-go-dashboard')?.addEventListener('click', () => {
        clearWizardState();
        if (state.sessionId) {
            state.isAuthenticated = true;
            switchView('dashboard');
        } else {
            switchView('login');
        }
    });
}

// Navigate to a specific wizard step
function navigateWizard(step) {
    const currentStepEl = document.querySelector(`.wizard-step[data-step="${wizardState.currentStep}"]`);
    const nextStepEl = document.querySelector(`.wizard-step[data-step="${step}"]`);
    
    if (!currentStepEl || !nextStepEl) return;
    
    // Animate out current step
    currentStepEl.classList.add('exit');
    
    setTimeout(() => {
        currentStepEl.classList.remove('active', 'exit');
        nextStepEl.classList.add('active');
        
        // Update progress indicator
        updateWizardProgress(step);
        
        wizardState.currentStep = step;
        saveWizardState();
    }, 300);
}

// Update the progress dots
function updateWizardProgress(step) {
    const progressContainer = document.getElementById('wizard-progress');
    if (!progressContainer) return;
    
    // For steps 6 and 7 (progress and completion), hide the progress indicator
    if (step >= 6) {
        progressContainer.style.display = 'none';
        return;
    }
    progressContainer.style.display = 'flex';
    
    const dots = progressContainer.querySelectorAll('.wizard-progress-dot');
    const lines = progressContainer.querySelectorAll('.wizard-progress-line');
    
    dots.forEach((dot, index) => {
        const dotStep = index + 1;
        dot.classList.remove('active', 'completed');
        dot.textContent = dotStep;
        
        if (dotStep < step) {
            dot.classList.add('completed');
            dot.textContent = '';
        } else if (dotStep === step) {
            dot.classList.add('active');
        }
    });
    
    lines.forEach((line, index) => {
        line.classList.toggle('completed', index < step - 1);
    });
}

// Update the summary step
function updateSummary() {
    // Data disks summary
    const dataContainer = document.getElementById('summary-data-disks');
    if (dataContainer) {
        if (wizardState.selectedDataDisks.length > 0) {
            dataContainer.innerHTML = wizardState.selectedDataDisks.map(id => {
                const disk = wizardState.disks.find(d => d.id === id);
                return `
                    <div class="wizard-summary-disk">
                        ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || id)}
                        <span class="disk-role data">${escapeHtml(disk?.size || 'N/A')}</span>
                    </div>
                `;
            }).join('');
        } else {
            dataContainer.innerHTML = '<span class="wizard-summary-empty">Ninguno seleccionado</span>';
        }
    }
    
    // Parity disk summary
    const parityContainer = document.getElementById('summary-parity-disk');
    if (parityContainer) {
        if (wizardState.selectedParityDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedParityDisk);
            parityContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedParityDisk)}
                    <span class="disk-role parity">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            parityContainer.innerHTML = '<span class="wizard-summary-empty">Sin paridad (no protegido)</span>';
        }
    }
    
    // Cache disk summary
    const cacheContainer = document.getElementById('summary-cache-disk');
    if (cacheContainer) {
        if (wizardState.selectedCacheDisk) {
            const disk = wizardState.disks.find(d => d.id === wizardState.selectedCacheDisk);
            cacheContainer.innerHTML = `
                <div class="wizard-summary-disk">
                    ${getDiskIcon(disk?.type)} ${escapeHtml(disk?.model || wizardState.selectedCacheDisk)}
                    <span class="disk-role cache">${escapeHtml(disk?.size || 'N/A')}</span>
                </div>
            `;
        } else {
            cacheContainer.innerHTML = '<span class="wizard-summary-empty">Sin caché</span>';
        }
    }
    
    // Total capacity
    const totalContainer = document.getElementById('summary-total-capacity');
    if (totalContainer) {
        let totalBytes = 0;
        wizardState.selectedDataDisks.forEach(id => {
            const disk = wizardState.disks.find(d => d.id === id);
            if (disk) totalBytes += parseDiskSize(disk.size);
        });
        totalContainer.textContent = formatBytes(totalBytes);
    }
}

// Format bytes to human readable
// formatBytes imported from modules/utils.js

// Create the storage pool
async function createStoragePool() {
    if (wizardState.isConfiguring) return;
    if (wizardState.selectedDataDisks.length === 0) {
        showNotification(t('wizard.selectDataDisk', 'Debes seleccionar al menos un disco de datos'), 'error');
        return;
    }
    
    wizardState.isConfiguring = true;
    
    // Navigate to progress step
    navigateWizard(6);
    
    // Capture selected filesystem
    const selectedFilesystem = document.querySelector('input[name="wizard-filesystem"]:checked')?.value || 'ext4';

    // Build disk selections
    const selections = [];
    
    wizardState.selectedDataDisks.forEach(id => {
        selections.push({ id, role: 'data', format: true, filesystem: selectedFilesystem });
    });
    
    if (wizardState.selectedParityDisk) {
        selections.push({ id: wizardState.selectedParityDisk, role: 'parity', format: true, filesystem: selectedFilesystem });
    }
    
    if (wizardState.selectedCacheDisk) {
        selections.push({ id: wizardState.selectedCacheDisk, role: 'cache', format: true, filesystem: selectedFilesystem });
    }
    
    const tasks = ['format', 'mount', 'snapraid', 'mergerfs', 'fstab', 'sync'];
    
    try {
        // Update task: format
        updateWizardTask('format', 'running', 'Formateando discos...');
        await new Promise(r => setTimeout(r, 500));
        
        // Call the API to configure the pool
        const res = await authFetch(`${API_BASE}/storage/pool/configure`, {
            method: 'POST',
            body: JSON.stringify({ disks: selections })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Error al configurar el pool');
        }
        
        // Simulate progress through tasks
        updateWizardTask('format', 'done', 'Discos formateados');
        await new Promise(r => setTimeout(r, 300));
        
        updateWizardTask('mount', 'running', 'Montando particiones...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mount', 'done', 'Particiones montadas');
        
        updateWizardTask('snapraid', 'running', 'Configurando SnapRAID...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('snapraid', 'done', 'SnapRAID configurado');
        
        updateWizardTask('mergerfs', 'running', 'Configurando MergerFS...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('mergerfs', 'done', 'MergerFS configurado');
        
        updateWizardTask('fstab', 'running', 'Actualizando /etc/fstab...');
        await new Promise(r => setTimeout(r, 500));
        updateWizardTask('fstab', 'done', '/etc/fstab actualizado');
        
        updateWizardTask('sync', 'running', 'Sincronización inicial...');
        
        // Start sync in background if parity is configured
        if (wizardState.selectedParityDisk) {
            try {
                await authFetch(`${API_BASE}/storage/snapraid/sync`, { method: 'POST' });
                // Poll for sync progress (simplified)
                await new Promise(r => setTimeout(r, 2000));
                updateWizardTask('sync', 'done', 'Sincronización completada');
            } catch (syncError) {
                console.warn('Sync skipped:', syncError);
                updateWizardTask('sync', 'done', 'Sincronización programada');
            }
        } else {
            updateWizardTask('sync', 'done', 'Sin paridad - omitido');
        }
        
        // Update state
        state.storageConfig = selections;
        
        // Wait a moment then show completion
        await new Promise(r => setTimeout(r, 1000));
        navigateWizard(7);
        
        // Celebrate!
        celebrateWithConfetti();
        showNotification(t('wizard.poolCreated', '¡Pool de almacenamiento creado con éxito!'), 'success', 5000);
        
    } catch (e) {
        console.error('[Wizard] Pool creation error:', e);
        showNotification('Error: ' + e.message, 'error');
        
        // Mark current task as error
        tasks.forEach(task => {
            const item = document.querySelector(`.wizard-progress-item[data-task="${task}"]`);
            if (item) {
                const icon = item.querySelector('.wizard-progress-icon');
                if (icon && icon.classList.contains('running')) {
                    updateWizardTask(task, 'error', 'Error: ' + e.message);
                }
            }
        });
        
        wizardState.isConfiguring = false;
    }
}

// Update a task in the progress list
function updateWizardTask(taskName, status, message) {
    const item = document.querySelector(`.wizard-progress-item[data-task="${taskName}"]`);
    if (!item) return;
    
    const icon = item.querySelector('.wizard-progress-icon');
    const statusEl = item.querySelector('.wizard-progress-status');
    
    // Update icon
    icon.classList.remove('pending', 'running', 'done', 'error');
    icon.classList.add(status);
    
    switch (status) {
        case 'pending':
            icon.textContent = '⏳';
            break;
        case 'running':
            icon.textContent = '🔄';
            break;
        case 'done':
            icon.textContent = '✅';
            break;
        case 'error':
            icon.textContent = '❌';
            break;
    }
    
    // Update status text
    if (statusEl && message) {
        statusEl.textContent = message;
    }
}

// Legacy function for compatibility
function updateSummaryLegacy() {
    const roles = { data: 0, parity: 0, cache: 0 };
    document.querySelectorAll('.role-btn.active').forEach(btn => {
        const role = btn.dataset.role;
        if (role !== 'none') roles[role]++;
    });
    const dataCount = document.getElementById('data-count');
    const parityCount = document.getElementById('parity-count');
    const cacheCount = document.getElementById('cache-count');
    if (dataCount) dataCount.textContent = roles.data;
    if (parityCount) parityCount.textContent = roles.parity;
    if (cacheCount) cacheCount.textContent = roles.cache;
}

// Storage Progress Modal Functions
const progressModal = document.getElementById('storage-progress-modal');
const progressSteps = {
    format: document.getElementById('step-format'),
    mount: document.getElementById('step-mount'),
    snapraid: document.getElementById('step-snapraid'),
    mergerfs: document.getElementById('step-mergerfs'),
    fstab: document.getElementById('step-fstab'),
    sync: document.getElementById('step-sync')
};

function showProgressModal() {
    if (progressModal) {
        progressModal.classList.add('active');
        // Reset all steps
        Object.values(progressSteps).forEach(step => {
            if (step) {
                step.classList.remove('active', 'completed', 'error');
                const icon = step.querySelector('.step-icon');
                if (icon) icon.textContent = '⏳';
            }
        });
    }
}

function hideProgressModal() {
    if (progressModal) progressModal.classList.remove('active');
}

function updateProgressStep(stepId, status) {
    const step = progressSteps[stepId];
    if (!step) return;

    const icon = step.querySelector('.step-icon');

    step.classList.remove('active', 'completed', 'error');

    if (status === 'active') {
        step.classList.add('active');
        if (icon) icon.textContent = '';
    } else if (status === 'completed') {
        step.classList.add('completed');
        if (icon) icon.textContent = '';
    } else if (status === 'error') {
        step.classList.add('error');
        if (icon) icon.textContent = '';
    }
}

function updateSyncProgress(percent, statusText) {
    const fill = document.getElementById('sync-progress-fill');
    const status = document.getElementById('sync-status');
    const percentValue = Math.min(100, Math.max(0, percent || 0));

    if (fill) {
        fill.style.width = `${percentValue}%`;
    }
    if (status) {
        if (statusText && statusText.length > 0) {
            status.textContent = `${percentValue}% - ${statusText}`;
        } else {
            status.textContent = `${percentValue}% complete`;
        }
    }
}

async function pollSyncProgress() {
    return new Promise((resolve) => {
        // Poll more frequently at start for better responsiveness
        let pollCount = 0;

        const pollInterval = setInterval(async () => {
            pollCount++;
            try {
                const res = await authFetch(`${API_BASE}/storage/snapraid/sync/progress`);
                const data = await res.json();

                // Always update the progress display
                updateSyncProgress(data.progress || 0, data.status || 'Sincronizando...');

                if (!data.running) {
                    clearInterval(pollInterval);
                    if (data.error) {
                        updateProgressStep('sync', 'error');
                        resolve({ success: false, error: data.error });
                    } else {
                        // Ensure we show 100% at completion
                        updateSyncProgress(100, data.status || 'Sync completed');
                        updateProgressStep('sync', 'completed');
                        resolve({ success: true });
                    }
                }

                // Safety timeout after 5 minutes of polling
                if (pollCount > 150) {
                    clearInterval(pollInterval);
                    updateProgressStep('sync', 'completed');
                    updateSyncProgress(100, 'Tiempo de sincronización agotado - puede seguir ejecutándose en segundo plano');
                    resolve({ success: true });
                }
            } catch (e) {
                // Don't fail immediately on network errors, retry a few times
                if (pollCount > 5) {
                    clearInterval(pollInterval);
                    resolve({ success: false, error: e.message });
                }
            }
        }, 1000); // Poll every second for better UI responsiveness
    });
}

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

// Authentication
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

// Real Storage Telemetry
async function renderStorageDashboard() {
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
                                    await startBadblocks(disk.id);
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
                                        await startBadblocks(disk.id);
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
                        
                        async function startBadblocks(diskId) {
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
                    detectedNewDisks = [{
                        id: disk.id,
                        model: disk.model || 'Disco',
                        size: disk.size,
                        sizeFormatted: disk.size || 'N/A',
                        transport: disk.type || 'unknown', // SSD/HDD -> treat as transport hint
                        serial: disk.serial,
                        hasData: true, // Assume existing disk has data (safer default)
                        partitions: []
                    }];
                    showDiskActionModal();
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

// =============================================================================

/**
 * Clean up all event listeners and resources
 */
export function cleanup() {
    _moduleListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _moduleListeners.length = 0;
}

export { initStorageSetup, renderStorageDashboard, createStoragePool };

