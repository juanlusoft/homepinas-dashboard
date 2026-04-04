/**
 * Active Directory Module - LDAP Integration
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

async function renderActiveDirectoryView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;

    dashboardContent.innerHTML = '<div class="glass-card"><h3>Active Directory</h3><p>Loading AD information...</p></div>';

    try {
        const response = await authFetch('/api/active-directory');
        if (response.ok) {
            const data = await response.json();
            dashboardContent.innerHTML = `
                <div class="glass-card">
                    <h3>Active Directory Status</h3>
                    <p>Status: ${data.status || 'Unknown'}</p>
                    <p>Domain: ${data.domain || 'Not configured'}</p>
                </div>
            `;
        }
    } catch (error) {
        showNotification('Error loading Active Directory', 'error');
    }
}

export async function render(container) {
    await renderActiveDirectoryView();
}

export { renderActiveDirectoryView };
