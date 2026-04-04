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
