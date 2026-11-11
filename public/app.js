const state = {
  token: localStorage.getItem('hifa_token') || '',
  user: null,
  partner: null,
  couple: null,
  notifications: [],
  config: {},
  activeTab: 'couple',
  selectedWalletId: null,
  activeNotebookId: null,
  activePageId: null,
  countdownTimer: null
};

async function api(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const res = await fetch(path, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatMoney(amount) {
  const cur = state.user?.currency || 'ARS';
  const num = Number(amount || 0);
  try {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: cur, maximumFractionDigits: 2 }).format(num);
  } catch {
    return `${cur} ${num.toFixed(2)}`;
  }
}

function showStatus(msg, isError = false) {
  const banner = document.getElementById('status-banner');
  if (!banner) return;
  banner.innerHTML = `<div class="card" style="margin-block:0.75rem; padding:0.75rem 1rem; border-color:${isError ? 'var(--danger)' : 'var(--ok)'};">
    <strong class="${isError ? 'text-danger' : 'text-ok'}">${isError ? '⚠️ ' : '✓ '}${escapeHtml(msg)}</strong>
  </div>`;
  setTimeout(() => {
    if (banner.innerHTML.includes(escapeHtml(msg))) banner.innerHTML = '';
  }, 4500);
}

async function fileToUploadedUrl(fileInput) {
  const file = fileInput?.files?.[0];
  if (!file) return '';
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const res = await api('/api/upload', {
    method: 'POST',
    body: { filename: file.name, dataUrl }
  });
  return res.url || '';
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
  } else {
    root.removeAttribute('data-theme');
  }
}

