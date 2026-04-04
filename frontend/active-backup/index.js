// frontend/active-backup/index.js
// Módulo de pago — el registry muestra el overlay automáticamente.

export async function render(container) {
  container.innerHTML = `
    <div class="glass-card" style="padding:2rem;text-align:center">
      <h2>Active Backup</h2>
      <p>Requiere licencia HomePiNAS.</p>
    </div>`;
}

export function cleanup() {}
