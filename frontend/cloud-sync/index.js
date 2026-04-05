/**
 * Cloud Sync Module - Cloud Synchronization Management
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { t } from '/frontend/i18n.js';
import { escapeHtml } from '../utils.js';

let _csListeners = [];

function _trackListener(element, event, handler) {
    _csListeners.push({ element, event, handler });
}

async function renderCloudSyncView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    
    // Clear any existing refresh interval
    if (cloudSyncRefreshInterval) {
        clearInterval(cloudSyncRefreshInterval);
        cloudSyncRefreshInterval = null;
    }
    
    dashboardContent.innerHTML = `
        <div class="card cloudsync-card">
            <div id="cloud-sync-status">
                <h3 class="cloudsync-title">☁️ Cloud Sync</h3>
                <p>Cargando...</p>
            </div>
        </div>
        <div id="cloud-sync-content"></div>
    `;
    
    await loadCloudSyncStatus();
    
    // Auto-refresh every 5 seconds when view is active
    cloudSyncRefreshInterval = setInterval(async () => {
        if (document.getElementById('cloud-sync-status')) {
            await refreshSyncStatus();
        } else {
            // View no longer visible, stop refresh
            clearInterval(cloudSyncRefreshInterval);
            cloudSyncRefreshInterval = null;
        }
    }, 5000);
}


export function cleanup() {
    _csListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _csListeners = [];
}

export async function render(container) {
    await renderCloudSyncView();
}

export { renderCloudSyncView };
