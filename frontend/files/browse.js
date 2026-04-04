/**
 * File Manager — Browse / File-List Renderers
 * renderFilteredFiles, renderFilesList, renderFilesGrid
 * These functions build the DOM rows/cards for the files panel.
 */

import { authFetch } from '../api.js';
import { _trackListener } from './listeners.js';
import { escapeHtml, formatFileSize, getFileIconSVG, getFolderSVG, getLocationBadge } from './utils.js';
import { fmSelectedFiles, fmToggleSelect, showFileContextMenu, fmPreviewFile, downloadFile } from './actions.js';

const API_BASE = '/api';

// Injected by index.js — avoids circular dependency
let _getCurrentPath  = () => '/';
let _setCurrentPath  = (_p) => {};
let _getRenderView   = () => async () => {};
let _enqueueThumb    = (_thumb, _url) => {};
let _getFmViewMode   = () => 'list';

export function setBrowseDeps({ getCurrentPath, setCurrentPath, getRenderView, enqueueThumb, getFmViewMode }) {
    _getCurrentPath = getCurrentPath;
    _setCurrentPath = setCurrentPath;
    _getRenderView  = getRenderView;
    _enqueueThumb   = enqueueThumb;
    _getFmViewMode  = getFmViewMode;
}

// ─────────────────────────────────────────────────────────────────────────────

export function renderFilteredFiles(files, highlightQuery = '') {
    const filesList = document.getElementById('files-list');
    if (!filesList) return;

    if (files.length === 0) {
        filesList.innerHTML = `<div class="fm-empty-state">
            <p>🔍 Sin resultados${highlightQuery ? ' para "' + highlightQuery + '"' : ''}</p>
            <p class="fm-search-hint">Presiona Enter para buscar en subcarpetas</p>
        </div>`;
        return;
    }

    const sorted = [...files].sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return  1;
        return a.name.localeCompare(b.name);
    });

    filesList.innerHTML = '';
    if (_getFmViewMode() === 'grid') {
        renderFilesGrid(filesList, sorted, _getCurrentPath());
    } else {
        renderFilesList(filesList, sorted, _getCurrentPath());
    }
}

