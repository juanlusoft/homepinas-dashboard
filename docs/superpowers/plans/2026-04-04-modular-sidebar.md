# Modular Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir cada ítem del sidebar en un módulo completamente independiente con lazy loading, CSS propio, error boundary y soporte de pago.

**Architecture:** Un `registry.js` central declara todos los módulos con dynamic import. Cada módulo exporta `render(container)` y `cleanup()`. El CSS de cada módulo se inyecta on-demand. `main.js` deja de importar módulos directamente.

**Tech Stack:** Vanilla JS ES Modules, dynamic import(), CSS link injection

---

## Mapa de archivos

| Archivo | Acción | Descripción |
|---------|--------|-------------|
| `frontend/modules/registry.js` | Crear | Registry central + loadModule + error boundary |
| `frontend/style-base.css` | Crear | Extrae estilos compartidos de style.css |
| `frontend/main.js` | Modificar | Reemplaza imports estáticos + renderContent por loadModule |
| `frontend/dashboard/style.css` | Crear | CSS stub vacío |
| `frontend/docker/style.css` | Crear | CSS stub vacío |
| `frontend/storage/style.css` | Crear | CSS stub vacío |
| `frontend/files/style.css` | Crear | CSS stub vacío |
| `frontend/network/style.css` | Crear | CSS stub vacío |
| `frontend/system/style.css` | Crear | CSS stub vacío |
| `frontend/terminal/style.css` | Crear | CSS stub vacío |
| `frontend/backup/style.css` | Crear | CSS stub vacío |
| `frontend/users/style.css` | Crear | CSS stub vacío |
| `frontend/vpn/style.css` | Crear | CSS stub vacío |
| `frontend/cloud-sync/style.css` | Crear | CSS stub vacío |
| `frontend/cloud-backup/style.css` | Crear | CSS stub vacío |
| `frontend/homestore/style.css` | Crear | CSS stub vacío |
| `frontend/active-directory/style.css` | Crear | CSS stub vacío |
| `frontend/active-backup/` | Crear | Nuevo módulo (wrapper + paid overlay) |
| `frontend/logs/` | Crear | Stub módulo faltante |
| `frontend/shortcuts/` | Crear | Stub módulo faltante |
| `frontend/dashboard/index.js` | Modificar | Añadir export render() |
| `frontend/network/index.js` | Modificar | Añadir export render() |
| `frontend/system/index.js` | Modificar | Añadir export render() |
| `frontend/terminal/index.js` | Modificar | Añadir export render() |
| `frontend/vpn/index.js` | Modificar | Añadir export render() |
| `frontend/backup/index.js` | Modificar | Añadir export render() |
| `frontend/users/index.js` | Modificar | Añadir export render() |
| `frontend/cloud-sync/index.js` | Modificar | Añadir export render() |
| `frontend/cloud-backup/index.js` | Modificar | Añadir export render() |
| `frontend/homestore/index.js` | Modificar | Añadir export render() |
| `frontend/active-directory/index.js` | Modificar | Añadir export render() |
| `frontend/files/index.js` | Modificar | Añadir export render() |
| `frontend/docker/index.js` | Modificar | Añadir export render() |
| `frontend/storage/wizard.js` | Modificar | Añadir export render() |

---

## Task 1: Crear registry.js

**Files:**
- Create: `frontend/modules/registry.js`

- [ ] **Step 1: Crear el archivo**

