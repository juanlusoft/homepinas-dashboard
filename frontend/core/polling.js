/**
 * Polling Module - Global data updates and monitoring
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';

const API_BASE = window.location.origin + '/api';

let _pollingIntervals = {
    stats: null,
    publicIP: null,
    storage: null
};

function stopGlobalPolling() {
    Object.keys(_pollingIntervals).forEach(key => {
        if (_pollingIntervals[key]) {
            clearInterval(_pollingIntervals[key]);
            _pollingIntervals[key] = null;
        }
    });
    if (state.pollingIntervals) {
        Object.keys(state.pollingIntervals).forEach(key => {
            if (state.pollingIntervals[key]) {
                clearInterval(state.pollingIntervals[key]);
                state.pollingIntervals[key] = null;
            }
        });
    }
}

async function updatePublicIP() {
    try {
        const res = await authFetch(`${API_BASE}/network/public-ip`);
        if (res.ok) {
            const data = await res.json();
            state.publicIP = data.ip || data.publicIP || '';
            const el = document.getElementById('public-ip-display');
            if (el) el.textContent = state.publicIP;
        }
    } catch (e) {
        console.debug('Public IP fetch failed:', e.message);
    }
}

function startGlobalPolling() {
    _pollingIntervals.stats = setInterval(async () => {
        try {
            const res = await authFetch(`${API_BASE}/system/stats`);
            if (res.ok) {
                state.globalStats = await res.json();
                if (state.currentView === "dashboard") {
                    import('../dashboard/index.js').then(m => m.renderDashboard(true)).catch(() => {});
                }
            }
        } catch (e) {
            if (e.message === 'Session expired' || e.message === 'CSRF_EXPIRED') {
                stopGlobalPolling();
                return;
            }
            console.error('Stats polling error:', e);
        }
    }, 5000);

    updatePublicIP();
    _pollingIntervals.publicIP = setInterval(updatePublicIP, 1000 * 60 * 10);
}

export {
    startGlobalPolling,
    stopGlobalPolling,
    updatePublicIP,
    _pollingIntervals
};
