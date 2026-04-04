/**
 * DOCKER MANAGEMENT MODULE
 * ════════════════════════════════════════════════════════════════════════════════
 * Container and compose file management interface
 * Features: Container control, docker-compose import, health monitoring,
 *           update checking, stacks management
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { state } from '../state.js';
import { escapeHtml, formatUptime } from '../utils.js';
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

// ════════════════════════════════════════════════════════════════════════════════
// DOCKER MANAGER
// ════════════════════════════════════════════════════════════════════════════════

async function renderDockerManager() {
    // Show loading immediately
    dashboardContent.innerHTML = "<div class=\"glass-card\" style=\"grid-column: 1 / -1; text-align: center; padding: 40px;\"><h3>" + t("common.loading", "Cargando...") + "</h3></div>";
    // Fetch containers and update status
    let updateStatus = { lastCheck: null, updatesAvailable: 0 };
    try {
        const [containersRes, updateRes] = await Promise.all([
            authFetch(`${API_BASE}/docker/containers`),
            authFetch(`${API_BASE}/docker/update-status`)
        ]);
        if (containersRes.ok) state.dockers = await containersRes.json();
        if (updateRes.ok) updateStatus = await updateRes.json();
    } catch (e) {
        console.error('Docker unreachable:', e);
        state.dockers = [];
    }

    // Fetch compose files
    let composeFiles = [];
    try {
        const composeRes = await authFetch(`${API_BASE}/docker/compose/list`);
        if (composeRes.ok) composeFiles = await composeRes.json();
    } catch (e) {
        console.error('Compose list error:', e);
    }

    // Header with actions
    const headerCard = document.createElement('div');
    headerCard.className = 'glass-card';
    headerCard.style.cssText = 'grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;';

    const headerLeft = document.createElement('div');
    const h3 = document.createElement('h3');
    h3.style.margin = '0';
    h3.textContent = t('docker.containers', 'Contenedores');
    const updateInfo = document.createElement('span');
    updateInfo.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 5px;';
    updateInfo.textContent = updateStatus.lastCheck
        ? `${t('docker.lastCheck', 'Última comprobación')}: ${new Date(updateStatus.lastCheck).toLocaleString()}`
        : t('docker.notCheckedYet', 'Actualizaciones no comprobadas aún');
    headerLeft.appendChild(h3);
    headerLeft.appendChild(updateInfo);

    const headerRight = document.createElement('div');
    headerRight.style.cssText = 'display: flex; gap: 10px; flex-wrap: wrap;';

    const checkUpdatesBtn = document.createElement('button');
    checkUpdatesBtn.className = 'btn-primary';
    checkUpdatesBtn.style.cssText = 'background: #6366f1; padding: 8px 16px; font-size: 0.85rem;';
    checkUpdatesBtn.innerHTML = '🔄 ' + t('docker.checkUpdates', 'Buscar Actualizaciones');
    checkUpdatesBtn.addEventListener('click', checkDockerUpdates);

    const importComposeBtn = document.createElement('button');
    importComposeBtn.className = 'btn-primary';
    importComposeBtn.style.cssText = 'background: #10b981; padding: 8px 16px; font-size: 0.85rem;';
    importComposeBtn.innerHTML = '📦 ' + t('docker.importCompose', 'Importar Compose');
    importComposeBtn.addEventListener('click', openComposeModal);

    const stacksBtn = document.createElement('button');
    stacksBtn.className = 'btn-primary';
    stacksBtn.style.cssText = 'background: #f59e0b; padding: 8px 16px; font-size: 0.85rem;';
    stacksBtn.innerHTML = '🗂️ Stacks';
    stacksBtn.addEventListener('click', openStacksManager);

    headerRight.appendChild(checkUpdatesBtn);
    headerRight.appendChild(importComposeBtn);
    headerRight.appendChild(stacksBtn);
    headerCard.appendChild(headerLeft);
    headerCard.appendChild(headerRight);
    
    // Clear loading message before adding content
    dashboardContent.innerHTML = '';
    dashboardContent.appendChild(headerCard);

    // Containers section
    if (state.dockers.length === 0) {
        const emptyCard = document.createElement('div');
        emptyCard.className = 'glass-card';
        emptyCard.style.cssText = 'grid-column: 1/-1; text-align:center; padding: 40px;';
        emptyCard.innerHTML = `
            <h4 class="docker-empty-title">${t("docker.noContainers", "No Containers Detected")}</h4>
            <p class="docker-empty-subtitle">Import a docker-compose file or run containers manually.</p>
        `;
        dashboardContent.appendChild(emptyCard);
    } else {
        const containerGrid = document.createElement('div');
        containerGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 20px; grid-column: 1 / -1;';

        state.dockers.forEach(container => {
            const card = document.createElement('div');
            card.className = 'glass-card docker-card';
            card.style.padding = '20px';

            const isRunning = container.status === 'running';
            const hasUpdate = container.hasUpdate;

            // Header row
            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 15px;';

            const info = document.createElement('div');
            const nameRow = document.createElement('div');
            nameRow.style.cssText = 'display: flex; align-items: center; gap: 8px;';
            const h4 = document.createElement('h4');
            h4.style.margin = '0';
            h4.textContent = container.name || t('common.unknown', 'Desconocido');
            nameRow.appendChild(h4);

            if (hasUpdate) {
                const updateBadge = document.createElement('span');
                updateBadge.style.cssText = 'background: #10b981; color: white; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; font-weight: 600;';
                updateBadge.textContent = t('docker.update', 'ACTUALIZACIÓN');
                nameRow.appendChild(updateBadge);
            }

            const imageSpan = document.createElement('span');
            imageSpan.style.cssText = 'font-size: 0.8rem; color: var(--text-dim); display: block; margin-top: 4px;';
            imageSpan.textContent = container.image || 'N/A';
            info.appendChild(nameRow);
            info.appendChild(imageSpan);

            const statusSpan = document.createElement('span');
            statusSpan.style.cssText = `
                padding: 4px 10px;
                border-radius: 12px;
                font-size: 0.75rem;
                font-weight: 600;
                background: ${isRunning ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'};
                color: ${isRunning ? '#10b981' : '#ef4444'};
            `;
            statusSpan.textContent = isRunning ? t('docker.running', 'EN EJECUCIÓN') : t('docker.stopped', 'DETENIDO');

            header.appendChild(info);
            header.appendChild(statusSpan);

            // Stats row (always show for running containers)
            card.appendChild(header);
            if (isRunning) {
                const cpuVal = container.cpu || '0%';
                const ramVal = container.ram && container.ram !== '---' ? container.ram : '< 1MB';
                const cpuNum = parseFloat(cpuVal) || 0;
                
                const statsRow = document.createElement('div');
                statsRow.style.cssText = 'display: flex; gap: 20px; margin-bottom: 15px; padding: 10px; background: rgba(255,255,255,0.03); border-radius: 8px;';
                statsRow.innerHTML = `
                    <div class="docker-stat-cell">
                        <div class="docker-stat-label">CPU</div>
                        <div class="docker-stat-value ${cpuNum > 50 ? 'docker-stat-value-cpu-warn' : 'docker-stat-value-cpu-ok'}">${escapeHtml(cpuVal)}</div>
                    </div>
                    <div class="docker-stat-cell">
                        <div class="docker-stat-label">RAM</div>
                        <div class="docker-stat-value docker-stat-value-ram">${escapeHtml(ramVal)}</div>
                    </div>
                `;
                card.appendChild(statsRow);
            }

            // Ports section
            if (container.ports && container.ports.length > 0) {
                const portsDiv = document.createElement('div');
                portsDiv.className = 'docker-ports';
                portsDiv.style.marginBottom = '12px'; // Add spacing before buttons
                container.ports.forEach(port => {
                    if (port.public) {
                        const badge = document.createElement('span');
                        badge.className = 'docker-port-badge';
                        badge.innerHTML = `<span class="port-public">${escapeHtml(port.public)}</span><span class="port-arrow">→</span><span class="port-private">${escapeHtml(port.private)}</span>`;
                        portsDiv.appendChild(badge);
                    }
                });
                if (portsDiv.children.length > 0) {
                    card.appendChild(portsDiv);
                }
            }

            // Volumes/Mounts section
            if (container.mounts && container.mounts.length > 0) {
                const mountsDiv = document.createElement('div');
                mountsDiv.className = 'docker-mounts';
                mountsDiv.style.cssText = 'margin-bottom: 12px; padding: 8px 10px; background: rgba(255,255,255,0.03); border-radius: 8px; border-left: 3px solid var(--accent, #6366f1);';
                
                const mountsLabel = document.createElement('div');
                mountsLabel.style.cssText = 'font-size: 0.7rem; color: var(--text-dim); margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px;';
                mountsLabel.textContent = `📂 ${t('docker.volumes', 'Volúmenes')}`;
                mountsDiv.appendChild(mountsLabel);
                
                container.mounts.forEach(m => {
                    const mountRow = document.createElement('div');
                    mountRow.style.cssText = 'font-size: 0.75rem; color: var(--text-secondary, #aaa); padding: 3px 0; display: flex; align-items: center; gap: 4px; word-break: break-all;';
                    const shortSource = m.source.length > 35 ? '…' + m.source.slice(-32) : m.source;
                    const rwBadge = m.rw ? '' : ' <span style="color: #f59e0b; font-size: 0.65rem;">RO</span>';
                    mountRow.innerHTML = `<span style="color: var(--text-dim);" title="${escapeHtml(m.source)}">${escapeHtml(shortSource)}</span> <span style="color: var(--text-dim); opacity: 0.5;">→</span> <span title="${escapeHtml(m.destination)}">${escapeHtml(m.destination)}</span>${rwBadge}`;
                    mountsDiv.appendChild(mountRow);
                });
                
                card.appendChild(mountsDiv);
            }

            // Controls row
            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px;';

            const actionBtn = document.createElement('button');
            actionBtn.className = 'btn-sm';
            actionBtn.style.cssText = `flex: 1; padding: 8px; background: ${isRunning ? '#ef4444' : '#10b981'}; color: white; border: none; border-radius: 6px; cursor: pointer;`;
            actionBtn.textContent = isRunning ? t('docker.stop', 'Detener') : t('docker.start', 'Iniciar');
            actionBtn.addEventListener('click', () => handleDockerAction(container.id, isRunning ? 'stop' : 'start', actionBtn));

            const restartBtn = document.createElement('button');
            restartBtn.className = 'btn-sm';
            restartBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer;';
            restartBtn.textContent = t('docker.restart', 'Reiniciar');
            restartBtn.addEventListener('click', () => handleDockerAction(container.id, 'restart', restartBtn));

            controls.appendChild(actionBtn);
            controls.appendChild(restartBtn);

            if (hasUpdate) {
                const updateBtn = document.createElement('button');
                updateBtn.className = 'btn-sm';
                updateBtn.style.cssText = 'width: 100%; margin-top: 8px; padding: 10px; background: linear-gradient(135deg, #10b981, #059669); color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;';
                updateBtn.innerHTML = '⬆️ ' + t('docker.updateContainer', 'Actualizar');
                updateBtn.addEventListener('click', () => updateContainer(container.id, container.name, updateBtn));
                controls.appendChild(updateBtn);
            }

            card.appendChild(controls);

            // Action buttons row (logs, web, edit)
            const actionsRow = document.createElement('div');
            actionsRow.className = 'docker-actions-row';

            // Logs button (always show, works for running and stopped)
            const logsBtn = document.createElement('button');
            logsBtn.className = 'docker-action-btn logs';
            logsBtn.innerHTML = '📜 ' + t('docker.viewLogs', 'Logs');
            logsBtn.addEventListener('click', () => openContainerLogs(container.id, container.name));
            actionsRow.appendChild(logsBtn);

            if (isRunning) {
                // Open Web button (if has public ports)
                // Deduplicate ports (same public port can appear for TCP and UDP)
                const allPublicPorts = (container.ports || []).filter(p => p.public);
                const seenPorts = new Set();
                const publicPorts = allPublicPorts.filter(p => {
                    const key = `${p.public}:${p.private}`;
                    if (seenPorts.has(key)) return false;
                    seenPorts.add(key);
                    return true;
                });
                if (publicPorts.length > 0) {
                    // Prefer common HTTP ports for the default action
                    const httpPorts = [80, 443, 8080, 8443, 8888, 9090, 3000, 5000, 9000, 8096, 7878, 8989, 8686, 9696];
                    const preferredPort = publicPorts.find(p => httpPorts.includes(p.private)) || publicPorts[0];
                    const webBtn = document.createElement('button');
                    webBtn.className = 'docker-action-btn web';
                    webBtn.innerHTML = '🌐 ' + t('docker.openWebUI', 'Web');
                    webBtn.addEventListener('click', (e) => {
                        if (publicPorts.length === 1) {
                            // Single port — open directly
                            const proto = preferredPort.private === 443 || preferredPort.private === 8443 ? 'https' : 'http';
                            window.open(`${proto}://${window.location.hostname}:${preferredPort.public}`, '_blank');
                        } else {
                            // Multiple ports — show selector as fixed popup near the button
                            const existing = document.querySelector('.docker-port-selector');
                            if (existing) { existing.remove(); return; }
                            const selector = document.createElement('div');
                            selector.className = 'docker-port-selector';
                            const btnRect = webBtn.getBoundingClientRect();
                            // Position above the button to avoid overlapping with notes section below
                            const popupHeight = publicPorts.length * 38 + 16; // estimate
                            const topPos = btnRect.top - popupHeight - 4;
                            const useAbove = topPos > 10; // fall back to below if not enough space above
                            const finalTop = useAbove ? topPos : (btnRect.bottom + 4);
                            selector.style.cssText = `position:fixed;z-index:10000;background:var(--bg-primary, #fff);border:2px solid var(--accent, #4f46e5);border-radius:10px;padding:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);display:flex;flex-direction:column;gap:4px;top:${finalTop}px;left:${btnRect.left}px;`;
                            for (const p of publicPorts) {
                                const opt = document.createElement('button');
                                opt.className = 'docker-action-btn web';
                                opt.style.cssText = 'font-size:0.85rem;padding:6px 12px;white-space:nowrap;text-align:left;';
                                const isPreferred = p === preferredPort;
                                opt.textContent = `:${p.public} → ${p.private}${isPreferred ? ' ★' : ''}`;
                                opt.addEventListener('click', () => {
                                    const proto = p.private === 443 || p.private === 8443 ? 'https' : 'http';
                                    window.open(`${proto}://${window.location.hostname}:${p.public}`, '_blank');
                                    selector.remove();
                                });
                                selector.appendChild(opt);
                            }
                            // Close on click outside
                            const closeHandler = (ev) => {
                                if (!selector.contains(ev.target) && ev.target !== webBtn) {
                                    selector.remove();
                                    document.removeEventListener('click', closeHandler);
                                }
                            };
                            setTimeout(() => document.addEventListener('click', closeHandler), 0);
                            document.body.appendChild(selector);
                        }
                    });
                    actionsRow.appendChild(webBtn);
                }
            }

            // Edit compose button (always show if container has compose file)
            if (container.compose) {
                const editBtn = document.createElement('button');
                editBtn.className = 'docker-action-btn edit';
                editBtn.innerHTML = '✏️ ' + t('docker.editCompose', 'Editar');
                editBtn.addEventListener('click', () => openEditComposeModal(container.compose.name));
                actionsRow.appendChild(editBtn);
            }

            if (actionsRow.children.length > 0) {
                card.appendChild(actionsRow);
            }

            // Notes section
            const notesDiv = document.createElement('div');
            notesDiv.className = 'docker-notes';
            
            const notesHeader = document.createElement('div');
            notesHeader.className = 'docker-notes-header';
            
            const notesLabel = document.createElement('span');
            notesLabel.textContent = `📝 ${t('docker.notes', 'Notas')}`;
            
            const saveNoteBtn = document.createElement('button');
            saveNoteBtn.className = 'btn-sm';
            saveNoteBtn.style.cssText = 'padding: 4px 8px; font-size: 0.7rem;';
            saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
            
            notesHeader.appendChild(notesLabel);
            notesHeader.appendChild(saveNoteBtn);
            
            const notesTextarea = document.createElement('textarea');
            notesTextarea.className = 'docker-notes-input';
            notesTextarea.placeholder = t('docker.addNote', 'Añadir notas, contraseñas, etc...');
            notesTextarea.value = container.notes || '';
            
            // Save button click handler
            saveNoteBtn.addEventListener('click', async () => {
                const ok = await saveContainerNotes(container.id, notesTextarea.value);
                if (ok) {
                    saveNoteBtn.textContent = '✓ ' + t('common.saved', 'Guardado');
                    setTimeout(() => {
                        saveNoteBtn.textContent = t('docker.saveNote', 'Guardar');
                    }, 2000);
                } else {
                    showNotification(t('common.error', 'Error al guardar'), 'error');
                }
            });
            
            notesDiv.appendChild(notesHeader);
            notesDiv.appendChild(notesTextarea);
            card.appendChild(notesDiv);

            containerGrid.appendChild(card);
        });

        dashboardContent.appendChild(containerGrid);
    }

    // Compose Files Section
    if (composeFiles.length > 0) {
        const composeSectionTitle = document.createElement('h3');
        composeSectionTitle.style.cssText = 'grid-column: 1 / -1; margin-top: 30px; margin-bottom: 10px;';
        composeSectionTitle.textContent = t('docker.composeFiles', 'Docker Compose Files');
        dashboardContent.appendChild(composeSectionTitle);

        const composeGrid = document.createElement('div');
        composeGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 15px; grid-column: 1 / -1;';

        composeFiles.forEach(compose => {
            const card = document.createElement('div');
            card.className = 'glass-card';
            card.style.padding = '15px';

            const header = document.createElement('div');
            header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;';

            const name = document.createElement('h4');
            name.style.margin = '0';
            name.textContent = compose.name;

            const modified = document.createElement('span');
            modified.style.cssText = 'font-size: 0.75rem; color: var(--text-dim);';
            modified.textContent = new Date(compose.modified).toLocaleDateString();

            header.appendChild(name);
            header.appendChild(modified);

            const controls = document.createElement('div');
            controls.style.cssText = 'display: flex; gap: 8px;';

            const runBtn = document.createElement('button');
            runBtn.style.cssText = 'flex: 1; padding: 8px; background: #10b981; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            runBtn.textContent = t('docker.run', 'Run');
            runBtn.addEventListener('click', () => runCompose(compose.name, runBtn));

            const stopBtn = document.createElement('button');
            stopBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            stopBtn.textContent = t('docker.stop', 'Stop');
            stopBtn.addEventListener('click', () => stopCompose(compose.name, stopBtn));

            const deleteBtn = document.createElement('button');
            deleteBtn.style.cssText = 'padding: 8px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
            deleteBtn.textContent = '🗑️';
            deleteBtn.addEventListener('click', () => deleteCompose(compose.name));

            controls.appendChild(runBtn);
            controls.appendChild(stopBtn);
            controls.appendChild(deleteBtn);

            card.appendChild(header);
            card.appendChild(controls);
            composeGrid.appendChild(card);
        });

        dashboardContent.appendChild(composeGrid);
    }
}

// Docker Update Functions
async function checkDockerUpdates(event) {
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '🔄 Checking...';

    try {
        const res = await authFetch(`${API_BASE}/docker/check-updates`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Check failed');

        showNotification(t('docker.updateCheckComplete', `Comprobación completada: ${data.totalImages} imágenes revisadas, ${data.updatesAvailable} actualizaciones disponibles`), 'info');
        renderContent('docker');
    } catch (e) {
        console.error('Docker update check error:', e);
        showNotification(e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '🔄 ' + t('docker.checkUpdates', 'Buscar Actualizaciones');
    }
}

async function updateContainer(containerId, containerName, btn) {
    const confirmed = await showConfirmModal(
        `¿Actualizar "${containerName}"?`,
        'Esto parará el container, descargará la última imagen y lo recreará. Los volúmenes y datos se conservan.'
    );
    if (!confirmed) return;

    btn.disabled = true;
    btn.innerHTML = '⏳ Updating...';

    try {
        const res = await authFetch(`${API_BASE}/docker/update`, {
            method: 'POST',
            body: JSON.stringify({ containerId })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Update failed');

        showNotification(t('docker.containerUpdated', `Contenedor "${containerName}" actualizado`), 'success');
        renderContent('docker');
    } catch (e) {
        console.error('Container update error:', e);
        showNotification(t('docker.updateFailed', 'Actualización fallida') + ': ' + e.message, 'error');
        btn.disabled = false;
        btn.innerHTML = '⬆️ Update Container';
    }
}

// Compose Functions
function openComposeModal() {
    const modal = document.createElement('div');
    modal.id = 'compose-modal';
    modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0,0,0,0.8); display: flex; align-items: center;
        justify-content: center; z-index: 1000;
    `;

    modal.innerHTML = `
        <div class="docker-compose-modal">
            <div class="docker-compose-header">
                <h3 class="docker-compose-title">${t('docker.importCompose', 'Importar Docker Compose')}</h3>
                <button id="close-compose-modal" class="docker-compose-close">&times;</button>
            </div>
            <div class="input-group docker-compose-input-group">
                <input type="text" id="compose-name" placeholder=" " required>
                <label>${t('docker.stackName', 'Nombre del Stack')}</label>
            </div>
            <div class="docker-compose-label-wrap">
                <label class="docker-compose-label">docker-compose.yml content:</label>
                <div class="docker-compose-file-row">
                    <label class="docker-compose-file-label">
                        📁 ${t('docker.uploadYml', 'Subir archivo .yml')}
                        <input type="file" id="compose-file-input" accept=".yml,.yaml" class="docker-compose-file-input">
                    </label>
                </div>
                <textarea id="compose-content" class="docker-compose-textarea" placeholder="version: '3'
services:
  myapp:
    image: nginx:latest
    ports:
      - '8080:80'"></textarea>
            </div>
            <div class="cloudbackup-sync-input-group">
                <button id="save-compose-btn" class="btn-primary docker-compose-save-btn">${t('docker.saveCompose', 'Guardar Compose')}</button>
                <button id="save-run-compose-btn" class="btn-primary docker-compose-save-run-btn">${t('docker.saveAndRun', 'Guardar y Ejecutar')}</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    document.getElementById('close-compose-modal').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });

    // File upload handler
    document.getElementById("compose-file-input").addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                document.getElementById("compose-content").value = event.target.result;
                // Auto-fill stack name from filename if empty
                const nameInput = document.getElementById("compose-name");
                if (!nameInput.value.trim()) {
                    nameInput.value = file.name.replace(/.(yml|yaml)$/i, "").replace(/docker-compose[-_]?/i, "") || "stack";
                }
            };
            reader.readAsText(file);
        }
    });


    document.getElementById('save-compose-btn').addEventListener('click', () => saveCompose(false));
    document.getElementById('save-run-compose-btn').addEventListener('click', () => saveCompose(true));
}

async function saveCompose(andRun) {
    const name = document.getElementById("compose-name").value.trim();
    const content = document.getElementById("compose-content").value;

    if (!name) {
        showNotification(t('docker.stackNameRequired', 'Introduce un nombre para el stack'), 'warning');
        return;
    }
    if (!content) {
        showNotification(t('docker.composeContentRequired', 'Introduce el contenido del compose'), 'warning');
        return;
    }

    // Replace modal content with progress view
    const modal = document.getElementById("compose-modal");
    const modalContent = modal.querySelector("div");
    modalContent.innerHTML = `
        <h3 class="docker-deploy-title">Desplegando Stack: ${escapeHtml(name)}</h3>
        <div id="deploy-steps">
            <div class="deploy-step" id="step-save">
                <span class="step-icon">⏳</span>
                <span class="step-text">Guardando archivo compose...</span>
            </div>
            ${andRun ? `<div class="deploy-step" id="step-pull">
                <span class="step-icon">⏳</span>
                <span class="step-text">Descargando imágenes...</span>
            </div>
            <div class="deploy-step" id="step-start">
                <span class="step-icon">⏳</span>
                <span class="step-text">Iniciando contenedores...</span>
            </div>` : ""}
        </div>
        <div class="docker-deploy-progress-wrap">
            <div class="docker-deploy-progress-bg">
                <div id="deploy-progress" class="docker-deploy-progress-bar"></div>
            </div>
            <div id="deploy-status" class="docker-deploy-status">Inicializando...</div>
        </div>
        <div id="deploy-log" class="docker-deploy-log"></div>
        <div id="deploy-actions" class="docker-deploy-actions">
            <button id="deploy-close-btn" class="btn-primary docker-deploy-close">Accept</button>
        </div>
    `;

    const updateStep = (stepId, status) => {
        const step = document.getElementById(stepId);
        if (!step) return;
        step.className = "deploy-step";
        if (status) step.classList.add(status);
    };

    const updateProgress = (percent, text) => {
        const bar = document.getElementById("deploy-progress");
        const status = document.getElementById("deploy-status");
        if (bar) bar.style.width = percent + "%";
        if (status) status.textContent = text;
    };

    const showResult = (success, message, log = "") => {
        const actions = document.getElementById("deploy-actions");
        const logDiv = document.getElementById("deploy-log");
        const btn = document.getElementById("deploy-close-btn");
        
        if (actions) actions.style.display = "block";
        if (!success && log && logDiv) {
            logDiv.style.display = "block";
            logDiv.textContent = log;
            logDiv.style.color = "#ef4444";
        }
        if (btn) {
            btn.textContent = success ? "Accept" : "Close";
            btn.style.background = success ? "#10b981" : "#ef4444";
            btn.onclick = () => {
                modal.remove();
                if (success) renderContent("docker");
            };
        }
        updateProgress(100, message);
    };

    try {
        // Step 1: Save compose file
        updateStep("step-save", "active");
        updateProgress(10, "Guardando archivo compose...");

        const res = await authFetch(`${API_BASE}/docker/compose/import`, {
            method: "POST",
            body: JSON.stringify({ name, content })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Error al importar");

        updateStep("step-save", "done");
        updateProgress(andRun ? 33 : 100, andRun ? "Compose guardado, iniciando despliegue..." : "¡Compose guardado exitosamente!");

        if (andRun) {
            // Step 2: Pull & Start
            updateStep("step-pull", "active");
            updateProgress(50, "Descargando imágenes e iniciando contenedores...");

            const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                method: "POST",
                body: JSON.stringify({ name })
            });
            const runData = await runRes.json();

            if (!runRes.ok) {
                updateStep("step-pull", "error");
                updateStep("step-start", "error");
                throw new Error(runData.error || runData.output || "Error al ejecutar");
            }

            updateStep("step-pull", "done");
            updateStep("step-start", "done");
            showResult(true, "¡Stack desplegado exitosamente! ✅");
        } else {
            showResult(true, "¡Archivo Compose guardado! ✅");
        }

    } catch (e) {
        console.error("Compose deploy error:", e);
        const currentStep = document.querySelector(".deploy-step.active");
        if (currentStep) currentStep.classList.replace("active", "error");
        showResult(false, "Despliegue fallido ❌", e.message);
    }
}

async function runCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = t('docker.starting', 'Iniciando...');

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/up`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || t('common.error', 'Error al iniciar'));

        showNotification(`Compose "${name}" ${t('docker.started', 'iniciado')}`, 'success');
        renderContent('docker');
    } catch (e) {
        console.error('Compose run error:', e);
        showNotification(e.message, 'error');
        btn.disabled = false;
        btn.textContent = t('docker.run', 'Ejecutar');
    }
}

async function stopCompose(name, btn) {
    btn.disabled = true;
    btn.textContent = t('docker.stopping', 'Deteniendo...');

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/down`, {
            method: 'POST',
            body: JSON.stringify({ name })
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || t('common.error', 'Error al detener'));

        showNotification(`Compose "${name}" ${t('docker.stopped', 'detenido')}`, 'success');
        renderContent('docker');
    } catch (e) {
        console.error('Compose stop error:', e);
        showNotification(e.message, 'error');
        btn.disabled = false;
        btn.textContent = t('docker.stop', 'Detener');
    }
}

async function deleteCompose(name) {
    const confirmed = await showConfirmModal(
        `¿Eliminar "${name}"?`,
        'Esto parará todos los containers y eliminará el archivo compose.'
    );
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(name)}`, {
            method: 'DELETE'
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Delete failed');

        showNotification(t('docker.composeDeleted', `Compose "${name}" eliminado`), 'success');
        renderContent('docker');
    } catch (e) {
        console.error('Compose delete error:', e);
        showNotification(e.message, 'error');
    }
}

// Edit compose modal
async function openEditComposeModal(composeName) {
    // Fetch current compose content
    let content = '';
    try {
        const res = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`);
        if (res.ok) {
            const data = await res.json();
            content = data.content || '';
        }
    } catch (e) {
        console.error('Error fetching compose:', e);
    }

    const modal = document.createElement('div');
    modal.className = 'modal active';
    modal.innerHTML = `
        <div class="glass-card modal-content docker-edit-modal">
            <header class="modal-header">
                <h3>✏️ ${t('docker.editCompose', 'Editar Compose')}: ${escapeHtml(composeName)}</h3>
                <button id="close-edit-compose" class="btn-close">&times;</button>
            </header>
            <div class="docker-edit-padding">
                <textarea id="edit-compose-content" class="docker-edit-textarea">${escapeHtml(content)}</textarea>
            </div>
            <div class="modal-footer docker-edit-footer">
                <button id="cancel-edit-compose" class="btn-primary docker-edit-cancel">
                    ${t('common.cancel', 'Cancelar')}
                </button>
                <button id="save-edit-compose" class="btn-primary">
                    ${t('common.save', 'Guardar')}
                </button>
                <button id="save-run-edit-compose" class="btn-primary docker-edit-save-run">
                    ${t('docker.saveAndRun', 'Guardar y Ejecutar')}
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const closeModal = () => modal.remove();
    document.getElementById('close-edit-compose').addEventListener('click', closeModal);
    document.getElementById('cancel-edit-compose').addEventListener('click', closeModal);

    // Click outside to close
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    const saveHandler = async (andRun) => {
        const newContent = document.getElementById('edit-compose-content').value;
        try {
            // Save compose
            const saveRes = await authFetch(`${API_BASE}/docker/compose/${encodeURIComponent(composeName)}`, {
                method: 'PUT',
                body: JSON.stringify({ content: newContent })
            });
            if (!saveRes.ok) {
                const data = await saveRes.json();
                throw new Error(data.error || 'Failed to save');
            }

            if (andRun) {
                // Run compose
                const runRes = await authFetch(`${API_BASE}/docker/compose/up`, {
                    method: 'POST',
                    body: JSON.stringify({ name: composeName })
                });
                if (!runRes.ok) {
                    const data = await runRes.json();
                    throw new Error(data.error || 'Failed to run');
                }
            }

            modal.remove();
            renderContent('docker');
        } catch (e) {
            showNotification(e.message, 'error');
        }
    };

    document.getElementById('save-edit-compose').addEventListener('click', () => saveHandler(false));
    document.getElementById('save-run-edit-compose').addEventListener('click', () => saveHandler(true));
}

window.checkDockerUpdates = checkDockerUpdates;
window.updateContainer = updateContainer;
window.openComposeModal = openComposeModal;
window.openEditComposeModal = openEditComposeModal;

async function handleDockerAction(id, action, btn) {
    if (!btn) return;

    btn.disabled = true;
    btn.textContent = t('common.processing', 'Procesando...');

    try {
        const res = await authFetch(`${API_BASE}/docker/action`, {
            method: 'POST',
            body: JSON.stringify({ id, action })
        });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'Docker action failed');
        }

        renderContent('docker');
    } catch (e) {
        console.error('Docker action error:', e);
        showNotification(e.message || t('docker.error', 'Error de Docker'), 'error');
        btn.disabled = false;
        btn.textContent = action === 'stop' ? 'Stop' : 'Start';
    }
}

// Keep window reference for backward compatibility
window.handleDockerAction = handleDockerAction;

// Network Manager (Refined)
async function renderNetworkManager() {
    try {
        const res = await authFetch(`${API_BASE}/network/interfaces`);
        if (!res.ok) throw new Error('Failed to fetch interfaces');
        state.network.interfaces = await res.json();
    } catch (e) {
        console.error('Network fetch error:', e);
        dashboardContent.innerHTML = `<div class="glass-card"><h3>${t('common.error', 'Error al cargar datos de red')}</h3></div>`;
        return;
    }

    // Remove any existing network-grid to prevent duplicates
    const existingGrid = dashboardContent.querySelector('.network-grid');
    if (existingGrid) existingGrid.remove();

    const container = document.createElement('div');
    container.className = 'network-grid';

    // 1. Interfaces Section
    const ifaceSection = document.createElement('div');
    const ifaceTitle = document.createElement('h3');
    ifaceTitle.textContent = 'CM5 ' + t('network.adapters', 'Adaptadores de Red');
    ifaceTitle.style.marginBottom = '20px';
    ifaceSection.appendChild(ifaceTitle);

    // Grid container for interface cards
    const interfacesGrid = document.createElement('div');
    interfacesGrid.className = 'interfaces-grid';

    state.network.interfaces.forEach(iface => {
        const card = document.createElement('div');
        card.className = 'glass-card interface-card';
        card.dataset.interfaceId = iface.id;

        const isConnected = iface.status === 'connected';
        // Use local state if available, otherwise use server state
        const isDhcp = localDhcpState[iface.id] !== undefined ? localDhcpState[iface.id] : iface.dhcp;

        // Create header
        const header = document.createElement('div');
        header.className = 'interface-header';

        const headerInfo = document.createElement('div');
        const h4 = document.createElement('h4');
        h4.textContent = `${iface.name || t('common.unknown', 'Desconocido')} (${iface.id || 'N/A'})`;
        const statusSpan = document.createElement('span');
        statusSpan.style.cssText = `font-size: 0.8rem; color: ${isConnected ? '#10b981' : '#94a3b8'}`;
        const statusMap = { connected: t('terminal.connected', 'CONECTADO'), disconnected: t('terminal.disconnected', 'DESCONECTADO') };
        statusSpan.textContent = statusMap[iface.status] || (iface.status || t('common.unknown', 'desconocido')).toUpperCase();
        headerInfo.appendChild(h4);
        headerInfo.appendChild(statusSpan);

        const checkboxItem = document.createElement('div');
        checkboxItem.className = 'checkbox-item';

        const dhcpCheckbox = document.createElement('input');
        dhcpCheckbox.type = 'checkbox';
        dhcpCheckbox.id = `dhcp-${iface.id}`;
        dhcpCheckbox.checked = isDhcp;
        dhcpCheckbox.addEventListener('change', (e) => toggleDHCP(iface.id, e.target.checked, iface));

        const dhcpLabel = document.createElement('label');
        dhcpLabel.htmlFor = `dhcp-${iface.id}`;
        dhcpLabel.textContent = 'DHCP';

        checkboxItem.appendChild(dhcpCheckbox);
        checkboxItem.appendChild(dhcpLabel);

        header.appendChild(headerInfo);
        header.appendChild(checkboxItem);

        // Create form — reuse renderNetForm to avoid duplication
        const netForm = document.createElement('div');
        netForm.className = 'net-form';
        netForm.id = `netform-${iface.id}`;
        renderNetForm(netForm, iface, isDhcp);

        card.appendChild(header);
        card.appendChild(netForm);
        interfacesGrid.appendChild(card);
    });

    ifaceSection.appendChild(interfacesGrid);

    // DDNS section is now rendered by renderDDNSSection() after this function
    container.appendChild(ifaceSection);
    dashboardContent.appendChild(container);
}

// Network functions
function toggleDHCP(interfaceId, isChecked, iface) {
    // Update local state
    localDhcpState[interfaceId] = isChecked;

    // When switching to manual, try to populate gateway if empty
    if (!isChecked && !iface.gateway) {
        // Attempt to infer gateway from the IP (common pattern: x.x.x.1)
        if (iface.ip) {
            const parts = iface.ip.split('.');
            if (parts.length === 4) {
                iface.gateway = `${parts[0]}.${parts[1]}.${parts[2]}.1`;
            }
        }
    }

    // Re-render only the form for this interface
    const netForm = document.getElementById(`netform-${interfaceId}`);
    if (netForm) {
        renderNetForm(netForm, iface, isChecked);
    }
}

// Helper function to render the network form
function renderNetForm(netForm, iface, isDhcp) {
    netForm.innerHTML = '';

    if (isDhcp) {
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        inputGroup.style.gridColumn = '1 / -1';

        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.value = iface.ip || '';
        ipInput.disabled = true;
        ipInput.placeholder = ' ';

        const label = document.createElement('label');
        label.textContent = t('network.hardwareAssignedIP', 'Hardware Assigned IP');

        inputGroup.appendChild(ipInput);
        inputGroup.appendChild(label);
        netForm.appendChild(inputGroup);
    } else {
        // IP Input
        const ipGroup = document.createElement('div');
        ipGroup.className = 'input-group';
        const ipInput = document.createElement('input');
        ipInput.type = 'text';
        ipInput.id = `ip-${iface.id}`;
        ipInput.value = iface.ip || '';
        ipInput.placeholder = ' ';
        const ipLabel = document.createElement('label');
        ipLabel.textContent = t('network.ipAddress', 'Dirección IP');
        ipGroup.appendChild(ipInput);
        ipGroup.appendChild(ipLabel);

        // Subnet Input
        const subnetGroup = document.createElement('div');
        subnetGroup.className = 'input-group';
        const subnetInput = document.createElement('input');
        subnetInput.type = 'text';
        subnetInput.id = `subnet-${iface.id}`;
        subnetInput.value = iface.subnet || '';
        subnetInput.placeholder = ' ';
        const subnetLabel = document.createElement('label');
        subnetLabel.textContent = t('network.subnetMask', 'Máscara de Subred');
        subnetGroup.appendChild(subnetInput);
        subnetGroup.appendChild(subnetLabel);

        // Gateway Input
        const gatewayGroup = document.createElement('div');
        gatewayGroup.className = 'input-group';
        const gatewayInput = document.createElement('input');
        gatewayInput.type = 'text';
        gatewayInput.id = `gateway-${iface.id}`;
        gatewayInput.value = iface.gateway || '';
        gatewayInput.placeholder = ' ';
        const gatewayLabel = document.createElement('label');
        gatewayLabel.textContent = t('network.gateway', 'Puerta de Enlace');
        gatewayGroup.appendChild(gatewayInput);
        gatewayGroup.appendChild(gatewayLabel);

        // DNS Input
        const dnsGroup = document.createElement('div');
        dnsGroup.className = 'input-group';
        const dnsInput = document.createElement('input');
        dnsInput.type = 'text';
        dnsInput.id = `dns-${iface.id}`;
        dnsInput.value = iface.dns || '';
        dnsInput.placeholder = ' ';
        const dnsLabel = document.createElement('label');
        dnsLabel.textContent = t('network.dns', 'DNS') + ' (ej: 8.8.8.8)';
        dnsGroup.appendChild(dnsInput);
        dnsGroup.appendChild(dnsLabel);

        netForm.appendChild(ipGroup);
        netForm.appendChild(subnetGroup);
        netForm.appendChild(gatewayGroup);
        netForm.appendChild(dnsGroup);
    }

    // Save button
    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; align-items: flex-end; padding-top: 10px; grid-column: 1 / -1;';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'padding: 10px; width: 100%;';
    saveBtn.textContent = t('network.saveToNode', 'Guardar en Nodo');
    saveBtn.addEventListener('click', () => applyNetwork(iface.id));

    btnContainer.appendChild(saveBtn);
    netForm.appendChild(btnContainer);
}

async function applyNetwork(interfaceId) {
    const dhcpCheckbox = document.getElementById(`dhcp-${interfaceId}`);
    const isDhcp = dhcpCheckbox ? dhcpCheckbox.checked : false;

    let config = { dhcp: isDhcp };

    if (!isDhcp) {
        const ipInput = document.getElementById(`ip-${interfaceId}`);
        const subnetInput = document.getElementById(`subnet-${interfaceId}`);
        const gatewayInput = document.getElementById(`gateway-${interfaceId}`);
        const dnsInput = document.getElementById(`dns-${interfaceId}`);

        if (ipInput) config.ip = ipInput.value.trim();
        if (subnetInput) config.subnet = subnetInput.value.trim();
        if (gatewayInput) config.gateway = gatewayInput.value.trim();
        if (dnsInput) config.dns = dnsInput.value.trim();

        // Basic validation
        const ipRegex = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;

        if (config.ip && !ipRegex.test(config.ip)) {
            showNotification(t('network.invalidIP', 'Formato de IP inválido'), 'warning');
            return;
        }

        if (config.subnet && !ipRegex.test(config.subnet)) {
            showNotification(t('network.invalidSubnet', 'Formato de máscara de subred inválido'), 'warning');
            return;
        }

        if (config.gateway && !ipRegex.test(config.gateway)) {
            showNotification(t('network.invalidGateway', 'Formato de puerta de enlace inválido'), 'warning');
            return;
        }

        if (config.dns && !ipRegex.test(config.dns)) {
            showNotification(t('network.invalidDNS', 'Formato de DNS inválido'), 'warning');
            return;
        }
    }

    try {
        const res = await authFetch(`${API_BASE}/network/configure`, {
            method: 'POST',
            body: JSON.stringify({ id: interfaceId, config })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Network configuration failed');
        }

        showToast(data.message || t('common.saved', 'Configuración guardada'), 'success');
        // If IP changed, warn user they may need to reconnect
        if (!isDhcp && config.ip) {
            const currentUrl = new URL(window.location);
            const currentHost = currentUrl.hostname;
            if (config.ip !== currentHost) {
                setTimeout(async () => {
                    const goToNew = await showConfirmModal(
                        t('network.ipChanged', 'IP cambiada'),
                        t('network.goToNewIP', `IP cambiada a ${config.ip}. ¿Ir a la nueva dirección?`),
                        t('common.yes', 'Sí'),
                        t('common.no', 'No')
                    );
                    if (goToNew) {
                        currentUrl.hostname = config.ip;
                        window.location.href = currentUrl.toString();
                    }
                }, 1500);
            }
        }
    } catch (e) {
        console.error('Network config error:', e);
        showToast(e.message || t('common.error', 'Error al aplicar configuración de red'), 'error');
    }
}

// DDNS modal is now handled by showDDNSForm() in renderDDNSSection

// Terms and Conditions Modal
const termsModal = document.getElementById('terms-modal');
const termsLink = document.getElementById('terms-link');
const closeTermsBtn = document.getElementById('close-terms-modal');
const acceptTermsBtn = document.getElementById('accept-terms-btn');

if (termsLink) {
    termsLink.addEventListener('click', (e) => {
        e.preventDefault();
        if (termsModal) termsModal.style.display = 'flex';
    });
}

if (closeTermsBtn) {
    closeTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (acceptTermsBtn) {
    acceptTermsBtn.addEventListener('click', () => {
        if (termsModal) termsModal.style.display = 'none';
    });
}

if (termsModal) {
    termsModal.addEventListener('click', (e) => {
        if (e.target === termsModal) {
            termsModal.style.display = 'none';
        }
    });
}

// System View (Real Actions)
function renderSystemView() {
    // Format uptime intelligently
    const uptimeSeconds = Number(state.globalStats.uptime) || 0;
    const days = Math.floor(uptimeSeconds / 86400);
    const hours = Math.floor((uptimeSeconds % 86400) / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    let uptimeStr;
    if (days > 0) {
        uptimeStr = `${days} día${days > 1 ? 's' : ''} ${hours}h`;
    } else if (hours > 0) {
        uptimeStr = `${hours} hora${hours > 1 ? 's' : ''} ${minutes}m`;
    } else {
        uptimeStr = `${minutes} minuto${minutes !== 1 ? 's' : ''}`;
    }
    const hostname = escapeHtml(state.globalStats.hostname || 'raspberrypi');

    const container = document.createElement('div');
    container.style.cssText = 'display: contents;';

    // Management card
    const mgmtCard = document.createElement('div');
    mgmtCard.className = 'glass-card';
    mgmtCard.style.gridColumn = '1 / -1';

    const mgmtTitle = document.createElement('h3');
    mgmtTitle.textContent = 'CM5 ' + t('system.nodeManagement', 'Gestión del Nodo');

    const mgmtDesc = document.createElement('p');
    mgmtDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    mgmtDesc.textContent = t('system.executeActions', 'Ejecutar acciones físicas en el hardware del NAS.');

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 20px; margin-top: 30px;';

    const rebootBtn = document.createElement('button');
    rebootBtn.className = 'btn-primary';
    rebootBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4);';
    rebootBtn.textContent = t('system.restartNode', 'Reiniciar Nodo');
    rebootBtn.addEventListener('click', () => systemAction('reboot'));

    const shutdownBtn = document.createElement('button');
    shutdownBtn.className = 'btn-primary';
    shutdownBtn.style.cssText = 'background: #ef4444; box-shadow: 0 4px 15px rgba(239, 68, 68, 0.4);';
    shutdownBtn.textContent = t('system.powerOff', 'Apagar');
    shutdownBtn.addEventListener('click', () => systemAction('shutdown'));

    btnContainer.appendChild(rebootBtn);
    btnContainer.appendChild(shutdownBtn);

    mgmtCard.appendChild(mgmtTitle);
    mgmtCard.appendChild(mgmtDesc);
    mgmtCard.appendChild(btnContainer);

    // Info card
    const infoCard = document.createElement('div');
    infoCard.className = 'glass-card';

    const infoTitle = document.createElement('h3');
    infoTitle.textContent = t('system.systemInfo', 'Información del Sistema');

    const uptimeRow = document.createElement('div');
    uptimeRow.className = 'stat-row';
    uptimeRow.innerHTML = `<span>${t('system.logicUptime', 'Tiempo Activo Lógico')}</span> <span>${escapeHtml(uptimeStr)}</span>`;

    const hostnameRow = document.createElement('div');
    hostnameRow.className = 'stat-row';
    hostnameRow.innerHTML = `<span>${t('system.nodeName', 'Nombre del Nodo')}</span> <span>${escapeHtml(hostname)}</span>`;

    infoCard.appendChild(infoTitle);
    infoCard.appendChild(uptimeRow);
    infoCard.appendChild(hostnameRow);

    // Dashboard Update card
    const dashUpdateCard = document.createElement('div');
    dashUpdateCard.className = 'glass-card';

    const dashUpdateTitle = document.createElement('h3');
    dashUpdateTitle.textContent = t('system.dashboardUpdate', 'Actualización HomePiNAS');

    const dashUpdateDesc = document.createElement('p');
    dashUpdateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    dashUpdateDesc.textContent = t('system.dashboardUpdateDesc', 'Buscar e instalar actualizaciones del dashboard desde GitHub.');

    const updateStatus = document.createElement('div');
    updateStatus.id = 'update-status';
    updateStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    updateStatus.innerHTML = `<span class="misc-status-placeholder">${t('system.clickToCheck', 'Haz clic en "Buscar" para verificar...')}</span>`;

    const dashBtnContainer = document.createElement('div');
    dashBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkUpdateBtn = document.createElement('button');
    checkUpdateBtn.className = 'btn-primary';
    checkUpdateBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkUpdateBtn.textContent = t('system.checkUpdates', 'Buscar Actualizaciones');
    checkUpdateBtn.addEventListener('click', checkForUpdates);

    const applyUpdateBtn = document.createElement('button');
    applyUpdateBtn.className = 'btn-primary';
    applyUpdateBtn.id = 'apply-update-btn';
    applyUpdateBtn.style.cssText = 'background: #10b981; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.4); display: none;';
    applyUpdateBtn.textContent = t('system.installUpdate', 'Instalar Actualización');
    applyUpdateBtn.addEventListener('click', applyUpdate);

    dashBtnContainer.appendChild(checkUpdateBtn);
    dashBtnContainer.appendChild(applyUpdateBtn);

    dashUpdateCard.appendChild(dashUpdateTitle);
    dashUpdateCard.appendChild(dashUpdateDesc);
    dashUpdateCard.appendChild(updateStatus);
    dashUpdateCard.appendChild(dashBtnContainer);

    // OS Update card
    const osUpdateCard = document.createElement('div');
    osUpdateCard.className = 'glass-card';

    const osUpdateTitle = document.createElement('h3');
    osUpdateTitle.textContent = t('system.osUpdate', 'Actualización del Sistema');

    const osUpdateDesc = document.createElement('p');
    osUpdateDesc.style.cssText = 'color: var(--text-dim); margin-top: 10px;';
    osUpdateDesc.textContent = t('system.osUpdateDesc', 'Buscar e instalar actualizaciones de paquetes del sistema operativo.');

    const osStatus = document.createElement('div');
    osStatus.id = 'os-update-status';
    osStatus.style.cssText = 'margin-top: 15px; padding: 10px; background: rgba(255,255,255,0.05); border-radius: 8px;';
    osStatus.innerHTML = `<span class="misc-status-placeholder">${t('system.clickToCheck', 'Haz clic en "Buscar" para verificar...')}</span>`;

    const osBtnContainer = document.createElement('div');
    osBtnContainer.style.cssText = 'display: flex; gap: 15px; margin-top: 20px;';

    const checkOsBtn = document.createElement('button');
    checkOsBtn.className = 'btn-primary';
    checkOsBtn.style.cssText = 'background: #6366f1; box-shadow: 0 4px 15px rgba(99, 102, 241, 0.4);';
    checkOsBtn.textContent = t('system.checkOsUpdates', 'Buscar Actualizaciones');
    checkOsBtn.addEventListener('click', checkOsUpdates);

    const applyOsBtn = document.createElement('button');
    applyOsBtn.className = 'btn-primary';
    applyOsBtn.id = 'apply-os-update-btn';
    applyOsBtn.style.cssText = 'background: #f59e0b; box-shadow: 0 4px 15px rgba(245, 158, 11, 0.4); display: none;';
    applyOsBtn.textContent = t('system.installOsUpdate', 'Instalar Actualizaciones');
    applyOsBtn.addEventListener('click', applyOsUpdate);

    osBtnContainer.appendChild(checkOsBtn);
    osBtnContainer.appendChild(applyOsBtn);

    osUpdateCard.appendChild(osUpdateTitle);
    osUpdateCard.appendChild(osUpdateDesc);
    osUpdateCard.appendChild(osStatus);
    osUpdateCard.appendChild(osBtnContainer);

    // Update grid (2 columns)
    const updateGrid = document.createElement('div');
    updateGrid.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px;';
    dashUpdateCard.style.width = 'auto';
    osUpdateCard.style.width = 'auto';
    updateGrid.appendChild(dashUpdateCard);
    updateGrid.appendChild(osUpdateCard);

    dashboardContent.appendChild(mgmtCard);
    dashboardContent.appendChild(infoCard);
    dashboardContent.appendChild(updateGrid);
}

async function systemAction(action) {
    const actionLabel = action === 'reboot' ? 'reiniciar' : 'apagar';
    const confirmed = await showConfirmModal(t('system.action', 'Acción del sistema'), `¿Seguro que quieres ${actionLabel} el NAS?`);
    if (!confirmed) return;

    try {
        const res = await authFetch(`${API_BASE}/power/${action}`, { method: 'POST' });

        if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || 'System action failed');
        }

        showNotification(t('system.commandSent', `Comando ${action.toUpperCase()} enviado`), 'info');
    } catch (e) {
        console.error('System action error:', e);
        showNotification(e.message || t('system.error', 'Error del sistema'), 'error');
    }
}

window.systemAction = systemAction;

// Update Functions
async function checkForUpdates() {
    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (!statusEl) return;

    statusEl.innerHTML = `<span class="misc-status-checking">${t('system.checkingUpdates', 'Buscando actualizaciones...')}</span>`;
    if (applyBtn) applyBtn.style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/update/check`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || t('common.error', 'Error al buscar actualizaciones'));
        }

        // Warning for local changes
        const localChangesWarning = data.localChanges ? `
            <div class="misc-update-warning-box">
                <div class="misc-update-warning-title">⚠️ Cambios locales detectados</div>
                <div class="misc-update-warning-text">
                    Hay archivos modificados localmente. La actualización hará <code>git reset --hard</code> y perderás estos cambios:
                </div>
                <code class="misc-update-code">${escapeHtml((data.localChangesFiles || []).join('\n'))}</code>
            </div>
        ` : '';

        if (data.updateAvailable) {
            statusEl.innerHTML = `
                <div class="misc-update-available-title">${t('system.updateAvailable', '¡Actualización Disponible!')}</div>
                <div class="misc-update-version-info">
                    ${t('system.current', 'Actual')}: <strong>v${escapeHtml(data.currentVersion)}</strong> →
                    ${t('system.latest', 'Última')}: <strong class="misc-update-version-highlight">v${escapeHtml(data.latestVersion)}</strong>
                </div>
                <div class="misc-update-changelog-wrap">
                    <strong>${t('system.changes', 'Cambios')}:</strong><br>
                    <code class="misc-update-changelog-code">${escapeHtml(data.changelog || t('common.info', 'Ver GitHub para detalles'))}</code>
                </div>
                ${localChangesWarning}
            `;
            if (applyBtn) applyBtn.style.display = 'inline-block';
        } else {
            statusEl.innerHTML = `
                <div class="misc-update-uptodate-title">${t('system.upToDate', '¡Estás al día!')}</div>
                <div class="misc-update-uptodate-text">
                    ${t('system.version', 'Versión')}: <strong>v${escapeHtml(data.currentVersion)}</strong>
                </div>
                ${localChangesWarning}
            `;
        }
    } catch (e) {
        console.error('Update check error:', e);
        statusEl.innerHTML = `<span class="dash-status-error">Error: ${escapeHtml(e.message)}</span>`;
    }
}

async function applyUpdate() {
    const confirmed = await showConfirmModal(t('system.installUpdate', 'Instalar actualización'), t('system.confirmUpdate', '¿Instalar la actualización ahora? El servicio se reiniciará.'));
    if (!confirmed) return;

    const statusEl = document.getElementById('update-status');
    const applyBtn = document.getElementById('apply-update-btn');

    if (statusEl) {
        statusEl.innerHTML = `<span class="misc-status-checking">${t('system.installingUpdate', 'Instalando actualización... Por favor espera.')}</span>`;
    }
    if (applyBtn) {
        applyBtn.disabled = true;
        applyBtn.textContent = t('system.installing', 'Instalando...');
    }

    try {
        const res = await authFetch(`${API_BASE}/update/apply`, { method: 'POST' });
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.error || 'Update failed');
        }

        if (statusEl) {
            statusEl.innerHTML = `
                <div class="misc-update-progress-info">Update started!</div>
                <div class="misc-update-progress-text">
                    The service is restarting. This page will refresh automatically in 30 seconds...
                </div>
                <div class="misc-update-progress-wrap">
                    <div class="misc-update-progress-bar-bg">
                        <div id="update-progress" class="misc-update-progress-bar"></div>
                    </div>
                </div>
            `;
        }

        // Progress animation and auto-refresh
        let progress = 0;
        const progressEl = document.getElementById('update-progress');
        const interval = setInterval(() => {
            progress += 3.33;
            if (progressEl) progressEl.style.width = `${Math.min(progress, 100)}%`;
            if (progress >= 100) {
                clearInterval(interval);
                window.location.reload();
            }
        }, 1000);

    } catch (e) {
        console.error('Update apply error:', e);
        if (statusEl) {
            statusEl.innerHTML = `<span class="dash-status-error">${t('system.updateFailed', 'Actualización fallida')}: ${escapeHtml(e.message)}</span>`;
        }
        if (applyBtn) {
            applyBtn.disabled = false;
            applyBtn.textContent = t('system.retryUpdate', 'Reintentar Actualización');
            applyBtn.style.display = 'inline-block';
        }
    }
}

window.checkForUpdates = checkForUpdates;
window.applyUpdate = applyUpdate;

// OS Update Functions
async function checkOsUpdates() {
    const statusEl = document.getElementById('os-update-status');
    const applyBtn = document.getElementById('apply-os-update-btn');
    if (!statusEl) return;

    statusEl.innerHTML = `<span class="misc-status-checking">${t('system.checkingOsUpdates', 'Buscando actualizaciones del sistema... (puede tardar)')}</span>`;
    if (applyBtn) applyBtn.style.display = 'none';

    try {
        const res = await authFetch(`${API_BASE}/update/check-os`);
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || 'Error');

        if (data.updatesAvailable > 0) {
            const secBadge = data.securityUpdates > 0
                ? `<span class="misc-os-update-security-badge"> (${data.securityUpdates} de seguridad)</span>` : '';
            const pkgList = (data.packages || []).slice(0, 15).map(p =>
                `${escapeHtml(p.name)} ${p.currentVersion ? escapeHtml(p.currentVersion) + ' → ' : ''}${escapeHtml(p.newVersion)}`
            ).join('\n');
            const moreCount = data.updatesAvailable > 15 ? `\n... y ${data.updatesAvailable - 15} más` : '';

            statusEl.innerHTML = `
                <div class="misc-os-update-available-title">${data.updatesAvailable} ${t('system.osUpdatesAvailable', 'actualizaciones disponibles')}${secBadge}</div>
                <code class="misc-os-update-code">${escapeHtml(pkgList + moreCount)}</code>
            `;
            if (applyBtn) applyBtn.style.display = 'inline-block';
        } else {
            statusEl.innerHTML = `
                <div class="misc-os-uptodate-title">${t('system.osUpToDate', '¡Sistema operativo al día!')}</div>
                <div class="misc-os-uptodate-text">${t('system.noOsUpdates', 'No hay paquetes pendientes de actualización.')}</div>
            `;
        }
    } catch (e) {
        statusEl.innerHTML = `<span class="dash-status-error">Error: ${escapeHtml(e.message)}</span>`;
    }
}

async function applyOsUpdate() {
    const confirmed = await showConfirmModal(
        t('system.osUpdateConfirmTitle', 'Actualizar sistema operativo'),
        t('system.osUpdateConfirmMsg', '¿Instalar todas las actualizaciones del sistema? Esto puede tardar varios minutos.')
    );
    if (!confirmed) return;

    const statusEl = document.getElementById('os-update-status');
    const applyBtn = document.getElementById('apply-os-update-btn');

    if (statusEl) statusEl.innerHTML = `<span class="misc-status-checking">${t('system.installingOsUpdate', 'Instalando actualizaciones del SO... Esto puede tardar varios minutos.')}</span>`;
    if (applyBtn) { applyBtn.disabled = true; applyBtn.textContent = t('system.installing', 'Instalando...'); }

    try {
        const res = await authFetch(`${API_BASE}/update/apply-os`, { method: 'POST' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Error');

        if (statusEl) {
            statusEl.innerHTML = `
                <div class="misc-os-install-started-title">${t('system.osUpdateStarted', '¡Actualización del SO iniciada!')}</div>
                <div class="misc-os-install-started-text">${t('system.osUpdateRunning', 'Las actualizaciones se están instalando en segundo plano. Puedes seguir usando el dashboard.')}</div>
            `;
        }
        if (applyBtn) applyBtn.style.display = 'none';
    } catch (e) {
        if (statusEl) statusEl.innerHTML = `<span class="dash-status-error">Error: ${escapeHtml(e.message)}</span>`;
        if (applyBtn) { applyBtn.disabled = false; applyBtn.textContent = t('system.retryUpdate', 'Reintentar'); }
    }
}

// Auto-check for dashboard updates once per day and show banner
(function initDashboardUpdateCheck() {
    const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
    const STORAGE_KEY = 'homepinas_last_update_check';

    async function silentUpdateCheck() {
        try {
            const res = await authFetch(`${API_BASE}/update/check`);
            if (!res.ok) return;
            const data = await res.json();

            localStorage.setItem(STORAGE_KEY, Date.now().toString());

            if (data.updateAvailable) {
                showUpdateBanner(data.currentVersion, data.latestVersion);
            } else {
                // Remove banner if no update
                const existing = document.getElementById('update-banner');
                if (existing) existing.remove();
            }
        } catch (e) {
            // Silent fail - don't bother user
        }
    }

    function showUpdateBanner(currentVersion, latestVersion) {
        // Don't show duplicate banner
        if (document.getElementById('update-banner')) return;

        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.style.cssText = 'position: fixed; bottom: 20px; right: 20px; z-index: 9998; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; padding: 16px 20px; border-radius: 12px; box-shadow: 0 8px 24px rgba(99,102,241,0.4); display: flex; align-items: center; gap: 12px; max-width: 400px; animation: slideInRight 0.4s ease;';
        banner.innerHTML = `
            <div class="misc-update-banner-icon">🆕</div>
            <div class="misc-update-banner-content">
                <div class="misc-update-banner-title">${t('system.updateAvailableBanner', '¡Actualización disponible!')}</div>
                <div class="misc-update-banner-version">v${escapeHtml(currentVersion)} → v${escapeHtml(latestVersion)}</div>
            </div>
            <button data-action="view-update" class="misc-update-banner-view-btn">${t('system.viewUpdate', 'Ver')}</button>
            <button data-action="dismiss-update" class="misc-update-banner-close-btn">&times;</button>
        `;
        document.body.appendChild(banner);
    }

    // Check on page load (after small delay) if enough time has passed
    setTimeout(() => {
        const lastCheck = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
        if (Date.now() - lastCheck > CHECK_INTERVAL) {
            silentUpdateCheck();
        }
    }, 10000); // Wait 10s after page load

    // Also set interval for long sessions
    setInterval(silentUpdateCheck, CHECK_INTERVAL);
})();

// Helper Colors
function getRoleColor(role) {
    switch (role) {
        case 'data': return '#6366f1';
        case 'parity': return '#f59e0b';
        case 'cache': return '#10b981';
        case 'independent': return '#14b8a6';
        default: return '#475569';
    }
}

if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
        const confirmed = await showConfirmModal(t('system.resetNAS', 'RESETEAR NAS'), t('system.confirmReset', '¿Seguro que quieres RESETEAR todo el NAS? Se borrará toda la configuración.'));
        if (!confirmed) return;

        resetBtn.textContent = t('system.resettingNode', 'Reseteando Nodo...');
        resetBtn.disabled = true;

        try {
            // Use public factory-reset endpoint (no auth required - for login page)
            const res = await fetch(`${API_BASE}/system/factory-reset`, { method: 'POST' });
            const data = await res.json();

            if (res.ok && data.success) {
                // Clear local session
                clearSession();
                window.location.reload();
            } else {
                showNotification(t('system.resetFailed', 'Reseteo Fallido') + ': ' + (data.error || t('common.unknown', 'Error desconocido')), 'error');
                resetBtn.textContent = t('system.resetSetupData', 'Resetear Configuración');
                resetBtn.disabled = false;
            }
        } catch (e) {
            console.error('Reset error:', e);
            showNotification(e.message || t('system.resetError', 'Error de Reseteo: Comunicación interrumpida'), 'error');
            resetBtn.textContent = t('system.resetSetupData', 'Resetear Configuración');
            resetBtn.disabled = false;
        }
    });
}


// Power menu handler (logout, reboot, shutdown)
const powerBtn = document.getElementById("power-btn");
const powerDropdown = document.getElementById("power-dropdown");
if (powerBtn && powerDropdown) {
    // Toggle dropdown via CSS class
    powerBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        powerDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener("click", () => {
        powerDropdown.classList.remove('open');
    });
    powerDropdown.addEventListener("click", (e) => e.stopPropagation());

    // Logout
    document.getElementById("power-logout").addEventListener("click", async () => {
        powerDropdown.classList.remove('open');
        const confirmed = await showConfirmModal(t('auth.logout', 'Cerrar sesión'), t('auth.confirmLogout', '¿Seguro que quieres cerrar sesión?'));
        if (confirmed) {
            clearSession();
            state.isAuthenticated = false;
            state.user = null;
            window.location.reload();
        }
    });

    // Reboot
    document.getElementById("power-reboot").addEventListener("click", async () => {
        powerDropdown.classList.remove('open');
        const confirmed = await showConfirmModal('Reiniciar sistema', '¿Seguro que quieres reiniciar el sistema? Se perderán todas las conexiones activas.');
        if (confirmed) {
            try {
                const res = await authFetch(`${API_BASE}/power/reboot`, { method: 'POST' });
                if (res.ok) {
                    showNotification(t('system.restarting', 'Sistema reiniciando... La página se recargará en 60 segundos.'), 'success', 10000);
                    setTimeout(() => window.location.reload(), 60000);
                } else {
                    const data = await res.json();
                    showNotification(data.error || 'Error al reiniciar', 'error');
                }
            } catch (e) {
                showNotification('Error al reiniciar: ' + e.message, 'error');
            }
        }
    });

    // Shutdown
    document.getElementById("power-shutdown").addEventListener("click", async () => {
        powerDropdown.classList.remove('open');
        const confirmed = await showConfirmModal('Apagar sistema', '⚠️ ¿Seguro que quieres APAGAR el sistema? Necesitarás acceso físico para volver a encenderlo.');
        if (confirmed) {
            try {
                const res = await authFetch(`${API_BASE}/power/shutdown`, { method: 'POST' });
                if (res.ok) {
                    showNotification(t('system.shuttingDown', 'Sistema apagándose...'), 'warning', 10000);
                } else {
                    const data = await res.json();
                    showNotification(data.error || 'Error al apagar', 'error');
                }
            } catch (e) {
                showNotification('Error al apagar: ' + e.message, 'error');
            }
        }
    });
}

// Header notifications and user menu handlers
const headerNotifications = document.getElementById("header-notifications");
const headerUserMenu = document.getElementById("header-user-menu");

if (headerNotifications) {
    headerNotifications.addEventListener("click", () => {
        // Show notifications dropdown or modal
        showNotificationCenter();
    });
}

if (headerUserMenu) {
    headerUserMenu.addEventListener("click", (e) => {
        e.stopPropagation();
        showUserMenu();
    });
}

// Simple notification center function
function showNotificationCenter() {
    // Create notification center modal if it doesn't exist
    let modal = document.getElementById('notification-center-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'notification-center-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <header class="modal-header">
                    <h3>Centro de Notificaciones</h3>
                    <button class="modal-close" data-action="close-modal">&times;</button>
                </header>
                <div class="modal-body">
                    <div class="notification-list">
                        <div class="empty-state">
                            <div class="empty-icon">🔔</div>
                            <p>No hay notificaciones</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
}

// Simple user menu function
function showUserMenu() {
    // Create user menu dropdown if it doesn't exist
    let dropdown = document.getElementById('user-menu-dropdown');
    if (!dropdown) {
        dropdown = document.createElement('div');
        dropdown.id = 'user-menu-dropdown';
        dropdown.className = 'user-menu-dropdown';
        dropdown.innerHTML = `
            <div class="user-menu-option" data-action="user-profile">
                <span class="user-menu-icon">👤</span>
                <span>Perfil de Usuario</span>
            </div>
            <div class="user-menu-option" data-action="user-settings">
                <span class="user-menu-icon">⚙️</span>
                <span>Configuración</span>
            </div>
            <div class="user-menu-divider"></div>
            <div class="user-menu-option" data-action="change-password">
                <span class="user-menu-icon">🔑</span>
                <span>Cambiar Contraseña</span>
            </div>
        `;
        
        // Position dropdown relative to user menu
        const userMenu = document.getElementById('header-user-menu');
        userMenu.style.position = 'relative';
        userMenu.appendChild(dropdown);
    }
    
    // Toggle dropdown visibility
    dropdown.classList.toggle('show');
    
    // Close dropdown when clicking outside
    setTimeout(() => {
        document.addEventListener('click', function closeUserMenu(e) {
            if (!dropdown.contains(e.target) && !document.getElementById('header-user-menu').contains(e.target)) {
                dropdown.classList.remove('show');
                document.removeEventListener('click', closeUserMenu);
            }
        });
    }, 0);
}

// User menu helper functions
function showUserProfile() {
    showNotification(t('common.featureInDev', 'Funcionalidad en desarrollo'), 'info');
    document.getElementById('user-menu-dropdown').classList.remove('show');
}

function showUserSettings() {
    showNotification(t('common.featureInDev', 'Funcionalidad en desarrollo'), 'info');
    document.getElementById('user-menu-dropdown').classList.remove('show');
}

function showChangePassword() {
    // Create change password modal
    let modal = document.getElementById('change-password-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'change-password-modal';
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <header class="modal-header">
                    <h3>Cambiar Contraseña</h3>
                    <button class="modal-close" data-action="close-modal">&times;</button>
                </header>
                <div class="modal-body">
                    <form id="change-password-form">
                        <div class="input-group">
                            <input type="password" id="current-password" required placeholder=" ">
                            <label for="current-password">Contraseña Actual</label>
                        </div>
                        <div class="input-group">
                            <input type="password" id="new-password" required placeholder=" ">
                            <label for="new-password">Nueva Contraseña</label>
                        </div>
                        <div class="input-group">
                            <input type="password" id="confirm-password" required placeholder=" ">
                            <label for="confirm-password">Confirmar Nueva Contraseña</label>
                        </div>
                        <div class="modal-actions">
                            <button type="button" data-action="close-modal">Cancelar</button>
                            <button type="submit">Cambiar Contraseña</button>
                        </div>
                    </form>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    modal.classList.add('active');
    document.getElementById('user-menu-dropdown').classList.remove('show');
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

export { renderDockerManager };
