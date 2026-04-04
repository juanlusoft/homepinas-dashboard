/**
 * DOCKER ACTIONS
 * ════════════════════════════════════════════════════════════════════════════════
 * Container lifecycle actions: start/stop/restart, update, update-check
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { renderContent } from '../main.js';
import { t } from '../../i18n.js';

const API_BASE = `${window.location.origin}/api`;

export async function handleDockerAction(id, action, btn) {
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

export async function checkDockerUpdates(event) {
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

export async function updateContainer(containerId, containerName, btn) {
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
