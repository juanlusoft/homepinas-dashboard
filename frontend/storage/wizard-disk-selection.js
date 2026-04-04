/**
 * WIZARD DISK SELECTION
 * ════════════════════════════════════════════════════════════════════════════════
 * Disk card rendering, selection handling, and option filtering for the
 * storage setup wizard (steps 2, 3, 4 — data / parity / cache selection).
 */

import { escapeHtml } from '../utils.js';
import { t } from '../../i18n.js';
import { wizardState, saveWizardState } from './wizard-state.js';

// ════════════════════════════════════════════════════════════════════════════════
// DISK ICONS
// ════════════════════════════════════════════════════════════════════════════════

// Get appropriate icon for disk type
export function getDiskIcon(type) {
    switch (type?.toUpperCase()) {
        case 'NVME': return '⚡';
        case 'SSD': return '💾';
        case 'HDD': return '💿';
        default: return '📀';
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// DISK CARD HTML
// ════════════════════════════════════════════════════════════════════════════════

// Create a disk selection card
export function createDiskCard(disk, inputType, role) {
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

// ════════════════════════════════════════════════════════════════════════════════
// POPULATE DISK LISTS
// ════════════════════════════════════════════════════════════════════════════════

// Populate disk selection lists for all wizard steps
export function populateWizardDiskLists() {
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

// ════════════════════════════════════════════════════════════════════════════════
// SELECTION HANDLERS
// ════════════════════════════════════════════════════════════════════════════════

// Setup click listeners for disk cards
export function setupDiskCardListeners(container, role) {
    container.querySelectorAll('.wizard-disk-card').forEach(card => {
        card.addEventListener('click', () => handleDiskSelection(card, role));
    });
}

// Handle disk selection
export function handleDiskSelection(card, role) {
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

// ════════════════════════════════════════════════════════════════════════════════
// OPTION FILTERING
// ════════════════════════════════════════════════════════════════════════════════

// Update parity disk options based on data disk selection
export function updateParityDiskOptions() {
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
export function updateCacheDiskOptions() {
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

// ════════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ════════════════════════════════════════════════════════════════════════════════

// Parse disk size string to bytes for comparison
export function parseDiskSize(sizeStr) {
    if (!sizeStr) return 0;
    const match = sizeStr.match(/^([\d.]+)\s*(TB|GB|MB|KB|B)?$/i);
    if (!match) return 0;
    const num = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    const multipliers = { B: 1, KB: 1024, MB: 1024**2, GB: 1024**3, TB: 1024**4 };
    return num * (multipliers[unit] || 1);
}

// Restore saved selections when disk lists are populated
export function restoreWizardSelections() {
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
