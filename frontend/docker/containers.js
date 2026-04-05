/**
 * DOCKER CONTAINER CARDS
 * ════════════════════════════════════════════════════════════════════════════════
 * Builds individual container card DOM elements for the Docker manager view
 */

import { showNotification } from '../notifications.js';
import { escapeHtml } from '../utils.js';
import { t } from '/frontend/i18n.js';
import { authFetch } from '../api.js';
import { handleDockerAction, updateContainer } from './actions.js';
import { openEditComposeModal } from './compose.js';

const API_BASE = `${window.location.origin}/api`;

/**
 * Save notes for a container
 * @param {string} containerId
 * @param {string} notes
 * @returns {Promise<boolean>}
 */
async function saveContainerNotes(containerId, notes) {
    try {
        const res = await authFetch(`${API_BASE}/docker/containers/${encodeURIComponent(containerId)}/notes`, {
            method: 'POST',
            body: JSON.stringify({ notes })
        });
        return res.ok;
    } catch (e) {
        console.error('Save notes error:', e);
        return false;
    }
}

/**
 * Open container logs modal (stub — not yet implemented)
 * @param {string} containerId
 * @param {string} containerName
 */
function openContainerLogs(containerId, containerName) {
    showNotification(t('common.featureInDev', 'Funcionalidad en desarrollo'), 'info');
}

/**
 * Open stacks manager modal (stub — not yet implemented)
 */
function openStacksManager() {
    showNotification(t('common.featureInDev', 'Funcionalidad en desarrollo'), 'info');
}

/**
 * Build a container card DOM element
 * @param {Object} container - Container data object
 * @returns {HTMLElement}
 */
export function buildContainerCard(container) {
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

    card.appendChild(header);

    // Stats row (running containers only)
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
        portsDiv.style.marginBottom = '12px';
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

    // Controls row (start/stop + restart + update)
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

    // Logs button (always show)
    const logsBtn = document.createElement('button');
    logsBtn.className = 'docker-action-btn logs';
    logsBtn.innerHTML = '📜 ' + t('docker.viewLogs', 'Logs');
    logsBtn.addEventListener('click', () => openContainerLogs(container.id, container.name));
    actionsRow.appendChild(logsBtn);

    if (isRunning) {
        // Open Web button (if has public ports)
        const allPublicPorts = (container.ports || []).filter(p => p.public);
        const seenPorts = new Set();
        const publicPorts = allPublicPorts.filter(p => {
            const key = `${p.public}:${p.private}`;
            if (seenPorts.has(key)) return false;
            seenPorts.add(key);
            return true;
        });
        if (publicPorts.length > 0) {
            const httpPorts = [80, 443, 8080, 8443, 8888, 9090, 3000, 5000, 9000, 8096, 7878, 8989, 8686, 9696];
            const preferredPort = publicPorts.find(p => httpPorts.includes(p.private)) || publicPorts[0];
            const webBtn = document.createElement('button');
            webBtn.className = 'docker-action-btn web';
            webBtn.innerHTML = '🌐 ' + t('docker.openWebUI', 'Web');
            webBtn.addEventListener('click', (e) => {
                if (publicPorts.length === 1) {
                    const proto = preferredPort.private === 443 || preferredPort.private === 8443 ? 'https' : 'http';
                    window.open(`${proto}://${window.location.hostname}:${preferredPort.public}`, '_blank');
                } else {
                    const existing = document.querySelector('.docker-port-selector');
                    if (existing) { existing.remove(); return; }
                    const selector = document.createElement('div');
                    selector.className = 'docker-port-selector';
                    const btnRect = webBtn.getBoundingClientRect();
                    const popupHeight = publicPorts.length * 38 + 16;
                    const topPos = btnRect.top - popupHeight - 4;
                    const useAbove = topPos > 10;
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

    // Edit compose button (if container has compose file)
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

    return card;
}

/**
 * Build the compose file card DOM element
 * @param {Object} compose - Compose file data
 * @param {Function} onRun
 * @param {Function} onStop
 * @param {Function} onDelete
 * @returns {HTMLElement}
 */
export function buildComposeCard(compose, onRun, onStop, onDelete) {
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
    runBtn.addEventListener('click', () => onRun(compose.name, runBtn));

    const stopBtn = document.createElement('button');
    stopBtn.style.cssText = 'flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
    stopBtn.textContent = t('docker.stop', 'Stop');
    stopBtn.addEventListener('click', () => onStop(compose.name, stopBtn));

    const deleteBtn = document.createElement('button');
    deleteBtn.style.cssText = 'padding: 8px 12px; background: #ef4444; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;';
    deleteBtn.textContent = '🗑️';
    deleteBtn.addEventListener('click', () => onDelete(compose.name));

    controls.appendChild(runBtn);
    controls.appendChild(stopBtn);
    controls.appendChild(deleteBtn);

    card.appendChild(header);
    card.appendChild(controls);

    return card;
}

export { openStacksManager };
