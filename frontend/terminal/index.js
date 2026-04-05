/**
 * Terminal Module
 * Web-based terminal emulator interface with xterm.js
 * @module terminal
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { t } from '/frontend/i18n.js';
import { state } from '../state.js';

// Terminal state
let terminalWs = null;
let terminal = null;
let fitAddon = null;
const API_BASE = `${window.location.origin}/api`;

/**
 * Render the terminal view with shortcuts
 * @param {HTMLElement} dashboardContent - Container for terminal content
 */
export async function renderTerminalView(dashboardContent) {
    // Fetch shortcuts
    try {
        const res = await authFetch(`${API_BASE}/shortcuts`);
        if (res.ok) {
            const data = await res.json();
            state.shortcuts = { defaults: data.defaults || [], custom: data.custom || [] };
        }
    } catch (e) {
        console.error('Shortcuts fetch error:', e);
    }

    const container = document.createElement('div');
    container.className = 'terminal-view-container';
    container.style.width = '100%';

    // Header
    const header = document.createElement('div');
    header.className = 'glass-card';
    header.style.cssText = 'grid-column: 1 / -1; margin-bottom: 20px;';
    header.innerHTML = `
        <h3>${t('terminal.title', 'Terminal y Herramientas')}</h3>
        <p class="misc-about-text">
            ${t('shortcuts.defaultShortcuts', 'Accesos rápidos a herramientas del sistema')}
        </p>
    `;
    container.appendChild(header);

    // Shortcuts grid
    const grid = document.createElement('div');
    grid.className = 'terminal-grid';

    // Default shortcuts
    const allShortcuts = [...state.shortcuts.defaults, ...state.shortcuts.custom];

    allShortcuts.forEach(shortcut => {
        const card = document.createElement('div');
        card.className = 'glass-card shortcut-card';

        const iconDiv = document.createElement('div');
        iconDiv.className = 'icon';
        iconDiv.textContent = shortcut.icon || '💻';

        const nameDiv = document.createElement('div');
        nameDiv.className = 'name';
        nameDiv.textContent = shortcut.name;

        const descDiv = document.createElement('div');
        descDiv.className = 'description';
        descDiv.textContent = shortcut.description || shortcut.command;

        card.appendChild(iconDiv);
        card.appendChild(nameDiv);
        card.appendChild(descDiv);

        // Add delete button for custom shortcuts
        if (!shortcut.isDefault && shortcut.id) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'shortcut-delete-btn';
            deleteBtn.innerHTML = '🗑️';
            deleteBtn.title = t('common.delete', 'Eliminar');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const confirmed = await showConfirmModal('Eliminar acceso directo', '¿Eliminar este acceso directo?');
                if (confirmed) {
                    try {
                        const res = await authFetch(`${API_BASE}/shortcuts/${shortcut.id}`, {
                            method: 'DELETE'
                        });
                        if (res.ok) {
                            // Re-render terminal view
                            container.innerHTML = '';
                            await renderTerminalView(dashboardContent);
                        } else {
                            const data = await res.json();
                            showNotification(data.error || t('common.error', 'Error'), 'error');
                        }
                    } catch (err) {
                        console.error('Delete shortcut error:', err);
                        showNotification(t('common.error', 'Error'), 'error');
                    }
                }
            });
            card.appendChild(deleteBtn);
        }

        card.addEventListener('click', () => openTerminal(shortcut.command, shortcut.name));
        grid.appendChild(card);
    });

    // Add new shortcut button
    const addCard = document.createElement('div');
    addCard.className = 'glass-card shortcut-card add-new';
    addCard.innerHTML = `
        <div class="icon">➕</div>
        <div class="name">${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</div>
    `;
    addCard.addEventListener('click', openAddShortcutModal);
    grid.appendChild(addCard);

    container.appendChild(grid);
    dashboardContent.appendChild(container);
}

