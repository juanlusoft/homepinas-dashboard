/**
 * File Manager — File Actions
 * download, delete, rename, createNewFolder, searchFiles,
 * fmPreviewFile, showFileContextMenu, showFileLocation,
 * multi-select & bulk operations, clipboard (copy/cut/paste).
 */

import { authFetch } from '../api.js';
import { showNotification, showConfirmModal } from '../notifications.js';
import { _trackListener } from './listeners.js';
import { escapeHtml, formatFileSize, getFileIconSVG, getFolderSVG } from './utils.js';

const API_BASE = '/api';

// ─── Shared state injected by index.js ───────────────────────────────────────

let _getCurrentPath  = () => '/';
let _setCurrentPath  = (_p) => {};
let _getRenderView   = () => async () => {};   // () => renderFilesView fn
let _getLoadFiles    = () => async (_p) => {}; // () => loadFiles fn
let _getFmCurrentFiles = () => [];

export function setActionDeps({ getCurrentPath, setCurrentPath, getRenderView, getLoadFiles, getFmCurrentFiles }) {
    _getCurrentPath    = getCurrentPath;
    _setCurrentPath    = setCurrentPath;
    _getRenderView     = getRenderView;
    _getLoadFiles      = getLoadFiles;
    _getFmCurrentFiles = getFmCurrentFiles;
}

// ─── Selection state ─────────────────────────────────────────────────────────

export let fmSelectedFiles = new Set();
export let fmClipboard     = { action: null, files: [] };

// ─── Selection helpers ────────────────────────────────────────────────────────

export function fmToggleSelect(path, checked) {
    if (checked) {
        fmSelectedFiles.add(path);
    } else {
        fmSelectedFiles.delete(path);
    }
    fmUpdateBulkBar();
    const row = document.querySelector(`[data-path="${CSS.escape(path)}"]`);
    if (row) row.classList.toggle('selected', checked);
}

export function fmToggleSelectAll(checked) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.checked = checked;
    });
    if (checked) {
        _getFmCurrentFiles().forEach(f => fmSelectedFiles.add(_getCurrentPath() + '/' + f.name));
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.add('selected'));
    } else {
        fmSelectedFiles.clear();
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    fmUpdateBulkBar();
}

export function fmUpdateBulkBar() {
    const bar   = document.getElementById('fm-bulk-bar');
    const count = document.getElementById('fm-bulk-count');
    if (!bar) return;
    if (fmSelectedFiles.size > 0) {
        bar.style.display = 'flex';
        if (count) count.textContent = `${fmSelectedFiles.size} seleccionado${fmSelectedFiles.size > 1 ? 's' : ''}`;
    } else {
        bar.style.display = 'none';
    }
}

export function fmClearSelection() {
    fmSelectedFiles.clear();
    const filesList = document.getElementById('files-list');
    if (filesList) {
        filesList.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
        filesList.querySelectorAll('[data-path]').forEach(r => r.classList.remove('selected'));
    }
    const selectAll = document.getElementById('fm-select-all');
    if (selectAll) selectAll.checked = false;
    fmUpdateBulkBar();
}

// ─── Bulk operations ─────────────────────────────────────────────────────────

export async function fmBulkDelete() {
    if (fmSelectedFiles.size === 0) return;
    const confirmed = await showConfirmModal('Eliminar archivos', `¿Eliminar ${fmSelectedFiles.size} elemento(s)?`);
    if (!confirmed) return;
    for (const fp of fmSelectedFiles) {
        try {
            await authFetch(`${API_BASE}/files/delete`, { method: 'POST', body: JSON.stringify({ path: fp }) });
        } catch (e) { console.error('Delete error:', e); }
    }
    fmSelectedFiles.clear();
    await _getLoadFiles()(_getCurrentPath());
}

export function fmBulkDownload() {
    for (const fp of fmSelectedFiles) {
        downloadFile(fp);
    }
}

