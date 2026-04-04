// HomePiNAS Dashboard v3 - Bootstrap Entry Point
// This file is the application bootstrap. All business logic is in modules/

import { initI18n, t, applyTranslations, getCurrentLang } from './i18n.js';
import { escapeHtml, formatBytes, debounce, formatUptime } from './modules/utils.js';

// Core modules
import { initAPI, authFetch, loadSession, saveSession, clearSession } from './modules/api.js';
import { showNotification, showConfirmModal, celebrateWithConfetti, dismissNotification, cleanupNotifications } from './modules/notifications.js';
import { navigateTo, getViewFromPath, handleRouteChange, switchView as routerSwitchView, setupRouteListeners, cleanupRouter } from './modules/router.js';
import * as StateModule from './modules/state.js';

// Feature modules
import { renderTerminalView, cleanup as cleanupTerminal } from './modules/terminal/index.js';
import { renderFilesView, cleanup as cleanupFiles } from './modules/files/index.js';
import { renderDockerManager, cleanup as cleanupDocker } from './modules/docker/index.js';
import { renderStorageDashboard, cleanup as cleanupWizard } from './modules/storage/wizard.js';
import { renderVPNView, cleanup as cleanupVPN } from './modules/vpn/index.js';
import { renderSystemView, cleanup as cleanupSystem } from './modules/system/index.js';
import { renderNetworkManager, cleanup as cleanupNetwork } from './modules/network/index.js';
import { renderBackupView, renderActiveBackupView, cleanup as cleanupBackup } from './modules/backup/index.js';
import { renderActiveDirectoryView, cleanup as cleanupAD } from './modules/active-directory/index.js';
import { renderCloudSyncView, cleanup as cleanupCloudSync } from './modules/cloud-sync/index.js';
import { renderCloudBackupView, cleanup as cleanupCloudBackup } from './modules/cloud-backup/index.js';
import { renderHomeStoreView, cleanup as cleanupHomeStore } from './modules/homestore/index.js';
import { renderLogsView, cleanup as cleanupLogs } from './modules/logs/index.js';
import { renderUsersView, cleanup as cleanupUsers } from './modules/users/index.js';
import { renderDashboard, cleanup as cleanupDashboard } from './modules/dashboard/index.js';
import { renderUPSSection, cleanup as cleanupUPS } from './modules/ups/index.js';
import { startDiskDetectionPolling, stopGlobalPolling, cleanup as cleanupDiskMgmt } from './modules/disk-management/index.js';

// ════════════════════════════════════════════════════════════════════════════════
// GLOBAL STATE & CONFIG
// ════════════════════════════════════════════════════════════════════════════════

const { state, setState, getState } = StateModule;
const API_BASE = window.location.origin + '/api';

// DOM Elements
const views = {
    setup: document.getElementById('setup-view'),
    storage: document.getElementById('storage-view'),
    login: document.getElementById('login-view'),
    dashboard: document.getElementById('dashboard-view')
};

const dashboardContent = document.getElementById('dashboard-content');
const setupForm = document.getElementById('setup-form');

// ════════════════════════════════════════════════════════════════════════════════
// VIEW SWITCHING & ROUTING
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Switch between application views
 * @param {string} viewName - Name of the view to display
 * @param {boolean} skipRender - Skip rendering content (for dashboard)
 */
function switchView(viewName, skipRender = false) {
    const previousView = state.currentView;

    // Cleanup previous view listeners
    if (previousView === 'files') cleanupFiles();
    if (previousView === 'docker') cleanupDocker();
    if (previousView === 'terminal') cleanupTerminal();
    if (previousView === 'storage') cleanupWizard();
    if (previousView === 'vpn') cleanupVPN();
    if (previousView === 'system') cleanupSystem();
    if (previousView === 'network') cleanupNetwork();
    if (previousView === 'backup') cleanupBackup();
    if (previousView === 'active-directory') cleanupAD();
    if (previousView === 'cloud-sync') cleanupCloudSync();
    if (previousView === 'cloud-backup') cleanupCloudBackup();
    if (previousView === 'homestore') cleanupHomeStore();
    if (previousView === 'logs') cleanupLogs();
    if (previousView === 'users') cleanupUsers();
    if (previousView === 'dashboard') cleanupDashboard();
    if (previousView === 'ups') cleanupUPS();
    cleanupNotifications();

    Object.values(views).forEach(v => v?.classList.remove('active'));
    if (views[viewName]) {
        views[viewName].classList.add('active');
        if (!skipRender && viewName !== 'setup' && viewName !== 'login') {
            renderContent(viewName);
        }
    }
}

