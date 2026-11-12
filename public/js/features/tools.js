import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= HERRAMIENTAS: RULETA, PLANES SEMANALES + IA Y CICLO MENSTRUAL ================= */
async function renderToolsTab(container) {
  const [{ roulettes }, { plans }, { menstrual }] = await Promise.all([
    api('/api/roulettes'),
    api('/api/plans'),
    api('/api/menstrual')
  ]);
  const selectedPlan = plans.find(p => p.selected_for_week);

  container.innerHTML = `
    <div class="grid-2">
      <!-- Ruleta -->
      <section class="card">
        <h2>🎡 Ruletas Personalizables para Tomar Decisiones</h2>
        <div id="roulette-wheel-box" class="roulette-wheel">¡Elige una ruleta y gira!</div>

        <div style="display:flex; flex-direction:column; gap:0.6rem; margin-block-end:1rem;">
          ${roulettes
            .map(
              r => `<div class="stat-box" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                <div>
                  <strong>${escapeHtml(r.name)}</strong>
                  <div class="text-muted">${r.options.map(escapeHtml).join(' · ')}</div>
                </div>
                <div style="display:flex; gap:0.4rem;">
                  <button type="button" class="btn btn-sm btn-primary" data-action="spin-roulette" data-options="${escapeHtml(JSON.stringify(r.options))}">🎲 Girar</button>
                  <button type="button" class="btn btn-sm btn-danger" data-action="delete-roulette" data-id="${r.id}">✕</button>
                </div>
              </div>`
            )
            .join('')}
        </div>

        <form id="form-new-roulette">
          <div class="field">
            <label for="roul-name">Nombre de la ruleta *</label>
            <input type="text" id="roul-name" name="name" placeholder="Ej: ¿Qué película vemos?, ¿Quién lava los platos?" required>
          </div>
          <div class="field">
            <label for="roul-opts">Opciones separadas por coma *</label>
            <input type="text" id="roul-opts" name="options" placeholder="Ej: Comedia, Terror, Ciencia Ficción, Drama" required>
          </div>
          <button type="submit" class="btn btn-primary">Guardar Ruleta</button>
        </form>
      </section>

      <!-- Planes Aleatorios de la Semana + IA -->
      <section class="card">
        <h2>✨ Planes Aleatorios de la Semana + IA</h2>
        <div class="stat-box" style="margin-block-end:1rem; border-color:var(--brand);">
          <div class="text-muted">Plan elegido para esta semana:</div>
          <div class="stat-value" style="font-size:1.2rem;">
            ${selectedPlan ? `🌟 ${escapeHtml(selectedPlan.title)} (${escapeHtml(selectedPlan.category)})` : 'Aún no sortearon el plan de la semana'}
          </div>
          <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.6rem;">
            <button type="button" class="btn btn-sm btn-primary" data-action="pick-random-plan">🎲 Sortear Plan Aleatorio</button>
            <button type="button" class="btn btn-sm" data-action="generate-ai-plans">🤖 Proponer Planes con IA (SpiderIA / Gustos)</button>
          </div>
        </div>

        <form id="form-new-plan" style="display:grid; grid-template-columns: 2fr 1fr auto; gap:0.4rem; margin-block-end:1rem;">
          <input type="text" name="title" placeholder="Proponer nuevo plan semanal *" aria-label="Título del plan" required>
          <input type="text" name="weather" placeholder="Clima ideal" aria-label="Clima ideal">
          <button type="submit" class="btn btn-primary">+ Añadir</button>
        </form>

        <ul style="list-style:none; padding:0; margin:0; max-block-size:260px; overflow:auto; display:flex; flex-direction:column; gap:0.4rem;">
          ${plans
            .map(
              p => `<li class="stat-box" style="padding:0.5rem 0.75rem; display:flex; justify-content:space-between; align-items:center;">
                <span>
                  <span class="badge">${p.source === 'ai' ? '🤖 IA' : p.source === 'system' ? '⭐ Sistema' : '💑 Pareja'}</span>
                  <strong>${escapeHtml(p.title)}</strong> <small class="text-muted">(${escapeHtml(p.weather)})</small>
                </span>
                ${p.couple_id ? `<button type="button" class="btn btn-sm btn-danger" data-action="delete-plan" data-id="${p.id}">✕</button>` : ''}
              </li>`
            )
            .join('')}
        </ul>
      </section>
    </div>

    <!-- Calendario de Ciclo Menstrual -->
    <section class="card">
      <h2>🌸 Calendario y Cálculo de Ciclo Menstrual</h2>
      <div class="grid-3" style="margin-block-end:1rem;">
        <div class="stat-box">
          <div class="text-muted">Próxima Regla Estimada</div>
          <div class="stat-value" style="font-size:1.25rem;">${menstrual.nextPeriodStart ? `${escapeHtml(menstrual.nextPeriodStart)} al ${escapeHtml(menstrual.nextPeriodEnd)}` : 'Registra el último inicio'}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Día Estimado de Ovulación</div>
          <div class="stat-value" style="font-size:1.25rem;">${escapeHtml(menstrual.ovulationDate || '—')}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Ventana Fértil</div>
          <div class="stat-value" style="font-size:1.25rem;">${escapeHtml(menstrual.fertileWindow || '—')}</div>
        </div>
      </div>

      <form id="form-menstrual" class="grid-3" style="align-items:end;">
        <div class="field" style="margin:0;">
          <label for="mens-start">Fecha de inicio del último período *</label>
          <input type="date" id="mens-start" name="lastStart" value="${escapeHtml(menstrual.lastStart || '')}" required>
        </div>
        <div class="field" style="margin:0;">
          <label for="mens-cycle">Duración del ciclo (días)</label>
          <input type="number" id="mens-cycle" name="cycleDays" min="20" max="45" value="${menstrual.cycleDays || 28}" required>
        </div>
        <div class="field" style="margin:0;">
          <label for="mens-period">Días de sangrado</label>
          <input type="number" id="mens-period" name="periodDays" min="2" max="10" value="${menstrual.periodDays || 5}" required>
        </div>
        <button type="submit" class="btn btn-primary">Guardar y Calcular Ciclo</button>
      </form>
    </section>
  `;
}