```javascript
// frontend/modules/registry.js

const _loadedCSS = new Set();

function _injectCSS(href) {
  if (_loadedCSS.has(href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
  _loadedCSS.add(href);
}

function _showError(container, err) {
  container.innerHTML = `
    <div class="module-error" style="padding:2rem;text-align:center">
      <h3>Error cargando módulo</h3>
      <pre style="text-align:left;background:#1a1a2e;padding:1rem;border-radius:8px;overflow:auto">${err?.message ?? String(err)}</pre>
    </div>`;
}

function _showPaidOverlay(container) {
  container.innerHTML = `
    <div class="paid-overlay" style="padding:4rem;text-align:center">
      <div style="font-size:3rem;margin-bottom:1rem">🔒</div>
      <h2>Requiere licencia</h2>
      <p>Activa tu licencia HomePiNAS para acceder a este módulo.</p>
    </div>`;
}

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

let _currentCleanup = null;

export async function loadModule(id, container) {
  if (_currentCleanup) {
    try { _currentCleanup(); } catch (_) {}
    _currentCleanup = null;
  }

  container.innerHTML = '';

  const mod = modules.find(m => m.id === id);
  if (!mod) return _showError(container, `Módulo desconocido: ${id}`);
  if (mod.paid) return _showPaidOverlay(container);

  _injectCSS(mod.css);

  try {
    const { render, cleanup } = await mod.load();
    _currentCleanup = cleanup ?? null;
    await render(container);
  } catch (err) {
    console.error(`[registry] Error en módulo "${id}":`, err);
    _showError(container, err);
  }
}
```

- [ ] **Step 2: Verificar que el archivo existe**

```bash
ls frontend/modules/registry.js
```
Expected: archivo existe

- [ ] **Step 3: Commit**

```bash
git add frontend/modules/registry.js
git commit -m "feat: add module registry with lazy loading and error boundary"
```

---

## Task 2: Crear CSS stubs para todos los módulos

**Files:**
- Create: `frontend/dashboard/style.css`, `frontend/docker/style.css`, `frontend/storage/style.css`, `frontend/files/style.css`, `frontend/network/style.css`, `frontend/system/style.css`, `frontend/terminal/style.css`, `frontend/backup/style.css`, `frontend/users/style.css`, `frontend/vpn/style.css`, `frontend/cloud-sync/style.css`, `frontend/cloud-backup/style.css`, `frontend/homestore/style.css`, `frontend/active-directory/style.css`, `frontend/active-backup/style.css`, `frontend/logs/style.css`, `frontend/shortcuts/style.css`

- [ ] **Step 1: Crear todos los stubs de una vez**

```bash
for dir in dashboard docker storage files network system terminal backup users vpn cloud-sync cloud-backup homestore active-directory active-backup logs shortcuts; do
  touch frontend/$dir/style.css
done
```

- [ ] **Step 2: Verificar**

```bash
ls frontend/*/style.css
```
Expected: 17 archivos listados

- [ ] **Step 3: Commit**

```bash
git add frontend/*/style.css
git commit -m "feat: add per-module CSS stubs"
```

---

## Task 3: Crear módulos faltantes (logs, shortcuts, active-backup)

**Files:**
- Create: `frontend/logs/index.js`
- Create: `frontend/shortcuts/index.js`
- Create: `frontend/active-backup/index.js`

- [ ] **Step 1: Crear `frontend/logs/index.js`**

```javascript
// frontend/logs/index.js
// TODO: implementar vista de logs del sistema

export async function render(container) {
  container.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center">
      <h2>Logs del sistema</h2>
      <p>Módulo en desarrollo.</p>
    </div>`;
}

export function cleanup() {}
```

- [ ] **Step 2: Crear `frontend/shortcuts/index.js`**

```javascript
// frontend/shortcuts/index.js
// TODO: implementar vista de accesos directos

export async function render(container) {
  container.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center">
      <h2>Accesos directos</h2>
      <p>Módulo en desarrollo.</p>
    </div>`;
}

export function cleanup() {}
```

- [ ] **Step 3: Crear `frontend/active-backup/index.js`**

```javascript
// frontend/active-backup/index.js
// Módulo de pago — el registry muestra el overlay automáticamente.
// Este archivo solo existe para satisfacer el dynamic import si se necesita.

export async function render(container) {
  container.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center">
      <h2>Active Backup</h2>
      <p>Requiere licencia HomePiNAS.</p>
    </div>`;
}

