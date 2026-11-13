import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { filesToUploadedMedia } from '../core/upload.js';

let cachedPlans = [];
let activeFilter = 'all'; // 'all' | 'pending' | 'completed' | 'ai'
let searchTerm = '';
let editingMedia = []; // Copia mutable de medios del plan abierto en el modal

const MOODS = ['Romántica', 'Divertida', 'Inolvidable', 'Relajada', 'Aventura', 'Emotiva'];
const CATEGORIES = ['Cita', 'Comida', 'Aventura', 'Casa', 'Viaje', 'Cine / Series', 'Sorpresa', 'Otro'];

function attachLightDismissFallback(dialog) {
  if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;
  const outside = (e) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  let pressedOutside = false;
  dialog.addEventListener('pointerdown', (e) => { pressedOutside = outside(e); });
  dialog.addEventListener('pointerup', (e) => {
    if (pressedOutside && outside(e)) dialog.close();
  });
}

function renderStars(rating) {
  const n = Number(rating || 0);
  if (!n) return '<span class="text-muted">Sin calificar</span>';
  let html = '<span class="plan-stars" aria-label="Calificación ' + n + ' de 5">';
  for (let i = 1; i <= 5; i++) {
    html += `<i class="${i <= n ? 'fa-solid fa-star' : 'fa-regular fa-star'}" style="color:${i <= n ? '#f59e0b' : 'var(--muted)'};"></i>`;
  }
  html += ` <strong>${n}/5</strong></span>`;
  return html;
}