export default {
  id: 'tools',
  render: renderToolsTab,
  actions: {
    'spin-roulette': (ctx, el) => {
      const opts = JSON.parse(el.dataset.options || '[]');
      const wheel = document.getElementById('roulette-wheel-box');
      if (!wheel || opts.length === 0) return;
      const deg = 720 + Math.floor(Math.random() * 720);
      wheel.style.transform = `rotate(${deg}deg)`;
      const winner = opts[Math.floor(Math.random() * opts.length)];
      setTimeout(() => {
        wheel.textContent = `🎉 ¡Salió: ${winner}!`;
      }, 1400);
    },
    'delete-roulette': async (ctx, el) => {
      await api(`/api/roulettes/${el.dataset.id}`, { method: 'DELETE' });
      ctx.refresh();
    },
    'pick-random-plan': async (ctx) => {
      const res = await api('/api/plans/random', { method: 'POST' });
      ctx.showStatus(`Plan elegido: ${res.chosen.title}`);
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
      ctx.refresh();
    }
  },
  forms: {
    'form-new-roulette': async (ctx, data) => {
      await api('/api/roulettes', { method: 'POST', body: data });
      ctx.refresh();
    },
    'form-new-plan': async (ctx, data) => {
      await api('/api/plans', { method: 'POST', body: data });
      ctx.refresh();
    },
    'form-menstrual': async (ctx, data) => {
      await api('/api/menstrual', { method: 'PUT', body: data });
      ctx.showStatus('Calendario menstrual actualizado.');
      ctx.refresh();
    }
  }
};
