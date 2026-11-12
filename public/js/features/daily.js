import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

/* ================= HERRAMIENTAS: PREGUNTA DEL DÍA Y RACHAS (3 RECUPERACIONES/MES) ================= */
async function renderDailyQuestionTab(container) {
  const dq = await api('/api/daily-question');
  const myAns = dq.answers.find(a => a.user_id === state.user.id);
  const partnerAns = dq.answers.find(a => a.user_id !== state.user.id);

  container.innerHTML = `
    <section class="card">
      <h2>🔥 Pregunta del Día y Racha en Pareja</h2>
      <div class="grid-3" style="margin-block-end:1.25rem;">
        <div class="stat-box">
          <div class="text-muted">Racha Actual</div>
          <div class="stat-value">🔥 ${dq.streak_count} días</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Racha Más Larga (Récord)</div>
          <div class="stat-value">🏆 ${dq.longest_streak} días</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Recuperar Racha (${escapeHtml(dq.streak_recovery_month)})</div>
          <div class="stat-value">💖 ${dq.streak_recoveries_left} / 3 disp.</div>
          <button type="button" class="btn btn-sm" style="margin-top:0.4rem;" data-action="recover-streak" ${dq.streak_recoveries_left <= 0 ? 'disabled' : ''}>
            Usar Recuperación de Racha
          </button>
        </div>
      </div>

      <div class="card" style="background:var(--surface-alt);">
        <span class="badge">Pregunta del ${escapeHtml(dq.date)}</span>
        <h3 style="font-size:1.35rem; margin-block:0.5rem;">“${escapeHtml(dq.question.question_text)}”</h3>
        <p class="text-muted">Cuando <strong>ambos</strong> contestan la pregunta del día, la racha suma +1 día automáticamente.</p>

        <form id="form-daily-answer">
          <div class="field">
            <label for="daily-ans-input">Tu respuesta de hoy *</label>
            <textarea id="daily-ans-input" name="answer_text" rows="3" required placeholder="Escribe lo que sientes...">${escapeHtml(myAns?.answer_text || '')}</textarea>
          </div>
          <button type="submit" class="btn btn-primary">${myAns ? 'Actualizar mi respuesta' : 'Enviar mi respuesta'}</button>
        </form>
      </div>

      <div class="grid-2">
        <div class="stat-box">
          <h4>Tu Respuesta (${escapeHtml(state.user.first_name)})</h4>
          <p>${myAns ? escapeHtml(myAns.answer_text) : '<span class="text-muted">Aún no contestaste hoy.</span>'}</p>
        </div>
        <div class="stat-box">
          <h4>Respuesta de ${escapeHtml(state.partner?.first_name || 'tu Pareja')}</h4>
          <p>${
            partnerAns
              ? myAns
                ? escapeHtml(partnerAns.answer_text)
                : '🔒 <em>¡Tu pareja ya contestó! Escribe tu respuesta para ver la suya e iniciar/sumar la racha.</em>'
              : '<span class="text-muted">Todavía no contestó hoy.</span>'
          }</p>
        </div>
      </div>
    </section>
  `;
}

export default {
  id: 'daily',
  render: renderDailyQuestionTab,
  actions: {
    'recover-streak': async (ctx) => {
      const res = await api('/api/daily-question/recover', { method: 'POST', body: {} });
      ctx.showStatus(`¡Racha recuperada! Te quedan ${res.streak_recoveries_left} recuperaciones este mes.`);
      ctx.refresh();
    }
  },
  forms: {
    'form-daily-answer': async (ctx, data) => {
      const res = await api('/api/daily-question/answer', { method: 'POST', body: data });
      ctx.showStatus(res.both_answered ? `¡Ambos respondieron! Racha actual: ${res.streak_count} 🔥` : 'Respuesta guardada.');
      ctx.refresh();
    }
  }
};
