import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, showStatus } from '../core/utils.js';

export function populateSetupDialog() {
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

export function openSetupDialog() {
  const setupDialog = document.getElementById('dialog-setup');
  if (!setupDialog) return;
  populateSetupDialog();
  setupDialog.showModal();
}

export function initDialogs(ctx) {
  const setupDialog = document.getElementById('dialog-setup');
  const notifDialog = document.getElementById('dialog-notifications');

  document.getElementById('btn-open-setup')?.addEventListener('click', () => {
    openSetupDialog();
  });

  document.getElementById('btn-close-setup')?.addEventListener('click', () => {
    setupDialog?.close();
  });

  setupDialog?.addEventListener('close', () => {
    setupDialog.returnValue = '';
  });

  document.getElementById('btn-test-spider')?.addEventListener('click', async () => {
    const out = document.getElementById('spider-test-output');
    if (!out) return;
    out.textContent = 'Probando conexión con SpiderWebAPI...';
    try {
      const res = await api('/api/spiderweb/test', {
        method: 'POST',
        body: {
          spiderwebdbname: document.getElementById('setup-dbname')?.value,
          spiderapikey: document.getElementById('setup-apikey')?.value,
          spidercloudstrogaeid: document.getElementById('setup-storageid')?.value
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
    try {
      const res = await api('/api/setup', {
        method: 'POST',
        body: {
          db_mode: document.getElementById('setup-db-mode')?.value,
          storage_mode: document.getElementById('setup-storage-mode')?.value,
          spiderwebdbname: document.getElementById('setup-dbname')?.value,
          spiderapikey: document.getElementById('setup-apikey')?.value,
          spidercloudstrogaeid: document.getElementById('setup-storageid')?.value
        }
      });
      state.config = res.config;
      setupDialog?.close();
      showStatus('Configuración de almacenamiento y base de datos guardada.');
      if (state.activeTab === 'settings') ctx.refresh();
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  document.getElementById('btn-open-notifications')?.addEventListener('click', () => {
    const listEl = document.getElementById('notifications-list');
    if (!listEl) return;
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
    notifDialog?.showModal();
  });

  notifDialog?.addEventListener('close', () => {
    if (notifDialog) notifDialog.returnValue = '';
  });

  document.getElementById('btn-mark-read')?.addEventListener('click', async () => {
    await api('/api/notifications/read', { method: 'POST' });
    state.notifications.forEach(n => (n.read = 1));
    const notifCount = document.getElementById('notif-count');
    if (notifCount) notifCount.textContent = '0';
    notifDialog?.close();
  });
}

