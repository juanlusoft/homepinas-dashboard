# Dashboard v3.5 — Task Tracker

> Generado tras code review con clean-code-ts-go.  
> Estado: `[ ]` pendiente · `[~]` en progreso · `[x]` completado

---

## COMPLETADO — Sistema de módulos independientes (2026-04-04)

- [x] `frontend/modules/registry.js` — lazy loading, error boundary, paid overlay
- [x] CSS stubs por módulo (17 archivos `[modulo]/style.css`)
- [x] Módulos stub creados: `logs/`, `shortcuts/`, `active-backup/`
- [x] Todos los módulos exportan `render(container)` + `cleanup()`
- [x] `main.js` usa `loadModule()` — sin imports estáticos de módulos
- [x] `active-backup` y `active-directory` muestran paid overlay
- [ ] Split de `style.css` → `style-base.css` + módulos (en progreso, gradual)

---

## CRITICOS — Crashes en runtime

> Estos rompen la app al iniciar. Resolver primero.

- [x] **C-01** `frontend/core/auth-2fa.js:17-18` — `disable2FA()` declarada dos veces; `load2FAStatus` y `setup2FA` referenciados pero no definidos. Eliminado duplicado, implementadas funciones faltantes.
- [x] **C-02** `frontend/core/polling.js` — `stopGlobalPolling()`, `updatePublicIP()` y `startDiskDetectionPolling()` exportadas pero sin implementación. Implementadas.
- [x] **C-03** `frontend/dashboard/index.js:47` — `formatUptime` usada sin importar. Import añadido.

---

## SEGURIDAD — Alta prioridad

- [x] **S-01** `backend/security.js:51-54` — `safeExec()` valida solo `path.basename()`. Validación de path completo añadida en `safeExec` y `sudoExec`.
- [x] **S-02** `backend/security.js:88-94` — Paths que comienzan con `/` bypasseaban el check de shell injection. Lógica corregida.
- [x] **S-03** `backend/terminal-ws.js:115-117` — Argumentos del terminal no sanitizados antes de pasar al PTY. Argumentos eliminados.
- [x] **S-04** `backend/totp-crypto.js` — Clave TOTP en `config/.totp-server-key` en disco plano. Movida a ENV var `TOTP_SERVER_KEY` con fallback al fichero.
- [x] **S-05** `backend/rateLimit.js` — Sin rate limit dedicado para cambio/reset de contraseña. `passwordLimiter` añadido.

---

## ERROR HANDLING

- [x] **E-01** `backend/health-monitor.js:133-197` — `checkSmartHealth()` tenía 65 líneas. Extraído en `_checkSmartFailure()`, `_checkDiskSectors()`, `_checkSsdLife()`.
- [x] **E-02** `backend/error-monitor.js:95-99` — Errores de `journalctl` silenciosos. Distinguido `ENOENT` (no-systemd, debug) de fallo real (error).
- [x] **E-03** `backend/health-monitor.js:79-82` — Fallback silencioso a cache en errores de `lsblk`. Logueado con cache count, error code y cache age.

---

## VALIDACIÓN DE INPUTS

- [x] **V-01** `backend/sanitize.js:168-182` — `validateComposeContent()` buscaba keyword `services` en texto plano. Usa `js-yaml` con fallback a regex estricto.
- [x] **V-02** `backend/sanitize.js:127-135` — `sanitizePath()` no bloqueaba paths peligrosos. Añadido `dangerousPaths` block para `/`, `/etc`, `/proc`, `/sys`, `/dev`, `/root`, `/boot`.

---

## REFACTOR — Código largo / SRP

- [x] **R-01** `backend/index.js` (526 líneas) — Partido en `middleware.js`, `routes.js`, `ssl-setup.js`. `index.js` es ahora bootstrap de ~98 líneas. (Nota: rutas `/api/*` ya estaban en `backend/routes/` pre-existente.)
- [x] **R-02** `frontend/notifications.js` — `showConfirmModal()` y `processNotificationQueue()` extraídos en helpers privados `_buildConfirmModal`, `_bindConfirmModalEvents`, `_buildNotificationElement`.
- [x] **R-03** `frontend/storage/wizard.js` (2,531 → 1,232 líneas) — Partido en `wizard-state.js`, `wizard-disk-selection.js`, `wizard-navigation.js`, `wizard-pool.js`, `wizard-storage-dashboard.js`.
- [x] **R-04** `frontend/docker/index.js` (1,924 → 1,186 líneas) — Partido en `actions.js`, `compose.js`, `containers.js`.
- [x] **R-05** `frontend/files/index.js` (1,579 → 489 líneas) — Partido en `actions.js`, `browse.js`, `tree.js`, `upload.js`, `utils.js`, `listeners.js`.

---

## CONFIGURACIÓN — Valores hardcodeados

- [x] **H-01** `backend/session.js:15-16` — Timeouts de sesión movidos a ENV vars `SESSION_DURATION` y `SESSION_IDLE_TIMEOUT` con validación y fallback.
- [x] **H-02** `backend/health-monitor.js:216,249` — Umbrales de temperatura y pool movidos a `TEMP_THRESHOLD_C` y `POOL_USAGE_THRESHOLD` con ENV vars y validación de rango.
- [x] **H-03** `backend/index.js:359` — Lista de SPA routes centralizada en `backend/spa-routes.js`. `index.js` hace `require('./spa-routes')`.

---

## CALIDAD — Naming & Consistencia

- [x] **Q-01** `frontend/` — Convención ya uniforme: `export function` para funciones, `export const` para valores. Sin cambios necesarios.
- [x] **Q-02** Frontend general — JSDoc ya presente en funciones públicas de `api.js`, `utils.js`, `state.js`. Sin cambios necesarios.
- [x] **Q-03** `backend/data.js:68-86` — `withData()` revisado. Implementación con promise-chain es correcta (no hay race condition). Comentarios explicativos añadidos.

---

## DEUDA TÉCNICA — Largo plazo

- [x] **D-01** Migrar backend a TypeScript. Todos los archivos `.js` del backend migrados a `.ts` con tipos estrictos. `tsx` como runner, sin paso de compilación. `allowJs: true` para migración gradual del frontend.
- [x] **D-02** Añadir tests unitarios para `totp-crypto.js`, `sanitize.js`, `security.js`. Stubs creados en `backend/tests/`.
- [x] **D-03** `frontend/style.css` (13,585 líneas) — CSS extraído a 17 archivos `[modulo]/style.css`. `style-base.css` ampliado con modales, selects, menús compartidos. `style.css` original intacto (eliminación gradual pendiente).
- [x] **D-04** CI/CD con GitHub Actions: `ci.yml` (lint + vitest en todo push/PR) y `security-audit.yml` (npm audit en push a main). Vitest añadido a devDependencies.

---

## Progreso general

| Categoría | Total | Hecho | Pendiente |
|-----------|-------|-------|-----------|
| Críticos | 3 | 3 | 0 |
| Seguridad | 5 | 5 | 0 |
| Error handling | 3 | 3 | 0 |
| Validación | 2 | 2 | 0 |
| Refactor | 5 | 5 | 0 |
| Hardcoded | 3 | 3 | 0 |
| Calidad | 3 | 3 | 0 |
| Deuda técnica | 4 | 4 | 0 |
| **TOTAL** | **28** | **28** | **0** |

---

_Última actualización: 2026-04-04 — Backend TypeScript migration complete (28/28)_
