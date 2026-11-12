import { api } from '../core/api.js';
import { escapeHtml, formatMoney } from '../core/utils.js';

/* ================= DASHBOARD DE LA PAREJA ================= */
async function renderDashboardTab(container) {
  const d = await api('/api/dashboard');
  const goTo = (tab, label) => `<button type="button" class="btn btn-sm" data-action="goto-tab" data-tab="${tab}">${label}</button>`;
  const fmtDt = v => escapeHtml(String(v || '').replace('T', ' '));
  const tastesLine = (n, t) => `<div class="stat-box"><strong>${escapeHtml(n)}</strong>
    <div class="text-muted"><i class="fa-solid fa-utensils"></i> ${escapeHtml(t.favorite_food || '—')} · <i class="fa-solid fa-spa"></i> ${escapeHtml(t.favorite_flowers || '—')} · <i class="fa-solid fa-palette"></i> ${escapeHtml(t.favorite_color || '—')}</div></div>`;

  container.innerHTML = `
    <section class="card" style="text-align:center;">
      <div style="display:flex; justify-content:center; align-items:center; gap:1rem;">
        <img class="avatar-sm" style="width:64px;height:64px;" src="${escapeHtml(d.me.avatar_url)}" alt="" width="64" height="64">
        <i class="fa-solid fa-heart" style="color:var(--brand); font-size:2rem;"></i>
        <img class="avatar-sm" style="width:64px;height:64px;" src="${escapeHtml(d.partner.avatar_url)}" alt="" width="64" height="64">
      </div>
      <h2 style="margin-block:0.75rem 0;">${escapeHtml(d.me.first_name)} & ${escapeHtml(d.partner.first_name)}</h2>
      <div class="stat-value" style="font-size:2.4rem;">${d.days_together} días juntos</div>
      <p class="text-muted" style="margin:0;">Desde el ${escapeHtml(d.relationship_start)}${d.motto ? ` · “${escapeHtml(d.motto)}”` : ''}</p>
    </section>

    <div class="grid-3" style="margin-block-end:1.25rem;">
      <div class="stat-box"><div class="text-muted"><i class="fa-solid fa-wallet"></i> Balance global</div><div class="stat-value">${formatMoney(d.balance)}</div>
        <div class="text-muted">Gastado este mes: ${formatMoney(d.month_expense)}</div></div>
      <div class="stat-box"><div class="text-muted"><i class="fa-solid fa-fire" style="color:#ef4444;"></i> Racha</div><div class="stat-value">${d.streak_count} días</div>
        <div class="text-muted">Récord ${d.longest_streak} · Hoy respondieron ${d.answered_today}/2</div></div>
      <div class="stat-box"><div class="text-muted"><i class="fa-solid fa-gift"></i> / <i class="fa-solid fa-hourglass-half"></i> / <i class="fa-solid fa-spa"></i></div>
        <div>${d.pending_cravings ? `<strong>${d.pending_cravings}</strong> antojo(s) por responder` : 'Sin antojos pendientes'}</div>
        <div>${d.next_capsule ? `Cápsula: ${fmtDt(d.next_capsule.unlock_at)}` : 'Sin cápsulas selladas'}</div>
        <div>${d.next_period ? `Próx. ciclo: ${escapeHtml(d.next_period)}` : ''}</div></div>
    </div>

    <div class="grid-2">
      <section class="card"><h3><i class="fa-solid fa-list-check"></i> Tareas pendientes</h3>
        ${d.pending_tasks.length ? `<ul>${d.pending_tasks.map(t => `<li><strong>${escapeHtml(t.title)}</strong> <span class="badge">${escapeHtml(t.priority)}</span> ${t.due_datetime ? `<small class="text-muted">${fmtDt(t.due_datetime)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="text-muted">Todo al día <i class="fa-solid fa-circle-check text-ok"></i></p>'}
        ${goTo('tasks', 'Ver tableros')}</section>
      <section class="card"><h3><i class="fa-solid fa-calendar-days"></i> Próximos eventos</h3>
        ${d.upcoming_events.length ? `<ul>${d.upcoming_events.map(e => `<li><strong>${escapeHtml(e.title)}</strong> <small class="text-muted">${fmtDt(e.start_datetime)}</small></li>`).join('')}</ul>` : '<p class="text-muted">Sin eventos próximos.</p>'}
        ${goTo('calendar', 'Ver calendario')}</section>
      <section class="card"><h3><i class="fa-solid fa-bullseye"></i> Metas activas</h3>
        ${d.active_goals.length ? d.active_goals.map(g => {
          const pct = g.goal_type === 'time' ? null : Math.min(100, Math.round((g.current_value / Math.max(1, g.target_value)) * 100));
          return `<div style="margin-block-end:0.6rem;"><strong>${escapeHtml(g.title)}</strong>${pct === null ? ' <span class="badge"><i class="fa-solid fa-stopwatch"></i></span>' : `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`}</div>`;
        }).join('') : '<p class="text-muted">Sin metas activas.</p>'}
        ${goTo('goals', 'Ver metas')}</section>
      <section class="card"><h3><i class="fa-solid fa-wand-magic-sparkles"></i> Plan de la semana</h3>
        <p>${d.week_plan ? `<i class="fa-solid fa-star" style="color:#f59e0b;"></i> <strong>${escapeHtml(d.week_plan.title)}</strong> (${escapeHtml(d.week_plan.category)})` : '<span class="text-muted">Aún no sortearon el plan.</span>'}</p>
        ${goTo('tools', 'Ir a planes')}</section>
    </div>

    <section class="card"><h3><i class="fa-solid fa-heart"></i> Gustos rápidos</h3>
      <div class="grid-2">${tastesLine(d.me.first_name, d.me.tastes || {})}${tastesLine(d.partner.first_name, d.partner.tastes || {})}</div></section>
  `;
}

export default {
  id: 'dashboard',
  render: renderDashboardTab
};
