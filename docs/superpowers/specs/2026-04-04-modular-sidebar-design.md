# Spec: Sistema de Módulos Independientes para Sidebar

**Fecha:** 2026-04-04  
**Estado:** Aprobado  
**Proyecto:** HomePiNAS Dashboard v3.5

---

## Objetivo

Convertir cada ítem del sidebar en un bloque completamente independiente: aislado en runtime, con estilos propios, y con soporte para módulos de pago. Permite trabajar en un módulo sin riesgo de romper otros.

---

## Requisitos

1. **Aislamiento en runtime** — un crash en un módulo no afecta al resto de la app
2. **Aislamiento de estilos** — cada módulo carga su propio CSS solo cuando se activa
3. **Módulos de pago** — Active Backup y Active Directory muestran overlay "Requiere licencia" en lugar de su contenido
4. **Migración gradual** — se puede migrar módulo a módulo sin romper los demás
5. **Contrato uniforme** — todos los módulos exportan exactamente `render(container)` y `cleanup()`

---

## Módulos

| ID | Ruta | Pago |
|----|------|------|
| dashboard | /dashboard | No |
| docker | /docker | No |
| storage | /storage | No |
| files | /files | No |
| network | /network | No |
| system | /system | No |
| terminal | /terminal | No |
| backup | /backup | No |
| logs | /logs | No |
| users | /users | No |
| shortcuts | /shortcuts | No |
| cloud-sync | /cloud-sync | No |
| cloud-backup | /cloud-backup | No |
| homestore | /homestore | No |
| vpn | /vpn | No |
| active-backup | /active-backup | **Sí** |
| active-directory | /active-directory | **Sí** |

---

## Arquitectura

### Estructura de archivos

```
frontend/
├── style-base.css              ← compartido: sidebar, botones, modals, vars CSS
├── modules/
│   └── registry.js             ← fuente de verdad: definición + loader + error boundary
├── main.js                     ← bootstrap simplificado, sin imports de módulos
├── dashboard/
│   ├── index.js
│   └── style.css
├── docker/
│   ├── index.js
│   └── style.css
└── ... (todos los módulos con la misma estructura)
```

### Contrato de módulo

Cada `index.js` de módulo exporta exactamente dos funciones:

```javascript
// Recibe el contenedor DOM donde renderizar
export async function render(container) { ... }

// Limpia event listeners, timers, estado local
export function cleanup() { ... }
```

No hay `renderDockerView()`, `renderFilesView()`, etc. Todos se llaman igual.

### registry.js

Responsabilidades:
- Lista declarativa de todos los módulos
- Carga dinámica (`import()`) — el módulo no se descarga hasta que se navega a él
- Inyección de CSS por módulo (cacheado tras primera carga)
- Error boundary — errores en `render()` se capturan y muestran inline sin crashear la app
- Overlay de pago para módulos `paid: true`
- Gestión del cleanup del módulo anterior al cambiar de vista

```javascript
export const modules = [
  {
    id: 'docker',
    route: '/docker',
    paid: false,
    css: '/frontend/docker/style.css',
    load: () => import('/frontend/docker/index.js')
  },
  {
    id: 'active-backup',
    route: '/active-backup',
    paid: true,
    css: '/frontend/active-backup/style.css',
    load: () => import('/frontend/active-backup/index.js')
  },
  // ...
]

let _currentCleanup = null

export async function loadModule(id, container) {
  if (_currentCleanup) { _currentCleanup(); _currentCleanup = null }

  const mod = modules.find(m => m.id === id)
  if (!mod) return showError(container, `Módulo desconocido: ${id}`)
  if (mod.paid) return showPaidOverlay(container)

  injectCSS(mod.css)

  try {
    const { render, cleanup } = await mod.load()
    _currentCleanup = cleanup ?? null
    await render(container)
  } catch (err) {
    showError(container, err)
  }
}
```

### CSS

- `style-base.css` cargado una vez en `<head>` al arrancar la app
- `[modulo]/style.css` inyectado como `<link>` la primera vez que se activa la vista
- Un `Set` interno evita inyectar el mismo archivo más de una vez
- Módulos que no tienen estilos propios aún apuntan a un `style.css` vacío (no da error)

### main.js simplificado

```javascript
import { loadModule } from './modules/registry.js'

async function renderContent(view) {
  const container = document.getElementById('dashboard-content')
  await loadModule(view, container)
}
```

Elimina los 15 imports estáticos actuales. El módulo solo existe en memoria mientras su vista está activa.

---

## Estrategia de migración

La migración es módulo a módulo. En ningún momento hay que migrar todo a la vez.

**Orden recomendado:**
1. Crear `registry.js` con todos los módulos declarados
2. Actualizar `main.js` para usar `loadModule()`
3. Migrar módulos simples primero (dashboard, network, system)
4. Migrar módulos grandes en su propio paso (storage/wizard, docker, files)
5. Partir `style.css` en base + por módulo al final, una vez el JS esté estable

**Regla durante migración:** mientras un módulo no esté migrado, su función actual sigue funcionando. El registry puede apuntar temporalmente a un wrapper que llama a la función vieja.

---

## Error boundary

Cuando `render()` lanza una excepción:

```html
<div class="module-error">
  <h3>Error cargando módulo</h3>
  <pre>[mensaje de error]</pre>
</div>
```

El resto de la app (sidebar, header, otros módulos ya cargados) no se ve afectado.

---

## Overlay de pago

Cuando `paid: true`:

```html
<div class="paid-overlay">
  <h2>Requiere licencia</h2>
  <p>Activa tu licencia para acceder a este módulo.</p>
</div>
```

Los estilos de `.paid-overlay` viven en `style-base.css`.

---

## Lo que NO cubre esta spec

- Sistema de licencias real (validación, activación, servidor de licencias)
- Build pipeline / bundler (esbuild, vite) — se aborda en spec separada
- Migración del CSS monolítico a módulos — se hace en paralelo al JS, módulo a módulo
- Tests automatizados por módulo
