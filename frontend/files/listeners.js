/**
 * File Manager — Shared event-listener registry
 * Centralises _trackListener so all sub-modules record their listeners
 * in the same array, which index.js drains during cleanup().
 */

export let _fileManagerListeners = [];

export function _trackListener(element, event, handler) {
    _fileManagerListeners.push({ element, event, handler });
}

export function _resetListeners() {
    _fileManagerListeners = [];
}