/**
 * Open terminal modal with xterm.js
 * @param {string} command - Command to execute (default: 'bash')
 * @param {string} title - Terminal title
 */
export function openTerminal(command = 'bash', title = 'Terminal') {
    const modal = document.getElementById('terminal-modal');
    const containerEl = document.getElementById('terminal-container');
    const statusEl = document.getElementById('terminal-status-text');

    if (!modal || !containerEl) {
        console.error('Terminal modal not found');
        return;
    }

    // Show modal
    modal.classList.add('active');
    containerEl.innerHTML = '';

    // Initialize xterm.js
    if (typeof Terminal !== 'undefined') {
        terminal = new Terminal({
            cursorBlink: true,
            fontSize: 14,
            fontFamily: '"Fira Code", "Monaco", "Consolas", monospace',
            theme: {
                background: '#1a1a2e',
                foreground: '#ffffff',
                cursor: '#84cc16',
                cursorAccent: '#1a1a2e',
                selection: 'rgba(132, 204, 22, 0.3)',
                black: '#3a3a4a',
                red: '#ff6b6b',
                green: '#69ff94',
                yellow: '#fff56d',
                blue: '#6eb5ff',
                magenta: '#ff77ff',
                cyan: '#6ef5ff',
                white: '#ffffff',
                brightBlack: '#666677',
                brightRed: '#ff8080',
                brightGreen: '#8affaa',
                brightYellow: '#ffff88',
                brightBlue: '#88ccff',
                brightMagenta: '#ff99ff',
                brightCyan: '#88ffff',
                brightWhite: '#ffffff'
            },
            scrollback: 5000
        });

        // Load addons
        if (typeof FitAddon !== 'undefined') {
            fitAddon = new FitAddon.FitAddon();
            terminal.loadAddon(fitAddon);
        }

        if (typeof WebLinksAddon !== 'undefined') {
            terminal.loadAddon(new WebLinksAddon.WebLinksAddon());
        }

        terminal.open(containerEl);

        if (fitAddon) {
            setTimeout(() => fitAddon.fit(), 100);
        }

        // Connect WebSocket
        const sessionId = `term-${Date.now()}`;
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProtocol}//${window.location.host}/api/terminal/ws?sessionId=${sessionId}&command=${encodeURIComponent(command)}&token=${state.sessionId}`;

        statusEl.textContent = t('terminal.connecting', 'Conectando...');

        terminalWs = new WebSocket(wsUrl);

        // Connection timeout
        const connectionTimeout = setTimeout(() => {
            if (terminalWs && terminalWs.readyState !== WebSocket.OPEN) {
                terminalWs.close();
                statusEl.textContent = t('terminal.timeout', 'Conexión expiró');
                document.querySelector('.terminal-status').classList.add('disconnected');
                terminal.write('\r\n\x1b[31m[Error: Timeout de conexión]\x1b[0m\r\n');
                terminal.write('\x1b[33mEl servidor no respondió en el tiempo esperado.\x1b[0m\r\n');
                terminal.write('\x1b[33mVerifica que el comando sea válido y el servicio funcione correctamente.\x1b[0m\r\n');
                terminal.write('\x1b[36mComando que se intentó ejecutar: ' + command + '\x1b[0m\r\n');
            }
        }, 10000);

        terminalWs.onopen = () => {
            clearTimeout(connectionTimeout);
            statusEl.textContent = t('terminal.connected', 'Conectado');
            document.querySelector('.terminal-status').classList.remove('disconnected');

            if (command !== 'bash') {
                terminal.write('\x1b[36m[Ejecutando: ' + command + ']\x1b[0m\r\n');
            }
        };

        terminalWs.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                if (msg.type === 'output') {
                    terminal.write(msg.data);
                } else if (msg.type === 'exit') {
                    terminal.write(`\r\n\x1b[33m[Proceso terminado con código ${msg.exitCode}]\x1b[0m\r\n`);
                    statusEl.textContent = t('terminal.disconnected', 'Desconectado');
                    document.querySelector('.terminal-status').classList.add('disconnected');
                }
            } catch (e) {
                console.error('Terminal message error:', e);
            }
        };

        terminalWs.onclose = (event) => {
            clearTimeout(connectionTimeout);
            statusEl.textContent = t('terminal.disconnected', 'Desconectado');
            document.querySelector('.terminal-status').classList.add('disconnected');

            if (event.code === 1006) {
                terminal.write('\r\n\x1b[31m[Error: No se pudo conectar al servidor de terminal]\x1b[0m\r\n');

                if (command !== 'bash') {
                    terminal.write('\x1b[33mError ejecutando comando desde acceso directo:\x1b[0m\r\n');
                    terminal.write('\x1b[36m' + command + '\x1b[0m\r\n');
                    terminal.write('\x1b[33mPosibles causas:\x1b[0m\r\n');
                    terminal.write('  - El comando no existe o no está en el PATH\r\n');
                    terminal.write('  - Permisos insuficientes para ejecutar el comando\r\n');
                    terminal.write('  - El servicio de terminal necesita reiniciarse\r\n');
                    terminal.write('\x1b[33mSolución: Verifica el comando o usa el terminal manual\x1b[0m\r\n');
                } else {
                    terminal.write('\x1b[33mPosibles causas:\x1b[0m\r\n');
                    terminal.write('  - El módulo node-pty no está instalado correctamente\r\n');
                    terminal.write('  - El servidor necesita reiniciarse después de la instalación\r\n');
                    terminal.write('\x1b[33mSolución: sudo systemctl restart homepinas\x1b[0m\r\n');
                }
            }
        };

        terminalWs.onerror = (err) => {
            console.error('Terminal WebSocket error:', err);
            clearTimeout(connectionTimeout);
            statusEl.textContent = t('terminal.error', 'Error de conexión');
            document.querySelector('.terminal-status').classList.add('disconnected');

            terminal.write('\r\n\x1b[31m[Error de WebSocket]\x1b[0m\r\n');
            if (command !== 'bash') {
                terminal.write('\x1b[33mError al conectar con el servidor para ejecutar: ' + command + '\x1b[0m\r\n');
            }
        };

        // Send input to WebSocket
        terminal.onData((data) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'input', data }));
            }
        });

        // Handle resize
        terminal.onResize(({ cols, rows }) => {
            if (terminalWs && terminalWs.readyState === WebSocket.OPEN) {
                terminalWs.send(JSON.stringify({ type: 'resize', cols, rows }));
            }
        });

    } else {
        containerEl.innerHTML = '<p class="misc-terminal-error">Error: xterm.js no disponible</p>';
    }
}

