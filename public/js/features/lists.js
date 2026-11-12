import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

/* ================= FASE 2: LISTAS (COMPRAS, PRECIOS, ITEMS) ================= */
async function renderListsTab(container) {
  const { lists } = await api('/api/lists');

  container.innerHTML = `
    <section class="card">
      <h2>🛒 Sistema de Listas Compartidas (Compras, Supermercado, etc.)</h2>
      <form id="form-new-list" style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="flex:1; margin:0;">
          <label for="list-name">Nombre de nueva lista *</label>
          <input type="text" id="list-name" name="name" placeholder="Ej: Supermercado Mensual, Farmacia, Viaje" required>
        </div>
        <button type="submit" class="btn btn-primary">Crear Lista</button>
      </form>
    </section>

    <div class="grid-2">
      ${lists
        .map(
          l => `<section class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="margin:0;">📝 ${escapeHtml(l.name)}</h3>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-list" data-id="${l.id}">Eliminar Lista</button>
            </div>
            <p class="text-muted">Total estimado: <strong>${formatMoney(l.totalPrice)}</strong> · Comprado: <strong class="text-ok">${formatMoney(l.checkedPrice)}</strong></p>

            <form class="form-add-list-item" data-list-id="${l.id}" style="display:grid; grid-template-columns: 2fr 1fr 1fr auto; gap:0.4rem; margin-block-end:1rem;">
              <input type="text" name="name" placeholder="Producto / ítem *" aria-label="Nombre del ítem" required>
              <input type="number" name="price" step="0.01" placeholder="Precio" aria-label="Precio">
              <input type="text" name="quantity" value="1" placeholder="Cant." aria-label="Cantidad">
              <button type="submit" class="btn btn-primary">+</button>
            </form>

            ${
              l.items.length === 0
                ? '<p class="text-muted">Lista vacía.</p>'
                : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.45rem;">
                    ${l.items
                      .map(
                        item => `<li class="stat-box" style="padding:0.6rem 0.8rem; display:flex; justify-content:space-between; align-items:center;">
                          <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; font-weight:400;">
                            <input type="checkbox" data-action="toggle-list-item" data-id="${item.id}" ${item.checked ? 'checked' : ''}>
                            <span style="${item.checked ? 'text-decoration:line-through; opacity:0.6;' : ''}">
                              <strong>${escapeHtml(item.name)}</strong> (${escapeHtml(item.quantity)}) — ${formatMoney(item.price)}
                            </span>
                          </label>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete-list-item" data-id="${item.id}">✕</button>
                        </li>`
                      )
                      .join('')}
                  </ul>`
            }
          </section>`
        )
        .join('')}
    </div>
  `;
}

export default {
  id: 'lists',
  render: renderListsTab,
  actions: {
    'delete-list': async (ctx, el) => {
      await api(`/api/lists/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'toggle-list-item': async (ctx, el) => {
      await api(`/api/list-items/${el.dataset.id}`, { method: 'PATCH', body: { checked: el.checked } });
      ctx.refresh();
    },
    'delete-list-item': async (ctx, el) => {
      await api(`/api/list-items/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-list': async (ctx, data) => {
      await api('/api/lists', { method: 'POST', body: data });
      ctx.refresh();
    },
    // se identifica por clase (hay un form por lista)
    'form-add-list-item': async (ctx, data, form) => {
      await api(`/api/lists/${form.dataset.listId}/items`, { method: 'POST', body: data });
      ctx.refresh();
    }
  }
};
