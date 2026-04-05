/**
 * Notifications Module
 * Manages toast notifications, confirmation modals, and celebration effects
 * @module notifications
 */

import { escapeHtml } from './utils.js';
import { t } from '/frontend/i18n.js';

// Local state
let notificationQueue = [];
let isShowingNotification = false;

/**
 * Helper function for accessibility: trap focus within modal
 * @param {HTMLElement} modal - Modal element to trap focus in
 * @returns {Function|null} - Cleanup function to remove event listener
 */
function trapFocus(modal) {
    const focusableSelectors = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const focusableElements = modal.querySelectorAll(focusableSelectors);
    if (focusableElements.length === 0) return null;

    const firstFocusable = focusableElements[0];
    const lastFocusable = focusableElements[focusableElements.length - 1];

    const handler = (e) => {
        if (e.key !== 'Tab') return;
        if (e.shiftKey) {
            if (document.activeElement === firstFocusable) {
                lastFocusable.focus();
                e.preventDefault();
            }
        } else {
            if (document.activeElement === lastFocusable) {
                firstFocusable.focus();
                e.preventDefault();
            }
        }
    };

    modal.addEventListener('keydown', handler);
    firstFocusable.focus();
    return handler;
}

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Type: 'success', 'error', 'warning', 'info' (default: 'info')
 * @param {number} duration - Duration in ms (default: 4000)
 */
export function showNotification(message, type = 'info', duration = 4000) {
    notificationQueue.push({ message, type, duration });
    processNotificationQueue();
}

/**
 * Build notification element DOM
 * @private
 * @param {string} message - The notification message
 * @param {string} type - Type: 'success', 'error', 'warning', 'info'
 * @returns {HTMLElement} - The notification toast element
 */
function _buildNotificationElement(message, type) {
    const toast = document.createElement('div');
    toast.className = `notification-toast ${type}`;
    toast.setAttribute('role', 'alert');
    toast.setAttribute('aria-live', 'polite');

    // Icon based on type
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };

    // Title based on type (i18n)
    const titles = {
        success: t('common.success', 'Éxito'),
        error: t('common.errorTitle', 'Error'),
        warning: t('common.warning', 'Advertencia'),
        info: t('common.info', 'Información')
    };

    toast.innerHTML = `
        <span class="notification-icon">${icons[type] || icons.info}</span>
        <div class="notification-content">
            <div class="notification-title">${titles[type] || titles.info}</div>
            <div class="notification-message">${escapeHtml(message)}</div>
        </div>
        <button class="notification-close" aria-label="${t('common.close', 'Cerrar')}">×</button>
    `;

    return toast;
}

/**
 * Process notification queue and display next notification
 * @private
 */
function processNotificationQueue() {
    if (isShowingNotification || notificationQueue.length === 0) return;

    isShowingNotification = true;
    const { message, type, duration } = notificationQueue.shift();

    // Remove any existing notification
    const existing = document.querySelector('.notification-toast');
    if (existing) existing.remove();

    // Build and append notification element
    const toast = _buildNotificationElement(message, type);
    document.body.appendChild(toast);

    // Close button handler
    const closeBtn = toast.querySelector('.notification-close');
    closeBtn.addEventListener('click', () => dismissNotification(toast));

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    // Auto dismiss
    setTimeout(() => dismissNotification(toast), duration);
}

/**
 * Dismiss a notification toast
 * @param {HTMLElement} toast - Toast element to dismiss
 */
export function dismissNotification(toast) {
    if (!toast || !toast.parentNode) {
        isShowingNotification = false;
        processNotificationQueue();
        return;
    }

    toast.classList.remove('show');

    setTimeout(() => {
        if (toast.parentNode) toast.remove();
        isShowingNotification = false;
        processNotificationQueue();
    }, 400);
}

/**
 * Build confirm modal DOM element
 * @private
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {string} confirmText - Confirm button text
 * @param {string} cancelText - Cancel button text
 * @returns {HTMLElement} - The modal element
 */
