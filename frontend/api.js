/**
 * API Module
 * Centralized HTTP requests with authentication and session management
 * @module api
 */

import { t } from '../i18n.js';
import { showNotification } from './notifications.js';
import { switchView } from './router.js';

// State reference - injected by main.js
let stateRef = {
    isAuthenticated: false,
    sessionId: null,
    csrfToken: null,
    user: null
};
let API_BASE = null;

/**
 * Initialize API module with state reference
 * @param {Object} state - Global application state
 */
export function initAPI(state) {
    stateRef = state;
    API_BASE = window.location.origin + '/api';
}

/**
 * Authenticated fetch wrapper
 * Adds session and CSRF tokens to requests
 * Handles CSRF and session expiration errors
 * @param {string} url - Request URL
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} - Fetch response
 * @throws {Error} - If session expired or CSRF invalid
 */
export async function authFetch(url, options = {}) {
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
    };

    if (stateRef.sessionId) {
        headers['X-Session-Id'] = stateRef.sessionId;
    }

    if (stateRef.csrfToken) {
        headers['X-CSRF-Token'] = stateRef.csrfToken;
    }

    const response = await fetch(url, { ...options, headers });

    // Handle CSRF errors (token expired after server restart)
    if (response.status === 403) {
        const cloned = response.clone();
        try {
            const data = await cloned.json();
            if (data.code === 'CSRF_INVALID' || (data.error && data.error.includes('CSRF'))) {
                clearSession();
                showNotification(
                    t('auth.sessionExpired', 'Sesión expirada. Por favor, inicia sesión de nuevo.'),
                    'warning'
                );
                setTimeout(() => location.reload(), 1500);
                throw new Error('CSRF_EXPIRED');
            }
        } catch (e) {
            if (e.message === 'CSRF_EXPIRED') throw e;
            // Not a JSON response or not CSRF error, continue
        }
    }

    // Handle session expiration
    if (response.status === 401 && stateRef.isAuthenticated) {
        stateRef.isAuthenticated = false;
        stateRef.sessionId = null;
        stateRef.user = null;
        sessionStorage.removeItem('sessionId');
        switchView('login');
        throw new Error('Session expired');
    }

    return response;
}

/**
 * Save session information to state and sessionStorage
 * @param {string} sessionId - Session ID from backend
 * @param {string} csrfToken - CSRF token from backend (optional)
 */
export function saveSession(sessionId, csrfToken = null) {
    stateRef.sessionId = sessionId;
    sessionStorage.setItem('sessionId', sessionId);
    if (csrfToken) {
        stateRef.csrfToken = csrfToken;
        sessionStorage.setItem('csrfToken', csrfToken);
    }
}

/**
 * Load session information from sessionStorage
 * @returns {string|null} - Session ID if found, null otherwise
 */
export function loadSession() {
    const sessionId = sessionStorage.getItem('sessionId');
    const csrfToken = sessionStorage.getItem('csrfToken');
    if (sessionId) {
        stateRef.sessionId = sessionId;
    }
    if (csrfToken) {
        stateRef.csrfToken = csrfToken;
    }
    return sessionId;
}

/**
 * Clear session information from state and sessionStorage
 */
export function clearSession() {
    stateRef.sessionId = null;
    stateRef.csrfToken = null;
    stateRef.user = null;
    stateRef.isAuthenticated = false;
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('csrfToken');
}

/**
 * Cleanup API module
 */
export function cleanupAPI() {
    // Clear any pending requests or timers if needed
}
