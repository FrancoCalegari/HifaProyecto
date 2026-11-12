import { state, profilesReady } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, applyTheme, showStatus } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';
import { populateSetupDialog } from './dialogs.js';

let appRouter = null;

export function setSessionRouter(router) {
  appRouter = router;
}

export async function bootstrap() {
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
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

export function showAuthView() {
  document.getElementById('auth-view').hidden = false;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('btn-logout').hidden = true;
  document.getElementById('btn-open-notifications').hidden = true;
  document.getElementById('couple-badge').hidden = true;
}

export function showAppShell() {
  document.getElementById('auth-view').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('btn-logout').hidden = false;
  document.getElementById('btn-open-notifications').hidden = false;

  const badge = document.getElementById('couple-badge');
  if (badge) {
    badge.hidden = false;
    if (state.partner) {
      badge.innerHTML = `<img class="avatar-sm" src="${escapeHtml(state.user.avatar_url)}" alt="" width="32" height="32">
        ${escapeHtml(state.user.first_name)} ❤️ ${escapeHtml(state.partner.first_name)}
        <img class="avatar-sm" src="${escapeHtml(state.partner.avatar_url)}" alt="" width="32" height="32">`;
    } else {
      badge.textContent = `${state.user.first_name} (Sin vincular aún)`;
    }
  }

  const dashBtn = document.querySelector('[data-tab="dashboard"]');
  if (dashBtn) dashBtn.hidden = !profilesReady();
  if (state.activeTab === 'dashboard' && !profilesReady()) state.activeTab = 'couple';

  const unread = state.notifications.filter(n => !n.read).length;
  const notifCount = document.getElementById('notif-count');
  if (notifCount) notifCount.textContent = String(unread);

  // Si viene con link de vinculación ?pair=CODE y aún no está vinculado
  const params = new URLSearchParams(window.location.search);
  if (params.get('pair') && !state.user.couple_id) {
    state.activeTab = 'couple';
  }

  appRouter?.renderActiveTab();
}

export function initAuth() {
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
}

