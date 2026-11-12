import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';

/* ================= HERRAMIENTAS: CÁPSULA DEL TIEMPO ================= */
async function renderCapsulesTab(container) {
  const { capsules } = await api('/api/capsules');

  container.innerHTML = `
    <section class="card">
      <h2><i class="fa-solid fa-hourglass-half"></i> Cápsula del Tiempo (Cartas dedicadas con desbloqueo programado)</h2>
      <form id="form-new-capsule">
        <div class="grid-2">
          <div class="field">
            <label for="cap-title">Título de la carta *</label>
            <input type="text" id="cap-title" name="title" placeholder="Ej: Para nuestro próximo aniversario" required>
          </div>
          <div class="field">
            <label for="cap-unlock">Fecha y hora en que se desbloquea para leer *</label>
            <input type="datetime-local" id="cap-unlock" name="unlock_at" required>
          </div>
        </div>
        <div class="field">
          <label for="cap-body">Cuerpo de la carta *</label>
          <textarea id="cap-body" name="body" rows="4" required placeholder="Escribe tu carta para el futuro..."></textarea>
        </div>
        <div class="field">
          <label for="cap-photo">Foto recuerdo (opcional)</label>
          <input type="file" id="cap-photo" accept="image/*">
        </div>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-lock"></i> Sellar Cápsula del Tiempo</button>
      </form>
    </section>

    <div class="grid-2">
      ${
        capsules.length === 0
          ? '<p class="text-muted">Aún no hay cartas en la cápsula del tiempo.</p>'
          : capsules
              .map(
                c => `<article class="card">
                  <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                      <span class="badge">${c.locked ? '<i class="fa-solid fa-lock"></i> Bloqueada' : '<i class="fa-solid fa-lock-open"></i> Desbloqueada'}</span>
                      <h3 style="margin:0.35rem 0;">${escapeHtml(c.title)}</h3>
                      <div class="text-muted">De ${escapeHtml(c.author_name || '')} · Se desbloquea: <strong>${escapeHtml(c.unlock_at.replace('T', ' '))}</strong></div>
                    </div>
                    <button type="button" class="btn btn-sm btn-danger" data-action="delete-capsule" data-id="${c.id}" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
                  </div>
                  <p style="margin-top:0.75rem; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
                  ${!c.locked && c.photo_url ? `<img src="${escapeHtml(c.photo_url)}" alt="${escapeHtml(c.title)}" loading="lazy" width="320" height="200" style="max-width:100%; height:auto; border-radius:0.5rem;">` : ''}
                </article>`
              )
              .join('')
      }
    </div>
  `;
}

export default {
  id: 'capsules',
  render: renderCapsulesTab,
  actions: {
    'delete-capsule': async (ctx, el) => {
      await api(`/api/capsules/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-capsule': async (ctx, data) => {
      const photoUrl = await fileToUploadedUrl(document.getElementById('cap-photo'));
      await api('/api/capsules', { method: 'POST', body: { ...data, photo_url: photoUrl } });
      ctx.showStatus('Cápsula del tiempo sellada.');
      ctx.refresh();
    }
  }
};
