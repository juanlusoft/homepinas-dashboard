/**
 * File Manager Module — Entry Point
 * Exports render(container) and cleanup() as required.
 * Handles: state, thumbnail queue, loadFiles, renderFilesView, breadcrumb.
 * Delegates to:
 *   ./listeners.js — shared event-listener registry
 *   ./utils.js     — pure helpers (icons, sizes, escaping)
 *   ./upload.js    — file upload + drag-and-drop
 *   ./actions.js   — file CRUD, preview, context menu, selection, bulk ops
 *   ./browse.js    — renderFilesList / renderFilesGrid / renderFilteredFiles
 *   ./tree.js      — folder tree (left sidebar)
 * @module files
 */

import { authFetch } from '../api.js';
import { state } from '../state.js';

import { _fileManagerListeners, _trackListener, _resetListeners } from './listeners.js';
import { escapeHtml } from './utils.js';
import { handleFileUpload, fmSetupDragDrop, triggerFileUpload, setGetCurrentPath, setOnUploadDone } from './upload.js';
import {
    setActionDeps,
    fmSelectedFiles, fmClipboard,
    fmToggleSelectAll,
    fmClearSelection,
    fmBulkDelete, fmBulkDownload, fmBulkCopy, fmBulkCut, fmPaste,
    createNewFolder, searchFiles,
} from './actions.js';
import { setBrowseDeps, renderFilteredFiles, renderFilesList, renderFilesGrid } from './browse.js';
import { setTreeDeps, loadFolderTree } from './tree.js';

const API_BASE = '/api';

// ═════════════════════════════════════════════════════════════════════════════
// STATE
// ═════════════════════════════════════════════════════════════════════════════

let currentFilePath = '/';
let fmViewMode      = localStorage.getItem('fm-view-mode') || 'list'; // 'list' | 'grid'
let fmCurrentFiles  = []; // current loaded file list for reference

// Thumbnail loading queue — limits concurrent downloads to avoid overwhelming the Pi
const _thumbBlobUrls     = [];
let _thumbQueueActive    = 0;
const _thumbQueuePending = [];
const THUMB_MAX_CONCURRENT = 3;

// Folder tree state
let fmExpandedFolders = new Set(['/']);

// ─── Wire sub-module dependencies ────────────────────────────────────────────

setGetCurrentPath(() => currentFilePath);
setOnUploadDone(async () => { await loadFiles(currentFilePath); });

setActionDeps({
    getCurrentPath:    () => currentFilePath,
    setCurrentPath:    (p) => { currentFilePath = p; },
    getRenderView:     () => renderFilesView,
    getLoadFiles:      () => loadFiles,
    getFmCurrentFiles: () => fmCurrentFiles,
});

setBrowseDeps({
    getCurrentPath: () => currentFilePath,
    setCurrentPath: (p) => { currentFilePath = p; },
    getRenderView:  () => renderFilesView,
    enqueueThumb:   (thumb, url) => _enqueueThumbLoad(thumb, url),
    getFmViewMode:  () => fmViewMode,
});

setTreeDeps({
    getCurrentPath:    () => currentFilePath,
    setCurrentPath:    (p) => { currentFilePath = p; },
    getRenderView:     () => renderFilesView,
    getExpandedFolders: () => fmExpandedFolders,
    addExpanded:       (p) => fmExpandedFolders.add(p),
    deleteExpanded:    (p) => fmExpandedFolders.delete(p),
});

// ═════════════════════════════════════════════════════════════════════════════
// THUMBNAIL QUEUE
// ═════════════════════════════════════════════════════════════════════════════

function _cleanupThumbBlobs() {
    while (_thumbBlobUrls.length > 0) {
        URL.revokeObjectURL(_thumbBlobUrls.pop());
    }
    _thumbQueuePending.length = 0;
    _thumbQueueActive = 0;
}