/**
 * Close terminal session and modal
 */
export function closeTerminal() {
    const modal = document.getElementById('terminal-modal');
    if (modal) modal.classList.remove('active');

    if (terminalWs) {
        terminalWs.close();
        terminalWs = null;
    }

    if (terminal) {
        terminal.dispose();
        terminal = null;
    }
}

/**
 * Open modal to add new shortcut
 */
export function openAddShortcutModal() {
    const modal = document.createElement('div');
    modal.id = 'shortcut-modal';
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content misc-shortcut-modal">
            <header class="modal-header">
                <h3>${t('shortcuts.addShortcut', 'Añadir Acceso Directo')}</h3>
                <button id="close-shortcut-modal" class="btn-close">&times;</button>
            </header>
            <form id="shortcut-form">
                <div class="input-group">
                    <input type="text" id="shortcut-name" required placeholder=" ">
                    <label>${t('shortcuts.name', 'Nombre')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-command" required placeholder=" ">
                    <label>${t('shortcuts.command', 'Comando')}</label>
                </div>
                <div class="input-group">
                    <input type="text" id="shortcut-description" placeholder=" ">
                    <label>${t('shortcuts.description', 'Descripción')}</label>
                </div>
                <div class="cloudbackup-sync-field">
                    <label class="misc-shortcut-icon-label">${t('shortcuts.icon', 'Icono')}</label>
                    <div id="icon-picker" class="misc-shortcut-icon-picker"></div>
                </div>
                <input type="hidden" id="shortcut-icon" value="💻">
                <div class="modal-footer misc-shortcut-modal-footer">
                    <button type="button" id="cancel-shortcut-modal" class="btn-primary misc-shortcut-cancel-btn">
                        ${t('common.cancel', 'Cancelar')}
                    </button>
                    <button type="submit" class="btn-primary">${t('common.save', 'Guardar')}</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-shortcut-modal').addEventListener('click', closeModal);
    document.getElementById('cancel-shortcut-modal').addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // Populate icon picker and handle form submission
    setupIconPickerAndForm(modal);
}

/**
 * Setup icon picker and form submission
 * @private
 */
function setupIconPickerAndForm(modal) {
    const icons = ['💻', '📊', '📁', '📝', '🐳', '📜', '💾', '🧠', '⚙️', '🔧', '📦', '🌐', '🔒', '📡', '⏱️', '🎯', '🚀', '💡', '🔍', '📈'];
    const iconPicker = modal.querySelector('#icon-picker');
    const form = modal.querySelector('#shortcut-form');
    const iconInput = modal.querySelector('#shortcut-icon');

    icons.forEach(icon => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = icon;
        btn.className = 'icon-btn';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            document.querySelectorAll('.icon-btn').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            iconInput.value = icon;
        });
        iconPicker.appendChild(btn);
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = modal.querySelector('#shortcut-name').value;
        const command = modal.querySelector('#shortcut-command').value;
        const description = modal.querySelector('#shortcut-description').value;
        const icon = iconInput.value;

        try {
            const res = await authFetch(`${API_BASE}/shortcuts`, {
                method: 'POST',
                body: JSON.stringify({ name, command, description, icon })
            });
            if (res.ok) {
                modal.remove();
                showNotification(t('shortcuts.created', 'Acceso directo creado'), 'success');
                // Refresh terminal view
                window.renderContent('terminal');
            } else {
                const data = await res.json();
                showNotification(data.error || t('common.error', 'Error'), 'error');
            }
        } catch (err) {
            console.error('Create shortcut error:', err);
            showNotification(t('common.error', 'Error'), 'error');
        }
    });
}

