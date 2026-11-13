import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

/* ================= FASE 2: LISTAS (COMPRAS, PRECIOS, ITEMS) ================= */
async function renderListsTab(container) {
  const { lists } = await api('/api/lists');

  container.innerHTML = `
    <section class="card">
      <h2><i class="fa-solid fa-cart-shopping"></i> Sistema de Listas Compartidas (Compras, Supermercado, etc.)</h2>
      <form id="form-new-list" style="display:flex; gap:0.75rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="flex:1; margin:0;">
          <label for="list-name">Nombre de nueva lista *</label>
          <input type="text" id="list-name" name="name" placeholder="Ej: Supermercado Mensual, Farmacia, Viaje" required>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Crear Lista</button>
      </form>
    </section>

    <div class="grid-2">
      ${lists
        .map(
          l => `<section class="card">
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h3 style="margin:0;"><i class="fa-solid fa-list-ul"></i> ${escapeHtml(l.name)}</h3>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-list" data-id="${l.id}"><i class="fa-solid fa-trash-can"></i> Eliminar Lista</button>
            </div>
            <p class="text-muted">Total estimado: <strong>${formatMoney(l.totalPrice)}</strong> · Comprado: <strong class="text-ok">${formatMoney(l.checkedPrice)}</strong></p>

            <form class="form-add-list-item list-item-form-grid" data-list-id="${l.id}">
              <input type="text" name="name" placeholder="Producto / ítem *" aria-label="Nombre del ítem" required>
              <input type="number" name="price" step="0.01" placeholder="Precio" aria-label="Precio">
              <input type="text" name="quantity" value="1" placeholder="Cant." aria-label="Cantidad">
              <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i></button>
            </form>

            ${
              l.items.length === 0
                ? '<p class="text-muted">Lista vacía.</p>'
                : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.45rem;">
                    ${l.items
                      .map(
                        item => `<li class="stat-box" style="padding:0.6rem 0.8rem; display:flex; justify-content:space-between; align-items:center;">
                          <label style="display:flex; align-items:center; gap:0.6rem; cursor:pointer; font-weight:400; flex:1;">
                            <input type="checkbox" data-action="toggle-list-item" data-id="${item.id}" ${item.checked ? 'checked' : ''}>
                            <span style="${item.checked ? 'text-decoration:line-through; opacity:0.6;' : ''}">
                              <strong>${escapeHtml(item.name)}</strong> (${escapeHtml(item.quantity)}) — ${formatMoney(item.price)}
                            </span>
                          </label>
                          <div style="display:flex; gap:0.35rem; align-items:center;">
                            <button type="button" class="btn btn-sm" data-action="edit-list-item" data-item='${escapeHtml(JSON.stringify(item))}' aria-label="Editar ${escapeHtml(item.name)}">
                              <i class="fa-solid fa-pen-to-square"></i>
                            </button>
                            <button type="button" class="btn btn-sm btn-danger" data-action="delete-list-item" data-id="${item.id}" aria-label="Eliminar ${escapeHtml(item.name)}">
                              <i class="fa-solid fa-xmark"></i>
                            </button>
                          </div>
                        </li>`
                      )
                      .join('')}
                  </ul>`
            }
          </section>`
        )
        .join('')}
    </div>

    <!-- Diálogo nativo: Editar Ítem de Lista -->
    <dialog id="dialog-edit-item" aria-labelledby="dialog-edit-item-title">
      <h2 id="dialog-edit-item-title"><i class="fa-solid fa-pen-to-square"></i> Editar Ítem de la Lista</h2>
      <p class="text-muted">Modifica el nombre, precio estimado o cantidad del producto.</p>
      <form id="form-edit-list-item">
        <input type="hidden" id="edit-item-id" name="id">
        <div class="field">
          <label for="edit-item-name">Nombre del producto / ítem *</label>
          <input type="text" id="edit-item-name" name="name" required>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="edit-item-price">Precio estimado</label>
            <input type="number" id="edit-item-price" name="price" step="0.01" min="0">
          </div>
          <div class="field">
            <label for="edit-item-qty">Cantidad</label>
            <input type="text" id="edit-item-qty" name="quantity">
          </div>
        </div>
        <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
          <button type="button" class="btn" data-action="close-edit-item-dialog" id="btn-close-edit-item">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Cambios</button>
        </div>
      </form>
    </dialog>
  `;

  document.getElementById('btn-close-edit-item')?.addEventListener('click', () => {
    document.getElementById('dialog-edit-item')?.close();
  });
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
    'edit-list-item': (ctx, el) => {
      const item = JSON.parse(el.dataset.item || '{}');
      const dialog = document.getElementById('dialog-edit-item');
      if (!dialog) return;
      document.getElementById('edit-item-id').value = item.id || '';
      document.getElementById('edit-item-name').value = item.name || '';
      document.getElementById('edit-item-price').value = item.price !== undefined ? item.price : 0;
      document.getElementById('edit-item-qty').value = item.quantity || '1';
      dialog.showModal();
    },
    'delete-list-item': async (ctx, el) => {
      await api(`/api/list-items/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'close-edit-item-dialog': () => {
      const dialog = document.getElementById('dialog-edit-item');
      if (dialog && typeof dialog.close === 'function') {
        try { dialog.close(); } catch (_) {}
      }
    }
  },
  forms: {
    'form-new-list': async (ctx, data) => {
      await api('/api/lists', { method: 'POST', body: data });
      ctx.refresh();
    },
    'form-add-list-item': async (ctx, data, form) => {
      await api(`/api/lists/${form.dataset.listId}/items`, { method: 'POST', body: data });
      ctx.refresh();
    },
    'form-edit-list-item': async (ctx, data) => {
      const id = data.id;
      const dialog = document.getElementById('dialog-edit-item');
      await api(`/api/list-items/${id}`, {
        method: 'PUT',
        body: {
          name: data.name,
          price: Number(data.price || 0),
          quantity: data.quantity
        }
      });
      if (dialog && typeof dialog.close === 'function') {
        try { dialog.close(); } catch (_) {}
      }
      ctx.showStatus('Ítem actualizado.');
      await ctx.refresh();
    }
  }
};
