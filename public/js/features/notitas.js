import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';

/* ================= HERRAMIENTAS: "NOTITAS" (CANVAS + SOBRESCRITURA) Y NOTAS CON FOTOS ================= */
async function renderNotitasTab(container) {
  const [{ notitas }, { notes }] = await Promise.all([api('/api/notitas'), api('/api/notes')]);
  const myNotita = notitas.find(n => n.author_user_id === state.user.id);
  const partnerNotita = notitas.find(n => n.author_user_id !== state.user.id);

  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2><i class="fa-solid fa-note-sticky"></i> "Notitas" en Pareja (En vivo)</h2>
        <p class="text-muted">Al enviar una notita o dibujo nuevo, <strong>sobrescribe la anterior</strong> y le envía una notificación de <em>"Nota nueva"</em> a tu pareja.</p>

        <div class="grid-2" style="margin-block-end:1rem;">
          <div class="stat-box">
            <h3>De tu pareja para vos</h3>
            ${
              partnerNotita
                ? `<p><strong>${escapeHtml(partnerNotita.first_name)}:</strong> ${escapeHtml(partnerNotita.text_content || '')}</p>
                   ${partnerNotita.drawing_data_url ? `<img src="${escapeHtml(partnerNotita.drawing_data_url)}" alt="Dibujo de tu pareja" style="max-width:100%; border-radius:0.5rem; background:#fff;">` : ''}
                   <div class="text-muted" style="margin-top:0.35rem;">Actualizado: ${escapeHtml(partnerNotita.updated_at)}</div>`
                : '<p class="text-muted">Tu pareja aún no dejó una notita.</p>'
            }
          </div>
          <div class="stat-box">
            <h3>Tu notita actual visible</h3>
            ${
              myNotita
                ? `<p>${escapeHtml(myNotita.text_content || '')}</p>
                   ${myNotita.drawing_data_url ? `<img src="${escapeHtml(myNotita.drawing_data_url)}" alt="Mi dibujo actual" style="max-width:100%; border-radius:0.5rem; background:#fff;">` : ''}
                   <div class="text-muted" style="margin-top:0.35rem;">Actualizado: ${escapeHtml(myNotita.updated_at)}</div>`
                : '<p class="text-muted">Todavía no enviaste una notita.</p>'
            }
          </div>
        </div>

        <form id="form-notita">
          <div class="field">
            <label for="notita-text">Mensaje corto / comentario</label>
            <input type="text" id="notita-text" name="text_content" placeholder="Ej: ¡Que tengas un hermoso día mi amor! ☕❤️" value="${escapeHtml(myNotita?.text_content || '')}">
          </div>
          <div class="field">
            <label for="notita-color">Dibujo rápido para tu pareja (opcional)</label>
            <div style="display:flex; gap:0.5rem; align-items:center; margin-block-end:0.4rem;">
              <input type="color" id="notita-color" value="#e11d48" aria-label="Color del pincel">
              <button type="button" class="btn btn-sm" id="btn-clear-canvas">Limpiar Dibujo</button>
            </div>
            <canvas id="notita-canvas" class="draw-canvas" width="380" height="200"></canvas>
          </div>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> Enviar "Nota Nueva" (Sobrescribir anterior)</button>
        </form>
      </section>

      <section class="card">
        <h2><i class="fa-solid fa-camera"></i> Notas Compartidas (con Fotos)</h2>
        <form id="form-shared-note" style="margin-block-end:1.25rem;">
          <div class="field">
            <label for="note-title">Título de la nota *</label>
            <input type="text" id="note-title" name="title" placeholder="Ej: Receta de nuestra salsa, Datos del depto" required>
          </div>
          <div class="field">
            <label for="note-content">Contenido</label>
            <textarea id="note-content" name="content" rows="3"></textarea>
          </div>
          <div class="field">
            <label for="note-photo">Foto adjunta (opcional)</label>
            <input type="file" id="note-photo" accept="image/*">
          </div>
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Nota Compartida</button>
        </form>

        <div style="display:flex; flex-direction:column; gap:0.75rem;">
          ${
            notes.length === 0
              ? '<p class="text-muted">No hay notas compartidas aún.</p>'
              : notes
                  .map(
                    n => `<article class="stat-box">
                      <div style="display:flex; justify-content:space-between; align-items:start;">
                        <strong>${escapeHtml(n.title)}</strong>
                        <button type="button" class="btn btn-sm btn-danger" data-action="delete-note" data-id="${n.id}" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
                      </div>
                      <p style="margin:0.4rem 0;">${escapeHtml(n.content)}</p>
                      ${n.photo_url ? `<img src="${escapeHtml(n.photo_url)}" alt="${escapeHtml(n.title)}" loading="lazy" width="320" height="200" style="max-width:100%; height:auto; border-radius:0.5rem;">` : ''}
                      <div class="text-muted">Por ${escapeHtml(n.author_name || '')} · ${escapeHtml(n.created_at)}</div>
                    </article>`
                  )
                  .join('')
          }
        </div>
      </section>
    </div>
  `;
}

// Estado del canvas de dibujo (reemplaza el hack canvas._hasDrawn)
let hasDrawn = false;
let stopDrawing = null;

function initDrawingCanvas() {
  const canvas = document.getElementById('notita-canvas');
  if (!canvas) return;
  const c2d = canvas.getContext('2d');
  c2d.lineWidth = 4;
  c2d.lineCap = 'round';
  let drawing = false;
  hasDrawn = false;

  const getPos = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height
    };
  };

  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture?.(e.pointerId);
    drawing = true;
    hasDrawn = true;
    c2d.strokeStyle = document.getElementById('notita-color')?.value || '#e11d48';
    const p = getPos(e);
    c2d.beginPath();
    c2d.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = getPos(e);
    c2d.lineTo(p.x, p.y);
    c2d.stroke();
  });

  const onUp = () => { drawing = false; };
  window.addEventListener('pointerup', onUp);
  stopDrawing = () => window.removeEventListener('pointerup', onUp);

  document.getElementById('btn-clear-canvas')?.addEventListener('click', () => {
    c2d.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  });
}

export default {
  id: 'notitas',
  render: renderNotitasTab,
  onMount: initDrawingCanvas,
  unmount() {
    stopDrawing?.();
    stopDrawing = null;
  },
  actions: {
    'delete-note': async (ctx, el) => {
      await api(`/api/notes/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-notita': async (ctx, data) => {
      const canvas = document.getElementById('notita-canvas');
      const drawingDataUrl = canvas && hasDrawn ? canvas.toDataURL('image/png') : '';
      await api('/api/notitas', {
        method: 'POST',
        body: { text_content: data.text_content, drawing_data_url: drawingDataUrl }
      });
      ctx.showStatus('Notita enviada (se sobrescribió la anterior y se notificó a tu pareja).');
      ctx.refresh();
    },
    'form-shared-note': async (ctx, data) => {
      const photoUrl = await fileToUploadedUrl(document.getElementById('note-photo'));
      await api('/api/notes', { method: 'POST', body: { ...data, photo_url: photoUrl } });
      ctx.showStatus('Nota compartida guardada.');
      ctx.refresh();
    }
  }
};