/**
 * Setup terminal modal controls and event listeners
 */
export function setupTerminalControls() {
    const closeTerminalBtn = document.getElementById('close-terminal-modal');
    if (closeTerminalBtn) {
        closeTerminalBtn.addEventListener('click', closeTerminal);
    }

    const fullscreenBtn = document.getElementById('terminal-fullscreen');
    if (fullscreenBtn) {
        fullscreenBtn.addEventListener('click', () => {
            const modalContent = document.querySelector('.terminal-modal-content');
            if (modalContent) {
                modalContent.classList.toggle('fullscreen');
                if (fitAddon) fitAddon.fit();
            }
        });
    }

    // Resize terminal on window resize
    window.addEventListener('resize', handleTerminalResize);
}

/**
 * Handle terminal resize
 * @private
 */
function handleTerminalResize() {
    if (fitAddon && terminal) {
        fitAddon.fit();
    }
}

/**
 * Cleanup terminal module (remove event listeners)
 */
export function cleanup() {
    closeTerminal();

    const closeTerminalBtn = document.getElementById('close-terminal-modal');
    if (closeTerminalBtn) {
        closeTerminalBtn.removeEventListener('click', closeTerminal);
    }

    const fullscreenBtn = document.getElementById('terminal-fullscreen');
    if (fullscreenBtn) {
        fullscreenBtn.removeEventListener('click', null);
    }

    window.removeEventListener('resize', handleTerminalResize);
}

export async function render(container) {
    await renderTerminalView(container);
}