export function fmBulkCopy() {
    fmClipboard = { action: 'copy', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    _getRenderView()();
}

export function fmBulkCut() {
    fmClipboard = { action: 'cut', files: Array.from(fmSelectedFiles).map(p => ({ path: p, name: p.split('/').pop() })) };
    fmClearSelection();
    _getRenderView()();
}

export async function fmPaste() {
    if (!fmClipboard.action || fmClipboard.files.length === 0) return;
    for (const f of fmClipboard.files) {
        const newPath = _getCurrentPath() + '/' + f.name;
        try {
            if (fmClipboard.action === 'copy') {
                await authFetch(`${API_BASE}/files/copy`, { method: 'POST', body: JSON.stringify({ srcPath: f.path, destPath: newPath }) });
            } else {
                await authFetch(`${API_BASE}/files/rename`, { method: 'POST', body: JSON.stringify({ oldPath: f.path, newPath: newPath }) });
            }
        } catch (e) { console.error('Paste error:', e); }
    }
    fmClipboard = { action: null, files: [] };
    await _getLoadFiles()(_getCurrentPath());
    _getRenderView()();
}

// ─── File CRUD ────────────────────────────────────────────────────────────────

/**
 * Download a file
 * @async
 * @param {string} filePath - Path to file to download
 */
export async function downloadFile(filePath) {
    try {
        const res = await authFetch(`${API_BASE}/files/download?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Download failed');
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filePath.split('/').pop() || 'download';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (e) {
        showNotification('Error al descargar archivo', 'error');
    }
}

/**
 * Delete a file
 * @async
 * @param {string} filePath - Path to file
 * @param {string} name - File name
 */
export async function deleteFile(filePath, name) {
    const confirmed = await showConfirmModal('Eliminar archivo', `¿Eliminar "${name}"?`);
    if (!confirmed) return;
    try {
        const res = await authFetch(`${API_BASE}/files/delete`, {
            method: 'POST',
            body: JSON.stringify({ path: filePath })
        });
        if (!res.ok) throw new Error('Failed');
        await _getLoadFiles()(_getCurrentPath());
    } catch (e) {
        showNotification('Error al eliminar', 'error');
    }
}

/**
 * Rename a file
 * @async
 * @param {string} filePath - Path to file
 * @param {string} oldName - Current file name
 */
export async function renameFile(filePath, oldName) {
    const newName = prompt('Nuevo nombre:', oldName);
    if (!newName || newName === oldName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..' || trimmed.includes('\0')) {
        showNotification('Nombre no válido. No puede contener / \\ ni ser . o ..', 'warning');
        return;
    }
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    try {
        const res = await authFetch(`${API_BASE}/files/rename`, {
            method: 'POST',
            body: JSON.stringify({ oldPath: filePath, newPath: dir + '/' + trimmed })
        });
        if (!res.ok) throw new Error('Failed');
        await _getLoadFiles()(_getCurrentPath());
    } catch (e) {
        showNotification('Error al renombrar', 'error');
    }
}

/**
 * Create a new folder
 * @async
 */
export async function createNewFolder() {
    const name = prompt('Nombre de la carpeta:');
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..' || trimmed.includes('\0')) {
        showNotification('Nombre de carpeta no válido. No puede contener / \\ ni ser . o ..', 'warning');
        return;
    }
    try {
        const res = await authFetch(`${API_BASE}/files/mkdir`, {
            method: 'POST',
            body: JSON.stringify({ path: _getCurrentPath() + '/' + trimmed })
        });
        if (!res.ok) throw new Error('Failed');
        await _getLoadFiles()(_getCurrentPath());
        // Refresh folder tree via renderFilesView
        await _getRenderView()();
    } catch (e) {
        showNotification('Error al crear carpeta', 'error');
    }
}

/**
 * Search files
 * @async
 * @param {string} query - Search query
 */
export async function searchFiles(query) {
    if (!query.trim()) { await _getLoadFiles()(_getCurrentPath()); return; }
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>🔍 Buscando...</p></div>';
    try {
        const res = await authFetch(`${API_BASE}/files/search?path=${encodeURIComponent(_getCurrentPath())}&query=${encodeURIComponent(query)}`);
        if (!res.ok) throw new Error('Search failed');
        const searchData = await res.json();
        const results    = searchData.results || searchData || [];
        if (results.length === 0) {
            filesList.innerHTML = '<div class="fm-empty-state"><p>Sin resultados para "' + escapeHtml(query) + '"</p></div>';
            return;
        }
        filesList.innerHTML  = '';
        filesList.className  = 'fm-list';
        results.forEach(file => {
            const row      = document.createElement('div');
            row.className  = 'fm-row';
            row.innerHTML  = `
                <span></span>
                <span class="fm-file-icon">${file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name || file.path.split('/').pop())}</span>
                <span class="fm-file-name" style="grid-column: span 2;">${file.path || file.name}</span>
                <span class="fm-file-meta">${file.type === 'directory' ? '—' : formatFileSize(file.size)}</span>
                <span></span><span></span>
            `;
            row.style.cursor = 'pointer';
            const rowClickHandler = () => {
                if (file.type === 'directory') {
                    _setCurrentPath(file.path || ('/' + file.name));
                    _getRenderView()();
                }
            };
            row.addEventListener('click', rowClickHandler);
            _trackListener(row, 'click', rowClickHandler);
            filesList.appendChild(row);
        });
    } catch (e) {
        filesList.innerHTML = '<div class="fm-empty-state" style="color: #ef4444;">Error en la búsqueda</div>';
    }
}

// ─── Context menu ─────────────────────────────────────────────────────────────

export function showFileContextMenu(e, filePath, file) {
    document.querySelectorAll('.fm-context-menu').forEach(m => m.remove());

    const menu        = document.createElement('div');
    menu.className    = 'fm-context-menu';

    const menuWidth  = 200;
    const menuHeight = 280;
    let top  = e.clientY;
    let left = e.clientX;
    if (left + menuWidth  > window.innerWidth)  left = window.innerWidth  - menuWidth  - 8;
    if (top  + menuHeight > window.innerHeight) top  = window.innerHeight - menuHeight - 8;
    menu.style.top  = top  + 'px';
    menu.style.left = left + 'px';

    const items = [
        ...(file.type === 'directory' ? [
            { icon: '📂', label: 'Abrir carpeta', action: () => { _setCurrentPath(filePath); _getRenderView()(); } },
        ] : [
            { icon: '👁️', label: 'Vista previa', action: () => fmPreviewFile(file, filePath.substring(0, filePath.lastIndexOf('/'))) },
        ]),
        { icon: '✏️', label: 'Renombrar', action: () => renameFile(filePath, file.name) },
        ...(file.type !== 'directory' ? [
            { icon: '⬇️', label: 'Descargar', action: () => downloadFile(filePath) },
        ] : []),
        { divider: true },
        { icon: '📋', label: 'Copiar', action: () => { fmClipboard = { action: 'copy', files: [{ path: filePath, name: file.name }] }; _getRenderView()(); } },
        { icon: '✂️', label: 'Mover',  action: () => { fmClipboard = { action: 'cut',  files: [{ path: filePath, name: file.name }] }; _getRenderView()(); } },
        { divider: true },
        { icon: '📍', label: 'Ver ubicación', action: () => showFileLocation(filePath) },
        { divider: true },
        { icon: '🗑️', label: 'Eliminar', action: () => deleteFile(filePath, file.name), danger: true },
    ];

    items.forEach(item => {
        if (item.divider) {
            const hr      = document.createElement('div');
            hr.className  = 'fm-context-divider';
            menu.appendChild(hr);
            return;
        }
        const btn      = document.createElement('button');
        btn.className  = 'fm-context-item' + (item.danger ? ' danger' : '');
        btn.innerHTML  = `<span>${item.icon}</span><span>${item.label}</span>`;
        const btnClickHandler = () => { menu.remove(); item.action(); };
        btn.addEventListener('click', btnClickHandler);
        _trackListener(btn, 'click', btnClickHandler);
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);
    requestAnimationFrame(() => menu.classList.add('visible'));
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}

async function showFileLocation(filePath) {
    try {
        const res  = await authFetch(`${API_BASE}/storage/file-location?path=${encodeURIComponent(filePath)}`);
        const data = await res.json();

        const typeIcon = data.diskType === 'cache' ? '⚡' : data.diskType === 'data' ? '💿' : '❓';
        const typeName = data.diskType === 'cache' ? 'Caché (SSD/NVMe)' : data.diskType === 'data' ? 'Pool de datos (HDD)' : 'Desconocido';

        showNotification(`${typeIcon} ${escapeHtml(filePath.split('/').pop())}: ${typeName} (${escapeHtml(data.physicalLocation)})`, 'info');
    } catch (e) {
        showNotification('No se pudo determinar la ubicación del archivo', 'error');
    }
}

// ─── File preview ─────────────────────────────────────────────────────────────

/**
 * Preview a file
 * @param {Object} file - File object
 * @param {string} basePath - Base path
 */
export function fmPreviewFile(file, basePath) {
    const fullPath  = basePath + '/' + file.name;
    const ext       = file.name.split('.').pop().toLowerCase();
    const imgExts   = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
    const textExts  = ['txt', 'md', 'log', 'json', 'yml', 'yaml', 'xml', 'csv', 'sh', 'bash', 'py', 'js', 'ts', 'html', 'css', 'php', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'sql', 'conf', 'cfg', 'ini', 'env', 'toml', 'service', 'properties', 'gitignore', 'dockerfile'];
    const videoExts = ['mp4', 'webm', 'ogg'];
    const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];

    document.querySelectorAll('.fm-preview-overlay').forEach(m => m.remove());

    const overlay   = document.createElement('div');
    overlay.className = 'fm-preview-overlay';

    const modal     = document.createElement('div');
    modal.className = 'fm-preview-modal';

    const header    = document.createElement('div');
    header.className = 'fm-preview-header';

    const titleSpan       = document.createElement('span');
    titleSpan.className   = 'fm-preview-title';
    titleSpan.textContent = file.name;

    const actionsDiv      = document.createElement('div');
    actionsDiv.className  = 'fm-preview-actions';

    const downloadBtn     = document.createElement('button');
    downloadBtn.className = 'fm-action-btn';
    downloadBtn.title     = 'Descargar';
    downloadBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
    const downloadBtnHandler = () => downloadFile(fullPath);
    downloadBtn.addEventListener('click', downloadBtnHandler);
    _trackListener(downloadBtn, 'click', downloadBtnHandler);

    const closeBtn     = document.createElement('button');
    closeBtn.className = 'fm-action-btn';
    closeBtn.title     = 'Cerrar';
    closeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

    actionsDiv.appendChild(downloadBtn);
    actionsDiv.appendChild(closeBtn);
    header.appendChild(titleSpan);
    header.appendChild(actionsDiv);
    modal.appendChild(header);

    const body     = document.createElement('div');
    body.className = 'fm-preview-body';

    const fileEndpoint  = `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}`;
    let _previewBlobUrl = null;

    function loadPreviewBlob(callback) {
        body.innerHTML = '<div class="fm-preview-loading"><div class="fm-spinner"></div></div>';
        authFetch(fileEndpoint)
            .then(r => r.ok ? r.blob() : Promise.reject('Download failed'))
            .then(blob => {
                _previewBlobUrl = URL.createObjectURL(blob);
                callback(_previewBlobUrl);
            })
            .catch(() => {
                body.innerHTML = '<p class="fm-preview-error">Error al cargar el archivo</p>';
            });
    }

    function closePreview() {
        if (_previewBlobUrl) { URL.revokeObjectURL(_previewBlobUrl); _previewBlobUrl = null; }
        overlay.remove();
    }

    if (imgExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<img src="${url}" alt="${escapeHtml(file.name)}" class="fm-preview-image" />`;
        });
    } else if (videoExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<video controls autoplay class="fm-preview-video"><source src="${escapeHtml(encodeURI(url))}"></video>`;
        });
    } else if (audioExts.includes(ext)) {
        loadPreviewBlob(url => {
            body.innerHTML = `<div class="fm-preview-audio-wrap">${getFileIconSVG(file.name, 80)}<audio controls autoplay class="fm-preview-audio"><source src="${escapeHtml(encodeURI(url))}"></audio></div>`;
        });
    } else if (ext === 'pdf') {
        loadPreviewBlob(url => {
            body.innerHTML = `<iframe src="${escapeHtml(encodeURI(url))}" class="fm-preview-pdf"></iframe>`;
        });
    } else if (textExts.includes(ext)) {
        body.innerHTML = '<div class="fm-preview-loading"><div class="fm-spinner"></div></div>';
        authFetch(fileEndpoint).then(r => r.text()).then(text => {
            const pre      = document.createElement('pre');
            pre.className  = 'fm-preview-code';
            pre.textContent = text.slice(0, 100000);
            body.innerHTML  = '';
            body.appendChild(pre);
        }).catch(() => {
            body.innerHTML = '<p class="fm-preview-error">Error al cargar el archivo</p>';
        });
    } else {
        body.innerHTML = `
            <div class="fm-preview-nopreview">
                ${getFileIconSVG(file.name, 80)}
                <p class="fm-preview-file-name">${escapeHtml(file.name)}</p>
                <p class="fm-preview-file-meta">${formatFileSize(file.size)} · ${ext.toUpperCase()}</p>
                <button class="btn-primary btn-sm fm-nopreview-download" style="margin-top: 16px;">Descargar archivo</button>
            </div>
        `;
        const nopreviewDownloadHandler = () => downloadFile(fullPath);
        body.querySelector('.fm-nopreview-download').addEventListener('click', nopreviewDownloadHandler);
        _trackListener(body.querySelector('.fm-nopreview-download'), 'click', nopreviewDownloadHandler);
    }

    modal.appendChild(body);

    const footer     = document.createElement('div');
    footer.className = 'fm-preview-footer';
    footer.innerHTML = `
        <span>📐 ${formatFileSize(file.size)}</span>
        <span>📅 ${file.modified ? new Date(file.modified).toLocaleString('es-ES') : '—'}</span>
        ${file.permissions ? `<span>🔒 ${file.permissions}</span>` : ''}
    `;
    modal.appendChild(footer);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const overlayClickHandler = (e) => { if (e.target === overlay) closePreview(); };
    overlay.addEventListener('click', overlayClickHandler);
    _trackListener(overlay, 'click', overlayClickHandler);

    const closeBtnHandler = () => closePreview();
    closeBtn.addEventListener('click', closeBtnHandler);
    _trackListener(closeBtn, 'click', closeBtnHandler);

    const escHandler = (e) => { if (e.key === 'Escape') { closePreview(); document.removeEventListener('keydown', escHandler); } };
    document.addEventListener('keydown', escHandler);
    _trackListener(document, 'keydown', escHandler);
}