export function cleanup() {}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/logs/index.js frontend/shortcuts/index.js frontend/active-backup/index.js
git commit -m "feat: add stub modules for logs, shortcuts, active-backup"
```

---

## Task 4: Migrar módulo dashboard

**Files:**
- Modify: `frontend/dashboard/index.js`

- [ ] **Step 1: Añadir export `render` al final del archivo**

Abrir `frontend/dashboard/index.js` y añadir antes de `export { renderDashboard }`:

```javascript
export async function render(container) {
  await renderDashboard();
}
```

El archivo debe quedar con ambos exports al final:
```javascript
export async function render(container) {
  await renderDashboard();
}

export { renderDashboard };
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/dashboard`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/dashboard/index.js
git commit -m "feat(dashboard): add render(container) export for registry"
```

---

## Task 5: Migrar módulo network

**Files:**
- Modify: `frontend/network/index.js`

- [ ] **Step 1: Añadir export `render` al final del archivo**

Añadir antes de las líneas de export actuales:

```javascript
export async function render(container) {
  await renderNetworkManager();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/network`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/network/index.js
git commit -m "feat(network): add render(container) export for registry"
```

---

## Task 6: Migrar módulo system

**Files:**
- Modify: `frontend/system/index.js`

- [ ] **Step 1: Añadir export `render` al final**

Añadir antes de `export { renderSystemView }`:

```javascript
export async function render(container) {
  await renderSystemView();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/system`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/system/index.js
git commit -m "feat(system): add render(container) export for registry"
```

---

## Task 7: Migrar módulo terminal

**Files:**
- Modify: `frontend/terminal/index.js`

- [ ] **Step 1: Añadir export `render` al final**

`renderTerminalView` ya acepta container. Añadir:

```javascript
export async function render(container) {
  await renderTerminalView(container);
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/terminal`. El terminal debe abrir sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/terminal/index.js
git commit -m "feat(terminal): add render(container) export for registry"
```

---

## Task 8: Migrar módulo vpn

**Files:**
- Modify: `frontend/vpn/index.js`

- [ ] **Step 1: Añadir export `render` al final**

Añadir antes de `export { renderVPNView }`:

```javascript
export async function render(container) {
  await renderVPNView();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/vpn`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/vpn/index.js
git commit -m "feat(vpn): add render(container) export for registry"
```

---

## Task 9: Migrar módulo backup

**Files:**
- Modify: `frontend/backup/index.js`

- [ ] **Step 1: Añadir export `render` al final**

El módulo backup tiene dos funciones: `renderBackupView` (ruta `/backup`) y `renderActiveBackupView` (ruta `/active-backup`, ahora módulo de pago).

Añadir antes de `export { renderBackupView, renderActiveBackupView }`:

```javascript
export async function render(container) {
  await renderBackupView();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/backup`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/backup/index.js
git commit -m "feat(backup): add render(container) export for registry"
```

---

## Task 10: Migrar módulo users

**Files:**
- Modify: `frontend/users/index.js`

- [ ] **Step 1: Añadir export `render` al final**

Añadir antes de `export { renderUsersView }`:

```javascript
export async function render(container) {
  await renderUsersView();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/users`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/users/index.js
git commit -m "feat(users): add render(container) export for registry"
```

---

## Task 11: Migrar módulo cloud-sync

**Files:**
- Modify: `frontend/cloud-sync/index.js`

- [ ] **Step 1: Añadir export `render` al final**

Añadir antes de `export { renderCloudSyncView }`:

```javascript
export async function render(container) {
  await renderCloudSyncView();
}
```

- [ ] **Step 2: Verificar en browser**

Navegar a `/cloud-sync`. La vista debe cargar sin errores.

- [ ] **Step 3: Commit**

```bash
git add frontend/cloud-sync/index.js
git commit -m "feat(cloud-sync): add render(container) export for registry"
```

---

## Task 12: Migrar módulo cloud-backup

**Files:**
- Modify: `frontend/cloud-backup/index.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export" frontend/cloud-backup/index.js
```

- [ ] **Step 2: Añadir export `render` usando el nombre encontrado**

Si la función se llama `renderCloudBackupView`:
```javascript
export async function render(container) {
  await renderCloudBackupView();
}
```

- [ ] **Step 3: Verificar en browser**

Navegar a `/cloud-backup`. La vista debe cargar sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/cloud-backup/index.js
git commit -m "feat(cloud-backup): add render(container) export for registry"
```

---

## Task 13: Migrar módulo homestore

**Files:**
- Modify: `frontend/homestore/index.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export" frontend/homestore/index.js
```

- [ ] **Step 2: Añadir export `render` usando el nombre encontrado**

Si la función se llama `renderHomeStoreView`:
```javascript
export async function render(container) {
  await renderHomeStoreView();
}
```

- [ ] **Step 3: Verificar en browser**

Navegar a `/homestore`. La vista debe cargar sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/homestore/index.js
git commit -m "feat(homestore): add render(container) export for registry"
```

---

## Task 14: Migrar módulo active-directory (pago)

**Files:**
- Modify: `frontend/active-directory/index.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export" frontend/active-directory/index.js
```

- [ ] **Step 2: Añadir export `render`**

Si la función se llama `renderActiveDirectoryView`:
```javascript
export async function render(container) {
  await renderActiveDirectoryView();
}
```

Nota: el registry mostrará el paid overlay antes de llamar a `render()` porque `paid: true`. Este archivo existe por completitud.

- [ ] **Step 3: Commit**

```bash
git add frontend/active-directory/index.js
git commit -m "feat(active-directory): add render(container) export for registry"
```

---

## Task 15: Migrar módulo files (grande)

**Files:**
- Modify: `frontend/files/index.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export\|^async function render\|^export async" frontend/files/index.js | head -10
```

- [ ] **Step 2: Añadir export `render` al final**

```javascript
export async function render(container) {
  await renderFilesView();
}
```

- [ ] **Step 3: Verificar en browser**

Navegar a `/files`. El explorador de archivos debe cargar sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/files/index.js
git commit -m "feat(files): add render(container) export for registry"
```

---

## Task 16: Migrar módulo docker (grande)

**Files:**
- Modify: `frontend/docker/index.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export\|^export async" frontend/docker/index.js | head -10
```

- [ ] **Step 2: Añadir export `render` al final**

Antes de `export { renderDockerManager }`:

```javascript
export async function render(container) {
  await renderDockerManager();
}
```

- [ ] **Step 3: Verificar en browser**

Navegar a `/docker`. La vista de Docker debe cargar sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/docker/index.js
git commit -m "feat(docker): add render(container) export for registry"
```

---

## Task 17: Migrar módulo storage/wizard (más grande)

**Files:**
- Modify: `frontend/storage/wizard.js`

- [ ] **Step 1: Buscar nombre de la función principal**

```bash
grep "^export\|^export async" frontend/storage/wizard.js | head -10
```

- [ ] **Step 2: Añadir export `render` al final**

Antes del export actual de `renderStorageDashboard`:

```javascript
export async function render(container) {
  await renderStorageDashboard();
}
```

- [ ] **Step 3: Verificar en browser**

Navegar a `/storage`. La vista de almacenamiento debe cargar sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/storage/wizard.js
git commit -m "feat(storage): add render(container) export for registry"
```

---

## Task 18: Actualizar main.js para usar el registry

> Este task se ejecuta DESPUÉS de que todos los módulos tienen `render()` exportado (Tasks 4-17).

**Files:**
- Modify: `frontend/main.js`

- [ ] **Step 1: Verificar que todos los módulos tienen `render` export**

```bash
for dir in dashboard network system terminal vpn backup users cloud-sync cloud-backup homestore active-directory files docker; do
  echo -n "$dir: " && grep "export async function render\|export function render" frontend/$dir/index.js | head -1
done
echo -n "storage: " && grep "export async function render\|export function render" frontend/storage/wizard.js | head -1
```

Expected: cada módulo muestra su línea de `export`.

- [ ] **Step 2: Reemplazar imports de módulos y renderContent en main.js**

Eliminar las líneas 14-30 (todos los imports de feature modules):
```javascript
// ELIMINAR estas líneas:
import { renderTerminalView, cleanup as cleanupTerminal } from './modules/terminal/index.js';
import { renderFilesView, cleanup as cleanupFiles } from './modules/files/index.js';
import { renderDockerManager, cleanup as cleanupDocker } from './modules/docker/index.js';
import { renderStorageDashboard, cleanup as cleanupWizard } from './modules/storage/wizard.js';
import { renderVPNView, cleanup as cleanupVPN } from './modules/vpn/index.js';
import { renderSystemView, cleanup as cleanupSystem } from './modules/system/index.js';
import { renderNetworkManager, cleanup as cleanupNetwork } from './modules/network/index.js';
import { renderBackupView, renderActiveBackupView, cleanup as cleanupBackup } from './modules/backup/index.js';
import { renderActiveDirectoryView, cleanup as cleanupAD } from './modules/active-directory/index.js';
import { renderCloudSyncView, cleanup as cleanupCloudSync } from './modules/cloud-sync/index.js';
import { renderCloudBackupView, cleanup as cleanupCloudBackup } from './modules/cloud-backup/index.js';
import { renderHomeStoreView, cleanup as cleanupHomeStore } from './modules/homestore/index.js';
import { renderLogsView, cleanup as cleanupLogs } from './modules/logs/index.js';
import { renderUsersView, cleanup as cleanupUsers } from './modules/users/index.js';
import { renderDashboard, cleanup as cleanupDashboard } from './modules/dashboard/index.js';
import { renderUPSSection, cleanup as cleanupUPS } from './modules/ups/index.js';
```

Añadir en su lugar (después de los imports de core modules):
```javascript
import { loadModule } from './modules/registry.js';
```

- [ ] **Step 3: Reemplazar la función switchView**

Reemplazar `switchView` completa (líneas 59-88) con:

```javascript
function switchView(viewName, skipRender = false) {
  const previousView = state.currentView;

  cleanupNotifications();

  Object.values(views).forEach(v => v?.classList.remove('active'));
  if (views[viewName]) {
    views[viewName].classList.add('active');
    if (!skipRender && viewName !== 'setup' && viewName !== 'login') {
      renderContent(viewName);
    }
  }
}
```

- [ ] **Step 4: Reemplazar la función renderContent**

Reemplazar `renderContent` completa (líneas 94-114) con:

```javascript
async function renderContent(view) {
  state.currentView = view;
  await loadModule(view, dashboardContent);
}
```

- [ ] **Step 5: Corregir imports de utils y core modules**

Las líneas 5-11 tienen rutas `./modules/` incorrectas. Corregirlas:

```javascript
// ANTES:
import { escapeHtml, formatBytes, debounce, formatUptime } from './modules/utils.js';
import { initAPI, authFetch, loadSession, saveSession, clearSession } from './modules/api.js';
import { showNotification, showConfirmModal, celebrateWithConfetti, dismissNotification, cleanupNotifications } from './modules/notifications.js';
import { navigateTo, getViewFromPath, handleRouteChange, switchView as routerSwitchView, setupRouteListeners, cleanupRouter } from './modules/router.js';
import * as StateModule from './modules/state.js';

// DESPUÉS:
import { escapeHtml, formatBytes, debounce, formatUptime } from './utils.js';
import { initAPI, authFetch, loadSession, saveSession, clearSession } from './api.js';
import { showNotification, showConfirmModal, celebrateWithConfetti, dismissNotification, cleanupNotifications } from './notifications.js';
import { navigateTo, getViewFromPath, handleRouteChange, switchView as routerSwitchView, setupRouteListeners, cleanupRouter } from './router.js';
import * as StateModule from './state.js';
```

- [ ] **Step 6: Corregir import de disk-management en init()**

Buscar y corregir:
```javascript
// ANTES:
import { startDiskDetectionPolling, stopGlobalPolling, cleanup as cleanupDiskMgmt } from './modules/disk-management/index.js';

// DESPUÉS (mover al top del archivo con los otros imports):
import { startDiskDetectionPolling, stopGlobalPolling } from './disk-management/index.js';
```

- [ ] **Step 7: Verificar en browser**

1. Cargar la app → debe llegar al dashboard o login
2. Navegar a cada ruta del sidebar → cada módulo debe cargar
3. Navegar a `/active-backup` → debe mostrar el paid overlay
4. Navegar a `/active-directory` → debe mostrar el paid overlay
5. Provocar un error en un módulo (temporalmente) → solo ese módulo muestra error, app sigue funcionando

- [ ] **Step 8: Commit**

```bash
git add frontend/main.js
git commit -m "feat: wire main.js to module registry, remove static imports"
```

---

## Task 19: Crear style-base.css

**Files:**
- Create: `frontend/style-base.css`
- Modify: `frontend/style.css` (se mantiene pero se marca para split posterior)

- [ ] **Step 1: Crear style-base.css con sección de variables CSS**

Abrir `frontend/style.css` e identificar las variables CSS globales (`:root { ... }`). Copiarlas a `frontend/style-base.css`:

```bash
grep -n ":root" frontend/style.css | head -5
```

- [ ] **Step 2: Crear el archivo con la estructura base**

```css
/* frontend/style-base.css
 * Estilos compartidos: variables, sidebar, botones, modals, layout base.
 * Los estilos específicos de cada módulo van en [modulo]/style.css
 */

/* === VARIABLES (copiar bloque :root de style.css) === */
/* [pegar aquí el bloque :root completo de style.css] */

/* El resto de style.css se migrará aquí módulo a módulo */
```

Nota: El split completo de style.css (13,585 líneas) es trabajo separado. Por ahora style-base.css existe como placeholder para la migración gradual de estilos.

- [ ] **Step 3: Referenciar style-base.css en index.html**

Asegurarse de que `index.html` carga `style-base.css` antes de `style.css`:

```html
<link rel="stylesheet" href="/frontend/style-base.css">
<link rel="stylesheet" href="/frontend/style.css">
```

- [ ] **Step 4: Commit**

```bash
git add frontend/style-base.css
git commit -m "feat: add style-base.css placeholder for modular CSS split"
```

---

## Task 20: Añadir tarea al TASKS.md

**Files:**
- Modify: `TASKS.md`

- [ ] **Step 1: Marcar como completado en TASKS.md**

En `TASKS.md`, añadir una nueva sección con el estado de este refactor:

```markdown
## COMPLETADO — Sistema de módulos independientes (2026-04-04)

- [x] registry.js con lazy loading y error boundary
- [x] CSS stubs por módulo
- [x] Módulos faltantes: logs, shortcuts, active-backup (stubs)
- [x] Todos los módulos exportan render(container) + cleanup()
- [x] main.js usa loadModule() sin imports estáticos
- [x] Active Backup y Active Directory muestran paid overlay
- [ ] Split de style.css → style-base.css + módulos (pendiente, progresivo)
```

- [ ] **Step 2: Commit**

```bash
git add TASKS.md
git commit -m "docs: update TASKS.md with modular sidebar completion"
```

---

## Verificación final

- [ ] Navegar a cada ruta del sidebar: `/dashboard`, `/docker`, `/storage`, `/files`, `/network`, `/system`, `/terminal`, `/backup`, `/logs`, `/users`, `/shortcuts`, `/cloud-sync`, `/cloud-backup`, `/homestore`, `/vpn`
- [ ] Verificar que `/active-backup` y `/active-directory` muestran paid overlay
- [ ] Verificar que un error en un módulo no crashea la app (añadir `throw new Error('test')` temporalmente en un render, quitar después)
- [ ] Verificar que el botón atrás del browser funciona correctamente
- [ ] Verificar que no hay errores en la consola del browser al hacer navegación normal
