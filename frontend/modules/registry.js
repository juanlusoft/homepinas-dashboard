// ─── CSS injection ────────────────────────────────────────────────────────────

const _injectedCSS = new Set();

function _injectCSS(href) {
  if (_injectedCSS.has(href)) return;
  const link = document.createElement('link');
  link.rel  = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  _injectedCSS.add(href);
}

// ─── Error UI ─────────────────────────────────────────────────────────────────

function _showError(container, err) {
  container.innerHTML = `
    <div class="module-error">
      <h2>Error loading module</h2>
      <pre>${err && err.message ? err.message : String(err)}</pre>
    </div>
  `;
}

// ─── Paid overlay ─────────────────────────────────────────────────────────────

function _showPaidOverlay(container) {
  container.innerHTML = `
    <div class="module-paid-overlay">
      <h2>Requiere licencia</h2>
      <p>Este módulo está disponible en la versión de pago.</p>
    </div>
  `;
}

// ─── Module registry ──────────────────────────────────────────────────────────
// IMPORTANT: Each module's `route` property must also appear in
// backend/spa-routes.js so the Express server serves index.html for that path.
// When adding a new module here, add its route there too.

export const modules = [
  { id: 'dashboard',        route: '/dashboard',        paid: false, css: '/frontend/dashboard/style.css',        load: () => import('../dashboard/index.js') },
  { id: 'docker',           route: '/docker',           paid: false, css: '/frontend/docker/style.css',           load: () => import('../docker/index.js') },
  { id: 'storage',          route: '/storage',          paid: false, css: '/frontend/storage/style.css',          load: () => import('../storage/wizard.js') },
  { id: 'files',            route: '/files',            paid: false, css: '/frontend/files/style.css',            load: () => import('../files/index.js') },
  { id: 'network',          route: '/network',          paid: false, css: '/frontend/network/style.css',          load: () => import('../network/index.js') },
  { id: 'system',           route: '/system',           paid: false, css: '/frontend/system/style.css',           load: () => import('../system/index.js') },
  { id: 'terminal',         route: '/terminal',         paid: false, css: '/frontend/terminal/style.css',         load: () => import('../terminal/index.js') },
  { id: 'backup',           route: '/backup',           paid: false, css: '/frontend/backup/style.css',           load: () => import('../backup/index.js') },
  { id: 'logs',             route: '/logs',             paid: false, css: '/frontend/logs/style.css',             load: () => import('../logs/index.js') },
  { id: 'users',            route: '/users',            paid: false, css: '/frontend/users/style.css',            load: () => import('../users/index.js') },
  { id: 'shortcuts',        route: '/shortcuts',        paid: false, css: '/frontend/shortcuts/style.css',        load: () => import('../shortcuts/index.js') },
  { id: 'cloud-sync',       route: '/cloud-sync',       paid: false, css: '/frontend/cloud-sync/style.css',       load: () => import('../cloud-sync/index.js') },
  { id: 'cloud-backup',     route: '/cloud-backup',     paid: false, css: '/frontend/cloud-backup/style.css',     load: () => import('../cloud-backup/index.js') },
  { id: 'homestore',        route: '/homestore',        paid: false, css: '/frontend/homestore/style.css',        load: () => import('../homestore/index.js') },
  { id: 'vpn',              route: '/vpn',              paid: false, css: '/frontend/vpn/style.css',              load: () => import('../vpn/index.js') },
  { id: 'active-backup',    route: '/active-backup',    paid: true,  css: '/frontend/active-backup/style.css',    load: () => import('../active-backup/index.js') },
  { id: 'active-directory', route: '/active-directory', paid: true,  css: '/frontend/active-directory/style.css', load: () => import('../active-directory/index.js') },
];

// ─── Lifecycle ────────────────────────────────────────────────────────────────

let _currentCleanup = null;

export async function loadModule(id, container) {
  // Run and clear previous cleanup
  if (_currentCleanup) {
    try {
      await _currentCleanup();
    } catch (e) {
      console.warn('[registry] cleanup error:', e);
    }
    _currentCleanup = null;
  }

  container.innerHTML = '';

  const mod = modules.find(m => m.id === id);
  if (!mod) {
    _showError(container, new Error(`Module not found: "${id}"`));
    return;
  }

  if (mod.paid === true) {
    _showPaidOverlay(container);
    return;
  }

  _injectCSS(mod.css);

  try {
    const { render, cleanup } = await mod.load();
    _currentCleanup = cleanup || null;
    await render(container);
  } catch (err) {
    console.error(`[registry] Failed to load module "${id}":`, err);
    _showError(container, err);
  }
}