export function renderFilesList(container, files, filePath) {
    files.forEach(file => {
        const fullPath   = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const row        = document.createElement('div');
        row.className    = 'fm-row' + (isSelected ? ' selected' : '');
        row.dataset.path = fullPath;

        const checkbox  = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} data-path="${escapeHtml(fullPath)}"><span class="fm-checkbox-custom"></span>`;
        const checkboxHandler = function() { fmToggleSelect(this.dataset.path, this.checked); };
        checkbox.querySelector('input').addEventListener('change', checkboxHandler);
        _trackListener(checkbox.querySelector('input'), 'change', checkboxHandler);
        const checkboxClickHandler = (e) => e.stopPropagation();
        checkbox.addEventListener('click', checkboxClickHandler);
        _trackListener(checkbox, 'click', checkboxClickHandler);

        const iconWrap     = document.createElement('span');
        iconWrap.className = 'fm-file-icon';
        iconWrap.innerHTML = file.type === 'directory' ? getFolderSVG() : getFileIconSVG(file.name);

        const nameSpan     = document.createElement('span');
        nameSpan.className = 'fm-file-name';
        nameSpan.textContent = file.name;

        const badge = getLocationBadge(fullPath);
        if (badge) {
            const badgeSpan     = document.createElement('span');
            badgeSpan.innerHTML = badge;
            nameSpan.appendChild(badgeSpan.firstChild);
        }

        const sizeSpan     = document.createElement('span');
        sizeSpan.className = 'fm-file-meta';
        sizeSpan.textContent = file.type === 'directory' ? '—' : formatFileSize(file.size);

        const dateSpan     = document.createElement('span');
        dateSpan.className = 'fm-file-meta fm-hide-mobile';
        dateSpan.textContent = file.modified
            ? new Date(file.modified).toLocaleString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '—';

        const permSpan     = document.createElement('span');
        permSpan.className = 'fm-file-meta fm-hide-mobile fm-file-perm';
        permSpan.textContent = file.permissions || file.mode || '—';

        const actionsDiv     = document.createElement('div');
        actionsDiv.className = 'fm-row-actions';

        if (file.type !== 'directory') {
            const dlBtn     = document.createElement('button');
            dlBtn.className = 'fm-action-btn';
            dlBtn.title     = 'Descargar';
            dlBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            const dlBtnHandler = (e) => { e.stopPropagation(); downloadFile(fullPath); };
            dlBtn.addEventListener('click', dlBtnHandler);
            _trackListener(dlBtn, 'click', dlBtnHandler);
            actionsDiv.appendChild(dlBtn);
        }

        const menuBtn     = document.createElement('button');
        menuBtn.className = 'fm-action-btn';
        menuBtn.title     = 'Más opciones';
        menuBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
        const menuBtnHandler = (e) => { e.stopPropagation(); showFileContextMenu(e, fullPath, file); };
        menuBtn.addEventListener('click', menuBtnHandler);
        _trackListener(menuBtn, 'click', menuBtnHandler);
        actionsDiv.appendChild(menuBtn);

        row.appendChild(checkbox);
        row.appendChild(iconWrap);
        row.appendChild(nameSpan);
        row.appendChild(sizeSpan);
        row.appendChild(dateSpan);
        row.appendChild(permSpan);
        row.appendChild(actionsDiv);

        const rowClickHandler = () => {
            if (file.type === 'directory') {
                _setCurrentPath(fullPath);
                _getRenderView()();
            } else {
                fmPreviewFile(file, filePath);
            }
        };
        row.addEventListener('click', rowClickHandler);
        _trackListener(row, 'click', rowClickHandler);

        const rowContextMenuHandler = (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        };
        row.addEventListener('contextmenu', rowContextMenuHandler);
        _trackListener(row, 'contextmenu', rowContextMenuHandler);

        row.draggable = true;
        const dragstartHandler = (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            row.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        };
        row.addEventListener('dragstart', dragstartHandler);
        _trackListener(row, 'dragstart', dragstartHandler);

        const dragendHandler = () => {
            row.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        };
        row.addEventListener('dragend', dragendHandler);
        _trackListener(row, 'dragend', dragendHandler);

        container.appendChild(row);
    });

    if (filePath.startsWith('/mnt/storage') || filePath === '/') {
        const filePaths = files.filter(f => f.type !== 'directory').map(f => filePath + '/' + f.name);
        if (filePaths.length > 0) {
            authFetch(`${API_BASE}/storage/file-locations`, {
                method: 'POST',
                body: JSON.stringify({ paths: filePaths })
            }).then(r => r.json()).then(data => {
                if (!data.locations) return;
                container.querySelectorAll('.fm-row').forEach(row => {
                    const loc = data.locations[row.dataset.path];
                    if (loc) {
                        const badge       = document.createElement('span');
                        badge.className   = 'fm-location-badge fm-location-' + loc.diskType;
                        badge.title       = loc.physicalLocation || '';
                        badge.textContent = loc.diskType === 'cache' ? '⚡' : '💿';
                        const nameEl = row.querySelector('.fm-file-name');
                        if (nameEl) nameEl.appendChild(badge);
                    }
                });
            }).catch(() => {});
        }
    }
}

export function renderFilesGrid(container, files, filePath) {
    files.forEach(file => {
        const fullPath   = filePath + '/' + file.name;
        const isSelected = fmSelectedFiles.has(fullPath);
        const card       = document.createElement('div');
        card.className   = 'fm-grid-item' + (isSelected ? ' selected' : '');
        card.dataset.path = fullPath;

        const checkbox  = document.createElement('label');
        checkbox.className = 'fm-checkbox-wrap fm-grid-checkbox';
        checkbox.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} data-path="${escapeHtml(fullPath)}"><span class="fm-checkbox-custom"></span>`;
        const checkboxHandler = function() { fmToggleSelect(this.dataset.path, this.checked); };
        checkbox.querySelector('input').addEventListener('change', checkboxHandler);
        _trackListener(checkbox.querySelector('input'), 'change', checkboxHandler);
        const checkboxClickHandler = (e) => e.stopPropagation();
        checkbox.addEventListener('click', checkboxClickHandler);
        _trackListener(checkbox, 'click', checkboxClickHandler);

        const iconArea     = document.createElement('div');
        iconArea.className = 'fm-grid-icon';

        const ext     = file.name.split('.').pop().toLowerCase();
        const imgExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
        if (file.type !== 'directory' && imgExts.includes(ext)) {
            const thumb     = document.createElement('img');
            thumb.className = 'fm-grid-thumb';
            thumb.alt       = file.name;
            thumb.loading   = 'lazy';
            iconArea.appendChild(thumb);
            _enqueueThumb(thumb, `${API_BASE}/files/download?path=${encodeURIComponent(fullPath)}`);
        } else {
            iconArea.innerHTML = file.type === 'directory' ? getFolderSVG(48) : getFileIconSVG(file.name, 48);
        }

        const nameLabel     = document.createElement('div');
        nameLabel.className = 'fm-grid-name';
        nameLabel.textContent = file.name;
        nameLabel.title     = file.name;

        const metaLabel     = document.createElement('div');
        metaLabel.className = 'fm-grid-meta';
        metaLabel.textContent = file.type === 'directory' ? 'Carpeta' : formatFileSize(file.size);

        card.appendChild(checkbox);
        card.appendChild(iconArea);
        card.appendChild(nameLabel);
        card.appendChild(metaLabel);

        const cardClickHandler = () => {
            if (file.type === 'directory') {
                _setCurrentPath(fullPath);
                _getRenderView()();
            } else {
                fmPreviewFile(file, filePath);
            }
        };
        card.addEventListener('click', cardClickHandler);
        _trackListener(card, 'click', cardClickHandler);

        const cardContextMenuHandler = (e) => {
            e.preventDefault();
            showFileContextMenu(e, fullPath, file);
        };
        card.addEventListener('contextmenu', cardContextMenuHandler);
        _trackListener(card, 'contextmenu', cardContextMenuHandler);

        card.draggable = true;
        const dragstartHandler = (e) => {
            e.dataTransfer.setData('text/plain', JSON.stringify({ path: fullPath, name: file.name }));
            e.dataTransfer.effectAllowed = 'move';
            card.classList.add('dragging');
            document.body.classList.add('fm-dragging');
        };
        card.addEventListener('dragstart', dragstartHandler);
        _trackListener(card, 'dragstart', dragstartHandler);

        const dragendHandler = () => {
            card.classList.remove('dragging');
            document.body.classList.remove('fm-dragging');
        };
        card.addEventListener('dragend', dragendHandler);
        _trackListener(card, 'dragend', dragendHandler);

        container.appendChild(card);
    });
}
