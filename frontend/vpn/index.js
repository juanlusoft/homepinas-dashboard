/**
 * VPN SERVER MODULE (WireGuard)
 * ════════════════════════════════════════════════════════════════════════════════
 * WireGuard VPN server management interface
 * Features: Client management, QR code generation, config download,
 *           server configuration, peer management
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { escapeHtml } from '../utils.js';
import { t } from '../../i18n.js';

// ════════════════════════════════════════════════════════════════════════════════
// MODULE STATE
// ════════════════════════════════════════════════════════════════════════════════

const _moduleListeners = [];
const API_BASE = `${window.location.origin}/api`;
const dashboardContent = document.getElementById('dashboard-content');

function _trackListener(element, event, handler) {
    _moduleListeners.push({ element, event, handler });
}

// VPN SERVER (WireGuard)
// =============================================================================

async function renderVPNView() {
    dashboardContent.innerHTML = '<div class="vpn-loading">Cargando estado VPN...</div>';

    let vpnStatus;
    try {
        const res = await authFetch(`${API_BASE}/vpn/status`);
        if (!res.ok) throw new Error('Error');
        vpnStatus = await res.json();
    } catch (e) {
        dashboardContent.innerHTML = '<div class="glass-card vpn-full-width vpn-error">Error al conectar con el servicio VPN</div>';
        return;
    }

    dashboardContent.innerHTML = '';

    // --- Tarjeta de estado principal ---
    const statusCard = document.createElement('div');
    statusCard.className = 'glass-card vpn-full-width';

    const isRunning = vpnStatus.running;
    const isInstalled = vpnStatus.installed;

    statusCard.innerHTML = `
        <div class="vpn-status-header">
            <div class="vpn-status-info">
                <div class="vpn-status-icon ${isRunning ? 'vpn-status-icon--active' : 'vpn-status-icon--inactive'}">🔒</div>
                <div>
                    <h3 style="margin: 0;">Servidor VPN WireGuard</h3>
                    <div class="vpn-status-text">
                        <span class="status-dot ${isRunning ? 'status-check-online' : isInstalled ? '' : ''}"></span>
                        <span>${isRunning ? 'Activo' : isInstalled ? 'Instalado - Detenido' : 'No instalado'}</span>
                    </div>
                </div>
            </div>
            <div class="vpn-action-btns" id="vpn-action-btns">
                ${!isInstalled ? `
                    <button class="btn-primary" id="vpn-install-btn">📦 Instalar WireGuard</button>
                ` : `
                    ${isRunning ? `
                        <button class="btn-primary vpn-btn-warning" id="vpn-stop-btn">⏹ Detener</button>
                        <button class="btn-primary" id="vpn-restart-btn">🔄 Reiniciar</button>
                    ` : `
                        <button class="btn-primary" id="vpn-start-btn">▶ Activar</button>
                    `}
                    <button class="vpn-btn-danger" id="vpn-uninstall-btn">🗑 Desinstalar</button>
                `}
            </div>
        </div>
    `;
    dashboardContent.appendChild(statusCard);

    // Event listeners para botones de estado
    const installBtn = document.getElementById('vpn-install-btn');
    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            installBtn.disabled = true;
            installBtn.textContent = '⏳ Iniciando instalación...';
            try {
                const r = await authFetch(`${API_BASE}/vpn/install`, { method: 'POST' });
                const d = await r.json();
                if (!r.ok) throw new Error(d.error || 'Error');

                // Polling de progreso
                const pollProgress = async () => {
                    try {
                        const pr = await authFetch(`${API_BASE}/vpn/install/progress`);
                        const pd = await pr.json();

                        if (pd.error) {
                            showNotification(`Error instalando: ${pd.error}`, 'error');
                            installBtn.disabled = false;
                            installBtn.textContent = '📦 Instalar WireGuard';
                            return;
                        }

                        installBtn.textContent = `⏳ ${pd.step || 'Instalando...'} (${pd.progress || 0}%)`;

                        if (pd.completed) {
                            showNotification(t('vpn.wireguardInstalled', 'WireGuard instalado correctamente'), 'success');
                            await renderVPNView();
                            return;
                        }

                        if (pd.running) {
                            setTimeout(pollProgress, 2000);
                        }
                    } catch {
                        setTimeout(pollProgress, 3000);
                    }
                };

                if (d.installing) {
                    setTimeout(pollProgress, 1500);
                } else {
                    showNotification(t('vpn.wireguardInstalled', 'WireGuard instalado correctamente'), 'success');
                    await renderVPNView();
                }
            } catch (e) {
                showNotification(`Error: ${e.message}`, 'error');
                installBtn.disabled = false;
                installBtn.textContent = '📦 Instalar WireGuard';
            }
        });
    }

    const startBtn = document.getElementById('vpn-start-btn');
    if (startBtn) {
        startBtn.addEventListener('click', async () => {
            startBtn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/start`, { method: 'POST' });
                if (!r.ok) throw new Error('Error');
                showNotification(t('vpn.activated', 'VPN activada'), 'success');
                await renderVPNView();
            } catch (e) {
                showNotification(t('vpn.activateError', 'Error al activar VPN'), 'error');
                startBtn.disabled = false;
            }
        });
    }

    const stopBtn = document.getElementById('vpn-stop-btn');
    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            stopBtn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/stop`, { method: 'POST' });
                if (!r.ok) throw new Error('Error');
                showNotification(t('vpn.stopped', 'VPN detenida'), 'success');
                await renderVPNView();
            } catch (e) {
                showNotification(t('vpn.stopError', 'Error al detener VPN'), 'error');
                stopBtn.disabled = false;
            }
        });
    }

    const restartBtn = document.getElementById('vpn-restart-btn');
    if (restartBtn) {
        restartBtn.addEventListener('click', async () => {
            restartBtn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/restart`, { method: 'POST' });
                if (!r.ok) throw new Error('Error');
                showNotification(t('vpn.restarted', 'VPN reiniciada'), 'success');
                await renderVPNView();
            } catch (e) {
                showNotification(t('vpn.restartError', 'Error al reiniciar VPN'), 'error');
                restartBtn.disabled = false;
            }
        });
    }

    const uninstallBtn = document.getElementById('vpn-uninstall-btn');
    if (uninstallBtn) {
        uninstallBtn.addEventListener('click', async () => {
            const confirmed = await showConfirmModal('Desinstalar VPN', '¿Seguro que quieres desinstalar WireGuard? Se eliminarán todos los clientes y la configuración.');
            if (!confirmed) return;
            uninstallBtn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/uninstall`, { method: 'POST' });
                if (!r.ok) throw new Error('Error');
                showNotification(t('vpn.wireguardUninstalled', 'WireGuard desinstalado'), 'success');
                await renderVPNView();
            } catch (e) {
                showNotification(t('vpn.uninstallError', 'Error al desinstalar'), 'error');
                uninstallBtn.disabled = false;
            }
        });
    }

    // Si no está instalado, no mostrar más
    if (!isInstalled) return;

    // --- 2-column layout container ---
    const vpnLayout = document.createElement('div');
    vpnLayout.className = 'vpn-layout';

    // LEFT COLUMN: Config + Peers
    const leftCol = document.createElement('div');
    leftCol.className = 'vpn-col-left';

    // --- Info del servidor ---
    const infoCard = document.createElement('div');
    infoCard.className = 'glass-card';
    const endpointWarning = vpnStatus.endpointIsLocal ? `
        <div class="vpn-endpoint-warning">
            ⚠️ <strong>Atención:</strong> El endpoint configurado (${escapeHtml(vpnStatus.endpoint || vpnStatus.publicIP || '')}) es una IP local.
            Los clientes externos no podrán conectarse. Configura un dominio DDNS o tu IP pública.
        </div>
    ` : '';
    infoCard.innerHTML = `
        <h4>⚙️ Configuración del Servidor</h4>
        ${endpointWarning}
        <div class="vpn-config-grid">
            <div><strong>Endpoint:</strong> ${escapeHtml(vpnStatus.endpoint || vpnStatus.publicIP || 'No configurado')}</div>
            <div><strong>Puerto:</strong> ${vpnStatus.port}</div>
            <div><strong>DNS:</strong> ${escapeHtml(vpnStatus.dns)}</div>
            <div><strong>Subred:</strong> ${escapeHtml(vpnStatus.subnet)}</div>
            <div><strong>IP Pública:</strong> ${escapeHtml(vpnStatus.publicIP || 'Desconocida')}</div>
            <div><strong>Clientes:</strong> ${vpnStatus.clientCount}</div>
        </div>
        <div class="vpn-config-actions">
            <button class="btn-primary btn-sm" id="vpn-edit-config-btn">✏️ Editar Configuración</button>
        </div>
    `;
    leftCol.appendChild(infoCard);

    // Stats de peers conectados
    const peersCard = document.createElement('div');
    peersCard.className = 'glass-card';
    const connectedCount = (vpnStatus.connectedPeers || []).filter(p => p.connected).length;
    peersCard.innerHTML = `
        <h4>📡 Peers Conectados (${connectedCount})</h4>
        <div id="vpn-peers-list">
            ${(vpnStatus.connectedPeers || []).length === 0 ? '<div class="vpn-empty-state">No hay peers conectados actualmente</div>' : ''}
        </div>
    `;

    const peersList = peersCard.querySelector('#vpn-peers-list');
    for (const peer of (vpnStatus.connectedPeers || [])) {
        const peerEl = document.createElement('div');
        peerEl.className = 'vpn-peer-item';
        const rxMB = (peer.transferRx / 1024 / 1024).toFixed(1);
        const txMB = (peer.transferTx / 1024 / 1024).toFixed(1);
        const handshakeTime = peer.latestHandshake ? new Date(peer.latestHandshake).toLocaleString('es-ES') : 'Nunca';
        peerEl.innerHTML = `
            <span class="status-dot ${peer.connected ? 'status-check-online' : 'status-check-offline'}"></span>
            <div class="vpn-peer-info">
                <div class="vpn-peer-name">${escapeHtml(peer.name)}</div>
                <div class="vpn-peer-details">
                    ${peer.endpoint ? escapeHtml(peer.endpoint) : 'Sin conexión'}
                    · ↓${rxMB} MB · ↑${txMB} MB
                </div>
                <div class="vpn-peer-handshake">Último handshake: ${handshakeTime}</div>
            </div>
        `;
        peersList.appendChild(peerEl);
    }
    leftCol.appendChild(peersCard);
    vpnLayout.appendChild(leftCol);

    // RIGHT COLUMN: Clients
    const rightCol = document.createElement('div');
    rightCol.className = 'vpn-col-right';

    const clientsCard = document.createElement('div');
    clientsCard.className = 'glass-card';
    clientsCard.innerHTML = `
        <div class="vpn-section-header">
            <h4>👥 Clientes VPN</h4>
            <button class="btn-primary btn-sm" id="vpn-add-client-btn">+ Nuevo Cliente</button>
        </div>
        <div id="vpn-clients-grid" class="vpn-clients-grid"></div>
    `;
    rightCol.appendChild(clientsCard);
    vpnLayout.appendChild(rightCol);

    dashboardContent.appendChild(vpnLayout);

    // Renderizar clientes
    const clientsGrid = clientsCard.querySelector('#vpn-clients-grid');
    const clients = vpnStatus.clients || [];
    const activeClients = clients.filter(c => !c.revoked);
    const revokedClients = clients.filter(c => c.revoked);

    if (activeClients.length === 0) {
        clientsGrid.innerHTML = '<div class="vpn-empty-state">No hay clientes configurados. Crea uno para conectarte por VPN.</div>';
    }

    for (const client of activeClients) {
        const clientEl = document.createElement('div');
        clientEl.className = 'vpn-client-card';
        clientEl.innerHTML = `
            <div>
                <div class="vpn-client-name">📱 ${escapeHtml(client.name)}</div>
                <div class="vpn-client-meta">IP: ${escapeHtml(client.address)}</div>
                <div class="vpn-client-date">Creado: ${new Date(client.createdAt).toLocaleDateString('es-ES')}</div>
            </div>
            <div class="vpn-client-actions">
                <button class="btn-primary btn-sm vpn-qr-btn" data-id="${client.id}">📱 QR Code</button>
                <button class="vpn-btn-secondary vpn-download-btn" data-id="${client.id}" data-name="${escapeHtml(client.name)}">⬇ Descargar</button>
                <button class="vpn-btn-danger vpn-revoke-btn" data-id="${client.id}" data-name="${escapeHtml(client.name)}">✕ Revocar</button>
            </div>
        `;
        clientsGrid.appendChild(clientEl);
    }

    // Mostrar revocados colapsados
    if (revokedClients.length > 0) {
        const revokedSection = document.createElement('div');
        revokedSection.className = 'vpn-revoked-section';
        revokedSection.innerHTML = `
            <details>
                <summary class="vpn-revoked-summary">Clientes revocados (${revokedClients.length})</summary>
                <div class="vpn-revoked-grid">
                    ${revokedClients.map(c => `
                        <div class="vpn-revoked-item">
                            <span class="vpn-revoked-name">${escapeHtml(c.name)}</span>
                            <span class="vpn-revoked-badge">Revocado</span>
                        </div>
                    `).join('')}
                </div>
            </details>
        `;
        clientsGrid.appendChild(revokedSection);
    }

    // --- Event Listeners ---

    // Añadir cliente
    document.getElementById('vpn-add-client-btn').addEventListener('click', () => showVPNAddClientModal());

    // Botones QR
    clientsCard.querySelectorAll('.vpn-qr-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const clientId = btn.dataset.id;
            btn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/clients/${clientId}/config`);
                if (!r.ok) throw new Error('Error');
                const data = await r.json();
                showVPNQRModal(data);
            } catch (e) {
                showNotification(t('vpn.qrError', 'Error al obtener QR'), 'error');
            }
            btn.disabled = false;
        });
    });

    // Botones descargar
    clientsCard.querySelectorAll('.vpn-download-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const clientId = btn.dataset.id;
            const clientName = btn.dataset.name;
            btn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/clients/${clientId}/config`);
                if (!r.ok) throw new Error('Error');
                const data = await r.json();
                const blob = new Blob([data.config], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${clientName}.conf`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } catch (e) {
                showNotification(t('vpn.downloadConfigError', 'Error al descargar configuración'), 'error');
            }
            btn.disabled = false;
        });
    });

    // Botones revocar
    clientsCard.querySelectorAll('.vpn-revoke-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const clientId = btn.dataset.id;
            const clientName = btn.dataset.name;
            const confirmed = await showConfirmModal('Revocar cliente', `¿Seguro que quieres revocar el cliente "${clientName}"? No podrá conectarse más.`);
            if (!confirmed) return;
            btn.disabled = true;
            try {
                const r = await authFetch(`${API_BASE}/vpn/clients/${clientId}`, { method: 'DELETE' });
                if (!r.ok) throw new Error('Error');
                showNotification(t('vpn.clientRevoked', `Cliente ${clientName} revocado`), 'success');
                await renderVPNView();
            } catch (e) {
                showNotification(t('vpn.revokeError', 'Error al revocar cliente'), 'error');
                btn.disabled = false;
            }
        });
    });

    // Editar configuración
    const editConfigBtn = document.getElementById('vpn-edit-config-btn');
    if (editConfigBtn) {
        editConfigBtn.addEventListener('click', () => showVPNConfigModal(vpnStatus));
    }
}

/**
 * Modal para añadir nuevo cliente VPN
 */
