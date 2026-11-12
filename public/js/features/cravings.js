import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';

/* ================= HERRAMIENTAS: ANTOJOS + SUGERIR ANTOJO ================= */
async function renderCravingsTab(container) {
  const { cravings } = await api('/api/cravings');
  const pendingForMe = cravings.filter(c => c.status === 'suggested' && c.owner_user_id === state.user.id);
  const myActive = cravings.filter(c => c.status === 'active' && c.owner_user_id === state.user.id);
  const partnerActive = cravings.filter(c => c.status === 'active' && c.owner_user_id !== state.user.id);

  container.innerHTML = `
    ${
      pendingForMe.length > 0
        ? `<section class="card" style="border-color:var(--brand); border-width:2px;">
            <h2>💌 Sugerencias de Antojos de tu Pareja (${pendingForMe.length})</h2>
            <p class="text-muted">Si aceptas un antojo sugerido, se añade automáticamente a tu lista de antojos.</p>
            <div class="grid-2">
              ${pendingForMe
                .map(
                  c => `<div class="stat-box">
                    <strong>${escapeHtml(c.title)}</strong>
                    <p class="text-muted">Sugerido por ${escapeHtml(c.suggested_by_name || 'tu pareja')} ${c.price ? `· ${formatMoney(c.price)}` : ''}</p>
                    ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
                    <div style="display:flex; gap:0.5rem;">
                      <button type="button" class="btn btn-sm btn-primary" data-action="respond-craving" data-id="${c.id}" data-accept="1">✓ Aceptar Antojo</button>
                      <button type="button" class="btn btn-sm btn-danger" data-action="respond-craving" data-id="${c.id}" data-accept="0">✕ Rechazar</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    <section class="card">
      <h2>🎁 Cargar Antojo o Sugerir Antojo a mi Pareja</h2>
      <form id="form-new-craving">
        <div class="grid-2">
          <div class="field">
            <label for="crav-title">¿Qué quieren? (Producto, plan o servicio) *</label>
            <input type="text" id="crav-title" name="title" placeholder="Ej: Chocolate Rapanui, Perfume, Cena de sushi" required>
          </div>
          <div class="field">
            <label for="crav-mode">Destino del antojo</label>
            <select id="crav-mode" name="suggest_to_partner">
              <option value="">Añadir a MI lista de antojos</option>
              <option value="1">💡 Sugerir este antojo a mi pareja (para que acepte o rechace)</option>
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="crav-price">Precio estimado (opcional)</label>
            <input type="number" id="crav-price" name="price" step="0.01" placeholder="0.00">
          </div>
          <div class="field">
            <label for="crav-url">URL del producto (opcional)</label>
            <input type="url" id="crav-url" name="url" placeholder="https://..." autocorrect="off" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="crav-photo">Foto (opcional)</label>
            <input type="file" id="crav-photo" accept="image/*">
          </div>
        </div>
        <div class="field">
          <label for="crav-desc">Descripción / Detalles (talle, sabor, color)</label>
          <input type="text" id="crav-desc" name="description" placeholder="Ej: Chocolate amargo 70%">
        </div>
        <button type="submit" class="btn btn-primary">Guardar Antojo</button>
      </form>
    </section>

    <div class="grid-2">
      <section class="card">
        <h3>✨ Antojos de ${escapeHtml(state.partner?.first_name || 'mi Pareja')} (${partnerActive.length})</h3>
        ${renderCravingsList(partnerActive)}
      </section>
      <section class="card">
        <h3>🍒 Mis Antojos (${myActive.length})</h3>
        ${renderCravingsList(myActive)}
      </section>
    </div>
  `;
}

function renderCravingsList(list) {
  if (list.length === 0) return '<p class="text-muted">Sin antojos cargados.</p>';
  return `<div style="display:flex; flex-direction:column; gap:0.75rem;">
    ${list
      .map(
        c => `<div class="stat-box">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <div>
              <strong>${escapeHtml(c.title)}</strong>
              ${c.price ? `<span class="badge">${formatMoney(c.price)}</span>` : ''}
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-craving" data-id="${c.id}">✕</button>
          </div>
          ${c.description ? `<p style="margin:0.35rem 0;">${escapeHtml(c.description)}</p>` : ''}
          ${c.url ? `<p style="margin:0.25rem 0;"><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">🔗 Ver link del producto</a></p>` : ''}
          ${c.photo_url ? `<img src="${escapeHtml(c.photo_url)}" alt="${escapeHtml(c.title)}" loading="lazy" width="240" height="160" style="max-width:100%; height:auto; border-radius:0.5rem; margin-top:0.4rem;">` : ''}
        </div>`
      )
      .join('')}
  </div>`;
}

export default {
  id: 'cravings',
  render: renderCravingsTab,
  actions: {
    'respond-craving': async (ctx, el) => {
      await api(`/api/cravings/${el.dataset.id}/respond`, {
        method: 'POST',
        body: { accept: el.dataset.accept === '1' }
      });
      ctx.showStatus(el.dataset.accept === '1' ? '¡Antojo aceptado y añadido a tu lista!' : 'Sugerencia descartada.');
      ctx.refresh();
    },
    'delete-craving': async (ctx, el) => {
      await api(`/api/cravings/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-craving': async (ctx, data) => {
      const photoUrl = await fileToUploadedUrl(document.getElementById('crav-photo'));
      await api('/api/cravings', {
        method: 'POST',
        body: { ...data, suggest_to_partner: Boolean(data.suggest_to_partner), photo_url: photoUrl }
      });
      ctx.showStatus(data.suggest_to_partner ? 'Sugerencia de antojo enviada a tu pareja.' : 'Antojo agregado a tu lista.');
      ctx.refresh();
    }
  }
};
