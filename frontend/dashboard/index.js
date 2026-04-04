/**
 * Dashboard Module - Main statistics and system overview
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { t } from '../../i18n.js';
import { escapeHtml, formatBytes } from '../utils.js';

let _dashListeners = [];

function _trackListener(element, event, handler) {
    _dashListeners.push({ element, event, handler });
}

// ════════════════════════════════════════════════════════════════════════════════
// DASHBOARD VIEW - Main system statistics and overview
// ════════════════════════════════════════════════════════════════════════════════

async function renderDashboard(quickRefresh) {
    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;

    try {
        if (!quickRefresh) {
            const response = await authFetch('/api/dashboard');
            if (!response.ok) throw new Error('Failed to load dashboard');
            const data = await response.json();
            state.globalStats = data.stats || {};
        }

        dashboardContent.innerHTML = '';

        // CPU, RAM, Temp, Uptime cards
        const grid = document.createElement('div');
        grid.className = 'dashboard-grid';
        grid.style.display = 'grid';
        grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(200px, 1fr))';
        grid.style.gap = '20px';

        const stats = [
            { label: 'CPU', value: state.globalStats.cpuLoad + '%', icon: '💻' },
            { label: 'RAM', value: Math.round((state.globalStats.ramUsed / state.globalStats.ramTotal) * 100) + '%', icon: '🧠' },
            { label: 'Temp', value: state.globalStats.cpuTemp + '°C', icon: '🌡️' },
            { label: 'Uptime', value: formatUptime(state.globalStats.uptime || 0), icon: '⏱️' }
        ];

        stats.forEach(stat => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.padding = '20px';
            card.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 10px;">${stat.icon}</div>
                <div style="font-size: 12px; color: rgba(255,255,255,0.7);">${stat.label}</div>
                <div style="font-size: 24px; font-weight: bold; margin-top: 10px;">${stat.value}</div>
            `;
            grid.appendChild(card);
        });

        dashboardContent.appendChild(grid);

    } catch (error) {
        console.error('Dashboard error:', error);
        showNotification('Error loading dashboard', 'error');
    }
}

/**
 * Cleanup function
 */
export function cleanup() {
    _dashListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _dashListeners = [];
}

export { renderDashboard };