function _buildConfirmModal(title, message, confirmText, cancelText) {
    const modal = document.createElement('div');
    modal.id = 'confirm-modal';
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease;
    `;

    modal.innerHTML = `
        <div class="glass-card scale-in dash-confirm-card">
            <h3 class="dash-confirm-title">${escapeHtml(title)}</h3>
            <p class="dash-confirm-message">${escapeHtml(message)}</p>
            <div class="dash-confirm-actions">
                <button id="confirm-cancel" class="wizard-btn wizard-btn-back">${escapeHtml(cancelText)}</button>
                <button id="confirm-ok" class="wizard-btn wizard-btn-next">${escapeHtml(confirmText)}</button>
            </div>
        </div>
    `;

    return modal;
}

/**
 * Bind event handlers to confirm modal
 * @private
 * @param {HTMLElement} modal - The modal element
 * @param {Function} resolve - Promise resolve function
 */
function _bindConfirmModalEvents(modal, resolve) {
    const confirmBtn = document.getElementById('confirm-ok');
    const cancelBtn = document.getElementById('confirm-cancel');

    if (!confirmBtn || !cancelBtn) {
        resolve(false);
        return;
    }

    const handleConfirm = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        document.removeEventListener('keydown', handleEscape);
        modal.remove();
        resolve(true);
    };

    const handleCancel = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
        modal.removeEventListener('click', handleBackdropClick);
        document.removeEventListener('keydown', handleEscape);
        modal.remove();
        resolve(false);
    };

    const handleBackdropClick = (e) => {
        if (e.target === modal) {
            handleCancel();
        }
    };

    const handleEscape = (e) => {
        if (e.key === 'Escape') {
            handleCancel();
        }
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
    modal.addEventListener('click', handleBackdropClick);
    document.addEventListener('keydown', handleEscape);
}

/**
 * Show a confirmation modal dialog
 * @param {string} title - Modal title
 * @param {string} message - Modal message
 * @param {string} confirmText - Confirm button text (default: 'Confirmar')
 * @param {string} cancelText - Cancel button text (default: 'Cancelar')
 * @returns {Promise<boolean>} - True if confirmed, false if cancelled
 */
export function showConfirmModal(title, message, confirmText = null, cancelText = null) {
    confirmText = confirmText || t('common.confirm', 'Confirmar');
    cancelText = cancelText || t('common.cancel', 'Cancelar');

    return new Promise((resolve) => {
        // Remove any existing confirm modal
        const existing = document.getElementById('confirm-modal');
        if (existing) existing.remove();

        // Build modal element
        const modal = _buildConfirmModal(title, message, confirmText, cancelText);
        document.body.appendChild(modal);

        // Setup focus trap
        trapFocus(modal);

        // Bind event handlers
        _bindConfirmModalEvents(modal, resolve);
    });
}

/**
 * Create confetti celebration effect
 */
export function celebrateWithConfetti() {
    const container = document.createElement('div');
    container.className = 'confetti-container';
    document.body.appendChild(container);

    const colors = ['#4ecdc4', '#ff6b6b', '#ffe66d', '#95e1d3', '#f38181', '#aa96da'];

    for (let i = 0; i < 50; i++) {
        const confetti = document.createElement('div');
        confetti.className = 'confetti';
        confetti.style.cssText = `
            position: fixed;
            width: 10px;
            height: 10px;
            background: ${colors[Math.floor(Math.random() * colors.length)]};
            left: ${Math.random() * 100}%;
            top: -10px;
            border-radius: 50%;
            animation: confetti-fall 3s ease-in-out forwards;
            pointer-events: none;
        `;
        container.appendChild(confetti);
    }

    // Cleanup after animation
    setTimeout(() => container.remove(), 3000);
}

/**
 * Cleanup notifications module (called on app shutdown)
 */
export function cleanupNotifications() {
    // Clear all pending notifications
    notificationQueue = [];
    isShowingNotification = false;

    // Remove any visible toasts
    const toasts = document.querySelectorAll('.notification-toast');
    toasts.forEach(toast => toast.remove());

    // Remove any open modals
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.remove();
}
