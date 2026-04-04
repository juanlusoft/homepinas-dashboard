/**
 * HomeStore Module
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

async function renderHomeStoreView() {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;

    dashboardContent.innerHTML = '<div class="glass-card"><h3>HomeStore</h3><p>Loading apps...</p></div>';

    try {
        const response = await authFetch('/api/homestore');
        if (response.ok) {
            const data = await response.json();
            const apps = data.apps || [];

            let html = '<div class="glass-card"><h3>Available Apps</h3><div style="display:grid;gap:10px;">';
            apps.forEach(app => {
                html += `<div style="padding:10px;border:1px solid rgba(255,255,255,0.1);">${app.name}</div>`;
            });
            html += '</div></div>';

            dashboardContent.innerHTML = html;
        }
    } catch (error) {
        showNotification('Error loading HomeStore', 'error');
    }
}

export async function render(container) {
    await renderHomeStoreView();
}

export { renderHomeStoreView };
