import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

/* ================= HERRAMIENTAS: METAS / PROYECTOS (MONETARIA, RUTINA, TIEMPO) ================= */
async function renderGoalsTab(container) {
  const { goals } = await api('/api/goals');

  container.innerHTML = `
    <section class="card">
      <h2><i class="fa-solid fa-bullseye"></i> Metas y Proyectos en Pareja</h2>
      <p class="text-muted">Crea metas <strong>Monetarias</strong> (ej. ahorro para casa), de <strong>Progreso/Hábito</strong> (ej. rutina de gym diaria/semanal/mensual/anual) o de <strong>Tiempo</strong> (cuenta regresiva con días, horas, minutos y segundos).</p>
      <form id="form-new-goal">
        <div class="grid-3">
          <div class="field">
            <label for="goal-title">Título del proyecto / meta *</label>
            <input type="text" id="goal-title" name="title" placeholder="Ej: Dinero para una casa / Rutina de Gym / Viaje" required>
          </div>
          <div class="field">
            <label for="goal-type">Tipo de meta *</label>
            <select id="goal-type" name="goal_type" required>
              <option value="monetary">Monetaria (ej: ahorro para casa)</option>
              <option value="habit">Progreso / Rutina (diaria, semanal, mensual, anual)</option>
              <option value="time">De Tiempo (Cuenta regresiva a fecha)</option>
            </select>
          </div>
          <div class="field">
            <label for="goal-target">Meta numérica (Monto $ o Cantidad de cumplimientos)</label>
            <input type="number" id="goal-target" name="target_value" step="0.01" value="100">
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="goal-freq">Frecuencia (para metas de rutina)</label>
            <select id="goal-freq" name="frequency">
              <option value="diaria">Diaria</option>
              <option value="semanal">Semanal</option>
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </select>
          </div>
          <div class="field">
            <label for="goal-date">Fecha objetivo (para metas de tiempo)</label>
            <input type="datetime-local" id="goal-date" name="target_date">
          </div>
          <div class="field">
            <label for="goal-desc">Descripción</label>
            <input type="text" id="goal-desc" name="description" placeholder="Detalles de nuestra meta">
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Crear Meta / Proyecto</button>
      </form>
    </section>

    <div class="grid-2">
      ${goals
        .map(g => {
          const pct =
            g.finished
              ? 100
              : g.goal_type === 'time'
              ? computeTimeProgressPct(g.created_at, g.target_date)
              : Math.min(100, Math.round((Number(g.current_value || 0) / Math.max(1, Number(g.target_value || 1))) * 100));

          return `<section class="card">
            <div style="display:flex; justify-content:space-between; align-items:start; gap:0.5rem;">
              <div>
                <span class="badge">${g.goal_type === 'monetary' ? '<i class="fa-solid fa-wallet"></i> Monetaria' : g.goal_type === 'habit' ? `<i class="fa-solid fa-dumbbell"></i> Rutina (${escapeHtml(g.frequency)})` : '<i class="fa-solid fa-stopwatch"></i> Cuenta Regresiva'}</span>
                ${g.finished ? '<span class="badge" style="background:var(--ok); color:#000;"><i class="fa-solid fa-check"></i> FINALIZADO</span>' : ''}
                <h3 style="margin:0.35rem 0;">${escapeHtml(g.title)}</h3>
                <div class="text-muted">Creado por ${escapeHtml(g.creator_name || '')} · Inicio: ${escapeHtml(g.created_at.slice(0, 10))}</div>
              </div>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-goal" data-id="${g.id}" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
            </div>

            ${g.description ? `<p>${escapeHtml(g.description)}</p>` : ''}

            <div class="progress-track" style="margin-block:0.75rem;">
              <div class="progress-fill" style="width:${pct}%;"></div>
            </div>

            ${
              g.goal_type === 'monetary'
                ? `<p>Ahorrado: <strong>${formatMoney(g.current_value)}</strong> de <strong>${formatMoney(g.target_value)}</strong> (${pct}%)</p>
                   ${
                     !g.finished
                       ? `<div style="display:flex; gap:0.4rem; align-items:center; flex-wrap:wrap;">
                            <input type="number" id="goal-add-${g.id}" placeholder="Monto a sumar" step="0.01" style="width:160px; min-height:38px;">
                            <button type="button" class="btn btn-sm btn-primary" data-action="progress-goal" data-id="${g.id}"><i class="fa-solid fa-plus"></i> Sumar Aporte</button>
                            <button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}"><i class="fa-solid fa-flag-checkered"></i> Finalizado en el acto</button>
                          </div>`
                       : ''
                   }`
                : g.goal_type === 'habit'
                ? `<p>Progreso acumulado: <strong>${g.current_value} / ${g.target_value}</strong> cumplimientos (${escapeHtml(g.frequency)}) — ${pct}%</p>
                   ${
                     !g.finished
                       ? `<div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                            <button type="button" class="btn btn-sm btn-primary" data-action="progress-goal" data-id="${g.id}" data-delta="1"><i class="fa-solid fa-check"></i> Cumplí hoy (${escapeHtml(g.frequency)})</button>
                            <button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}"><i class="fa-solid fa-flag-checkered"></i> Finalizado en el acto</button>
                          </div>`
                       : ''
                   }`
                : `<div class="stat-box" style="margin-block:0.5rem;">
                     <div class="text-muted">Tiempo restante hasta ${escapeHtml((g.target_date || '').replace('T', ' '))}:</div>
                     <div class="stat-value" data-countdown-target="${escapeHtml(g.target_date)}" data-finished="${g.finished}">Calculando...</div>
                   </div>
                   ${
                     !g.finished
                       ? `<button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}"><i class="fa-solid fa-flag-checkered"></i> Finalizado en el acto</button>`
                       : ''
                   }`
            }
          </section>`;
        })
        .join('')}
    </div>
  `;

  const updateTickers = () => {
    document.querySelectorAll('[data-countdown-target]').forEach(el => {
      if (el.dataset.finished === '1') {
        el.innerHTML = '<i class="fa-solid fa-trophy" style="color:#f59e0b;"></i> ¡Proyecto Finalizado!';
        return;
      }
      const targetMs = new Date(el.dataset.countdownTarget).getTime();
      if (!Number.isFinite(targetMs)) {
        el.textContent = 'Sin fecha configurada';
        return;
      }
      const diff = Math.max(0, targetMs - Date.now());
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      el.textContent = `${days}d ${hours}h ${mins}m ${secs}s`;
    });
  };
  updateTickers();
  state.countdownTimer = setInterval(updateTickers, 1000);
}

function computeTimeProgressPct(createdAt, targetDate) {
  const start = new Date(createdAt).getTime();
  const end = new Date(targetDate).getTime();
  const now = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 50;
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

export default {
  id: 'goals',
  render: renderGoalsTab,
  unmount() {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  },
  actions: {
    'progress-goal': async (ctx, el) => {
      const id = el.dataset.id;
      const input = document.getElementById(`goal-add-${id}`);
      const delta = input ? Number(input.value || 0) : Number(el.dataset.delta || 1);
      await api(`/api/goals/${id}/progress`, { method: 'POST', body: { delta } });
      ctx.refresh();
    },
    'finish-goal': async (ctx, el) => {
      await api(`/api/goals/${el.dataset.id}/finish`, { method: 'POST' });
      ctx.showStatus('¡Proyecto marcado como Finalizado!');
      ctx.refresh();
    },
    'delete-goal': async (ctx, el) => {
      await api(`/api/goals/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    }
  },
  forms: {
    'form-new-goal': async (ctx, data) => {
      await api('/api/goals', { method: 'POST', body: data });
      ctx.showStatus('Meta / proyecto creado.');
      ctx.refresh();
    }
  }
};
