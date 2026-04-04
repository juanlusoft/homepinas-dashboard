/**
 * File Manager — Folder Tree (left sidebar)
 * loadFolderTree, buildFolderTree, renderFolderTree
 */

import { authFetch } from '../api.js';
import { showNotification } from '../notifications.js';
import { _trackListener } from './listeners.js';

const API_BASE = '/api';

// Injected by index.js
let _getCurrentPath    = () => '/';
let _setCurrentPath    = (_p) => {};
let _getRenderView     = () => async () => {};
let _getExpandedFolders = () => new Set(['/']);
let _addExpanded       = (_p) => {};
let _deleteExpanded    = (_p) => {};

export function setTreeDeps({ getCurrentPath, setCurrentPath, getRenderView, getExpandedFolders, addExpanded, deleteExpanded }) {
    _getCurrentPath     = getCurrentPath;
    _setCurrentPath     = setCurrentPath;
    _getRenderView      = getRenderView;
    _getExpandedFolders = getExpandedFolders;
    _addExpanded        = addExpanded;
    _deleteExpanded     = deleteExpanded;
}

export async function loadFolderTree() {
    const treeContainer = document.getElementById('fm-tree');
    if (!treeContainer) return;
    treeContainer.innerHTML = '<div class="fm-tree-loading">Cargando...</div>';
    try {
        const tree = await buildFolderTree('/');
        treeContainer.innerHTML = '';
        renderFolderTree(treeContainer, tree, 0);
    } catch (e) {
        console.error('loadFolderTree error:', e);
        treeContainer.innerHTML = '<div class="fm-tree-error">Error al cargar</div>';
    }
}

export async function buildFolderTree(path) {
    try {
        const res = await authFetch(`${API_BASE}/files/list?path=${encodeURIComponent(path)}`);
        if (!res.ok) return { name: path.split('/').pop() || 'Storage', path, children: [] };
        const data    = await res.json();
        const items   = data.items || data.files || [];
        const folders = items
            .filter(f => f.type === 'directory' || f.isDirectory)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(f => ({
                name:     f.name,
                path:     path === '/' ? '/' + f.name : path + '/' + f.name,
                children: null
            }));
        return { name: path === '/' ? 'Storage' : path.split('/').pop(), path, children: folders };
    } catch (e) {
        return { name: path.split('/').pop() || 'Storage', path, children: [] };
    }
}

export function renderFolderTree(container, node, level) {
    const item      = document.createElement('div');
    item.className  = 'fm-tree-item' + (_getCurrentPath() === node.path ? ' active' : '');
    item.style.paddingLeft = (12 + level * 16) + 'px';

    const expandedFolders = _getExpandedFolders();
    const hasChildren = node.children === null || (node.children && node.children.length > 0);
    const isExpanded  = expandedFolders.has(node.path);

    const expandBtn     = document.createElement('span');
    expandBtn.className = 'fm-tree-expand' + (isExpanded ? ' expanded' : '');
    expandBtn.innerHTML = hasChildren ? '▶' : '';
    expandBtn.style.visibility = hasChildren ? 'visible' : 'hidden';

    const icon       = document.createElement('span');
    icon.className   = 'fm-tree-icon';
    icon.textContent = isExpanded && hasChildren ? '📂' : '📁';

    const name       = document.createElement('span');
    name.textContent = node.name;
    name.style.overflow     = 'hidden';
    name.style.textOverflow = 'ellipsis';

    item.appendChild(expandBtn);
    item.appendChild(icon);
    item.appendChild(name);

    const itemClickHandler = async (e) => {
        if (e.target === expandBtn || e.target.closest('.fm-tree-expand')) {
            e.stopPropagation();
            if (isExpanded) {
                _deleteExpanded(node.path);
            } else {
                _addExpanded(node.path);
                if (node.children === null) {
                    const childData = await buildFolderTree(node.path);
                    node.children   = childData.children || [];
                }
            }
            await loadFolderTree();
        } else {
            _setCurrentPath(node.path);
            _addExpanded(node.path);
            if (node.children === null) {
                const childData = await buildFolderTree(node.path);
                node.children   = childData.children || [];
            }
            await _getRenderView()();
        }
    };
    item.addEventListener('click', itemClickHandler);
    _trackListener(item, 'click', itemClickHandler);

    const dragoverHandler = (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        item.classList.add('drop-target');
    };
    item.addEventListener('dragover', dragoverHandler);
    _trackListener(item, 'dragover', dragoverHandler);

    const dragleaveHandler = () => { item.classList.remove('drop-target'); };
    item.addEventListener('dragleave', dragleaveHandler);
    _trackListener(item, 'dragleave', dragleaveHandler);

    const dropHandler = async (e) => {
        e.preventDefault();
        item.classList.remove('drop-target');
        try {
            const data = JSON.parse(e.dataTransfer.getData('text/plain'));
            if (data.path && data.name) {
                const srcFolder = data.path.substring(0, data.path.lastIndexOf('/')) || '/';
                if (srcFolder === node.path) return;
                const destPath = node.path === '/' ? '/' + data.name : node.path + '/' + data.name;
                const res = await authFetch(`${API_BASE}/files/move`, {
                    method: 'POST',
                    body: JSON.stringify({ source: data.path, destination: destPath })
                });
                if (res.ok) {
                    showNotification(`"${data.name}" movido a ${node.path}`, 'success');
                    await _getRenderView()();
                } else {
                    const err = await res.json().catch(() => ({}));
                    showNotification(err.error || 'No se pudo mover', 'error');
                }
            }
        } catch (e) {
            console.error('Drop error:', e);
        }
    };
    item.addEventListener('drop', dropHandler);
    _trackListener(item, 'drop', dropHandler);

    container.appendChild(item);

    if (hasChildren && isExpanded && Array.isArray(node.children) && node.children.length > 0) {
        const childrenContainer     = document.createElement('div');
        childrenContainer.className = 'fm-tree-children';
        node.children.forEach(child => {
            renderFolderTree(childrenContainer, child, level + 1);
        });
        container.appendChild(childrenContainer);
    }
}