/**
 * Render content based on view
 * @param {string} view - View name to render
 */
async function renderContent(view) {
    state.currentView = view;
    dashboardContent.innerHTML = '';

    if (view === 'dashboard') await renderDashboard();
    else if (view === 'docker') await renderDockerManager();
    else if (view === 'storage') await renderStorageDashboard();
    else if (view === 'files') await renderFilesView();
    else if (view === 'terminal') await renderTerminalView(dashboardContent);
    else if (view === 'network') await renderNetworkManager();
    else if (view === 'backup') await renderBackupView();
    else if (view === 'active-backup') await renderActiveBackupView();
    else if (view === 'active-directory') await renderActiveDirectoryView();
    else if (view === 'cloud-sync') await renderCloudSyncView();
    else if (view === 'cloud-backup') await renderCloudBackupView();
    else if (view === 'vpn') await renderVPNView();
    else if (view === 'homestore') await renderHomeStoreView();
    else if (view === 'logs') await renderLogsView();
    else if (view === 'users') await renderUsersView();
    else if (view === 'system') await renderSystemView();
}

// ════════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Initialize authentication and session
 */
async function initAuth() {
    const resolveUnauthenticatedView = async () => {
        try {
            const statusRes = await fetch(`${API_BASE}/status`);
            if (statusRes.ok) {
                const status = await statusRes.json();
                if (status.requireSetup) {
                    switchView('setup');
                    navigateTo('/setup', true);
                } else {
                    switchView('login');
                    navigateTo('/login', true);
                }
                return;
            }
        } catch (_) {
            // fall through to login
        }
        switchView('login');
        navigateTo('/login', true);
    };

    try {
        const sessionId = loadSession();
        if (!sessionId) {
            await resolveUnauthenticatedView();
            return false;
        }

        const response = await authFetch(`${API_BASE}/verify-session`, { method: 'POST' });
        if (response.ok) {
            const data = await response.json();
            state.isAuthenticated = true;
            // verify-session may only return tokens; keep any known user object
            if (data.user) state.user = data.user;
            return true;
        } else {
            clearSession();
            await resolveUnauthenticatedView();
            return false;
        }
    } catch (error) {
        console.error('Auth error:', error);
        clearSession();
        await resolveUnauthenticatedView();
        return false;
    }
}

/**
 * Application initialization
 */
async function init() {
    if (setupForm && setupForm.dataset.bound !== '1') {
        setupForm.dataset.bound = '1';
        setupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('new-username')?.value?.trim();
        const password = document.getElementById('new-password')?.value || '';
        const termsAccepted = !!document.getElementById('accept-terms')?.checked;
        const submitBtn = setupForm.querySelector('button[type="submit"]');

        if (!username || !password) {
            showNotification(t('auth.fillAllFields', 'Completa todos los campos'), 'warning');
            return;
        }
        if (!termsAccepted) {
            showNotification(t('auth.acceptTermsFirst', 'Debes aceptar los términos de uso'), 'warning');
            return;
        }

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.textContent = t('auth.initializing', 'Inicializando...');
        }

        try {
            const res = await fetch(`${API_BASE}/setup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                if (
                    res.status === 400 &&
                    typeof data.message === 'string' &&
                    data.message.toLowerCase().includes('already exists')
                ) {
                    switchView('login');
                    navigateTo('/login', true);
                }
                throw new Error(data.message || t('common.error', 'Error al inicializar'));
            }

            saveSession(data.sessionId, data.csrfToken);
            state.isAuthenticated = true;
            state.user = data.user || { username };

            switchView('storage');
            navigateTo('/setup/storage', true);
            showNotification(t('auth.initializationComplete', 'Sistema inicializado correctamente'), 'success');
        } catch (error) {
            console.error('Setup error:', error);
            showNotification(error.message || t('common.error', 'Error al inicializar'), 'error');
        } finally {
            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.textContent = t('auth.initializeGateway', 'Inicializar Sistema');
            }
        }
        });
    }

    initAPI(state);
    await initI18n();
    const isAuthed = await initAuth();

    if (isAuthed) {
        switchView('dashboard');
        setupRouteListeners();
        startDiskDetectionPolling();
    }
}

// ════════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
    try {
        await init();
    } catch (error) {
        console.error('Fatal error:', error);
        switchView('setup');
        showNotification('Fatal error initializing application', 'error');
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    stopGlobalPolling();
    cleanupRouter();
    cleanupNotifications();
});

export { switchView, renderContent, state };