function renderEditingMediaPreview() {
  const box = document.getElementById('plan-existing-media');
  if (!box) return;
  if (editingMedia.length === 0) {
    box.innerHTML = '<p class="text-muted" style="font-size:0.85rem; margin:0;">No hay fotos ni videos adjuntos aún.</p>';
    return;
  }
  box.innerHTML = editingMedia
    .map((m, idx) => `
      <div class="plan-media-thumb">
        ${
          m.type === 'video'
            ? `<video src="${escapeHtml(m.url)}" controls preload="metadata" style="width:100%; height:110px; object-fit:cover; border-radius:0.4rem;"></video>`
            : `<img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.name || 'Recuerdo de cita')}" loading="lazy" style="width:100%; height:110px; object-fit:cover; border-radius:0.4rem;">`
        }
        <button type="button" class="btn btn-sm btn-danger plan-media-remove" data-action="remove-plan-media" data-idx="${idx}" title="Quitar archivo" aria-label="Quitar archivo">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    `)
    .join('');
}

function openPlanModal(plan = null) {
  const dialog = document.getElementById('dialog-plan-journal');
  const form = document.getElementById('form-plan-journal');
  const heading = document.getElementById('plan-dialog-title');
  if (!dialog || !form || !heading) return;

  form.reset();
  const isEdit = Boolean(plan);
  heading.innerHTML = isEdit
    ? '<i class="fa-solid fa-book-open" style="color:var(--brand);"></i> Journal y Detalles de la Cita'
    : '<i class="fa-solid fa-calendar-plus" style="color:var(--brand);"></i> Nuevo Plan o Cita';

  document.getElementById('plan-modal-id').value = isEdit ? String(plan.id) : '';
  document.getElementById('plan-modal-title').value = plan?.title || '';
  document.getElementById('plan-modal-category').value = plan?.category || 'Cita';
  document.getElementById('plan-modal-weather').value = plan?.weather || 'Cualquiera';
  document.getElementById('plan-modal-date').value = plan?.planned_date || '';
  document.getElementById('plan-modal-location').value = plan?.location || '';
  document.getElementById('plan-modal-planner').value = plan?.planned_by || state.user?.first_name || '';
  document.getElementById('plan-modal-mood').value = plan?.mood || '';
  document.getElementById('plan-modal-desc').value = plan?.description || '';
  document.getElementById('plan-modal-journal').value = plan?.journal_text || '';

  const statusVal = plan?.status === 'completed' ? 'completed' : 'pending';
  const statusRadio = form.querySelector(`input[name="status"][value="${statusVal}"]`);
  if (statusRadio) statusRadio.checked = true;

  const ratingVal = String(Number(plan?.rating || 0));
  const ratingRadio = form.querySelector(`input[name="rating"][value="${ratingVal}"]`);
  if (ratingRadio) ratingRadio.checked = true;

  editingMedia = Array.isArray(plan?.media) ? plan.media.map(m => ({ ...m })) : [];
  renderEditingMediaPreview();

  const fileInput = document.getElementById('plan-modal-files');
  if (fileInput) fileInput.value = '';

  dialog.returnValue = '';
  dialog.showModal();
}

function getFilteredPlans() {
  const q = searchTerm.trim().toLowerCase();
  return cachedPlans.filter(p => {
    if (activeFilter === 'pending' && p.status === 'completed') return false;
    if (activeFilter === 'completed' && p.status !== 'completed') return false;
    if (activeFilter === 'ai' && p.source !== 'ai') return false;
    if (q) {
      const hay = [p.title, p.category, p.location, p.planned_by, p.journal_text, p.mood, p.description]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderPlanCardsHtml(filtered) {
  if (filtered.length === 0) {
    return `<section class="card" style="grid-column: 1 / -1;"><p class="text-muted">No hay planes que coincidan con este filtro. ¡Crea un plan nuevo o pide sugerencias a la IA!</p></section>`;
  }
  return filtered
    .map(p => {
      const isDone = p.status === 'completed';
      const mediaList = Array.isArray(p.media) ? p.media : [];
      const sourceBadge =
        p.source === 'ai'
          ? '<span class="badge"><i class="fa-solid fa-robot"></i> IA</span>'
          : p.source === 'system'
            ? '<span class="badge"><i class="fa-solid fa-star"></i> Sistema</span>'
            : '<span class="badge"><i class="fa-solid fa-heart"></i> Pareja</span>';
      const statusBadge = isDone
        ? '<span class="badge badge-success"><i class="fa-solid fa-check"></i> Realizada</span>'
        : '<span class="badge"><i class="fa-regular fa-clock"></i> Pendiente</span>';

      return `
        <article class="card ${p.selected_for_week ? 'roulette-item-active' : ''}" style="display:flex; flex-direction:column; gap:0.65rem;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
            <div>
              <div style="display:flex; gap:0.35rem; flex-wrap:wrap; margin-bottom:0.35rem;">
                ${sourceBadge}
                ${statusBadge}
                <span class="badge">${escapeHtml(p.category || 'Cita')}</span>
                ${p.selected_for_week ? '<span class="badge badge-brand"><i class="fa-solid fa-star"></i> Plan de la Semana</span>' : ''}
                ${p.mood ? `<span class="badge"><i class="fa-regular fa-face-smile"></i> ${escapeHtml(p.mood)}</span>` : ''}
              </div>
              <h3 style="margin:0;">${escapeHtml(p.title)}</h3>
            </div>
            <div style="display:flex; gap:0.3rem; flex-shrink:0;">
              <button type="button" class="btn btn-sm" data-action="select-week-plan" data-id="${p.id}" title="Elegir como plan de esta semana"><i class="fa-regular fa-star"></i></button>
              <button type="button" class="btn btn-sm btn-primary" data-action="edit-plan-journal" data-id="${p.id}" title="Abrir Journal / Editar cita"><i class="fa-solid fa-book-open"></i></button>
              ${p.couple_id ? `<button type="button" class="btn btn-sm btn-danger" data-action="delete-plan" data-id="${p.id}" title="Eliminar plan"><i class="fa-solid fa-trash-can"></i></button>` : ''}
            </div>
          </div>

          <div style="display:flex; flex-wrap:wrap; gap:0.75rem; font-size:0.86rem; color:var(--muted);">
            ${p.planned_date ? `<span><i class="fa-regular fa-calendar"></i> <strong>${escapeHtml(p.planned_date)}</strong></span>` : ''}
            ${p.location ? `<span><i class="fa-solid fa-location-dot"></i> ${escapeHtml(p.location)}</span>` : ''}
            ${p.planned_by ? `<span><i class="fa-solid fa-user-pen"></i> Planeó: <strong>${escapeHtml(p.planned_by)}</strong></span>` : ''}
            ${p.weather ? `<span><i class="fa-solid fa-cloud-sun"></i> ${escapeHtml(p.weather)}</span>` : ''}
          </div>

          ${p.rating > 0 ? `<div>${renderStars(p.rating)}</div>` : ''}

          ${p.description ? `<p class="text-muted" style="margin:0; font-size:0.9rem;">${escapeHtml(p.description)}</p>` : ''}

          ${
            p.journal_text
              ? `<div class="stat-box" style="padding:0.65rem 0.8rem; background:var(--surface-2, var(--bg));">
                  <div style="font-size:0.78rem; font-weight:700; color:var(--brand); margin-bottom:0.25rem;"><i class="fa-solid fa-feather-pointed"></i> Cómo fue (Journal):</div>
                  <p style="margin:0; white-space:pre-wrap; font-size:0.92rem;">${escapeHtml(p.journal_text)}</p>
                </div>`
              : ''
          }

          ${
            mediaList.length > 0
              ? `<div class="plan-media-grid">
                  ${mediaList
                    .map(m =>
                      m.type === 'video'
                        ? `<video src="${escapeHtml(m.url)}" controls preload="metadata" class="plan-media-item"></video>`
                        : `<a href="${escapeHtml(m.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(m.url)}" alt="${escapeHtml(m.name || p.title)}" loading="lazy" class="plan-media-item"></a>`
                    )
                    .join('')}
                </div>`
              : ''
          }

          <div style="margin-top:auto; padding-top:0.35rem;">
            <button type="button" class="btn btn-sm" data-action="edit-plan-journal" data-id="${p.id}">
              <i class="fa-solid fa-pen-to-square"></i> ${p.journal_text || isDone ? 'Editar Journal y Recuerdos' : 'Registrar Cita / Escribir Cómo Fue'}
            </button>
          </div>
        </article>`;
    })
    .join('');
}

async function renderPlansTab(container) {
  const { plans } = await api('/api/plans');
  cachedPlans = plans || [];

  const selectedPlan = cachedPlans.find(p => p.selected_for_week);
  const completedPlans = cachedPlans.filter(p => p.status === 'completed');
  const ratedPlans = completedPlans.filter(p => Number(p.rating) > 0);
  const avgRating = ratedPlans.length
    ? (ratedPlans.reduce((sum, p) => sum + Number(p.rating), 0) / ratedPlans.length).toFixed(1)
    : '—';
  const totalMedia = cachedPlans.reduce((sum, p) => sum + (Array.isArray(p.media) ? p.media.length : 0), 0);

  const meName = state.user?.first_name || 'Yo';
  const partnerName = state.partner?.first_name || 'Mi pareja';
  const filtered = getFilteredPlans();

  container.innerHTML = `
    <!-- Cabecera y Plan Elegido de la Semana -->
    <section class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; margin-bottom:1rem;">
        <div>
          <h2 style="margin:0;"><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--brand);"></i> Planes, Citas y Journaling</h2>
          <p class="text-muted" style="margin:0.2rem 0 0 0;">Planifiquen sus citas con ayuda de IA y guarden recuerdos con fotos, videos, fechas y calificaciones.</p>
        </div>
        <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" data-action="open-new-plan"><i class="fa-solid fa-plus"></i> Nuevo Plan / Cita</button>
          <button type="button" class="btn" data-action="generate-ai-plans"><i class="fa-solid fa-robot"></i> Proponer con IA</button>
        </div>
      </div>

      <div class="grid-3" style="margin-bottom:1rem;">
        <div class="stat-box span-2-desktop" style="border-color:var(--brand);">
          <div class="text-muted">Plan destacado de la semana:</div>
          <div class="stat-value" style="font-size:1.2rem; margin:0.25rem 0;">
            ${
              selectedPlan
                ? `<i class="fa-solid fa-star" style="color:#f59e0b;"></i> ${escapeHtml(selectedPlan.title)} <small class="text-muted">(${escapeHtml(selectedPlan.category)}${selectedPlan.location ? ' · ' + escapeHtml(selectedPlan.location) : ''})</small>`
                : 'Aún no eligieron el plan de esta semana'
            }
          </div>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.5rem;">
            <button type="button" class="btn btn-sm btn-primary" data-action="pick-random-plan"><i class="fa-solid fa-dice"></i> Sortear Plan Aleatorio</button>
            ${
              selectedPlan
                ? `<button type="button" class="btn btn-sm" data-action="edit-plan-journal" data-id="${selectedPlan.id}"><i class="fa-solid fa-pen-to-square"></i> Escribir Journal de esta Cita</button>`
                : ''
            }
          </div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Resumen del Journal</div>
          <div style="display:flex; flex-direction:column; gap:0.2rem; margin-top:0.35rem; font-size:0.92rem;">
            <span><i class="fa-solid fa-circle-check" style="color:var(--success);"></i> <strong>${completedPlans.length}</strong> citas realizadas</span>
            <span><i class="fa-solid fa-star" style="color:#f59e0b;"></i> Promedio: <strong>${avgRating}</strong></span>
            <span><i class="fa-solid fa-photo-film" style="color:var(--brand);"></i> <strong>${totalMedia}</strong> fotos/videos</span>
          </div>
        </div>
      </div>

      <!-- Barra de búsqueda y filtros -->
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem; padding-top:0.75rem; border-top:1px solid var(--border);">
        <div style="display:flex; gap:0.4rem; flex-wrap:wrap;" role="group" aria-label="Filtrar planes">
          <button type="button" class="btn btn-sm ${activeFilter === 'all' ? 'btn-primary' : ''}" data-action="filter-plans" data-filter="all">Todos (${cachedPlans.length})</button>
          <button type="button" class="btn btn-sm ${activeFilter === 'pending' ? 'btn-primary' : ''}" data-action="filter-plans" data-filter="pending"><i class="fa-regular fa-clock"></i> Pendientes (${cachedPlans.length - completedPlans.length})</button>
          <button type="button" class="btn btn-sm ${activeFilter === 'completed' ? 'btn-primary' : ''}" data-action="filter-plans" data-filter="completed"><i class="fa-solid fa-book-open"></i> Realizados / Journal (${completedPlans.length})</button>
          <button type="button" class="btn btn-sm ${activeFilter === 'ai' ? 'btn-primary' : ''}" data-action="filter-plans" data-filter="ai"><i class="fa-solid fa-robot"></i> Propuestos IA</button>
        </div>
        <search>
          <input type="search" id="plans-search-input" value="${escapeHtml(searchTerm)}" placeholder="Buscar por título, lugar, persona..." aria-label="Buscar planes y citas" style="min-width:220px;">
        </search>
      </div>
    </section>

    <!-- Listado de Planes y Entradas de Journaling -->
    <div id="plans-cards-grid" class="grid-2">
      ${renderPlanCardsHtml(filtered)}
    </div>

    <!-- Modal Nativo: Crear Plan / Escribir Journal de Cita -->
    <dialog id="dialog-plan-journal" aria-labelledby="plan-dialog-title" closedby="any" style="max-inline-size: min(760px, 95vw);">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem; margin-bottom:0.75rem;">
        <h2 id="plan-dialog-title" style="margin:0;">Plan y Journal de Cita</h2>
        <button type="button" class="btn btn-sm" data-action="close-plan-modal" aria-label="Cerrar"><i class="fa-solid fa-xmark"></i></button>
      </div>

      <form id="form-plan-journal">
        <input type="hidden" id="plan-modal-id" name="id">

        <div class="grid-2">
          <div class="field">
            <label for="plan-modal-title">Título del plan o cita *</label>
            <input type="text" id="plan-modal-title" name="title" placeholder="Ej: Picnic al atardecer en el parque" required autofocus>
          </div>
          <div class="field">
            <label for="plan-modal-date">Fecha de la cita</label>
            <input type="date" id="plan-modal-date" name="planned_date">
          </div>
        </div>

        <div class="grid-3">
          <div class="field">
            <label for="plan-modal-category">Categoría</label>
            <select id="plan-modal-category" name="category">
              ${CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="plan-modal-location">¿Dónde fue / Lugar?</label>
            <input type="text" id="plan-modal-location" name="location" placeholder="Ej: Palermo, Casa, Café...">
          </div>
          <div class="field">
            <label for="plan-modal-planner">¿Quién la planeó?</label>
            <input type="text" id="plan-modal-planner" name="planned_by" list="plan-planners-list" placeholder="Nombre o Ambos">
            <datalist id="plan-planners-list">
              <option value="${escapeHtml(meName)}">
              <option value="${escapeHtml(partnerName)}">
              <option value="Ambos">
              <option value="SpiderIA">
            </datalist>
          </div>
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="plan-modal-weather">Clima ideal</label>
            <input type="text" id="plan-modal-weather" name="weather" placeholder="Cualquiera, Soleado, Lluvia...">
          </div>
          <div class="field">
            <label for="plan-modal-mood">¿Cómo estuvo? (Vibra)</label>
            <select id="plan-modal-mood" name="mood">
              <option value="">Elegir vibra...</option>
              ${MOODS.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="grid-2">
          <fieldset style="border:1px solid var(--border); border-radius:0.5rem; padding:0.65rem 0.85rem; margin:0 0 0.85rem 0;">
            <legend style="font-size:0.85rem; font-weight:700; padding:0 0.35rem;">Estado de la cita</legend>
            <div style="display:flex; gap:1rem; flex-wrap:wrap;">
              <label style="display:inline-flex; align-items:center; gap:0.35rem; font-weight:500;">
                <input type="radio" name="status" value="pending" checked> Pendiente / Por hacer
              </label>
              <label style="display:inline-flex; align-items:center; gap:0.35rem; font-weight:500;">
                <input type="radio" name="status" value="completed"> Realizada (Journal)
              </label>
            </div>
          </fieldset>

          <fieldset style="border:1px solid var(--border); border-radius:0.5rem; padding:0.65rem 0.85rem; margin:0 0 0.85rem 0;">
            <legend style="font-size:0.85rem; font-weight:700; padding:0 0.35rem;">Calificación de la cita</legend>
            <div style="display:flex; gap:0.75rem; flex-wrap:wrap;">
              <label style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;">
                <input type="radio" name="rating" value="0" checked> N/A
              </label>
              ${[1, 2, 3, 4, 5]
                .map(
                  n => `<label style="display:inline-flex; align-items:center; gap:0.25rem; font-weight:500;">
                    <input type="radio" name="rating" value="${n}"> ${n}★
                  </label>`
                )
                .join('')}
            </div>
          </fieldset>
        </div>

        <div class="field">
          <label for="plan-modal-desc">Idea o detalles previos</label>
          <input type="text" id="plan-modal-desc" name="description" placeholder="Qué llevar, horario o detalles antes de ir...">
        </div>

        <div class="field">
          <label for="plan-modal-journal"><i class="fa-solid fa-feather-pointed"></i> Journal: ¿Cómo fue la cita?</label>
          <textarea id="plan-modal-journal" name="journal_text" rows="4" placeholder="Escribe lo que hicieron, lo que más les gustó, anécdotas o cómo se sintieron..."></textarea>
        </div>

        <div class="field">
          <label for="plan-modal-files"><i class="fa-solid fa-photo-film"></i> Subir fotos o videos de la cita (puedes elegir varios)</label>
          <input type="file" id="plan-modal-files" accept="image/*,video/*" multiple>
          <span class="text-muted" style="font-size:0.78rem;">Se guardan en la galería de la cita y se respaldan en la nube.</span>
        </div>

        <div id="plan-existing-media" class="plan-existing-media-list" style="margin-bottom:1rem;"></div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1rem;">
          <button type="button" class="btn" data-action="close-plan-modal">Cancelar</button>
          <button type="submit" id="btn-save-plan-journal" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Plan y Journal</button>
        </div>
      </form>
    </dialog>
  `;

  attachLightDismissFallback(document.getElementById('dialog-plan-journal'));

  const searchInput = document.getElementById('plans-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      const grid = document.getElementById('plans-cards-grid');
      if (grid) grid.innerHTML = renderPlanCardsHtml(getFilteredPlans());
    });
  }
}

export default {
  id: 'plans',
  render: renderPlansTab,
  actions: {
    'open-new-plan': () => {
      openPlanModal(null);
    },
    'edit-plan-journal': (_ctx, el) => {
      const id = Number(el.dataset.id);
      const target = cachedPlans.find(p => p.id === id);
      if (target) openPlanModal(target);
    },
    'close-plan-modal': () => {
      const dialog = document.getElementById('dialog-plan-journal');
      if (dialog?.open) dialog.close();
    },
    'remove-plan-media': (_ctx, el) => {
      const idx = Number(el.dataset.idx);
      if (!Number.isNaN(idx)) {
        editingMedia.splice(idx, 1);
        renderEditingMediaPreview();
      }
    },
    'filter-plans': (ctx, el) => {
      activeFilter = el.dataset.filter || 'all';
      ctx.refresh();
    },
    'pick-random-plan': async (ctx) => {
      const res = await api('/api/plans/random', { method: 'POST' });
      ctx.showStatus(`Plan elegido para la semana: ${res.chosen.title}`);
      ctx.refresh();
    },
    'select-week-plan': async (ctx, el) => {
      const res = await api(`/api/plans/${el.dataset.id}/select`, { method: 'POST' });
      ctx.showStatus(`Elegido para la semana: ${res.chosen.title}`);
      ctx.refresh();
    },
    'generate-ai-plans': async (ctx) => {
      ctx.showStatus('Generando planes personalizados con IA...');
      const res = await api('/api/plans/ai', { method: 'POST' });
      ctx.showStatus(`Se añadieron ${res.plans.length} planes propuestos por ${res.provider}.`);
      ctx.refresh();
    },
    'delete-plan': async (ctx, el) => {
      await api(`/api/plans/${el.dataset.id}`, { method: 'DELETE' });
      ctx.showStatus('Plan eliminado.');
      ctx.refresh();
    }
  },
  forms: {
    'form-plan-journal': async (ctx, data) => {
      const submitBtn = document.getElementById('btn-save-plan-journal');
      if (submitBtn) submitBtn.disabled = true;
      try {
        const fileInput = document.getElementById('plan-modal-files');
        let newlyUploaded = [];
        if (fileInput?.files?.length) {
          ctx.showStatus(`Subiendo ${fileInput.files.length} archivo(s) multimedia...`);
          newlyUploaded = await filesToUploadedMedia(fileInput);
        }

        const finalMedia = [...editingMedia, ...newlyUploaded];
        const payload = {
          title: data.title,
          category: data.category,
          weather: data.weather,
          planned_date: data.planned_date,
          location: data.location,
          planned_by: data.planned_by,
          mood: data.mood,
          status: data.status || 'pending',
          rating: Number(data.rating || 0),
          description: data.description,
          journal_text: data.journal_text,
          media: finalMedia
        };

        const planId = Number(data.id);
        if (planId) {
          await api(`/api/plans/${planId}`, { method: 'PUT', body: payload });
          ctx.showStatus('Journal y detalles de la cita guardados.');
        } else {
          await api('/api/plans', { method: 'POST', body: payload });
          ctx.showStatus('Nuevo plan/cita guardado.');
        }

        const dialog = document.getElementById('dialog-plan-journal');
        if (dialog?.open) dialog.close();
        ctx.refresh();
      } finally {
        if (submitBtn) submitBtn.disabled = false;
      }
    }
  }
};
