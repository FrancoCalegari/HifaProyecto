import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= CALENDARIO Y RECORDATORIOS ================= */
async function renderCalendarTab(container) {
  const { events } = await api('/api/calendar');

  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2><i class="fa-solid fa-calendar-days"></i> Agendar Día y Hora Juntos</h2>
        <form id="form-new-event">
          <div class="field">
            <label for="ev-title">Título del evento / cita *</label>
            <input type="text" id="ev-title" name="title" placeholder="Ej: Aniversario, Turno médico, Cena romántica" required>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="ev-start">Inicio (Fecha y Hora) *</label>
              <input type="datetime-local" id="ev-start" name="start_datetime" required>
            </div>
            <div class="field">
              <label for="ev-end">Fin (Opcional)</label>
              <input type="datetime-local" id="ev-end" name="end_datetime">
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="ev-rem-val">Recordar con anticipación de</label>
              <input type="number" id="ev-rem-val" name="remind_offset_value" value="30" min="1" required>
            </div>
            <div class="field">
              <label for="ev-rem-unit">Unidad de recordatorio</label>
              <select id="ev-rem-unit" name="remind_offset_unit">
                <option value="minutes">Minutos antes</option>
                <option value="hours">Horas antes</option>
                <option value="days">Días antes</option>
                <option value="weeks">Semanas antes</option>
                <option value="months">Meses antes</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label for="ev-desc">Notas o lugar</label>
            <textarea id="ev-desc" name="description" rows="2"></textarea>
          </div>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-plus"></i> Agendar en Calendario</button>
            <button type="button" class="btn" data-action="enable-browser-notif"><i class="fa-solid fa-bell"></i> Activar Avisos del Navegador</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2><i class="fa-solid fa-calendar-check"></i> Próximos Eventos en Agenda (${events.length})</h2>
        ${
          events.length === 0
            ? '<p class="text-muted">No hay eventos agendados todavía.</p>'
            : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.75rem;">
                ${events
                  .map(
                    ev => `<li class="stat-box">
                      <div style="display:flex; justify-content:space-between; align-items:start;">
                        <div>
                          <strong>${escapeHtml(ev.title)}</strong>
                          <div class="text-muted"><i class="fa-regular fa-clock"></i> ${escapeHtml(ev.start_datetime.replace('T', ' '))} ${ev.end_datetime ? `→ ${escapeHtml(ev.end_datetime.replace('T', ' '))}` : ''}</div>
                          <span class="badge"><i class="fa-solid fa-bell"></i> Recordatorio: ${ev.remind_offset_value} ${escapeHtml(ev.remind_offset_unit)} antes</span>
                          ${ev.description ? `<p style="margin:0.4rem 0 0 0;">${escapeHtml(ev.description)}</p>` : ''}
                        </div>
                        <button type="button" class="btn btn-sm btn-danger" data-action="delete-event" data-id="${ev.id}"><i class="fa-solid fa-xmark"></i></button>
                      </div>
                    </li>`
                  )
                  .join('')}
              </ul>`
        }
      </section>
    </div>
  `;
}

export default {
  id: 'calendar',
  render: renderCalendarTab,
  actions: {
    'delete-event': async (ctx, el) => {
      await api(`/api/calendar/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'enable-browser-notif': async (ctx) => {
      if ('Notification' in window) {
        const perm = await Notification.requestPermission();
        ctx.showStatus(`Permiso de notificaciones: ${perm}`);
      }
    }
  },
  forms: {
    'form-new-event': async (ctx, data) => {
      await api('/api/calendar', { method: 'POST', body: data });
      ctx.showStatus('Evento agendado con recordatorio.');
      ctx.refresh();
    }
  }
};
