# Dashcodex

Dashboard NAS full-stack (frontend + backend) preparado para produccion, con arquitectura modular y validacion tecnica completa.

## Estado

- Backend tests: 531/531 OK
- Lint backend: OK
- Frontend bundle: OK (esbuild)
- Refactor modular aplicado y duplicados criticos eliminados

## Stack

- Backend: Node.js + Express
- Frontend: Vanilla JS modular
- DB local/config: JSON + SQLite (segun modulo)
- Seguridad: sesiones, CSRF, RBAC, 2FA TOTP, rate limiting

## Estructura

```
backend/                  # API, middleware, utilidades, tests
frontend/                 # UI modular
frontend/modules/         # modulos por feature
scripts/                  # build/utilidades
index.html                # entrada web
```

## Requisitos

- Node.js 20+
- npm 10+

## Instalacion

```bash
npm install
```

## Desarrollo

```bash
npm run dev
```

## Produccion

```bash
npm run build
npm start
```

## Validacion local

```bash
npm run lint
npm test -- --runInBand
```

## Modulos clave

- Storage Wizard / Dashboard
- Docker Manager
- VPN WireGuard
- Network Manager
- File Manager
- Users + Auth/2FA
- Backups (local, active-backup, cloud)

## Notas

- Proyecto preparado para despliegue en NAS Linux.
- Para validacion real 100%, se recomienda smoke test E2E en el NAS objetivo.
- Diagnostico wizard en NAS:
  - `sudo homepinas-diagnose start`
  - `sudo homepinas-diagnose snapshot`
  - `sudo homepinas-diagnose stop`
  - `sudo homepinas-diagnose pack`

## Licencia

MIT
