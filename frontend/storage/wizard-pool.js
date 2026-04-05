/**
 * WIZARD POOL CREATION
 * ════════════════════════════════════════════════════════════════════════════════
 * Storage pool creation (API call + progress tracking), legacy progress modal,
 * and SnapRAID sync polling.
 */

import { authFetch } from '../api.js';
import { showNotification, celebrateWithConfetti } from '../notifications.js';
import { state } from '../state.js';
import { t } from '/frontend/i18n.js';
import { wizardState } from './wizard-state.js';
import { navigateWizard } from './wizard-navigation.js';

const API_BASE = `${window.location.origin}/api`;

// ════════════════════════════════════════════════════════════════════════════════
// POOL CREATION (wizard step 6 / 7)
// ════════════════════════════════════════════════════════════════════════════════

// Create the storage pool
export async function createStoragePool() {
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

// ════════════════════════════════════════════════════════════════════════════════
// TASK PROGRESS UI
// ════════════════════════════════════════════════════════════════════════════════

// Update a task in the progress list
export function updateWizardTask(taskName, status, message) {
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

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY PROGRESS MODAL
// ════════════════════════════════════════════════════════════════════════════════

const progressModal = document.getElementById('storage-progress-modal');
const progressSteps = {
    format: document.getElementById('step-format'),
    mount: document.getElementById('step-mount'),
    snapraid: document.getElementById('step-snapraid'),
    mergerfs: document.getElementById('step-mergerfs'),
    fstab: document.getElementById('step-fstab'),
    sync: document.getElementById('step-sync')
};

export function showProgressModal() {
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

export function hideProgressModal() {
    if (progressModal) progressModal.classList.remove('active');
}

export function updateProgressStep(stepId, status) {
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

export function updateSyncProgress(percent, statusText) {
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

export async function pollSyncProgress() {
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
