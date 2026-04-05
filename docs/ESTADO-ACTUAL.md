# Estado actual del proyecto — HomePiNAS Dashboard v3.5
> Fecha: 2026-04-05

---

## Entorno de pruebas

| Ítem | Valor |
|------|-------|
| Máquina | Raspberry Pi (pitest) |
| IP | 192.168.1.117 |
| Usuario SSH | juanlu / mimora |
| OS | Debian 13 Trixie (aarch64) |
| Node.js | v22.22.2 |
| Ruta instalación | /opt/homepinas |
| Servicio | homepinas (systemd) — **activo** |
| Repo remoto | https://github.com/juanlusoft/homepinas-dashboard |
| Rama | main |

---

## Qué funciona

- **Instalador** (`install.sh`): reescrito completamente. La Pi ya no se bloquea durante la instalación.
- **Backend**: arranca correctamente. Todas las rutas cargan.
- **Frontend**: se sirve y carga en el navegador.
- **Login / Setup**: el formulario de setup crea el usuario admin y redirige al storage wizard.
- **Autenticación**: sesiones funcionan (verify-session, login, logout).
- **Navegación sidebar**: los clicks en los botones del sidebar llaman correctamente a los módulos.
- **Storage module**: carga y muestra el dashboard de almacenamiento con los discos detectados.
- **Disk health panel**: el backend ahora devuelve la estructura correcta que espera el frontend.

---

## Qué NO funciona / pendiente

- **Todos los módulos del sidebar fallan al cargar** (Docker, Red, Sistema, Terminal, Backup, Usuarios, etc.) con algún error en el navegador — no se llegó a identificar el error exacto de cada uno antes de cerrar la sesión de debug.
- **Storage dashboard**: tenía TypeErrors encadenados (`disk.health.status`, `disk.serial.substring`, `disk.temperature.status`, `disk.powerOnTime.formatted`) — todos corregidos en el frontend. Puede que queden más.
- **Storage wizard** (configuración inicial del pool): no se verificó que funcione correctamente end-to-end.
- **Módulos paid** (Active Backup, Active Directory): muestran overlay de licencia — comportamiento intencional.

---

## Bugs corregidos en esta sesión (commits)

| Commit | Descripción |
|--------|-------------|
| `c867436` | `mkdir /mnt/cache /mnt/parity /mnt/disks` en install.sh — resolvía error systemd NAMESPACE (status=226) |
| `4acdf2b` | Reescritura completa de install.sh — Pi dejaba de responder por: falta de DEBIAN_FRONTEND, servicios auto-arrancando durante apt, apt-get upgrade matando el sistema, sin timeouts, wireguard completo en lugar de wireguard-tools |
| `ae61348` | Todos los `require('./utils/xxx')` en backend → rutas correctas tras migración TS |
| `062ea18` | `initSessionDb` importado desde `./session` no `./utils/session` |
| `0cd35eb` | Creado `frontend/i18n.js` (faltaba completamente — causaba pantalla en blanco) |
| `c2edd1e` | Todos los imports de i18n en frontend → `/frontend/i18n.js` (ruta absoluta, era relativa y el browser la resolvía mal) |
| `50e4f69` | Exportado alias `renderLogsView` en `logs/index.js` |
| `33d9c5d` | Añadidos endpoints `/api/dashboard` y `/api/storage/disks/detect` que faltaban en routes.ts |
| `be49c05` | Reemplazado fakeRes con monkey-patch de `res.json` en los alias de routes.ts |
| `673f927` | `validateSession` importado desde `./session` no `./utils/session` en auth.ts |
| `0fd0d3d` | El storage wizard se renderiza en `#storage-view`, el resto en `#dashboard-content` |
| `d9423a7` | Setup form: manejar HTTP 409 (admin ya existe) → redirige a login |
| `ac2ea73` | Añadidos click handlers al sidebar y llamada a `initRouter()` en main.js |
| `2e86bf5` | `resetBtn` declarado antes de usarse en `docker/index.js` |
| `4f97c9e` | Optional chaining en `disk.health?.status` en wizard-storage-dashboard.js |
| `624d59a` | Optional chaining en `disk.temperature?.current` y `disk.powerOnTime?.formatted` |
| `c239dee` | Backend `/disks/health` ahora devuelve estructura que el frontend espera: `{ id, health.status, temperature.{current,status}, powerOnTime.{formatted}, sectors.{reallocated,pending}, summary.{healthy,warning,critical} }` |

---

## Estructura del proyecto

```
/opt/homepinas/
├── backend/
│   ├── index.ts          # Entry point (tsx runner)
│   ├── routes.ts         # Registro de rutas
│   ├── auth.ts           # Middleware requireAuth
│   ├── middleware.ts     # CORS, rate limit, CSRF, logging
│   ├── session.ts        # SQLite sessions
│   ├── security.ts       # logSecurityEvent
│   ├── routes/
│   │   ├── auth.js       # /api/setup, /api/login, /api/logout, /api/verify-session
│   │   ├── storage.js    # /api/storage/* (pool, snapraid, SMART, badblocks)
│   │   ├── system.js     # /api/system/* (stats, disks, fans)
│   │   ├── docker.js     # /api/docker/*
│   │   ├── network.js    # /api/network/*
│   │   └── ... (20+ más)
│   └── utils/
│       └── session.js    # validateCsrf (CSRF only — sesiones en ./session.ts)
├── frontend/
│   ├── main.js           # Bootstrap, router, sidebar, auth
│   ├── router.js         # SPA router
│   ├── api.js            # authFetch wrapper
│   ├── i18n.js           # Internacionalización (es/en)
│   ├── state.js          # Estado global
│   ├── modules/
│   │   └── registry.js   # loadModule() — carga dinámica de módulos
│   ├── dashboard/index.js
│   ├── docker/index.js
│   ├── storage/
│   │   ├── wizard.js                   # Storage wizard (configuración inicial)
│   │   └── wizard-storage-dashboard.js # Dashboard de almacenamiento
│   └── ... (15+ módulos)
├── index.html            # SPA shell
└── install.sh            # Instalador completo
```

---

## Puntos críticos que hay que tener en cuenta

1. **El backend es TypeScript ejecutado con `tsx`** — no hay paso de compilación. Los archivos `.ts` se interpretan directamente.

2. **El frontend es ES Modules puro** — el browser resuelve los imports. Los imports relativos (`../api.js`) funcionan bien. Los imports a `/frontend/i18n.js` deben ser **absolutos** porque i18n.js está en la raíz de `/frontend/` y los módulos están en subdirectorios.

3. **Dos archivos de sesión distintos**:
   - `backend/session.ts` → `validateSession()`, `initSessionDb()`, `startSessionCleanup()` — **el real**
   - `backend/utils/session.js` → solo `validateCsrf()` — **solo para CSRF**
   - Confundir estos dos era la causa del error "validateSession is not a function"

4. **El systemd necesita que existan `/mnt/cache`, `/mnt/parity`, `/mnt/disks`, `/mnt/storage`** antes de arrancar, o falla con status=226/NAMESPACE.

5. **install.sh requiere `export DEBIAN_FRONTEND=noninteractive`** al principio — sin esto los scripts de postinst de apt se quedan esperando input y la Pi aparenta haberse colgado.

---

## Cómo reiniciar el servicio en el NAS

```bash
ssh juanlu@192.168.1.117  # pass: mimora
cd /opt/homepinas && git pull
sudo systemctl restart homepinas
journalctl -u homepinas -f   # ver logs en tiempo real
```