function renderMarkdown(md) {
  const lines = String(md || '').split('\n');
  const html = [];
  let inList = false;
  lines.forEach((rawLine, idx) => {
    const line = escapeHtml(rawLine);
    if (/^###\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h4>${line.replace(/^###\s+/, '')}</h4>`);
    } else if (/^##\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h3>${line.replace(/^##\s+/, '')}</h3>`);
    } else if (/^#\s+(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<h2>${line.replace(/^#\s+/, '')}</h2>`);
    } else if (/^-\s+\[( |x|X)\]\s+(.+)/.test(line)) {
      if (!inList) { html.push('<ul style="list-style:none; padding-inline-start:0.5rem;">'); inList = true; }
      const m = line.match(/^-\s+\[( |x|X)\]\s+(.+)/);
      const checked = m[1].toLowerCase() === 'x' ? 'checked' : '';
      html.push(`<li><label style="font-weight:400;"><input type="checkbox" data-md-line="${idx}" ${checked}> ${formatInlineMd(m[2])}</label></li>`);
    } else if (/^-\s+(.+)/.test(line)) {
      if (!inList) { html.push('<ul>'); inList = true; }
      html.push(`<li>${formatInlineMd(line.replace(/^-\s+/, ''))}</li>`);
    } else if (/^&gt;\s*(.+)/.test(line)) {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<blockquote style="border-inline-start:3px solid var(--brand); margin:0.5rem 0; padding-inline-start:0.75rem;">${formatInlineMd(line.replace(/^&gt;\s*/, ''))}</blockquote>`);
    } else if (line.trim() === '') {
      if (inList) { html.push('</ul>'); inList = false; }
    } else {
      if (inList) { html.push('</ul>'); inList = false; }
      html.push(`<p style="margin:0.4rem 0;">${formatInlineMd(line)}</p>`);
    }
  });
  if (inList) html.push('</ul>');
  return html.join('\n');
}

function formatInlineMd(text) {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
}

function profilesReady() {
  return Boolean(state.user?.profile_completed && state.partner?.profile_completed && state.couple?.relationship_start);
}

async function bootstrap() {
  if (state.countdownTimer) clearInterval(state.countdownTimer);
  try {
    const setupRes = await api('/api/setup');
    state.config = setupRes.config || {};
    populateSetupDialog();
  } catch (_) {}

  if (!state.token) {
    showAuthView();
    return;
  }

  try {
    const me = await api('/api/me');
    state.user = me.user;
    state.partner = me.partner;
    state.couple = me.couple;
    state.notifications = me.notifications || [];
    state.config = me.config || state.config;
    applyTheme(state.user.theme);
    populateSetupDialog();
    if (!state.booted) {
      state.booted = true;
      state.activeTab = profilesReady() ? 'dashboard' : 'couple';
    }
    showAppShell();
  } catch {
    state.token = '';
    localStorage.removeItem('hifa_token');
    showAuthView();
  }
}

function populateSetupDialog() {
  const cfg = state.config || {};
  const dbMode = document.getElementById('setup-db-mode');
  const stMode = document.getElementById('setup-storage-mode');
  const dbName = document.getElementById('setup-dbname');
  const apiKey = document.getElementById('setup-apikey');
  const stId = document.getElementById('setup-storageid');
  if (dbMode) dbMode.value = cfg.db_mode || 'local';
  if (stMode) stMode.value = cfg.storage_mode || 'local';
  if (dbName) dbName.value = cfg.spiderwebdbname || '';
  if (apiKey) apiKey.value = cfg.spiderapikey || '';
  if (stId) stId.value = cfg.spidercloudstrogaeid || '';
}

function showAuthView() {
  document.getElementById('auth-view').hidden = false;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('btn-logout').hidden = true;
  document.getElementById('btn-open-notifications').hidden = true;
  document.getElementById('couple-badge').hidden = true;
}

function showAppShell() {
  document.getElementById('auth-view').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('btn-logout').hidden = false;
  document.getElementById('btn-open-notifications').hidden = false;

  const badge = document.getElementById('couple-badge');
  badge.hidden = false;
  if (state.partner) {
    badge.innerHTML = `<img class="avatar-sm" src="${escapeHtml(state.user.avatar_url)}" alt="" width="32" height="32">
      ${escapeHtml(state.user.first_name)} ❤️ ${escapeHtml(state.partner.first_name)}
      <img class="avatar-sm" src="${escapeHtml(state.partner.avatar_url)}" alt="" width="32" height="32">`;
  } else {
    badge.textContent = `${state.user.first_name} (Sin vincular aún)`;
  }

  const dashBtn = document.querySelector('[data-tab="dashboard"]');
  if (dashBtn) dashBtn.hidden = !profilesReady();
  if (state.activeTab === 'dashboard' && !profilesReady()) state.activeTab = 'couple';

  const unread = state.notifications.filter(n => !n.read).length;
  document.getElementById('notif-count').textContent = String(unread);

  // Check if URL has ?pair=CODE and user is not linked yet
  const params = new URLSearchParams(window.location.search);
  if (params.get('pair') && !state.user.couple_id) {
    state.activeTab = 'couple';
  }

  renderActiveTab();
}

async function renderActiveTab() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }

  document.querySelectorAll('#nav-list .nav-btn').forEach(btn => {
    if (btn.dataset.tab === state.activeTab) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  const container = document.getElementById('tab-content');
  if (!state.user.couple_id && state.activeTab !== 'couple' && state.activeTab !== 'settings') {
    container.innerHTML = `<section class="card">
      <h2>🔗 Vincula tu cuenta con tu pareja primero</h2>
      <p>Para desbloquear todas las herramientas de Fase 2 (Economía, Tareas, Listas, Calendario, Ruleta, Pregunta del Día, Antojos, Cápsula del Tiempo, Metas y Cuadernos), primero vincúlate con tu pareja en la pestaña <strong>Pareja y Gustos</strong>.</p>
      <button type="button" class="btn btn-primary" data-action="go-couple">Ir a Vincular Pareja</button>
    </section>`;
    return;
  }

  if (state.user.couple_id && !profilesReady() && state.activeTab !== 'couple' && state.activeTab !== 'settings') {
    container.innerHTML = `<section class="card">
      <h2>📝 Falta completar el formulario de pareja</h2>
      <p>Cada uno completa su propia información. Cuando <strong>ambos</strong> la guarden se desbloquea el dashboard y el resto de las herramientas.</p>
      <button type="button" class="btn btn-primary" data-action="go-couple">Ir al formulario</button>
    </section>`;
    return;
  }

  switch (state.activeTab) {
    case 'dashboard':
      return renderDashboardTab(container);
    case 'couple':
      return renderCoupleTab(container);
    case 'economy':
      return renderEconomyTab(container);
    case 'tasks':
      return renderTasksTab(container);
    case 'lists':
      return renderListsTab(container);
    case 'calendar':
      return renderCalendarTab(container);
    case 'notitas':
      return renderNotitasTab(container);
    case 'daily':
      return renderDailyQuestionTab(container);
    case 'cravings':
      return renderCravingsTab(container);
    case 'goals':
      return renderGoalsTab(container);
    case 'capsules':
      return renderCapsulesTab(container);
    case 'notebooks':
      return renderNotebooksTab(container);
    case 'tools':
      return renderToolsTab(container);
    case 'settings':
      return renderSettingsTab(container);
  }
}

/* ================= FASE 1: VINCULACIÓN Y FORMULARIO DE PAREJA ================= */
function renderCoupleTab(container) {
  const urlPair = new URLSearchParams(window.location.search).get('pair') || '';
  if (!state.user.couple_id) {
    const shareLink = `${window.location.origin}/?pair=${encodeURIComponent(state.user.pair_code)}`;
    container.innerHTML = `
      <div class="grid-2">
        <section class="card" aria-labelledby="share-code-title">
          <h2 id="share-code-title">1. Comparte tu código o link de pareja</h2>
          <p class="text-muted">Uno de los dos crea o comparte este código y el otro se vincula ingresándolo.</p>
          <div class="stat-box" style="margin-block-end:1rem;">
            <div class="text-muted">Tu código único</div>
            <div class="stat-value" id="my-pair-code">${escapeHtml(state.user.pair_code)}</div>
            <p class="text-muted" style="word-break:break-all; margin-block:0.4rem;">Link: <code>${escapeHtml(shareLink)}</code></p>
          </div>
          <div style="display:flex; gap:0.6rem; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" data-action="copy-pair-link" data-link="${escapeHtml(shareLink)}">📋 Copiar Link de Invitación</button>
            <button type="button" class="btn" data-action="regenerate-pair-code">🔄 Generar Nuevo Código</button>
          </div>
        </section>

        <section class="card" aria-labelledby="join-code-title">
          <h2 id="join-code-title">2. Vincularme con el código de mi pareja</h2>
          <form id="form-link-couple">
            <div class="field">
              <label for="input-pair-code">Código de tu pareja *</label>
              <input type="text" id="input-pair-code" name="code" value="${escapeHtml(urlPair)}" placeholder="Ej: HIFA-A1B2C3" autocorrect="off" autocapitalize="characters" spellcheck="false" required>
            </div>
            <button type="submit" class="btn btn-primary">💞 Vincularnos ahora</button>
          </form>
        </section>
      </div>
    `;
    return;
  }

  const relStart = state.couple?.relationship_start || '';
  let daysTogetherText = 'Completa la fecha de inicio de su relación abajo (obligatorio).';
  if (relStart) {
    const diffMs = Date.now() - new Date(relStart + 'T00:00:00').getTime();
    const days = Math.max(0, Math.floor(diffMs / 86400000));
    daysTogetherText = `Llevan ${days} días juntos desde el ${relStart} ❤️`;
  }

  const myT = state.user.tastes || {};
  const paT = state.partner?.tastes || {};

  container.innerHTML = `
    <section class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
        <div>
          <h2 style="margin:0;">💑 Información y Gustos de la Pareja</h2>
          <p class="text-muted" style="margin:0.25rem 0 0 0;">${escapeHtml(daysTogetherText)}</p>
        </div>
        <span class="badge">Pareja #${state.couple.id}</span>
      </div>
    </section>

    <form id="form-couple-profile" class="card">
      <h3>Formulario de la Pareja</h3>
      <div class="grid-2">
        <div class="field">
          <label for="rel-start-date">¿Cuándo inició su relación? (Obligatorio) *</label>
          <input type="date" id="rel-start-date" name="relationship_start" value="${escapeHtml(relStart)}" required>
        </div>
        <div class="field">
          <label for="shared-anniversary-note">Lema, canción o acuerdo compartido en pareja</label>
          <input type="text" id="shared-anniversary-note" name="shared_motto" value="${escapeHtml(state.couple?.shared_info?.motto || '')}" placeholder="Ej: Nuestro lugar favorito, metas juntos...">
        </div>
      </div>

      <p class="text-muted">
        Tu formulario: ${state.user.profile_completed ? '<strong class="text-ok">✓ guardado</strong>' : '<strong>pendiente</strong>'} ·
        ${escapeHtml(state.partner?.first_name || 'Tu pareja')}: ${state.partner?.profile_completed ? '<strong class="text-ok">✓ guardado</strong>' : '<strong>pendiente</strong>'}
      </p>
      <div class="grid-2">
        ${renderTastesFieldset('me', `Mis Gustos y Talles (${state.user.first_name})`, myT)}
        ${state.partner?.profile_completed ? renderPartnerReadonly(paT) : `<fieldset><legend>${escapeHtml(state.partner?.first_name || 'Tu pareja')}</legend><p class="text-muted">Cada uno completa su propia información. Verás la de tu pareja cuando la guarde.</p></fieldset>`}
      </div>

      <button type="submit" class="btn btn-primary">💾 Guardar Información de la Pareja</button>
    </form>
  `;
}

function renderPartnerReadonly(t) {
  const rows = [
    ['Remera', t.shirt_size], ['Pantalón', t.pants_size], ['Calzado', t.shoe_size], ['Abrigo/Vestido', t.coat_size],
    ['Comida', t.favorite_food], ['Flores', t.favorite_flowers], ['Marcas', t.favorite_brands],
    ['Series/Pelis', t.favorite_series_movies], ['Color', t.favorite_color], ['Clima', t.favorite_weather],
    ['Plan', t.favorite_plan], ['Extras', t.additional_tastes]
  ].filter(r => r[1]);
  return `<fieldset><legend>Info de ${escapeHtml(state.partner.first_name)}</legend>
    <dl style="margin:0; display:grid; grid-template-columns:auto 1fr; gap:0.35rem 0.8rem;">
      ${rows.map(([k, v]) => `<dt class="text-muted">${k}</dt><dd style="margin:0;">${escapeHtml(v)}</dd>`).join('')}
    </dl></fieldset>`;
}

function renderTastesFieldset(prefix, legendTitle, t) {
  return `
    <fieldset>
      <legend>${escapeHtml(legendTitle)}</legend>
      <div class="grid-2">
        <div class="field">
          <label for="${prefix}-shirt">Talle Remera / Camisa</label>
          <input type="text" id="${prefix}-shirt" name="${prefix}_shirt_size" value="${escapeHtml(t.shirt_size || '')}" placeholder="Ej: M / L">
        </div>
        <div class="field">
          <label for="${prefix}-pants">Talle Pantalón</label>
          <input type="text" id="${prefix}-pants" name="${prefix}_pants_size" value="${escapeHtml(t.pants_size || '')}" placeholder="Ej: 40 / M">
        </div>
        <div class="field">
          <label for="${prefix}-shoes">Talle Calzado</label>
          <input type="text" id="${prefix}-shoes" name="${prefix}_shoe_size" value="${escapeHtml(t.shoe_size || '')}" placeholder="Ej: 38 / 42">
        </div>
        <div class="field">
          <label for="${prefix}-coat">Talle Abrigo / Vestido</label>
          <input type="text" id="${prefix}-coat" name="${prefix}_coat_size" value="${escapeHtml(t.coat_size || '')}" placeholder="Ej: L">
        </div>
      </div>
      <div class="field">
        <label for="${prefix}-food">Comida favorita</label>
        <input type="text" id="${prefix}-food" name="${prefix}_favorite_food" value="${escapeHtml(t.favorite_food || '')}" placeholder="Ej: Ñoquis, Sushi, Milanesas">
      </div>
      <div class="field">
        <label for="${prefix}-flowers">Flores favoritas</label>
        <input type="text" id="${prefix}-flowers" name="${prefix}_favorite_flowers" value="${escapeHtml(t.favorite_flowers || '')}" placeholder="Ej: Girasoles, Tulipanes, Rosas">
      </div>
      <div class="field">
        <label for="${prefix}-brands">Marcas favoritas</label>
        <input type="text" id="${prefix}-brands" name="${prefix}_favorite_brands" value="${escapeHtml(t.favorite_brands || '')}" placeholder="Ej: Nike, Zara, Adidas">
      </div>
      <div class="field">
        <label for="${prefix}-movies">Series o películas favoritas</label>
        <input type="text" id="${prefix}-movies" name="${prefix}_favorite_series_movies" value="${escapeHtml(t.favorite_series_movies || '')}" placeholder="Ej: Interstellar, Breaking Bad">
      </div>
      <div class="grid-2">
        <div class="field">
          <label for="${prefix}-color">Color favorito</label>
          <input type="text" id="${prefix}-color" name="${prefix}_favorite_color" value="${escapeHtml(t.favorite_color || '')}" placeholder="Ej: Azul marino, Lila">
        </div>
        <div class="field">
          <label for="${prefix}-weather">Clima favorito</label>
          <input type="text" id="${prefix}-weather" name="${prefix}_favorite_weather" value="${escapeHtml(t.favorite_weather || '')}" placeholder="Ej: Días de lluvia / Templado">
        </div>
      </div>
      <div class="field">
        <label for="${prefix}-plan">Plan favorito</label>
        <input type="text" id="${prefix}-plan" name="${prefix}_favorite_plan" value="${escapeHtml(t.favorite_plan || '')}" placeholder="Ej: Merienda y paseo, cine en casa">
      </div>
      <div class="field">
        <label for="${prefix}-extra">Gustos adicionales (alergias, snacks, perfumes, etc.)</label>
        <textarea id="${prefix}-extra" name="${prefix}_additional_tastes" rows="2">${escapeHtml(t.additional_tastes || '')}</textarea>
      </div>
    </fieldset>
  `;
}

/* ================= DASHBOARD DE LA PAREJA ================= */
async function renderDashboardTab(container) {
  const d = await api('/api/dashboard');
  const goTo = (tab, label) => `<button type="button" class="btn btn-sm" data-action="goto-tab" data-tab="${tab}">${label}</button>`;
  const fmtDt = v => escapeHtml(String(v || '').replace('T', ' '));
  const tastesLine = (n, t) => `<div class="stat-box"><strong>${escapeHtml(n)}</strong>
    <div class="text-muted">🍽️ ${escapeHtml(t.favorite_food || '—')} · 🌸 ${escapeHtml(t.favorite_flowers || '—')} · 🎨 ${escapeHtml(t.favorite_color || '—')}</div></div>`;

  container.innerHTML = `
    <section class="card" style="text-align:center;">
      <div style="display:flex; justify-content:center; align-items:center; gap:1rem;">
        <img class="avatar-sm" style="width:64px;height:64px;" src="${escapeHtml(d.me.avatar_url)}" alt="" width="64" height="64">
        <span style="font-size:2rem;">❤️</span>
        <img class="avatar-sm" style="width:64px;height:64px;" src="${escapeHtml(d.partner.avatar_url)}" alt="" width="64" height="64">
      </div>
      <h2 style="margin-block:0.75rem 0;">${escapeHtml(d.me.first_name)} & ${escapeHtml(d.partner.first_name)}</h2>
      <div class="stat-value" style="font-size:2.4rem;">${d.days_together} días juntos</div>
      <p class="text-muted" style="margin:0;">Desde el ${escapeHtml(d.relationship_start)}${d.motto ? ` · “${escapeHtml(d.motto)}”` : ''}</p>
    </section>

    <div class="grid-3" style="margin-block-end:1.25rem;">
      <div class="stat-box"><div class="text-muted">💰 Balance global</div><div class="stat-value">${formatMoney(d.balance)}</div>
        <div class="text-muted">Gastado este mes: ${formatMoney(d.month_expense)}</div></div>
      <div class="stat-box"><div class="text-muted">🔥 Racha</div><div class="stat-value">${d.streak_count} días</div>
        <div class="text-muted">Récord ${d.longest_streak} · Hoy respondieron ${d.answered_today}/2</div></div>
      <div class="stat-box"><div class="text-muted">🎁 / ⏳ / 🌸</div>
        <div>${d.pending_cravings ? `<strong>${d.pending_cravings}</strong> antojo(s) por responder` : 'Sin antojos pendientes'}</div>
        <div>${d.next_capsule ? `Cápsula: ${fmtDt(d.next_capsule.unlock_at)}` : 'Sin cápsulas selladas'}</div>
        <div>${d.next_period ? `Próx. ciclo: ${escapeHtml(d.next_period)}` : ''}</div></div>
    </div>

    <div class="grid-2">
      <section class="card"><h3>✅ Tareas pendientes</h3>
        ${d.pending_tasks.length ? `<ul>${d.pending_tasks.map(t => `<li><strong>${escapeHtml(t.title)}</strong> <span class="badge">${escapeHtml(t.priority)}</span> ${t.due_datetime ? `<small class="text-muted">${fmtDt(t.due_datetime)}</small>` : ''}</li>`).join('')}</ul>` : '<p class="text-muted">Todo al día 🎉</p>'}
        ${goTo('tasks', 'Ver tableros')}</section>
      <section class="card"><h3>📅 Próximos eventos</h3>
        ${d.upcoming_events.length ? `<ul>${d.upcoming_events.map(e => `<li><strong>${escapeHtml(e.title)}</strong> <small class="text-muted">${fmtDt(e.start_datetime)}</small></li>`).join('')}</ul>` : '<p class="text-muted">Sin eventos próximos.</p>'}
        ${goTo('calendar', 'Ver calendario')}</section>
      <section class="card"><h3>🎯 Metas activas</h3>
        ${d.active_goals.length ? d.active_goals.map(g => {
          const pct = g.goal_type === 'time' ? null : Math.min(100, Math.round((g.current_value / Math.max(1, g.target_value)) * 100));
          return `<div style="margin-block-end:0.6rem;"><strong>${escapeHtml(g.title)}</strong>${pct === null ? ' <span class="badge">⏱️</span>' : `<div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`}</div>`;
        }).join('') : '<p class="text-muted">Sin metas activas.</p>'}
        ${goTo('goals', 'Ver metas')}</section>
      <section class="card"><h3>✨ Plan de la semana</h3>
        <p>${d.week_plan ? `🌟 <strong>${escapeHtml(d.week_plan.title)}</strong> (${escapeHtml(d.week_plan.category)})` : '<span class="text-muted">Aún no sortearon el plan.</span>'}</p>
        ${goTo('tools', 'Ir a planes')}</section>
    </div>

    <section class="card"><h3>💑 Gustos rápidos</h3>
      <div class="grid-2">${tastesLine(d.me.first_name, d.me.tastes || {})}${tastesLine(d.partner.first_name, d.partner.tastes || {})}</div></section>
  `;
}

/* ================= FASE 2: ECONOMÍA, BILLETERAS Y ANALÍTICA ================= */
async function renderEconomyTab(container) {
  const data = await api('/api/economy');
  const { wallets, transactions, globalAnalytics } = data;
  const selectedWallet = wallets.find(w => w.id === state.selectedWalletId) || null;

  container.innerHTML = `
    <section class="card" aria-labelledby="econ-global-title">
      <h2 id="econ-global-title">📊 Analítica Global (Todos los Medios de Pago)</h2>
      <div class="grid-3" style="margin-block-end:1rem;">
        <div class="stat-box">
          <div class="text-muted">Ingresos Globales</div>
          <div class="stat-value text-ok">+${formatMoney(globalAnalytics.totalIncome)}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Expensas / Egresos Globales</div>
          <div class="stat-value text-danger">-${formatMoney(globalAnalytics.totalExpense)}</div>
        </div>
        <div class="stat-box">
          <div class="text-muted">Balance Global</div>
          <div class="stat-value">${formatMoney(globalAnalytics.netBalance)}</div>
        </div>
      </div>

      <h3>Resumen Global por Categoría (Ingresos y Expensas)</h3>
      ${
        globalAnalytics.byCategory.length === 0
          ? '<p class="text-muted">Aún no hay movimientos registrados.</p>'
          : `<div tabindex="0" role="region" aria-labelledby="cat-table-caption" class="table-wrapper">
              <table style="--label-2:'Tipo'; --label-3:'Movimientos'; --label-4:'Total';">
                <caption id="cat-table-caption" class="text-muted" style="padding:0.5rem;">Totales por categoría en todos los medios de pago</caption>
                <thead>
                  <tr>
                    <th>Categoría</th>
                    <th>Tipo</th>
                    <th>Movimientos</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${globalAnalytics.byCategory
                    .map(
                      c => `<tr>
                        <th>${escapeHtml(c.category)}</th>
                        <td><span class="badge">${c.kind === 'ingreso' ? 'Ingreso' : 'Expensa / Egreso'}</span></td>
                        <td>${c.count}</td>
                        <td class="${c.kind === 'ingreso' ? 'text-ok' : 'text-danger'}"><strong>${formatMoney(c.total)}</strong></td>
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>`
      }
    </section>

    <section class="card" aria-labelledby="wallets-title">
      <h2 id="wallets-title">💳 Billeteras y Medios de Pago (Separados por Dueño)</h2>
      <p class="text-muted">Selecciona cualquier medio de pago para inspeccionar su analítica individual y sus movimientos detallados.</p>
      <div class="grid-3" style="margin-block-end:1rem;">
        ${wallets
          .map(w => {
            const ownerLabel =
              w.owner_user_id === state.user.id
                ? state.user.first_name
                : w.owner_user_id && state.partner && w.owner_user_id === state.partner.id
                ? state.partner.first_name
                : 'Compartida (Ambos)';
            const isSelected = selectedWallet && selectedWallet.id === w.id;
            return `<div class="stat-box" style="border-width:${isSelected ? '2px' : '1px'}; border-color:${isSelected ? 'var(--brand)' : 'var(--border)'};">
              <div style="display:flex; justify-content:space-between; align-items:start;">
                <strong>${escapeHtml(w.name)}</strong>
                <span class="badge">${escapeHtml(w.type)}</span>
              </div>
              <div class="text-muted">Dueño: ${escapeHtml(ownerLabel)} ${w.details ? `· ${escapeHtml(w.details)}` : ''}</div>
              <div class="stat-value">${formatMoney(w.balance)}</div>
              <div class="text-muted" style="margin-block:0.35rem;">
                <span class="text-ok">+${formatMoney(w.income)}</span> / <span class="text-danger">-${formatMoney(w.expense)}</span>
              </div>
              <div style="display:flex; gap:0.4rem; margin-block-start:0.5rem;">
                <button type="button" class="btn btn-sm ${isSelected ? 'btn-primary' : ''}" data-action="select-wallet" data-id="${w.id}">
                  ${isSelected ? 'Viendo Analítica' : 'Ver Analítica del Medio'}
                </button>
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-wallet" data-id="${w.id}" aria-label="Eliminar billetera ${escapeHtml(w.name)}">✕</button>
              </div>
            </div>`;
          })
          .join('')}
      </div>

      ${
        selectedWallet
          ? `<div class="card" style="background:var(--surface-alt);">
              <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap;">
                <h3 style="margin:0;">🔍 Analítica de: ${escapeHtml(selectedWallet.name)} (${escapeHtml(selectedWallet.type)})</h3>
                <button type="button" class="btn btn-sm" data-action="select-wallet" data-id="">Cerrar detalle</button>
              </div>
              <p class="text-muted">Ingresos en este medio: <strong class="text-ok">+${formatMoney(selectedWallet.income)}</strong> · Egresos en este medio: <strong class="text-danger">-${formatMoney(selectedWallet.expense)}</strong> · Saldo actual: <strong>${formatMoney(selectedWallet.balance)}</strong></p>
              ${renderTransactionsTable(selectedWallet.transactions, `Movimientos de ${selectedWallet.name}`)}
            </div>`
          : ''
      }
    </section>

    <div class="grid-2">
      <section class="card" aria-labelledby="new-tx-title">
        <h2 id="new-tx-title">➕ Registrar Movimiento (Ingreso / Egreso)</h2>
        <form id="form-new-transaction">
          <div class="grid-2">
            <div class="field">
              <label for="tx-kind">Tipo de movimiento *</label>
              <select id="tx-kind" name="kind" required>
                <option value="egreso">Egreso / Gasto</option>
                <option value="ingreso">Ingreso de dinero</option>
              </select>
            </div>
            <div class="field">
              <label for="tx-scope">Alcance *</label>
              <select id="tx-scope" name="scope" required>
                <option value="compartido">Gasto / Ingreso Compartido</option>
                <option value="particular">Gasto / Ingreso Particular</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-wallet">Medio de pago (Billetera) *</label>
              <select id="tx-wallet" name="wallet_id" required>
                ${wallets.map(w => `<option value="${w.id}">${escapeHtml(w.name)} (${escapeHtml(w.type)})</option>`).join('')}
              </select>
            </div>
            <div class="field">
              <label for="tx-mode">Modo de operación *</label>
              <select id="tx-mode" name="mode" required>
                <option value="transferencia">Transferencia</option>
                <option value="efectivo">Efectivo</option>
                <option value="tarjeta_credito">Tarjeta de Crédito</option>
                <option value="tarjeta_debito">Tarjeta de Débito</option>
                <option value="qr">QR / Billetera Virtual</option>
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-who">¿Quién realizó la acción? *</label>
              <select id="tx-who" name="user_id" required>
                <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
                ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
              </select>
            </div>
            <div class="field">
              <label for="tx-amount">Monto *</label>
              <input type="number" id="tx-amount" name="amount" step="0.01" min="0.01" required>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="tx-category">Categoría (En qué se gastó / origen) *</label>
              <input type="text" id="tx-category" name="category" placeholder="Ej: Supermercado, Alquiler, Cita, Sueldo" required>
            </div>
            <div class="field">
              <label for="tx-date">Fecha *</label>
              <input type="date" id="tx-date" name="date" value="${new Date().toISOString().slice(0, 10)}" required>
            </div>
          </div>
          <div class="field">
            <label for="tx-desc">Detalle adicional</label>
            <input type="text" id="tx-desc" name="description" placeholder="Ej: Compra semanal en Coto">
          </div>
          <button type="submit" class="btn btn-primary">Guardar Movimiento</button>
        </form>
      </section>

      <section class="card" aria-labelledby="new-wallet-title">
        <h2 id="new-wallet-title">🏦 Agregar Medio de Pago / Billetera</h2>
        <form id="form-new-wallet">
          <div class="field">
            <label for="w-name">Nombre del medio de pago *</label>
            <input type="text" id="w-name" name="name" placeholder="Ej: Visa Galicia, MercadoPago, Efectivo Casa" required>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="w-type">Tipo *</label>
              <select id="w-type" name="type" required>
                <option value="billetera_virtual">Billetera Virtual</option>
                <option value="tarjeta_credito">Tarjeta de Crédito</option>
                <option value="tarjeta_debito">Tarjeta de Débito</option>
                <option value="efectivo">Efectivo</option>
                <option value="transferencia">Cuenta Bancaria</option>
              </select>
            </div>
            <div class="field">
              <label for="w-owner">Dueño de la billetera</label>
              <select id="w-owner" name="owner_user_id">
                <option value="">Compartida (Ambos)</option>
                <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
                ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
              </select>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="w-balance">Monto / Saldo inicial</label>
              <input type="number" id="w-balance" name="initial_balance" step="0.01" value="0">
            </div>
            <div class="field">
              <label for="w-details">Datos / Alias / Últimos 4 dígitos</label>
              <input type="text" id="w-details" name="details" placeholder="Ej: Alias pareja.mp / *4512">
            </div>
          </div>
          <button type="submit" class="btn btn-primary">Crear Billetera</button>
        </form>
      </section>
    </div>

    <section class="card">
      <h2>📜 Historial Global de Movimientos</h2>
      ${renderTransactionsTable(transactions, 'Todos los movimientos de la pareja')}
    </section>
  `;
}

function renderTransactionsTable(txs, captionText) {
  if (!txs || txs.length === 0) {
    return '<p class="text-muted">Sin movimientos registrados.</p>';
  }
  return `
    <div tabindex="0" role="region" aria-label="${escapeHtml(captionText)}" class="table-wrapper">
      <table style="--label-2:'Medio / Modo'; --label-3:'En qué / Categoría'; --label-4:'Quién'; --label-5:'Monto'; --label-6:'Acción';">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Medio / Modo</th>
            <th>En qué se gastó / Categoría</th>
            <th>Quién lo realizó</th>
            <th>Monto</th>
            <th>Acción</th>
          </tr>
        </thead>
        <tbody>
          ${txs
            .map(
              tx => `<tr>
                <th>${escapeHtml(tx.date)}</th>
                <td>${escapeHtml(tx.wallet_name || '')} <span class="badge">${escapeHtml(tx.mode)} · ${escapeHtml(tx.scope)}</span></td>
                <td><strong>${escapeHtml(tx.category)}</strong> ${tx.description ? `— ${escapeHtml(tx.description)}` : ''}</td>
                <td>${escapeHtml(tx.user_first_name || '')}</td>
                <td class="${tx.kind === 'ingreso' ? 'text-ok' : 'text-danger'}">
                  <strong>${tx.kind === 'ingreso' ? '+' : '-'}${formatMoney(tx.amount)}</strong>
                </td>
                <td>
                  <button type="button" class="btn btn-sm btn-danger" data-action="delete-tx" data-id="${tx.id}">Eliminar</button>
                </td>
              </tr>`
            )
            .join('')}
        </tbody>
      </table>
    </div>
  `;
}

/* ================= FASE 2: TAREAS Y TABLEROS COMPARTIDOS ================= */
async function renderTasksTab(container) {
  const { tasks } = await api('/api/tasks');
  const boards = Array.from(new Set(['General', 'Hogar', 'Compras y Trámites', ...tasks.map(t => t.board_name)]));

  container.innerHTML = `
    <section class="card">
      <h2>✅ Tableros de Tareas Compartidos</h2>
      <form id="form-new-task">
        <div class="grid-3">
          <div class="field">
            <label for="task-title">Tarea propuesta *</label>
            <input type="text" id="task-title" name="title" placeholder="Ej: Pagar expensas, Limpiar balcón" required>
          </div>
          <div class="field">
            <label for="task-board">Tablero</label>
            <input type="text" id="task-board" name="board_name" list="board-suggestions" value="General" required>
            <datalist id="board-suggestions">
              ${boards.map(b => `<option value="${escapeHtml(b)}">`).join('')}
            </datalist>
          </div>
          <div class="field">
            <label for="task-priority">Prioridad</label>
            <select id="task-priority" name="priority">
              <option value="alta">🔴 Alta</option>
              <option value="media" selected>🟡 Media</option>
              <option value="baja">🟢 Baja</option>
            </select>
          </div>
        </div>
        <div class="grid-2">
          <div class="field">
            <label for="task-assigned">¿Para quién es?</label>
            <select id="task-assigned" name="assigned_to">
              <option value="both">👫 Ambos</option>
              <option value="${state.user.id}">${escapeHtml(state.user.first_name)}</option>
              ${state.partner ? `<option value="${state.partner.id}">${escapeHtml(state.partner.first_name)}</option>` : ''}
            </select>
          </div>
          <div class="field">
            <label for="task-due">Fecha y hora de la tarea</label>
            <input type="datetime-local" id="task-due" name="due_datetime">
          </div>
        </div>
        <button type="submit" class="btn btn-primary">Agregar Tarea al Tablero</button>
      </form>
    </section>

    <div class="grid-2">
      ${boards
        .map(board => {
          const boardTasks = tasks.filter(t => t.board_name === board);
          return `<section class="card">
            <h3>📋 Tablero: ${escapeHtml(board)} (${boardTasks.length})</h3>
            ${
              boardTasks.length === 0
                ? '<p class="text-muted">Sin tareas en este tablero.</p>'
                : `<ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:0.6rem;">
                    ${boardTasks
                      .map(t => {
                        const who =
                          t.assigned_to === 'both'
                            ? 'Ambos'
                            : Number(t.assigned_to) === state.user.id
                            ? state.user.first_name
                            : state.partner?.first_name || 'Pareja';
                        return `<li class="stat-box" style="display:flex; justify-content:space-between; align-items:center; gap:0.5rem;">
                          <label style="display:flex; align-items:center; gap:0.6rem; font-weight:500; cursor:pointer;">
                            <input type="checkbox" data-action="toggle-task" data-id="${t.id}" ${t.completed ? 'checked' : ''}>
                            <span style="${t.completed ? 'text-decoration:line-through; opacity:0.6;' : ''}">
                              <strong>${escapeHtml(t.title)}</strong>
                              <span class="badge">${escapeHtml(t.priority)}</span>
                              <span class="badge">Para: ${escapeHtml(who)}</span>
                              ${t.due_datetime ? `<small class="text-muted"> · 🕒 ${escapeHtml(t.due_datetime.replace('T', ' '))}</small>` : ''}
                            </span>
                          </label>
                          <button type="button" class="btn btn-sm btn-danger" data-action="delete-task" data-id="${t.id}">✕</button>
                        </li>`;
                      })
                      .join('')}
                  </ul>`
            }
          </section>`;
        })
        .join('')}
    </div>
  `;
}

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

/* ================= FASE 2: CALENDARIO Y RECORDATORIOS ================= */
async function renderCalendarTab(container) {
  const { events } = await api('/api/calendar');

  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2>📅 Agendar Día y Hora Juntos</h2>
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
            <button type="submit" class="btn btn-primary">Agendar en Calendario</button>
            <button type="button" class="btn" data-action="enable-browser-notif">🔔 Activar Avisos del Navegador</button>
          </div>
        </form>
      </section>

      <section class="card">
        <h2>🗓️ Próximos Eventos en Agenda (${events.length})</h2>
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
                          <div class="text-muted">🕒 ${escapeHtml(ev.start_datetime.replace('T', ' '))} ${ev.end_datetime ? `→ ${escapeHtml(ev.end_datetime.replace('T', ' '))}` : ''}</div>
                          <span class="badge">⏰ Recordatorio: ${ev.remind_offset_value} ${escapeHtml(ev.remind_offset_unit)} antes</span>
                          ${ev.description ? `<p style="margin:0.4rem 0 0 0;">${escapeHtml(ev.description)}</p>` : ''}
                        </div>
                        <button type="button" class="btn btn-sm btn-danger" data-action="delete-event" data-id="${ev.id}">✕</button>
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

/* ================= HERRAMIENTAS: "NOTITAS" (CANVAS + SOBRESCRITURA) Y NOTAS CON FOTOS ================= */
async function renderNotitasTab(container) {
  const [{ notitas }, { notes }] = await Promise.all([api('/api/notitas'), api('/api/notes')]);
  const myNotita = notitas.find(n => n.author_user_id === state.user.id);
  const partnerNotita = notitas.find(n => n.author_user_id !== state.user.id);

  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2>💌 "Notitas" en Pareja (En vivo)</h2>
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
          <button type="submit" class="btn btn-primary">📨 Enviar "Nota Nueva" (Sobrescribir anterior)</button>
        </form>
      </section>

      <section class="card">
        <h2>📸 Notas Compartidas (con Fotos)</h2>
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
          <button type="submit" class="btn btn-primary">Guardar Nota Compartida</button>
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
                        <button type="button" class="btn btn-sm btn-danger" data-action="delete-note" data-id="${n.id}">✕</button>
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

  initDrawingCanvas();
}

function initDrawingCanvas() {
  const canvas = document.getElementById('notita-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  let drawing = false;
  let hasDrawn = false;

  const getPos = e => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height
    };
  };

  canvas.addEventListener('pointerdown', e => {
    drawing = true;
    hasDrawn = true;
    ctx.strokeStyle = document.getElementById('notita-color')?.value || '#e11d48';
    const p = getPos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  });

  canvas.addEventListener('pointermove', e => {
    if (!drawing) return;
    const p = getPos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });

  window.addEventListener('pointerup', () => {
    drawing = false;
  });

  document.getElementById('btn-clear-canvas')?.addEventListener('click', () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasDrawn = false;
  });

  canvas.dataset.hasDrawn = () => (hasDrawn ? '1' : '0');
  canvas._hasDrawn = () => hasDrawn;
}

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

/* ================= HERRAMIENTAS: ANTOJOS + SUGERIR ANTOJO ================= */
async function renderCravingsTab(container) {
  const { cravings } = await api('/api/cravings');
  const pendingForMe = cravings.filter(c => c.status === 'suggested' && c.owner_user_id === state.user.id);
  const myActive = cravings.filter(c => c.status === 'active' && c.owner_user_id === state.user.id);
  const partnerActive = cravings.filter(c => c.status === 'active' && c.owner_user_id !== state.user.id);

  container.innerHTML = `
    ${
      pendingForMe.length > 0
        ? `<section class="card" style="border-color:var(--brand); border-width:2px;">
            <h2>💌 Sugerencias de Antojos de tu Pareja (${pendingForMe.length})</h2>
            <p class="text-muted">Si aceptas un antojo sugerido, se añade automáticamente a tu lista de antojos.</p>
            <div class="grid-2">
              ${pendingForMe
                .map(
                  c => `<div class="stat-box">
                    <strong>${escapeHtml(c.title)}</strong>
                    <p class="text-muted">Sugerido por ${escapeHtml(c.suggested_by_name || 'tu pareja')} ${c.price ? `· ${formatMoney(c.price)}` : ''}</p>
                    ${c.description ? `<p>${escapeHtml(c.description)}</p>` : ''}
                    <div style="display:flex; gap:0.5rem;">
                      <button type="button" class="btn btn-sm btn-primary" data-action="respond-craving" data-id="${c.id}" data-accept="1">✓ Aceptar Antojo</button>
                      <button type="button" class="btn btn-sm btn-danger" data-action="respond-craving" data-id="${c.id}" data-accept="0">✕ Rechazar</button>
                    </div>
                  </div>`
                )
                .join('')}
            </div>
          </section>`
        : ''
    }

    <section class="card">
      <h2>🎁 Cargar Antojo o Sugerir Antojo a mi Pareja</h2>
      <form id="form-new-craving">
        <div class="grid-2">
          <div class="field">
            <label for="crav-title">¿Qué quieren? (Producto, plan o servicio) *</label>
            <input type="text" id="crav-title" name="title" placeholder="Ej: Chocolate Rapanui, Perfume, Cena de sushi" required>
          </div>
          <div class="field">
            <label for="crav-mode">Destino del antojo</label>
            <select id="crav-mode" name="suggest_to_partner">
              <option value="">Añadir a MI lista de antojos</option>
              <option value="1">💡 Sugerir este antojo a mi pareja (para que acepte o rechace)</option>
            </select>
          </div>
        </div>
        <div class="grid-3">
          <div class="field">
            <label for="crav-price">Precio estimado (opcional)</label>
            <input type="number" id="crav-price" name="price" step="0.01" placeholder="0.00">
          </div>
          <div class="field">
            <label for="crav-url">URL del producto (opcional)</label>
            <input type="url" id="crav-url" name="url" placeholder="https://..." autocorrect="off" autocapitalize="none" spellcheck="false">
          </div>
          <div class="field">
            <label for="crav-photo">Foto (opcional)</label>
            <input type="file" id="crav-photo" accept="image/*">
          </div>
        </div>
        <div class="field">
          <label for="crav-desc">Descripción / Detalles (talle, sabor, color)</label>
          <input type="text" id="crav-desc" name="description" placeholder="Ej: Chocolate amargo 70%">
        </div>
        <button type="submit" class="btn btn-primary">Guardar Antojo</button>
      </form>
    </section>

    <div class="grid-2">
      <section class="card">
        <h3>✨ Antojos de ${escapeHtml(state.partner?.first_name || 'mi Pareja')} (${partnerActive.length})</h3>
        ${renderCravingsList(partnerActive)}
      </section>
      <section class="card">
        <h3>🍒 Mis Antojos (${myActive.length})</h3>
        ${renderCravingsList(myActive)}
      </section>
    </div>
  `;
}

function renderCravingsList(list) {
  if (list.length === 0) return '<p class="text-muted">Sin antojos cargados.</p>';
  return `<div style="display:flex; flex-direction:column; gap:0.75rem;">
    ${list
      .map(
        c => `<div class="stat-box">
          <div style="display:flex; justify-content:space-between; align-items:start;">
            <div>
              <strong>${escapeHtml(c.title)}</strong>
              ${c.price ? `<span class="badge">${formatMoney(c.price)}</span>` : ''}
            </div>
            <button type="button" class="btn btn-sm btn-danger" data-action="delete-craving" data-id="${c.id}">✕</button>
          </div>
          ${c.description ? `<p style="margin:0.35rem 0;">${escapeHtml(c.description)}</p>` : ''}
          ${c.url ? `<p style="margin:0.25rem 0;"><a href="${escapeHtml(c.url)}" target="_blank" rel="noopener">🔗 Ver link del producto</a></p>` : ''}
          ${c.photo_url ? `<img src="${escapeHtml(c.photo_url)}" alt="${escapeHtml(c.title)}" loading="lazy" width="240" height="160" style="max-width:100%; height:auto; border-radius:0.5rem; margin-top:0.4rem;">` : ''}
        </div>`
      )
      .join('')}
  </div>`;
}

/* ================= HERRAMIENTAS: METAS / PROYECTOS (MONETARIA, RUTINA, TIEMPO) ================= */
async function renderGoalsTab(container) {
  const { goals } = await api('/api/goals');

  container.innerHTML = `
    <section class="card">
      <h2>🎯 Metas y Proyectos en Pareja</h2>
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
              <option value="monetary">💰 Monetaria (ej: 1.2M para casa)</option>
              <option value="habit">🏋️ Progreso / Rutina (diaria, semanal, mensual, anual)</option>
              <option value="time">⏱️ De Tiempo (Cuenta regresiva a fecha)</option>
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
                <span class="badge">${g.goal_type === 'monetary' ? '💰 Monetaria' : g.goal_type === 'habit' ? `🏋️ Rutina (${escapeHtml(g.frequency)})` : '⏱️ Cuenta Regresiva'}</span>
                ${g.finished ? '<span class="badge" style="background:var(--ok); color:#000;">✓ FINALIZADO</span>' : ''}
                <h3 style="margin:0.35rem 0;">${escapeHtml(g.title)}</h3>
                <div class="text-muted">Creado por ${escapeHtml(g.creator_name || '')} · Inicio: ${escapeHtml(g.created_at.slice(0, 10))}</div>
              </div>
              <button type="button" class="btn btn-sm btn-danger" data-action="delete-goal" data-id="${g.id}">✕</button>
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
                            <button type="button" class="btn btn-sm btn-primary" data-action="progress-goal" data-id="${g.id}">+ Sumar Aporte</button>
                            <button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}">🏁 Finalizado en el acto</button>
                          </div>`
                       : ''
                   }`
                : g.goal_type === 'habit'
                ? `<p>Progreso acumulado: <strong>${g.current_value} / ${g.target_value}</strong> cumplimientos (${escapeHtml(g.frequency)}) — ${pct}%</p>
                   ${
                     !g.finished
                       ? `<div style="display:flex; gap:0.4rem; flex-wrap:wrap;">
                            <button type="button" class="btn btn-sm btn-primary" data-action="progress-goal" data-id="${g.id}" data-delta="1">✓ Cumplí hoy (${escapeHtml(g.frequency)})</button>
                            <button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}">🏁 Finalizado en el acto</button>
                          </div>`
                       : ''
                   }`
                : `<div class="stat-box" style="margin-block:0.5rem;">
                     <div class="text-muted">Tiempo restante hasta ${escapeHtml((g.target_date || '').replace('T', ' '))}:</div>
                     <div class="stat-value" data-countdown-target="${escapeHtml(g.target_date)}" data-finished="${g.finished}">Calculando...</div>
                   </div>
                   ${
                     !g.finished
                       ? `<button type="button" class="btn btn-sm" data-action="finish-goal" data-id="${g.id}">🏁 Finalizado en el acto</button>`
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
        el.textContent = '🎉 ¡Proyecto Finalizado!';
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

/* ================= HERRAMIENTAS: CÁPSULA DEL TIEMPO ================= */
async function renderCapsulesTab(container) {
  const { capsules } = await api('/api/capsules');

  container.innerHTML = `
    <section class="card">
      <h2>⏳ Cápsula del Tiempo (Cartas dedicadas con desbloqueo programado)</h2>
      <form id="form-new-capsule">
        <div class="grid-2">
          <div class="field">
            <label for="cap-title">Título de la carta *</label>
            <input type="text" id="cap-title" name="title" placeholder="Ej: Para nuestro próximo aniversario" required>
          </div>
          <div class="field">
            <label for="cap-unlock">Fecha y hora en que se desbloquea para leer *</label>
            <input type="datetime-local" id="cap-unlock" name="unlock_at" required>
          </div>
        </div>
        <div class="field">
          <label for="cap-body">Cuerpo de la carta *</label>
          <textarea id="cap-body" name="body" rows="4" required placeholder="Escribe tu carta para el futuro..."></textarea>
        </div>
        <div class="field">
          <label for="cap-photo">Foto recuerdo (opcional)</label>
          <input type="file" id="cap-photo" accept="image/*">
        </div>
        <button type="submit" class="btn btn-primary">🔒 Sellar Cápsula del Tiempo</button>
      </form>
    </section>

    <div class="grid-2">
      ${
        capsules.length === 0
          ? '<p class="text-muted">Aún no hay cartas en la cápsula del tiempo.</p>'
          : capsules
              .map(
                c => `<article class="card">
                  <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                      <span class="badge">${c.locked ? '🔒 Bloqueada' : '🔓 Desbloqueada'}</span>
                      <h3 style="margin:0.35rem 0;">${escapeHtml(c.title)}</h3>
                      <div class="text-muted">De ${escapeHtml(c.author_name || '')} · Se desbloquea: <strong>${escapeHtml(c.unlock_at.replace('T', ' '))}</strong></div>
                    </div>
                    <button type="button" class="btn btn-sm btn-danger" data-action="delete-capsule" data-id="${c.id}">✕</button>
                  </div>
                  <p style="margin-top:0.75rem; white-space:pre-wrap;">${escapeHtml(c.body)}</p>
                  ${!c.locked && c.photo_url ? `<img src="${escapeHtml(c.photo_url)}" alt="${escapeHtml(c.title)}" loading="lazy" width="320" height="200" style="max-width:100%; height:auto; border-radius:0.5rem;">` : ''}
                </article>`
              )
              .join('')
      }
    </div>
  `;
}

/* ================= HERRAMIENTAS: CUADERNOS COMPARTIDOS (MARKDOWN) ================= */
async function renderNotebooksTab(container) {
  const { notebooks } = await api('/api/notebooks');
  const activeNb = notebooks.find(n => n.id === state.activeNotebookId) || notebooks[0] || null;
  if (activeNb) state.activeNotebookId = activeNb.id;
  const activePage = activeNb?.pages?.find(p => p.id === state.activePageId) || activeNb?.pages?.[0] || null;
  if (activePage) state.activePageId = activePage.id;

  container.innerHTML = `
    <section class="card">
      <h2>📓 Cuadernos Compartidos (Markdown, Listas, Checkboxes, Fotos)</h2>
      <form id="form-new-notebook" style="display:flex; gap:0.6rem; flex-wrap:wrap; align-items:flex-end;">
        <div class="field" style="margin:0; width:90px;">
          <label for="nb-icon">Ícono</label>
          <input type="text" id="nb-icon" name="icon" value="📓">
        </div>
        <div class="field" style="margin:0; flex:1;">
          <label for="nb-title">Título del nuevo cuaderno *</label>
          <input type="text" id="nb-title" name="title" placeholder="Ej: Recetario, Mudanza, Viajes, Películas" required>
        </div>
        <button type="submit" class="btn btn-primary">Crear Cuaderno</button>
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
                <button type="button" class="btn btn-sm btn-danger" data-action="delete-notebook" data-id="${activeNb.id}">Eliminar Cuaderno</button>
              </div>

              <div style="display:flex; gap:0.4rem; flex-wrap:wrap; margin-block-end:1rem;">
                ${activeNb.pages
                  .map(
                    p => `<button type="button" class="btn btn-sm ${activePage && activePage.id === p.id ? 'btn-primary' : ''}" data-action="select-page" data-id="${p.id}">
                      📄 ${escapeHtml(p.title)}
                    </button>`
                  )
                  .join('')}
              </div>

              <form id="form-new-page" data-notebook-id="${activeNb.id}" style="display:flex; gap:0.5rem; margin-block-end:1rem;">
                <input type="text" name="title" placeholder="Nueva página..." aria-label="Título de nueva página" required>
                <button type="submit" class="btn btn-sm btn-primary">+ Página</button>
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
                        <button type="submit" class="btn btn-primary">💾 Guardar Página</button>
                        <button type="button" class="btn btn-danger" data-action="delete-page" data-id="${activePage.id}">Eliminar Página</button>
                      </div>
                    </form>`
                  : ''
              }
            </section>

            <section class="card">
              <h3>👁️ Vista Previa Interactiva</h3>
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

/* ================= FASE 2: CONFIGURACIÓN INDIVIDUAL Y EN PAREJA ================= */
function renderSettingsTab(container) {
  const u = state.user;
  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2>👤 Configuración Individual del Usuario</h2>
        <form id="form-user-settings">
          <div class="grid-2">
            <div class="field">
              <label for="set-fname">Nombre *</label>
              <input type="text" id="set-fname" name="first_name" value="${escapeHtml(u.first_name)}" required>
            </div>
            <div class="field">
              <label for="set-lname">Apellido *</label>
              <input type="text" id="set-lname" name="last_name" value="${escapeHtml(u.last_name)}" required>
            </div>
          </div>
          <div class="grid-2">
            <div class="field">
              <label for="set-age">Edad *</label>
              <input type="number" id="set-age" name="age" value="${u.age}" required>
            </div>
            <div class="field">
              <label for="set-email">Correo *</label>
              <input type="email" id="set-email" name="email" value="${escapeHtml(u.email)}" required>
            </div>
          </div>
          <div class="grid-3">
            <div class="field">
              <label for="set-theme">Apariencia</label>
              <select id="set-theme" name="theme">
                <option value="system" ${u.theme === 'system' ? 'selected' : ''}>Sistema (Auto)</option>
                <option value="light" ${u.theme === 'light' ? 'selected' : ''}>Modo Claro</option>
                <option value="dark" ${u.theme === 'dark' ? 'selected' : ''}>Modo Oscuro</option>
              </select>
            </div>
            <div class="field">
              <label for="set-lang">Idioma</label>
              <select id="set-lang" name="language">
                <option value="es" ${u.language === 'es' ? 'selected' : ''}>Español</option>
                <option value="en" ${u.language === 'en' ? 'selected' : ''}>English</option>
              </select>
            </div>
            <div class="field">
              <label for="set-currency">Moneda</label>
              <select id="set-currency" name="currency">
                <option value="ARS" ${u.currency === 'ARS' ? 'selected' : ''}>ARS ($ Peso Arg)</option>
                <option value="USD" ${u.currency === 'USD' ? 'selected' : ''}>USD (US Dollar)</option>
                <option value="EUR" ${u.currency === 'EUR' ? 'selected' : ''}>EUR (Euro)</option>
              </select>
            </div>
          </div>
          <div class="field">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer;">
              <input type="checkbox" name="notifications_enabled" ${u.notifications_enabled ? 'checked' : ''}>
              Recibir notificaciones de pareja y agenda
            </label>
          </div>
          <div class="field">
            <label for="set-avatar-file">Cambiar foto de perfil</label>
            <input type="file" id="set-avatar-file" accept="image/*">
          </div>
          <div class="field">
            <label for="set-new-pw">Nueva contraseña (dejar vacío para mantener la actual)</label>
            <input type="password" id="set-new-pw" name="new_password" autocomplete="new-password">
          </div>
          <button type="submit" class="btn btn-primary">Guardar Mis Preferencias</button>
        </form>
      </section>

      <section class="card">
        <h2>💑 Configuración en Pareja y Motor Cloud/Local</h2>
        <p class="text-muted">Estado de vinculación: <strong>${state.partner ? `Vinculado con ${escapeHtml(state.partner.first_name)} ${escapeHtml(state.partner.last_name)}` : 'Pendiente de vincular'}</strong></p>
        <p class="text-muted">Motor DB activo: <strong>${escapeHtml(state.config.db_mode || 'local')}</strong> · Cloud Storage: <strong>${escapeHtml(state.config.storage_mode || 'local')}</strong></p>
        <button type="button" class="btn btn-primary" data-action="open-setup-dialog">⚙️ Configurar Proveedor Base de Datos / SpiderWebAPI</button>
      </section>
    </div>
  `;
}

/* ================= EVENT LISTENERS & DELEGATION ================= */
document.addEventListener('DOMContentLoaded', () => {
  bootstrap();

  // Navigation tabs
  document.getElementById('nav-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn) return;
    state.activeTab = btn.dataset.tab;
    renderActiveTab();
  });

  // Setup Dialog
  const setupDialog = document.getElementById('dialog-setup');
  document.getElementById('btn-open-setup')?.addEventListener('click', () => {
    populateSetupDialog();
    setupDialog.showModal();
  });
  document.getElementById('btn-close-setup')?.addEventListener('click', () => setupDialog.close());
  setupDialog?.addEventListener('close', () => {
    setupDialog.returnValue = '';
  });

  document.getElementById('btn-test-spider')?.addEventListener('click', async () => {
    const out = document.getElementById('spider-test-output');
    out.textContent = 'Probando conexión con SpiderWebAPI...';
    try {
      const res = await api('/api/spiderweb/test', {
        method: 'POST',
        body: {
          spiderwebdbname: document.getElementById('setup-dbname').value,
          spiderapikey: document.getElementById('setup-apikey').value,
          spidercloudstrogaeid: document.getElementById('setup-storageid').value
        }
      });
      out.textContent = res.ok
        ? `Conexión exitosa: ${JSON.stringify(res.databases || res.data).slice(0, 140)}`
        : `Aviso: ${res.error}`;
    } catch (err) {
      out.textContent = `Error: ${err.message}`;
    }
  });

  document.getElementById('form-setup')?.addEventListener('submit', async e => {
    e.preventDefault();
    const res = await api('/api/setup', {
      method: 'POST',
      body: {
        db_mode: document.getElementById('setup-db-mode').value,
        storage_mode: document.getElementById('setup-storage-mode').value,
        spiderwebdbname: document.getElementById('setup-dbname').value,
        spiderapikey: document.getElementById('setup-apikey').value,
        spidercloudstrogaeid: document.getElementById('setup-storageid').value
      }
    });
    state.config = res.config;
    setupDialog.close();
    showStatus('Configuración de almacenamiento y base de datos guardada.');
    if (state.activeTab === 'settings') renderActiveTab();
  });

  // Notifications Dialog
  const notifDialog = document.getElementById('dialog-notifications');
  document.getElementById('btn-open-notifications')?.addEventListener('click', () => {
    const listEl = document.getElementById('notifications-list');
    if (state.notifications.length === 0) {
      listEl.innerHTML = '<p class="text-muted">No tienes notificaciones.</p>';
    } else {
      listEl.innerHTML = state.notifications
        .map(
          n => `<div class="stat-box" style="margin-block-end:0.5rem;">
            <strong>${escapeHtml(n.title)}</strong> ${!n.read ? '<span class="badge">Nueva</span>' : ''}
            <p style="margin:0.25rem 0;">${escapeHtml(n.body)}</p>
            <small class="text-muted">${escapeHtml(n.created_at)}</small>
          </div>`
        )
        .join('');
    }
    notifDialog.showModal();
  });
  notifDialog?.addEventListener('close', () => {
    notifDialog.returnValue = '';
  });

  document.getElementById('btn-mark-read')?.addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST' });
    state.notifications.forEach(n => (n.read = 1));
    document.getElementById('notif-count').textContent = '0';
    notifDialog.close();
  });

  // Auth Login / Register / Logout
  document.getElementById('form-login')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const fd = new FormData(e.target);
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: Object.fromEntries(fd.entries())
      });
      state.token = res.token;
      localStorage.setItem('hifa_token', res.token);
      await bootstrap();
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  document.getElementById('form-register')?.addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      const avatarUrl = await fileToUploadedUrl(document.getElementById('reg-avatar-file'));
      if (avatarUrl) payload.avatar_url = avatarUrl;
      const res = await api('/api/auth/register', { method: 'POST', body: payload });
      state.token = res.token;
      localStorage.setItem('hifa_token', res.token);
      await bootstrap();
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  document.getElementById('btn-logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.token = '';
    localStorage.removeItem('hifa_token');
    showAuthView();
  });

  // Delegated clicks inside #tab-content
  document.getElementById('tab-content')?.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    try {
      if (action === 'goto-tab') {
        state.activeTab = btn.dataset.tab;
        return renderActiveTab();
      }
      if (action === 'go-couple') {
        state.activeTab = 'couple';
        return renderActiveTab();
      }
      if (action === 'open-setup-dialog') {
        populateSetupDialog();
        return setupDialog.showModal();
      }
      if (action === 'copy-pair-link') {
        await navigator.clipboard?.writeText(btn.dataset.link);
        return showStatus('Link copiado al portapapeles.');
      }
      if (action === 'regenerate-pair-code') {
        const res = await api('/api/couple/code', { method: 'POST' });
        state.user.pair_code = res.pair_code;
        return renderActiveTab();
      }
      if (action === 'select-wallet') {
        state.selectedWalletId = btn.dataset.id ? Number(btn.dataset.id) : null;
        return renderActiveTab();
      }
      if (action === 'delete-wallet') {
        await api(`/api/wallets/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'delete-tx') {
        await api(`/api/transactions/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'toggle-task') {
        await api(`/api/tasks/${btn.dataset.id}`, { method: 'PATCH', body: { completed: btn.checked } });
        return renderActiveTab();
      }
      if (action === 'delete-task') {
        await api(`/api/tasks/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'delete-list') {
        await api(`/api/lists/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'toggle-list-item') {
        await api(`/api/list-items/${btn.dataset.id}`, { method: 'PATCH', body: { checked: btn.checked } });
        return renderActiveTab();
      }
      if (action === 'delete-list-item') {
        await api(`/api/list-items/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'delete-event') {
        await api(`/api/calendar/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'enable-browser-notif') {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          showStatus(`Permiso de notificaciones: ${perm}`);
        }
        return;
      }
      if (action === 'delete-note') {
        await api(`/api/notes/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'recover-streak') {
        const res = await api('/api/daily-question/recover', { method: 'POST', body: {} });
        showStatus(`¡Racha recuperada! Te quedan ${res.streak_recoveries_left} recuperaciones este mes.`);
        return renderActiveTab();
      }
      if (action === 'respond-craving') {
        await api(`/api/cravings/${btn.dataset.id}/respond`, {
          method: 'POST',
          body: { accept: btn.dataset.accept === '1' }
        });
        showStatus(btn.dataset.accept === '1' ? '¡Antojo aceptado y añadido a tu lista!' : 'Sugerencia descartada.');
        return renderActiveTab();
      }
      if (action === 'delete-craving') {
        await api(`/api/cravings/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'progress-goal') {
        const id = btn.dataset.id;
        const input = document.getElementById(`goal-add-${id}`);
        const delta = input ? Number(input.value || 0) : Number(btn.dataset.delta || 1);
        await api(`/api/goals/${id}/progress`, { method: 'POST', body: { delta } });
        return renderActiveTab();
      }
      if (action === 'finish-goal') {
        await api(`/api/goals/${btn.dataset.id}/finish`, { method: 'POST' });
        showStatus('¡Proyecto marcado como Finalizado!');
        return renderActiveTab();
      }
      if (action === 'delete-goal') {
        await api(`/api/goals/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'delete-capsule') {
        await api(`/api/capsules/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'select-notebook') {
        state.activeNotebookId = Number(btn.dataset.id);
        state.activePageId = null;
        return renderActiveTab();
      }
      if (action === 'select-page') {
        state.activePageId = Number(btn.dataset.id);
        return renderActiveTab();
      }
      if (action === 'delete-notebook') {
        await api(`/api/notebooks/${btn.dataset.id}`, { method: 'DELETE' });
        state.activeNotebookId = null;
        return renderActiveTab();
      }
      if (action === 'delete-page') {
        await api(`/api/pages/${btn.dataset.id}`, { method: 'DELETE' });
        state.activePageId = null;
        return renderActiveTab();
      }
      if (action === 'spin-roulette') {
        const opts = JSON.parse(btn.dataset.options || '[]');
        const wheel = document.getElementById('roulette-wheel-box');
        if (wheel && opts.length > 0) {
          const deg = 720 + Math.floor(Math.random() * 720);
          wheel.style.transform = `rotate(${deg}deg)`;
          const winner = opts[Math.floor(Math.random() * opts.length)];
          setTimeout(() => {
            wheel.textContent = `🎉 ¡Salió: ${winner}!`;
          }, 1400);
        }
        return;
      }
      if (action === 'delete-roulette') {
        await api(`/api/roulettes/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
      if (action === 'pick-random-plan') {
        const res = await api('/api/plans/random', { method: 'POST' });
        showStatus(`Plan elegido: ${res.chosen.title}`);
        return renderActiveTab();
      }
      if (action === 'generate-ai-plans') {
        showStatus('Generando planes personalizados con IA...');
        const res = await api('/api/plans/ai', { method: 'POST' });
        showStatus(`Se añadieron ${res.plans.length} planes propuestos por ${res.provider}.`);
        return renderActiveTab();
      }
      if (action === 'delete-plan') {
        await api(`/api/plans/${btn.dataset.id}`, { method: 'DELETE' });
        return renderActiveTab();
      }
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  // Interactive Markdown Checkboxes inside notebooks
  document.getElementById('tab-content')?.addEventListener('change', async e => {
    if (e.target.matches('[data-md-line]')) {
      const lineIdx = Number(e.target.dataset.mdLine);
      const ta = document.getElementById('page-md-edit');
      const previewBox = document.getElementById('md-preview-box');
      if (!ta || !previewBox?.dataset.pageId) return;
      const lines = ta.value.split('\n');
      if (lines[lineIdx] !== undefined) {
        lines[lineIdx] = e.target.checked
          ? lines[lineIdx].replace(/^-\s+\[ \]/, '- [x]')
          : lines[lineIdx].replace(/^-\s+\[[xX]\]/, '- [ ]');
        ta.value = lines.join('\n');
        await api(`/api/pages/${previewBox.dataset.pageId}`, {
          method: 'PUT',
          body: { markdown_content: ta.value }
        });
      }
    }
  });

  // Delegated Form Submissions inside #tab-content
  document.getElementById('tab-content')?.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());

    try {
      if (form.id === 'form-link-couple') {
        await api('/api/couple/link', { method: 'POST', body: data });
        showStatus('¡Vinculación exitosa! Ahora completen los datos de su relación.');
        return bootstrap();
      }

      if (form.id === 'form-couple-profile') {
        const extractTastes = prefix => ({
          shirt_size: data[`${prefix}_shirt_size`] || '',
          pants_size: data[`${prefix}_pants_size`] || '',
          shoe_size: data[`${prefix}_shoe_size`] || '',
          coat_size: data[`${prefix}_coat_size`] || '',
          favorite_food: data[`${prefix}_favorite_food`] || '',
          favorite_flowers: data[`${prefix}_favorite_flowers`] || '',
          favorite_brands: data[`${prefix}_favorite_brands`] || '',
          favorite_series_movies: data[`${prefix}_favorite_series_movies`] || '',
          favorite_color: data[`${prefix}_favorite_color`] || '',
          favorite_weather: data[`${prefix}_favorite_weather`] || '',
          favorite_plan: data[`${prefix}_favorite_plan`] || '',
          additional_tastes: data[`${prefix}_additional_tastes`] || ''
        });
        const res = await api('/api/couple/profile', {
          method: 'PUT',
          body: {
            relationship_start: data.relationship_start,
            shared_info: { motto: data.shared_motto || '' },
            my_tastes: extractTastes('me')
          }
        });
        showStatus(res.profiles_ready ? '¡Ambos guardaron! Ya puedes ver el dashboard.' : 'Guardado. Falta que tu pareja complete el suyo.');
        if (res.profiles_ready) state.activeTab = 'dashboard';
        return bootstrap();
      }

      if (form.id === 'form-new-transaction') {
        await api('/api/transactions', { method: 'POST', body: data });
        showStatus('Movimiento registrado.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-wallet') {
        await api('/api/wallets', { method: 'POST', body: data });
        showStatus('Medio de pago creado.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-task') {
        await api('/api/tasks', { method: 'POST', body: data });
        showStatus('Tarea agregada al tablero.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-list') {
        await api('/api/lists', { method: 'POST', body: data });
        return renderActiveTab();
      }

      if (form.classList.contains('form-add-list-item')) {
        await api(`/api/lists/${form.dataset.listId}/items`, { method: 'POST', body: data });
        return renderActiveTab();
      }

      if (form.id === 'form-new-event') {
        await api('/api/calendar', { method: 'POST', body: data });
        showStatus('Evento agendado con recordatorio.');
        return renderActiveTab();
      }

      if (form.id === 'form-notita') {
        const canvas = document.getElementById('notita-canvas');
        const drawingDataUrl = canvas && canvas._hasDrawn && canvas._hasDrawn() ? canvas.toDataURL('image/png') : '';
        await api('/api/notitas', {
          method: 'POST',
          body: { text_content: data.text_content, drawing_data_url: drawingDataUrl }
        });
        showStatus('Notita enviada (se sobrescribió la anterior y se notificó a tu pareja).');
        return renderActiveTab();
      }

      if (form.id === 'form-shared-note') {
        const photoUrl = await fileToUploadedUrl(document.getElementById('note-photo'));
        await api('/api/notes', { method: 'POST', body: { ...data, photo_url: photoUrl } });
        showStatus('Nota compartida guardada.');
        return renderActiveTab();
      }

      if (form.id === 'form-daily-answer') {
        const res = await api('/api/daily-question/answer', { method: 'POST', body: data });
        showStatus(res.both_answered ? `¡Ambos respondieron! Racha actual: ${res.streak_count} 🔥` : 'Respuesta guardada.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-craving') {
        const photoUrl = await fileToUploadedUrl(document.getElementById('crav-photo'));
        await api('/api/cravings', {
          method: 'POST',
          body: { ...data, suggest_to_partner: Boolean(data.suggest_to_partner), photo_url: photoUrl }
        });
        showStatus(data.suggest_to_partner ? 'Sugerencia de antojo enviada a tu pareja.' : 'Antojo agregado a tu lista.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-goal') {
        await api('/api/goals', { method: 'POST', body: data });
        showStatus('Meta / proyecto creado.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-capsule') {
        const photoUrl = await fileToUploadedUrl(document.getElementById('cap-photo'));
        await api('/api/capsules', { method: 'POST', body: { ...data, photo_url: photoUrl } });
        showStatus('Cápsula del tiempo sellada.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-notebook') {
        const res = await api('/api/notebooks', { method: 'POST', body: data });
        state.activeNotebookId = res.id;
        return renderActiveTab();
      }

      if (form.id === 'form-new-page') {
        const res = await api(`/api/notebooks/${form.dataset.notebookId}/pages`, { method: 'POST', body: data });
        state.activePageId = res.id;
        return renderActiveTab();
      }

      if (form.id === 'form-save-page') {
        await api(`/api/pages/${form.dataset.pageId}`, { method: 'PUT', body: data });
        showStatus('Página Markdown actualizada.');
        return renderActiveTab();
      }

      if (form.id === 'form-new-roulette') {
        await api('/api/roulettes', { method: 'POST', body: data });
        return renderActiveTab();
      }

      if (form.id === 'form-new-plan') {
        await api('/api/plans', { method: 'POST', body: data });
        return renderActiveTab();
      }

      if (form.id === 'form-menstrual') {
        await api('/api/menstrual', { method: 'PUT', body: data });
        showStatus('Calendario menstrual actualizado.');
        return renderActiveTab();
      }

      if (form.id === 'form-user-settings') {
        const avatarUrl = await fileToUploadedUrl(document.getElementById('set-avatar-file'));
        const payload = {
          ...data,
          notifications_enabled: form.querySelector('[name="notifications_enabled"]').checked
        };
        if (avatarUrl) payload.avatar_url = avatarUrl;
        const res = await api('/api/settings/user', { method: 'PUT', body: payload });
        state.user = res.user;
        applyTheme(state.user.theme);
        showStatus('Configuración guardada.');
        return renderActiveTab();
      }
    } catch (err) {
      showStatus(err.message, true);
    }
  });
});

