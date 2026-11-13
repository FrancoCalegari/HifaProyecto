import { state, profilesReady } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, applyTheme, showStatus } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';
import { populateSetupDialog } from './dialogs.js';
import { isAdminRoute, renderAdminView } from './admin.js';

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
    if (isAdminRoute()) {
      renderAdminView();
      return;
    }
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
    if (isAdminRoute()) {
      renderAdminView();
      return;
    }
    showAppShell();
  } catch {
    state.token = '';
    localStorage.removeItem('hifa_token');
    if (isAdminRoute()) {
      renderAdminView();
      return;
    }
    showAuthView();
  }
}

function setAuthPanel(panel) {
  const grid = document.getElementById('auth-grid');
  if (grid) grid.dataset.activePanel = panel;
  document.querySelectorAll('#auth-tabs .auth-tab-btn').forEach(btn => {
    const active = btn.dataset.authPanel === panel;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
  });
}

export function showAuthView() {
  document.getElementById('auth-view').hidden = false;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('btn-logout').hidden = true;
  const mobileMenuBtn = document.getElementById('btn-mobile-menu');
  if (mobileMenuBtn) mobileMenuBtn.hidden = true;
  const adminBtn = document.getElementById('btn-admin-mode');
  if (adminBtn) adminBtn.hidden = true;
  document.getElementById('couple-badge').hidden = true;

  const hasPairInvite = Boolean(new URLSearchParams(window.location.search).get('pair'));
  const inviteBanner = document.getElementById('invite-banner');
  if (inviteBanner) inviteBanner.hidden = !hasPairInvite;
  if (hasPairInvite) setAuthPanel('register');
}

export function showAppShell() {
  document.getElementById('auth-view').hidden = true;
  document.getElementById('app-shell').hidden = false;
  document.getElementById('btn-logout').hidden = false;
  const mobileMenuBtn = document.getElementById('btn-mobile-menu');
  if (mobileMenuBtn) mobileMenuBtn.hidden = false;
  const adminBtn = document.getElementById('btn-admin-mode');
  if (adminBtn) {
    adminBtn.hidden = (state.user?.role !== 'admin');
  }

  const badge = document.getElementById('couple-badge');
  if (badge) {
    badge.hidden = false;
    if (state.partner) {
      badge.innerHTML = `<img class="avatar-sm" src="${escapeHtml(state.user.avatar_url)}" alt="" width="32" height="32">
        ${escapeHtml(state.user.first_name)} <i class="fa-solid fa-heart" style="color:var(--brand); margin:0 0.25rem;"></i> ${escapeHtml(state.partner.first_name)}
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
  document.getElementById('auth-tabs')?.addEventListener('click', e => {
    const btn = e.target.closest('.auth-tab-btn[data-auth-panel]');
    if (!btn) return;
    setAuthPanel(btn.dataset.authPanel);
  });

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
    state.booted = false;
    state.user = null;
    state.partner = null;
    state.couple = null;
    localStorage.removeItem('hifa_token');
    showAuthView();
  });
}

