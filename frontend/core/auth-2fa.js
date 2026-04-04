/**
 * 2FA Module - Two-Factor Authentication
 * Extracted from main.js
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { t } from '../../i18n.js';

let _listeners = [];

// ════════════════════════════════════════════════════════════════════════════════
// 2FA FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════════

async function disable2FA() {
async function disable2FA() {
    const password = prompt('Introduce tu contraseña para desactivar 2FA:');
    if (!password) return;
    try {
        const res = await authFetch(`${API_BASE}/totp/disable`, {
            method: 'DELETE',
            body: JSON.stringify({ password })
        });
        if (!res.ok) { showNotification(t('auth.wrongPassword', 'Contraseña incorrecta'), 'error'); return; }
        await load2FAStatus();
    } catch (e) {
        showNotification(t('auth.disable2FAError', 'Error al desactivar 2FA'), 'error');
    }
}

// =============================================================================
// BACKUP & SCHEDULER VIEW
// =============================================================================



export {
    load2FAStatus,
    setup2FA,
    disable2FA
};