function showVPNAddClientModal() {
    const existing = document.getElementById('vpn-client-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vpn-client-modal';
    modal.className = 'modal active';

    modal.innerHTML = `
        <div class="glass-card modal-content">
            <header class="modal-header">
                <h3>Nuevo Cliente VPN</h3>
                <button class="btn-close" id="close-vpn-client-modal">&times;</button>
            </header>
            <p class="vpn-modal-description">
                Crea un perfil de cliente para conectar un dispositivo a tu VPN.
                Se generará un QR code para escanear desde la app WireGuard.
            </p>
            <form id="vpn-client-form" class="vpn-form">
                <div class="input-group">
                    <input type="text" id="vpn-client-name" required placeholder=" " pattern="[a-zA-Z0-9_-]{1,32}" maxlength="32">
                    <label>Nombre del dispositivo</label>
                </div>
                <div class="vpn-hint">Ej: iPhone-Pablo, Laptop-Maria, Tablet-casa</div>
                <button type="submit" class="btn-primary" id="vpn-create-client-submit">🔑 Crear Cliente</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-vpn-client-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('vpn-client-name').focus();

    document.getElementById('vpn-client-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = document.getElementById('vpn-client-name').value.trim();
        const submitBtn = document.getElementById('vpn-create-client-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = '⏳ Creando...';

        try {
            const res = await authFetch(`${API_BASE}/vpn/clients`, {
                method: 'POST',
                body: JSON.stringify({ name })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');

            modal.remove();
            showNotification(t('vpn.clientCreated', `Cliente "${name}" creado`), 'success');

            // Mostrar QR inmediatamente
            showVPNQRModal(data);

            // Refrescar vista
            await renderVPNView();
        } catch (err) {
            showNotification(`Error: ${err.message}`, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = '🔑 Crear Cliente';
        }
    });
}

/**
 * Modal con QR code del cliente
 */
function showVPNQRModal(data) {
    const existing = document.getElementById('vpn-qr-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vpn-qr-modal';
    modal.className = 'modal active';

    const clientName = data.client ? data.client.name : 'Cliente';

    modal.innerHTML = `
        <div class="glass-card modal-content" style="text-align: center;">
            <header class="modal-header">
                <h3>📱 ${escapeHtml(clientName)}</h3>
                <button class="btn-close" id="close-vpn-qr-modal">&times;</button>
            </header>
            <p class="vpn-modal-description">
                Escanea este QR desde la app <strong>WireGuard</strong> en tu dispositivo móvil.
            </p>
            <div class="vpn-qr-container">
                ${data.qrSvg ? data.qrSvg : '<div class="vpn-qr-fallback">QR no disponible. Instala qrencode en el servidor.</div>'}
            </div>
            <div>
                <details class="vpn-config-details">
                    <summary>Ver configuración de texto</summary>
                    <pre class="vpn-config-pre">${escapeHtml(data.config || '')}</pre>
                </details>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-vpn-qr-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

/**
 * Modal para editar configuración del servidor VPN
 */
function showVPNConfigModal(currentStatus) {
    const existing = document.getElementById('vpn-config-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'vpn-config-modal';
    modal.className = 'modal active';

    modal.innerHTML = `
        <div class="glass-card modal-content">
            <header class="modal-header">
                <h3>⚙️ Configuración VPN</h3>
                <button class="btn-close" id="close-vpn-config-modal">&times;</button>
            </header>
            <form id="vpn-config-form" class="vpn-form">
                <div class="input-group">
                    <input type="text" id="vpn-cfg-endpoint" value="${escapeHtml(currentStatus.endpoint || '')}" placeholder=" ">
                    <label>Endpoint (dominio o IP pública)</label>
                </div>
                <div class="vpn-hint">IP o dominio DDNS por donde se conectan los clientes</div>
                <div class="input-group">
                    <input type="number" id="vpn-cfg-port" value="${currentStatus.port || 51820}" min="1024" max="65535" placeholder=" ">
                    <label>Puerto UDP</label>
                </div>
                <div class="input-group">
                    <input type="text" id="vpn-cfg-dns" value="${escapeHtml(currentStatus.dns || '1.1.1.1, 8.8.8.8')}" placeholder=" ">
                    <label>Servidores DNS (separados por coma)</label>
                </div>
                <button type="submit" class="btn-primary">💾 Guardar</button>
            </form>
        </div>
    `;

    document.body.appendChild(modal);
    document.getElementById('close-vpn-config-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    document.getElementById('vpn-config-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const body = {
            endpoint: document.getElementById('vpn-cfg-endpoint').value.trim(),
            port: parseInt(document.getElementById('vpn-cfg-port').value),
            dns: document.getElementById('vpn-cfg-dns').value.trim()
        };

        try {
            const res = await authFetch(`${API_BASE}/vpn/config`, {
                method: 'PUT',
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Error');
            modal.remove();
            showNotification(t('vpn.configUpdated', 'Configuración VPN actualizada'), 'success');
            await renderVPNView();
        } catch (err) {
            showNotification(`Error: ${err.message}`, 'error');
        }
    });
}

// =============================================================================

// ════════════════════════════════════════════════════════════════════════════════
// MODULE CLEANUP
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Clean up all event listeners and resources
 * @exports
 */
export function cleanup() {
    _moduleListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _moduleListeners.length = 0;
}

// ════════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════════

export { renderVPNView };
