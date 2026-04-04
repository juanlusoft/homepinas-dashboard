/**
 * Polling Module - Global data updates and monitoring
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';

let _pollingIntervals = {
    stats: null,
    publicIP: null,
    storage: null
};

// ════════════════════════════════════════════════════════════════════════════════
// GLOBAL POLLING FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

function startGlobalPolling() {
    // Polling System Stats (CPU/RAM/Temp)
    state.pollingIntervals.stats = setInterval(async () => {
        try {
            const res = await authFetch(`${API_BASE}/system/stats`);
            if (res.ok) {
                state.globalStats = await res.json();

                // Re-render dashboard if still on dashboard view
                // Do NOT increment renderGeneration — only user navigation does that
                if (state.currentView === "dashboard") {
                    renderDashboard(true);
                }
            }
        } catch (e) {
            // Session expired - authFetch handles redirect, stop polling
            if (e.message === 'Session expired' || e.message === 'CSRF_EXPIRED') {
                stopGlobalPolling();
                return;
            }
            console.error('Stats polling error:', e);
        }
    }, 5000);

    // Polling Public IP
    updatePublicIP();
    state.pollingIntervals.publicIP = setInterval(updatePublicIP, 1000 * 60 * 10);
    
    // Start disk detection polling
    startDiskDetectionPolling();
}


export {
    startGlobalPolling,
    stopGlobalPolling,
    updatePublicIP,
    _pollingIntervals
};
