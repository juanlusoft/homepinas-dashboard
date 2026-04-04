/**
 * DOCKER COMPOSE MANAGEMENT
 * ════════════════════════════════════════════════════════════════════════════════
 * Import, save, run, stop, delete, and edit docker-compose stacks
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { renderContent } from '../main.js';
import { escapeHtml } from '../utils.js';
import { t } from '../../i18n.js';

const API_BASE = `${window.location.origin}/api`;

export function openComposeModal() {
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

export async function saveCompose(andRun) {
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

export async function runCompose(name, btn) {
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

export async function stopCompose(name, btn) {
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

export async function deleteCompose(name) {
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

export async function openEditComposeModal(composeName) {
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
