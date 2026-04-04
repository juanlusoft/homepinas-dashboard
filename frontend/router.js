/**
 * Router Module
 * Handles URL routing, view navigation, and history management
 * @module router
 */

// State references - will be injected by main.js
let stateRef = { isAuthenticated: false, currentView: 'loading' };
let viewsMapRef = {};
let viewsRef = {};
let navLinksRef = [];
let viewTitleRef = null;

/**
 * Initialize router with state references
 * @param {Object} state - Global application state
 * @param {Object} viewsMap - Map of view names to titles
 * @param {Object} views - DOM elements of each view
 * @param {NodeList} navLinks - Navigation link elements
 * @param {HTMLElement} viewTitle - View title element
 */
export function initRouter(state, viewsMap, views, navLinks, viewTitle) {
    stateRef = state;
    viewsMapRef = viewsMap;
    viewsRef = views;
    navLinksRef = navLinks;
    viewTitleRef = viewTitle;
}

/**
 * Navigate to a URL path and update browser history
 * @param {string} path - URL path to navigate to
 * @param {boolean} replace - Use history.replaceState instead of pushState (default: false)
 */
export function navigateTo(path, replace = false) {
    if (replace) {
        history.replaceState({ path }, '', path);
    } else {
        history.pushState({ path }, '', path);
    }
}

/**
 * Get view name from URL path
 * @param {string} path - URL pathname
 * @returns {string} - View name (e.g., 'dashboard', 'storage', etc.)
 */
export function getViewFromPath(path) {
    const cleanPath = path.replace(/^\//, '').split('?')[0];
    if (!cleanPath || cleanPath === 'home' || cleanPath === 'dashboard') return 'dashboard';
    if (viewsMapRef && viewsMapRef[cleanPath]) return cleanPath;
    return 'dashboard';
}

/**
 * Handle route change from URL
 * Called when URL changes via back/forward buttons
 */
export function handleRouteChange() {
    if (!stateRef.isAuthenticated) return;

    const path = window.location.pathname;
    const view = getViewFromPath(path);

    // Update sidebar active state
    navLinksRef.forEach(link => {
        link.classList.toggle('active', link.dataset.view === view);
    });

    // Update title and render
    if (viewTitleRef) viewTitleRef.textContent = viewsMapRef[view] || 'HomePiNAS';
    renderContent(view);
    if (window.updateHeaderIPVisibility) {
        window.updateHeaderIPVisibility();
    }
}

/**
 * Switch to a different view and update UI
 * @param {string} viewName - Name of the view to switch to
 * @param {boolean} skipRender - If true, caller will handle rendering separately
 */
export function switchView(viewName, skipRender = false) {
    Object.values(viewsRef || {}).forEach(v => v?.classList?.remove('active'));
    if (viewsRef[viewName]) {
        viewsRef[viewName].classList.add('active');
        stateRef.currentView = viewName;
    }

    if (!skipRender) {
        renderContent(viewName);
    }
}

/**
 * Render content for the given view
 * Delegates actual rendering to the imported view modules
 * @private
 */
function renderContent(viewName) {
    if (window.renderContent) {
        window.renderContent(viewName);
    }
}

/**
 * Setup route event listeners
 */
export function setupRouteListeners() {
    // Listen for browser back/forward
    window.addEventListener('popstate', () => {
        if (stateRef.isAuthenticated) {
            handleRouteChange();
        }
    });
}

/**
 * Cleanup router (remove event listeners)
 */
export function cleanupRouter() {
    window.removeEventListener('popstate', handleRouteChange);
}
