/**
 * Users Module
 * Extracted from main.js
 */
import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { state } from '../state.js';
import { t } from '/frontend/i18n.js';

let _listeners = [];
export function cleanup() { _listeners.forEach(({element, event, handler}) => element.removeEventListener(event, handler)); _listeners = []; }

async function renderUsersView() {
    const container = document.createElement('div');
    container.className = 'users-layout';

    // LEFT COLUMN: Users card
    const usersCard = document.createElement('div');
    usersCard.className = 'glass-card';

    const header = document.createElement('div');
    header.className = 'users-card-header';

    const title = document.createElement('h3');
    title.textContent = '👥 Gestión de Usuarios';

    const addBtn = document.createElement('button');
    addBtn.className = 'btn-primary btn-sm';
    addBtn.textContent = '+ Añadir Usuario';
    addBtn.addEventListener('click', () => showUserForm());

    header.appendChild(title);
    header.appendChild(addBtn);
    usersCard.appendChild(header);

    // Users table
    const table = document.createElement('div');
    table.id = 'users-table';
    table.className = 'users-table';

    const tableHeader = document.createElement('div');
    tableHeader.className = 'users-table-header';
    tableHeader.innerHTML = '<span>Usuario</span><span>Rol</span><span>Creado</span><span>Último Acceso</span><span>Acciones</span>';
    table.appendChild(tableHeader);

    const usersList = document.createElement('div');
    usersList.id = 'users-list';
    table.appendChild(usersList);
    usersCard.appendChild(table);
    container.appendChild(usersCard);

    // RIGHT COLUMN: My Account + 2FA
    const rightCol = document.createElement('div');
    rightCol.className = 'users-right-col';

    // My Account Card
    const accountCard = document.createElement('div');
    accountCard.className = 'glass-card';

    const accountTitle = document.createElement('h3');
    accountTitle.textContent = '👤 Mi Cuenta';
    accountTitle.style.marginBottom = '15px';
    accountCard.appendChild(accountTitle);

    const accountContent = document.createElement('div');
    accountContent.id = 'my-account-content';
    accountContent.innerHTML = `
        <div class="users-account-info">
            <div class="users-account-row">
                <span class="users-account-label">Usuario</span>
                <span class="users-account-value">${escapeHtml(state.user?.username || 'admin')}</span>
            </div>
            <div class="users-account-row">
                <span class="users-account-label">Rol</span>
                <span class="users-account-value">Administrador</span>
            </div>
        </div>
        <hr style="border: none; border-top: 1px solid var(--border); margin: 16px 0;">
        <h4 style="margin-bottom: 12px; font-size: 0.9rem;">🔑 Cambiar Contraseña</h4>
        <form id="change-password-form" class="users-password-form">
            <div class="input-group">
                <input type="password" id="cp-current" required placeholder=" ">
                <label>Contraseña actual</label>
            </div>
            <div class="input-group">
                <input type="password" id="cp-new" required placeholder=" " minlength="6">
                <label>Nueva contraseña</label>
            </div>
            <div class="input-group">
                <input type="password" id="cp-confirm" required placeholder=" " minlength="6">
                <label>Confirmar nueva contraseña</label>
            </div>
            <div id="cp-message" class="users-password-message"></div>
            <button type="submit" class="btn-primary" style="width: 100%;">Cambiar Contraseña</button>
        </form>
    `;
    accountCard.appendChild(accountContent);
    rightCol.appendChild(accountCard);

    // 2FA Card
    const tfaCard = document.createElement('div');
    tfaCard.className = 'glass-card';

    const tfaTitle = document.createElement('h3');
    tfaTitle.textContent = '🔐 Autenticación de Dos Factores (2FA)';
    tfaTitle.style.marginBottom = '15px';
    tfaCard.appendChild(tfaTitle);

    const tfaContent = document.createElement('div');
    tfaContent.id = 'tfa-content';
    tfaContent.innerHTML = '<p class="users-loading-text">Cargando...</p>';
    tfaCard.appendChild(tfaContent);
    rightCol.appendChild(tfaCard);

    container.appendChild(rightCol);

    dashboardContent.appendChild(container);

    // Setup change password form handler
    document.getElementById('change-password-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const msgEl = document.getElementById('cp-message');
        const currentPassword = document.getElementById('cp-current').value;
        const newPassword = document.getElementById('cp-new').value;
        const confirmPassword = document.getElementById('cp-confirm').value;

        if (newPassword !== confirmPassword) {
            msgEl.textContent = 'Las contraseñas no coinciden';
            msgEl.className = 'users-password-message users-password-error';
            return;
        }
        if (newPassword.length < 6) {
            msgEl.textContent = 'La contraseña debe tener al menos 6 caracteres';
            msgEl.className = 'users-password-message users-password-error';
            return;
        }

        try {
            const res = await authFetch(`${API_BASE}/users/me/password`, {
                method: 'PUT',
                body: JSON.stringify({ currentPassword, newPassword })
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Error al cambiar contraseña');
            }
            msgEl.textContent = '✅ Contraseña cambiada correctamente';
            msgEl.className = 'users-password-message users-password-success';
            document.getElementById('cp-current').value = '';
            document.getElementById('cp-new').value = '';
            document.getElementById('cp-confirm').value = '';
        } catch (err) {
            msgEl.textContent = err.message;
            msgEl.className = 'users-password-message users-password-error';
        }
    });

    await loadUsers();
    await load2FAStatus();
}

export async function render(container) {
    await renderUsersView();
}

export { renderUsersView };
