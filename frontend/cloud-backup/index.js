/**
 * Cloud Backup Module
 */
import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { t } from '../../i18n.js';

let _listeners = [];
export function cleanup() {
    _listeners.forEach(({element, event, handler}) => {
        element.removeEventListener(event, handler);
    });
    _listeners = [];
}

async function renderCloudBackupView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    
    dashboardContent.innerHTML = '<div class="glass-card"><h3>Cloud Backup</h3><p>Loading...</p></div>';
    
    try {
        const response = await authFetch('/api/cloud-backup');
        if (response.ok) {
            const data = await response.json();
            dashboardContent.innerHTML = `
                <div class="glass-card">
                    <h3>Cloud Backup Status</h3>
                    <p>Status: ${data.status || 'Inactive'}</p>
                    <p>Last backup: ${data.lastBackup || 'Never'}</p>
                </div>
            `;
        }
    } catch (error) {
        showNotification('Error loading Cloud Backup', 'error');
    }
}

export { renderCloudBackupView };
