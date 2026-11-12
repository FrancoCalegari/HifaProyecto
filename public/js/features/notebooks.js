import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';
import { renderMarkdown } from '../core/markdown.js';

/* ================= HERRAMIENTAS: CUADERNOS COMPARTIDOS (MARKDOWN) ================= */
async function renderNotebooksTab(container) {
  const { notebooks } = await api('/api/notebooks');
  const activeNb = notebooks.find(n => n.id === state.activeNotebookId) || notebooks[0] || null;
  if (activeNb) state.activeNotebookId = activeNb.id;
  const activePage = activeNb?.pages?.find(p => p.id === state.activePageId) || activeNb?.pages?.[0] || null;
  if (activePage) state.activePageId = activePage.id;

  container.innerHTML = `
    <section class="card">
      <h2><i class="fa-solid fa-book"></i> Cuadernos Compartidos (Markdown, Listas, Checkboxes, Fotos)</h2>
      <form id="form-new-notebook" style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="margin:0; width:90px;">
          <label for="nb-icon">Ícono</label>
          <input type="text" id="nb-icon" name="icon" value="📓">
        </div>
        <div class="field" style="margin:0; flex:1;">
          <label for="nb-title">Título del nuevo cuaderno *</label>
          <input type="text" id="nb-title" name="title" placeholder="Ej: Recetario, Mudanza, Viajes, Películas" required>
        </div>
        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Crear Cuaderno</button>
      </form>

      <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-block-start:1rem;">
        ${notebooks
          .map(
            nb => `<button type="button" class="btn btn-sm ${activeNb && activeNb.id === nb.id ? 'btn-primary' : ''}" data-action="select-notebook" data-id="${nb.id}">
              ${escapeHtml(nb.icon)} ${escapeHtml(nb.title)} (${nb.pages.length})
            </button>`
          )
          .join('')}
      </div>
    </section>

    ${
      activeNb
        ? `<div class="grid-2">
            <section class="card">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-block-end:0.75rem;">
                <h3 style="margin:0;">${escapeHtml(activeNb.icon)} ${escapeHtml(activeNb.title)} — Páginas</h3>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-notebook" data-id="${activeNb.id}"><i class="fa-solid fa-trash-can"></i> Eliminar Cuaderno</button>
              </div>

              <div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-block-end:1rem;">
                ${activeNb.pages
                  .map(
                    p => `<button type="button" class="btn btn-sm ${activePage && activePage.id === p.id ? 'btn-primary' : ''}" data-action="select-page" data-id="${p.id}">
                      <i class="fa-solid fa-file-lines"></i> ${escapeHtml(p.title)}
                    </button>`
                  )
                  .join('')}
              </div>

              <form id="form-new-page" data-notebook-id="${activeNb.id}" style="display:flex; gap:0.5rem; margin-block-end:1rem;">
                <input type="text" name="title" placeholder="Nueva página..." aria-label="Título de nueva página" required>
                <button type="submit" class="btn btn-sm btn-primary"><i class="fa-solid fa-plus"></i> Página</button>
              </form>

              ${
                activePage
                  ? `<form id="form-save-page" data-page-id="${activePage.id}">
                      <div class="field">
                        <label for="page-title-edit">Título de la página</label>
                        <input type="text" id="page-title-edit" name="title" value="${escapeHtml(activePage.title)}" required>
                      </div>
                      <div class="field">
                        <label for="page-md-edit">Contenido Markdown (usa <code># Título</code>, <code>- [ ] tarea</code>, <code>**negrita**</code>, <code>![foto](url)</code>)</label>
                        <textarea id="page-md-edit" name="markdown_content" rows="10">${escapeHtml(activePage.markdown_content)}</textarea>
                      </div>
                      <div class="field">
                        <label for="page-photo-upload">Insertar foto en la página</label>
                        <input type="file" id="page-photo-upload" accept="image/*">
                      </div>
                      <div style="display:flex; gap:0.5rem;">
                        <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Página</button>
                        <button type="button" class="btn btn-danger" data-action="delete-page" data-id="${activePage.id}"><i class="fa-solid fa-trash-can"></i> Eliminar Página</button>
                      </div>
                    </form>`
                  : ''
              }
            </section>

            <section class="card">
              <h3><i class="fa-solid fa-eye"></i> Vista Previa Interactiva</h3>
              <div id="md-preview-box" class="markdown-preview" data-page-id="${activePage?.id || ''}">
                ${activePage ? renderMarkdown(activePage.markdown_content) : '<p class="text-muted">Selecciona o crea una página.</p>'}
              </div>
            </section>
          </div>`
        : ''
    }
  `;

  const photoInput = document.getElementById('page-photo-upload');
  if (photoInput) {
    photoInput.addEventListener('change', async () => {
      const url = await fileToUploadedUrl(photoInput);
      if (url) {
        const ta = document.getElementById('page-md-edit');
        ta.value += `\n![Foto](${url})\n`;
      }
    });
  }
}

export default {
  id: 'notebooks',
  render: renderNotebooksTab,
  actions: {
    'select-notebook': (ctx, el) => {
      state.activeNotebookId = Number(el.dataset.id);
      state.activePageId = null;
      ctx.refresh();
    },
    'select-page': (ctx, el) => {
      state.activePageId = Number(el.dataset.id);
      ctx.refresh();
    },
    'delete-notebook': async (ctx, el) => {
      await api(`/api/notebooks/${el.dataset.id}`, { method: 'DELETE' });
      state.activeNotebookId = null;
      ctx.refresh();
    },
    'delete-page': async (ctx, el) => {
      await api(`/api/pages/${el.dataset.id}`, { method: 'DELETE' });
      state.activePageId = null;
      ctx.refresh();
    }
  },
  forms: {
    'form-new-notebook': async (ctx, data) => {
      const res = await api('/api/notebooks', { method: 'POST', body: data });
      state.activeNotebookId = res.id;
      ctx.refresh();
    },
    'form-new-page': async (ctx, data, form) => {
      const res = await api(`/api/notebooks/${form.dataset.notebookId}/pages`, { method: 'POST', body: data });
      state.activePageId = res.id;
      ctx.refresh();
    },
    'form-save-page': async (ctx, data, form) => {
      await api(`/api/pages/${form.dataset.pageId}`, { method: 'PUT', body: data });
      ctx.showStatus('Página Markdown actualizada.');
      ctx.refresh();
    }
  },
  // selector CSS → handler del evento "change" (checkboxes interactivos del preview)
  changes: {
    '[data-md-line]': async (ctx, el) => {
      const lineIdx = Number(el.dataset.mdLine);
      const ta = document.getElementById('page-md-edit');
      const previewBox = document.getElementById('md-preview-box');
      if (!ta || !previewBox?.dataset.pageId) return;
      const lines = ta.value.split('\n');
      if (lines[lineIdx] === undefined) return;
      lines[lineIdx] = el.checked
        ? lines[lineIdx].replace(/^-\s+\[ \]/, '- [x]')
        : lines[lineIdx].replace(/^-\s+\[[xX]\]/, '- [ ]');
      ta.value = lines.join('\n');
      await api(`/api/pages/${previewBox.dataset.pageId}`, {
        method: 'PUT',
        body: { markdown_content: ta.value }
      });
    }
  }
};