function _enqueueThumbLoad(thumb, url) {
    _thumbQueuePending.push({ thumb, url });
    _processThumbQueue();
}

function _processThumbQueue() {
    while (_thumbQueueActive < THUMB_MAX_CONCURRENT && _thumbQueuePending.length > 0) {
        const { thumb, url } = _thumbQueuePending.shift();
        _thumbQueueActive++;
        authFetch(url)
            .then(r => r.ok ? r.blob() : null)
            .then(blob => {
                if (blob && thumb.isConnected) {
                    const blobUrl = URL.createObjectURL(blob);
                    _thumbBlobUrls.push(blobUrl);
                    thumb.src = blobUrl;
                }
            })
            .catch(() => {})
            .finally(() => {
                _thumbQueueActive--;
                _processThumbQueue();
            });
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// RENDER FILES VIEW
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Render the Files view
 * @async
 */
export async function renderFilesView() {
    // Load user's home path on first render (if not already set)
    if (currentFilePath === '/' && !state._fileHomeLoaded) {
        try {
            const homeRes = await authFetch(`${API_BASE}/files/user-home`);
            if (homeRes.ok) {
                const homeData = await homeRes.json();
                if (homeData.homePath && homeData.homePath !== '/') {
                    currentFilePath = homeData.homePath;
                }
                state._userFileRestrictions = homeData.hasRestrictions;
                state._userAllowedPaths     = homeData.allowedPaths || [];
            }
        } catch (e) {}
        state._fileHomeLoaded = true;
    }

    _cleanupThumbBlobs();

    const dashboardContent = document.getElementById('dashboard-content');
    if (!dashboardContent) return;
    dashboardContent.innerHTML = '';

    const layout      = document.createElement('div');
    layout.className  = 'fm-layout';

    // ── LEFT SIDEBAR: Folder Tree ──
    const sidebar     = document.createElement('div');
    sidebar.className = 'fm-sidebar';
    sidebar.innerHTML = `
        <div class="fm-sidebar-header">📂 Carpetas</div>
        <div class="fm-tree" id="fm-tree"></div>
    `;
    layout.appendChild(sidebar);

    // ── RIGHT PANEL: Main Content ──
    const main      = document.createElement('div');
    main.className  = 'fm-main';

    const toolbar   = document.createElement('div');
    toolbar.className = 'fm-main-toolbar';

    // Row 1: breadcrumb + actions
    const toolbarRow1     = document.createElement('div');
    toolbarRow1.className = 'fm-toolbar-row';

    const breadcrumb     = document.createElement('div');
    breadcrumb.className = 'fm-breadcrumb';
    breadcrumb.id        = 'fm-breadcrumb';
    updateBreadcrumb(breadcrumb, currentFilePath);

    const actions     = document.createElement('div');
    actions.className = 'fm-actions';

    const searchInput       = document.createElement('input');
    searchInput.type        = 'text';
    searchInput.placeholder = '🔍 Buscar...';
    searchInput.className   = 'fm-search-input';
    const searchKeydownHandler = (e) => { if (e.key === 'Enter') searchFiles(searchInput.value); };
    searchInput.addEventListener('keydown', searchKeydownHandler);
    _trackListener(searchInput, 'keydown', searchKeydownHandler);

    const searchInputHandler = (e) => {
        const query = e.target.value.trim().toLowerCase();
        if (!query) {
            renderFilteredFiles(fmCurrentFiles);
        } else {
            const filtered = fmCurrentFiles.filter(f => f.name.toLowerCase().includes(query));
            renderFilteredFiles(filtered, query);
        }
    };
    searchInput.addEventListener('input', searchInputHandler);
    _trackListener(searchInput, 'input', searchInputHandler);

    const uploadBtn     = document.createElement('button');
    uploadBtn.className = 'btn-primary btn-sm';
    uploadBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg> Subir';
    const uploadBtnHandler = () => triggerFileUpload();
    uploadBtn.addEventListener('click', uploadBtnHandler);
    _trackListener(uploadBtn, 'click', uploadBtnHandler);

    const newFolderBtn           = document.createElement('button');
    newFolderBtn.className       = 'btn-primary btn-sm';
    newFolderBtn.style.background = '#6366f1';
    newFolderBtn.innerHTML       = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg> Carpeta';
    const newFolderBtnHandler    = () => createNewFolder();
    newFolderBtn.addEventListener('click', newFolderBtnHandler);
    _trackListener(newFolderBtn, 'click', newFolderBtnHandler);

    const viewToggle     = document.createElement('div');
    viewToggle.className = 'fm-view-toggle';
    const listBtn        = document.createElement('button');
    listBtn.className    = 'fm-view-btn' + (fmViewMode === 'list' ? ' active' : '');
    listBtn.innerHTML    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
    listBtn.title        = 'Vista lista';
    const listBtnHandler = () => { fmViewMode = 'list'; localStorage.setItem('fm-view-mode', 'list'); renderFilesView(); };
    listBtn.addEventListener('click', listBtnHandler);
    _trackListener(listBtn, 'click', listBtnHandler);

    const gridBtn        = document.createElement('button');
    gridBtn.className    = 'fm-view-btn' + (fmViewMode === 'grid' ? ' active' : '');
    gridBtn.innerHTML    = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>';
    gridBtn.title        = 'Vista cuadrícula';
    const gridBtnHandler = () => { fmViewMode = 'grid'; localStorage.setItem('fm-view-mode', 'grid'); renderFilesView(); };
    gridBtn.addEventListener('click', gridBtnHandler);
    _trackListener(gridBtn, 'click', gridBtnHandler);

    viewToggle.appendChild(listBtn);
    viewToggle.appendChild(gridBtn);

    actions.appendChild(searchInput);
    actions.appendChild(uploadBtn);
    actions.appendChild(newFolderBtn);
    actions.appendChild(viewToggle);

    toolbarRow1.appendChild(breadcrumb);
    toolbarRow1.appendChild(actions);
    toolbar.appendChild(toolbarRow1);

    // Row 2: Bulk actions bar (hidden by default)
    const bulkBar     = document.createElement('div');
    bulkBar.className = 'fm-bulk-bar';
    bulkBar.id        = 'fm-bulk-bar';
    bulkBar.style.display = 'none';
    bulkBar.innerHTML = `
        <span class="fm-bulk-count" id="fm-bulk-count">0 seleccionados</span>
        <button class="fm-bulk-btn" data-action="bulk-download" title="Descargar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Descargar</button>
        <button class="fm-bulk-btn" data-action="bulk-copy" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg> Copiar</button>
        <button class="fm-bulk-btn" data-action="bulk-cut" title="Mover"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg> Mover</button>
        <button class="fm-bulk-btn fm-bulk-btn-danger" data-action="bulk-delete" title="Eliminar seleccionados"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg> Eliminar</button>
        <button class="fm-bulk-btn" data-action="bulk-clear" title="Deseleccionar">✕ Limpiar</button>
    `;
    const bulkBarHandler = (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        switch (btn.dataset.action) {
            case 'bulk-download': fmBulkDownload(); break;
            case 'bulk-copy':     fmBulkCopy();     break;
            case 'bulk-cut':      fmBulkCut();      break;
            case 'bulk-delete':   fmBulkDelete();   break;
            case 'bulk-clear':    fmClearSelection(); break;
        }
    };
    bulkBar.addEventListener('click', bulkBarHandler);
    _trackListener(bulkBar, 'click', bulkBarHandler);
    toolbar.appendChild(bulkBar);

    // Paste bar (when clipboard has items)
    if (fmClipboard.action && fmClipboard.files.length > 0) {
        const pasteBar     = document.createElement('div');
        pasteBar.className = 'fm-paste-bar';
        pasteBar.innerHTML = `
            <span>📋 ${fmClipboard.files.length} archivo(s) en portapapeles (${fmClipboard.action === 'copy' ? 'copiar' : 'mover'})</span>
            <button class="btn-primary btn-sm" data-action="paste">📋 Pegar aquí</button>
            <button class="fm-bulk-btn" data-action="clear-clipboard">✕ Cancelar</button>
        `;
        const pasteHandler = () => fmPaste();
        pasteBar.querySelector('[data-action="paste"]').addEventListener('click', pasteHandler);
        _trackListener(pasteBar.querySelector('[data-action="paste"]'), 'click', pasteHandler);
        const clearClipboardHandler = () => { fmClipboard.action = null; fmClipboard.files = []; renderFilesView(); };
        pasteBar.querySelector('[data-action="clear-clipboard"]').addEventListener('click', clearClipboardHandler);
        _trackListener(pasteBar.querySelector('[data-action="clear-clipboard"]'), 'click', clearClipboardHandler);
        toolbar.appendChild(pasteBar);
    }

    main.appendChild(toolbar);

    // Upload progress bar
    const uploadProgress     = document.createElement('div');
    uploadProgress.className = 'fm-upload-progress';
    uploadProgress.id        = 'fm-upload-progress';
    uploadProgress.style.display = 'none';
    uploadProgress.innerHTML = `
        <div class="fm-upload-info">
            <span id="fm-upload-filename">Subiendo...</span>
            <span id="fm-upload-percent">0%</span>
        </div>
        <div class="fm-progress-track">
            <div class="fm-progress-fill" id="fm-progress-fill" style="width: 0%"></div>
        </div>
    `;
    main.appendChild(uploadProgress);

    const content     = document.createElement('div');
    content.className = 'fm-main-content';
    content.id        = 'fm-main-content';

    const dropZone     = document.createElement('div');
    dropZone.className = 'fm-drop-zone';
    dropZone.id        = 'fm-drop-zone';
    dropZone.innerHTML = `
        <div class="fm-drop-inner">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--primary, #84cc16)" stroke-width="1.5">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p class="fm-dropzone-title">Suelta los archivos aquí</p>
            <p class="fm-dropzone-path">Se subirán a <strong>${escapeHtml(currentFilePath)}</strong></p>
        </div>
    `;
    content.appendChild(dropZone);

    if (fmViewMode === 'list') {
        const tableHeader     = document.createElement('div');
        tableHeader.className = 'fm-table-header';
        tableHeader.innerHTML = `
            <label class="fm-checkbox-wrap"><input type="checkbox" id="fm-select-all"><span class="fm-checkbox-custom"></span></label>
            <span></span>
            <span>Nombre</span>
            <span>Tamaño</span>
            <span class="fm-hide-mobile">Modificado</span>
            <span class="fm-hide-mobile">Permisos</span>
            <span></span>
        `;
        const selectAllHandler = function() { fmToggleSelectAll(this.checked); };
        tableHeader.querySelector('#fm-select-all').addEventListener('change', selectAllHandler);
        _trackListener(tableHeader.querySelector('#fm-select-all'), 'change', selectAllHandler);
        content.appendChild(tableHeader);
    }

    const filesList    = document.createElement('div');
    filesList.id       = 'files-list';
    filesList.className = fmViewMode === 'grid' ? 'fm-grid' : 'fm-list';
    content.appendChild(filesList);

    main.appendChild(content);
    layout.appendChild(main);
    dashboardContent.appendChild(layout);

    fmSetupDragDrop(layout);

    let fileInput = document.getElementById('file-upload-input');
    if (!fileInput) {
        fileInput          = document.createElement('input');
        fileInput.type     = 'file';
        fileInput.id       = 'file-upload-input';
        fileInput.multiple = true;
        fileInput.style.display = 'none';
        const fileInputHandler = (e) => handleFileUpload(e);
        fileInput.addEventListener('change', fileInputHandler);
        _trackListener(fileInput, 'change', fileInputHandler);
        document.body.appendChild(fileInput);
    }

    fmSelectedFiles.clear();

    await Promise.all([
        loadFolderTree(),
        loadFiles(currentFilePath)
    ]);
}

// ═════════════════════════════════════════════════════════════════════════════
// BREADCRUMB
// ═════════════════════════════════════════════════════════════════════════════

function updateBreadcrumb(breadcrumb, filePath) {
    breadcrumb.innerHTML = '';
    const parts = filePath.split('/').filter(Boolean);

    const homeBtn     = document.createElement('button');
    homeBtn.className = 'fm-breadcrumb-btn';
    homeBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>';
    homeBtn.title     = 'Storage';
    const homeBtnHandler = () => { currentFilePath = '/'; renderFilesView(); };
    homeBtn.addEventListener('click', homeBtnHandler);
    _trackListener(homeBtn, 'click', homeBtnHandler);
    breadcrumb.appendChild(homeBtn);

    let accPath = '';
    parts.forEach((part, i) => {
        accPath += '/' + part;
        const sep     = document.createElement('span');
        sep.className = 'fm-breadcrumb-sep';
        sep.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';
        breadcrumb.appendChild(sep);

        const btn        = document.createElement('button');
        btn.textContent  = part;
        btn.className    = 'fm-breadcrumb-btn' + (i === parts.length - 1 ? ' active' : '');
        const targetPath = accPath;
        const btnHandler = () => { currentFilePath = targetPath; renderFilesView(); };
        btn.addEventListener('click', btnHandler);
        _trackListener(btn, 'click', btnHandler);
        breadcrumb.appendChild(btn);
    });
}

// ═════════════════════════════════════════════════════════════════════════════
// LOAD FILES
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Load files from a directory
 * @async
 * @param {string} filePath - Directory path to load
 */
export async function loadFiles(filePath) {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;
    filesList.innerHTML = '<div class="fm-empty-state"><div class="fm-spinner"></div><p>Cargando archivos...</p></div>';

    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(filePath)}`);
        if (!res.ok) throw new Error('Failed to load files');
        const data  = await res.json();
        const files = data.items || data || [];

        fmCurrentFiles = files;

        if (files.length === 0) {
            filesList.innerHTML = `<div class="fm-empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" stroke-width="1" opacity="0.4">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>
                </svg>
                <p class="fm-empty-title">Carpeta vacía</p>
                <p class="fm-empty-subtitle">Arrastra archivos aquí o usa el botón Subir</p>
            </div>`;
            return;
        }

        files.sort((a, b) => {
            if (a.type === 'directory' && b.type !== 'directory') return -1;
            if (a.type !== 'directory' && b.type === 'directory') return  1;
            return a.name.localeCompare(b.name);
        });

        filesList.innerHTML = '';
        if (fmViewMode === 'grid') {
            renderFilesGrid(filesList, files, filePath);
        } else {
            renderFilesList(filesList, files, filePath);
        }
    } catch (e) {
        console.error('Load files error:', e);
        filesList.innerHTML = '<div class="fm-empty-state fm-error-state"><p>❌ Error al cargar archivos</p></div>';
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═════════════════════════════════════════════════════════════════════════════

export { handleFileUpload } from './upload.js';
export { fmPreviewFile, createNewFolder, downloadFile, deleteFile, renameFile, searchFiles } from './actions.js';

/**
 * Cleanup File Manager module — remove all event listeners
 */
export function cleanup() {
    _fileManagerListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
    });
    _resetListeners();
    _cleanupThumbBlobs();
    document.querySelectorAll('.fm-context-menu').forEach(m => m.remove());
    document.querySelectorAll('.fm-preview-overlay').forEach(m => m.remove());
}

export async function render(container) {
    await renderFilesView();
}
