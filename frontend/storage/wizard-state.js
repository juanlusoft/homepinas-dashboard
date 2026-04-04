/**
 * WIZARD STATE
 * ════════════════════════════════════════════════════════════════════════════════
 * Shared wizard state object and localStorage persistence helpers.
 */

// ════════════════════════════════════════════════════════════════════════════════
// SHARED STATE
// ════════════════════════════════════════════════════════════════════════════════

export const wizardState = {
    currentStep: 1,
    totalSteps: 7,
    disks: [],
    selectedDataDisks: [],
    selectedParityDisk: null,
    selectedCacheDisk: null,
    isConfiguring: false
};

// Load wizard state from localStorage
export function loadWizardState() {
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
export function saveWizardState() {
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
export function clearWizardState() {
    wizardState.currentStep = 1;
    wizardState.selectedDataDisks = [];
    wizardState.selectedParityDisk = null;
    wizardState.selectedCacheDisk = null;
    localStorage.removeItem('homepinas-wizard-state');
}
