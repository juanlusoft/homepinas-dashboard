/**
 * 2FA Module - Two-Factor Authentication
 * Manages TOTP setup, verification, and disable flows.
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { t } from '../../i18n.js';

const API_BASE = window.location.origin + '/api';

let _listeners = [];

function _trackListener(el, event, handler) {
    el.addEventListener(event, handler);
    _listeners.push({ el, event, handler });
}

/**
 * Fetches 2FA status from backend and renders the status card
 * into #two-fa-section if it exists, or returns the status object.
 * @returns {Promise<{enabled: boolean}>}
 */
export async function load2FAStatus() {
    try {
        const res = await authFetch(`${API_BASE}/totp/status`);
        if (!res.ok) throw new Error('Failed to load 2FA status');
        const data = await res.json();

        const section = document.getElementById('two-fa-section');
        if (!section) return data;

        if (data.enabled) {
            section.innerHTML = `
                <div class="glass-card">
                    <div class="card-header">
                        <h3>${t('auth.2faEnabled', 'Autenticación de dos factores')}</h3>
                        <span class="badge badge-success">${t('auth.active', 'Activo')}</span>
                    </div>
                    <p>${t('auth.2faEnabledDesc', 'Tu cuenta está protegida con autenticación de dos factores.')}</p>
                    <button id="disable-2fa-btn" class="btn btn-danger">
                        ${t('auth.disable2FA', 'Desactivar 2FA')}
                    </button>
                </div>`;
            const disableBtn = document.getElementById('disable-2fa-btn');
            if (disableBtn) _trackListener(disableBtn, 'click', disable2FA);
        } else {
            section.innerHTML = `
                <div class="glass-card">
                    <div class="card-header">
                        <h3>${t('auth.2faDisabled', 'Autenticación de dos factores')}</h3>
                        <span class="badge badge-warning">${t('auth.inactive', 'Inactivo')}</span>
                    </div>
                    <p>${t('auth.2faDisabledDesc', 'Añade una capa extra de seguridad activando la autenticación de dos factores.')}</p>
                    <button id="setup-2fa-btn" class="btn btn-primary">
                        ${t('auth.setup2FA', 'Configurar 2FA')}
                    </button>
                </div>`;
            const setupBtn = document.getElementById('setup-2fa-btn');
            if (setupBtn) _trackListener(setupBtn, 'click', setup2FA);
        }

        return data;
    } catch (e) {
        showNotification(t('auth.load2FAError', 'Error al cargar estado de 2FA'), 'error');
        return { enabled: false };
    }
}

/**
 * Initiates 2FA setup: fetches QR code, shows it in a custom modal,
 * then verifies the TOTP token entered by the user.
 *
 * NOTE: showConfirmModal from notifications.js escapes its message as plain
 * text, so a custom inline modal is used here to render the QR image and
 * token input field as HTML.
 */
export async function setup2FA() {
    try {
        const res = await authFetch(`${API_BASE}/totp/setup`, { method: 'POST' });
        if (!res.ok) throw new Error('Failed to start 2FA setup');
        const { qrCode, secret } = await res.json();

        // Remove any stale modal
        const existing = document.getElementById('setup-2fa-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.id = 'setup-2fa-modal';
        modal.style.cssText = `
            position: fixed;
            top: 0; left: 0;
            width: 100%; height: 100%;
            background: rgba(0,0,0,0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        modal.innerHTML = `
            <div class="glass-card scale-in" style="max-width:420px;width:90%;padding:2rem">
                <h3 style="margin-bottom:1rem">${t('auth.setup2FATitle', 'Configurar autenticación de dos factores')}</h3>
                <div style="text-align:center">
                    <p>${t('auth.scanQR', 'Escanea este código QR con tu app de autenticación (Google Authenticator, Authy, etc.)')}</p>
                    <img src="${qrCode}" alt="QR Code 2FA" style="width:200px;height:200px;margin:1rem auto;display:block" />
                    <p style="font-size:0.85rem;color:var(--text-muted)">${t('auth.manualCode', 'Código manual:')} <code>${secret}</code></p>
                    <div style="margin-top:1rem">
                        <label style="display:block;margin-bottom:0.5rem">${t('auth.enterToken', 'Introduce el código de 6 dígitos:')}</label>
                        <input id="totp-verify-input" type="text" inputmode="numeric" maxlength="6"
                               pattern="[0-9]{6}" autocomplete="one-time-code"
                               class="form-input" style="text-align:center;font-size:1.5rem;letter-spacing:0.3rem;width:12rem" />
                    </div>
                </div>
                <div style="display:flex;gap:0.75rem;justify-content:flex-end;margin-top:1.5rem">
                    <button id="setup-2fa-cancel" class="wizard-btn wizard-btn-back">${t('common.cancel', 'Cancelar')}</button>
                    <button id="setup-2fa-confirm" class="wizard-btn wizard-btn-next">${t('auth.verify', 'Verificar')}</button>
                </div>
            </div>`;

        document.body.appendChild(modal);

        const inputEl = document.getElementById('totp-verify-input');
        const confirmBtn = document.getElementById('setup-2fa-confirm');
        const cancelBtn = document.getElementById('setup-2fa-cancel');

        function handleEsc(e) {
            if (e.key === 'Escape') closeModal();
        }

        const closeModal = () => {
            document.removeEventListener('keydown', handleEsc);
            modal.remove();
        };

        const handleVerify = async () => {
            const token = inputEl?.value?.trim();
            if (!token || token.length !== 6) {
                showNotification(t('auth.invalidToken', 'Introduce un código de 6 dígitos'), 'warning');
                return;
            }
            try {
                const verifyRes = await authFetch(`${API_BASE}/totp/verify`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token })
                });
                if (!verifyRes.ok) {
                    showNotification(t('auth.invalidToken', 'Código incorrecto, inténtalo de nuevo'), 'error');
                    return;
                }
                showNotification(t('auth.2faEnabled', '2FA activado correctamente'), 'success');
                closeModal();
                await load2FAStatus();
            } catch (err) {
                showNotification(t('auth.setup2FAError', 'Error al verificar el código'), 'error');
            }
        };

        confirmBtn.addEventListener('click', handleVerify);
        cancelBtn.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });
        document.addEventListener('keydown', handleEsc);

        inputEl?.focus();
    } catch (e) {
        showNotification(t('auth.setup2FAError', 'Error al configurar 2FA'), 'error');
    }
}

/**
 * Disables 2FA after confirming the user's password.
 */
export async function disable2FA() {
    const password = prompt(t('auth.enterPasswordToDisable', 'Introduce tu contraseña para desactivar 2FA:'));
    if (!password) return;
    try {
        const res = await authFetch(`${API_BASE}/totp/disable`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        if (!res.ok) {
            showNotification(t('auth.wrongPassword', 'Contraseña incorrecta'), 'error');
            return;
        }
        showNotification(t('auth.2faDisabled', '2FA desactivado'), 'success');
        await load2FAStatus();
    } catch (e) {
        showNotification(t('auth.disable2FAError', 'Error al desactivar 2FA'), 'error');
    }
}

export function cleanup() {
    _listeners.forEach(({ el, event, handler }) => {
        el.removeEventListener(event, handler);
    });
    _listeners = [];
}
