/**
 * WIZARD NAVIGATION
 * ════════════════════════════════════════════════════════════════════════════════
 * Step-to-step navigation, progress indicator updates, and configuration
 * summary rendering for the storage setup wizard.
 */

import { escapeHtml, formatBytes } from '../utils.js';
import { t } from '/frontend/i18n.js';
import { state } from '../state.js';
import { wizardState, saveWizardState, clearWizardState } from './wizard-state.js';
import { updateParityDiskOptions, updateCacheDiskOptions, getDiskIcon, parseDiskSize } from './wizard-disk-selection.js';

// switchView is resolved at call-time via the global shim in wizard.js
function switchView(viewName) {
    if (typeof window.switchView === 'function') {
        window.switchView(viewName);
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// WIZARD NAVIGATION SETUP
// ════════════════════════════════════════════════════════════════════════════════

// Setup wizard navigation buttons
export function setupWizardNavigation() {
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
    // wizard-create-pool is bound in wizard.js after importing createStoragePool

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

// ════════════════════════════════════════════════════════════════════════════════
// STEP NAVIGATION
// ════════════════════════════════════════════════════════════════════════════════

// Navigate to a specific wizard step
export function navigateWizard(step) {
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

// ════════════════════════════════════════════════════════════════════════════════
// PROGRESS INDICATOR
// ════════════════════════════════════════════════════════════════════════════════

// Update the progress dots
export function updateWizardProgress(step) {
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

// ════════════════════════════════════════════════════════════════════════════════
// SUMMARY STEP
// ════════════════════════════════════════════════════════════════════════════════

// Update the summary step
export function updateSummary() {
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

// ════════════════════════════════════════════════════════════════════════════════
// LEGACY SUMMARY (compatibility)
// ════════════════════════════════════════════════════════════════════════════════

// Legacy function for compatibility
export function updateSummaryLegacy() {
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
