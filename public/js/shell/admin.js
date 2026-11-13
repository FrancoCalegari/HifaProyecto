import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, showStatus } from '../core/utils.js';
import { bootstrap } from './session.js';

let adminCtx = null;

export function isAdminRoute() {
  return window.location.pathname === '/admin';
}

export function enterAdminView() {
  history.pushState(null, '', '/admin');
  renderAdminView();
}

export function exitAdminView() {
  history.pushState(null, '', '/');
  document.getElementById('admin-view').hidden = true;
  bootstrap();
}

export async function renderAdminView() {
  const adminView = document.getElementById('admin-view');
  if (!adminView) return;

  // Ocultar vistas de usuario estándar
  document.getElementById('auth-view').hidden = true;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('couple-badge').hidden = true;
  adminView.hidden = false;

  // Caso 1: No autenticado o el usuario autenticado no es admin
  if (!state.token || !state.user || state.user.role !== 'admin') {
    renderAdminLoginForm(adminView);
    return;
  }

  // Caso 2: Autenticado como Administrador
  try {
    const data = await api('/api/admin/overview');
    renderAdminDashboard(adminView, data);
  } catch (err) {
    if (err.message?.includes('restringido') || err.message?.includes('autenticado')) {
      renderAdminLoginForm(adminView, 'Tu sesión actual no tiene rol de administrador. Inicia sesión con la cuenta de administrador.');
    } else {
      adminView.innerHTML = `<section class="card text-danger"><p>Error al cargar el panel de administración: ${escapeHtml(err.message)}</p></section>`;
    }
  }
}

function renderAdminLoginForm(container, customMsg = '') {
  container.innerHTML = `
    <div style="max-width:440px; margin: 3rem auto; padding: 1rem;">
      <div class="card" style="box-shadow:0 12px 36px rgba(0,0,0,0.25); border-color:var(--brand);">
        <div style="text-align:center; margin-bottom:1.5rem;">
          <span style="font-size:2.8rem; color:var(--brand); display:inline-block; margin-bottom:0.4rem;">
            <i class="fa-solid fa-shield-halved"></i>
          </span>
          <h2 style="margin:0.5rem 0 0.25rem;">Panel de Administración</h2>
          <p class="text-muted" style="font-size:0.9rem; margin:0;">
            Configuración del motor de base de datos y administración global de Hifa SaaS.
          </p>
        </div>

        ${
          customMsg
            ? `<div class="card text-danger" style="margin-bottom:1rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;">
                ${escapeHtml(customMsg)}
              </div>`
            : ''
        }
        <div id="admin-login-error" class="card text-danger" style="display:none; margin-bottom:1rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;"></div>

        <form id="form-admin-login">
          <div class="field">
            <label for="admin-email">Correo de Administrador</label>
            <input type="email" id="admin-email" name="email" placeholder="admin@tudominio.com" required autocomplete="username">
          </div>
          <div class="field">
            <label for="admin-password">Contraseña</label>
            <input type="password" id="admin-password" name="password" placeholder="••••••••" required autocomplete="current-password">
          </div>
          <button type="submit" class="btn btn-primary" style="width:100%; margin-top:0.5rem; padding:0.6rem;">
            <i class="fa-solid fa-lock"></i> Entrar como Administrador
          </button>
        </form>

        <div style="text-align:center; margin-top:1.25rem;">
          <button type="button" class="btn btn-sm" id="btn-admin-to-app">
            <i class="fa-solid fa-arrow-left"></i> Volver a la App de Parejas
          </button>
        </div>
      </div>
    </div>
  `;

  document.getElementById('form-admin-login')?.addEventListener('submit', async e => {
    e.preventDefault();
    const errBox = document.getElementById('admin-login-error');
    if (errBox) errBox.style.display = 'none';

    try {
      const fd = new FormData(e.target);
      const res = await api('/api/auth/login', {
        method: 'POST',
        body: Object.fromEntries(fd.entries())
      });

      if (res.user?.role !== 'admin') {
        throw new Error('La cuenta ingresada no tiene rol de Administrador.');
      }

      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('hifa_token', res.token);
      showStatus('Acceso concedido al Panel de Administración.');
      await renderAdminView();
    } catch (err) {
      if (errBox) {
        errBox.textContent = err.message;
        errBox.style.display = 'block';
      } else {
        showStatus(err.message, true);
      }
    }
  });

  document.getElementById('btn-admin-to-app')?.addEventListener('click', () => {
    exitAdminView();
  });
}

function renderAdminDashboard(container, data) {
  const { config, stats, users, cloudSync, backups = [] } = data;

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:1.25rem; max-width:1100px; margin: 1rem auto; padding: 0 1rem;">
      <!-- Barra superior de Administración -->
      <section class="card" style="border-left: 4px solid var(--brand);">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <h2 style="margin:0; display:flex; align-items:center; gap:0.5rem;">
              <span style="color:#f59e0b;"><i class="fa-solid fa-crown"></i></span> Panel de Administración Hifa SaaS
            </h2>
            <p class="text-muted" style="margin:0.25rem 0 0 0;">
              Sesión activa: <strong>${escapeHtml(state.user.email)}</strong> · Rol: <span class="badge badge-success"><i class="fa-solid fa-shield"></i> Administrador</span>
            </p>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn btn-sm" id="btn-admin-exit"><i class="fa-solid fa-heart" style="color:var(--brand);"></i> Ir a la App de Parejas</button>
            <button type="button" class="btn btn-sm btn-danger" id="btn-admin-logout"><i class="fa-solid fa-arrow-right-from-bracket"></i> Salir</button>
          </div>
        </div>
      </section>

      <!-- Estado de Producción y Nube -->
      <section class="card" style="border-left: 4px solid #3b82f6;">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <h3 style="margin:0; display:flex; align-items:center; gap:0.5rem;">
              <i class="fa-solid fa-cloud"></i> Entorno de Ejecución & Sincronización en la Nube
            </h3>
            <p class="text-muted" style="margin:0.25rem 0 0 0;">
              Plataforma: <strong>${cloudSync?.isVercel ? 'Vercel Serverless Production' : 'Servidor Node.js / Docker'}</strong> ·
              Directorio de datos: <code>${escapeHtml(cloudSync?.dataDir || './data')}</code>
            </p>
            <p class="text-muted" style="margin:0.25rem 0 0 0;">
              Última sincronización a Cloud Storage: <strong>${cloudSync?.lastSync ? escapeHtml(cloudSync.lastSync.replace('T', ' ').slice(0, 19)) : 'Automática al modificar datos'}</strong>
            </p>
          </div>
          <div>
            <button type="button" class="btn btn-sm btn-primary" id="btn-admin-sync-cloud">
              <i class="fa-solid fa-cloud-arrow-up"></i> Sincronizar Base de Datos Ahora
            </button>
          </div>
        </div>
        <div id="admin-cloud-sync-status" style="margin-top:0.5rem; font-size:0.85rem;"></div>
      </section>

      <!-- Métricas globales del SaaS -->
      <div class="grid-4">
        <div class="stat-box">
          <span class="text-muted"><i class="fa-solid fa-users"></i> Usuarios Registrados</span>
          <strong style="font-size:1.6rem; color:var(--brand);">${stats.usersCount}</strong>
          <small class="text-muted">Cuentas en total</small>
        </div>
        <div class="stat-box">
          <span class="text-muted"><i class="fa-solid fa-heart"></i> Parejas Vinculadas</span>
          <strong style="font-size:1.6rem; color:var(--ok);">${stats.couplesCount}</strong>
          <small class="text-muted">Vínculos activos</small>
        </div>
        <div class="stat-box">
          <span class="text-muted"><i class="fa-solid fa-wallet"></i> Billeteras Creadas</span>
          <strong style="font-size:1.6rem;">${stats.walletsCount}</strong>
          <small class="text-muted">Cuentas financieras</small>
        </div>
        <div class="stat-box">
          <span class="text-muted"><i class="fa-solid fa-database"></i> Motor de Base de Datos</span>
          <strong style="font-size:1.2rem; text-transform:uppercase;">${escapeHtml(config.db_mode || 'local')}</strong>
          <small class="text-muted">Almacenamiento: ${escapeHtml(config.storage_mode || 'local')}</small>
        </div>
      </div>

      <!-- Configuración del Motor de Base de Datos y Almacenamiento -->
      <section class="card">
        <h2><i class="fa-solid fa-gear"></i> Configuración del Motor de Base de Datos y SpiderWebAPI</h2>
        <p class="text-muted">
          Define si Hifa opera con la base de datos SQLite embebida local o conectado a SpiderWebAPI para base de datos remota SQL y Cloud Storage en nube.
        </p>

        <form id="form-admin-setup" style="margin-top:1rem;">
          <div class="grid-2">
            <div class="field">
              <label for="adm-db-mode">Modo de Base de Datos *</label>
              <select id="adm-db-mode" name="db_mode" required>
                <option value="local" ${config.db_mode === 'local' ? 'selected' : ''}>Local (SQLite embebido en servidor)</option>
                <option value="spiderweb" ${config.db_mode === 'spiderweb' ? 'selected' : ''}>Remoto (SpiderWebAPI SQL)</option>
              </select>
            </div>
            <div class="field">
              <label for="adm-storage-mode">Modo de Almacenamiento de Archivos *</label>
              <select id="adm-storage-mode" name="storage_mode" required>
                <option value="local" ${config.storage_mode === 'local' ? 'selected' : ''}>Local (Disco del servidor en ./uploads)</option>
                <option value="spiderweb" ${config.storage_mode === 'spiderweb' ? 'selected' : ''}>Remoto (SpiderCloudStorage ID)</option>
              </select>
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="adm-api-url">URL de SpiderWebAPI</label>
              <input type="text" id="adm-api-url" name="spiderweb_api_url" value="${escapeHtml(config.spiderweb_api_url || 'https://spiderwebargapi.com.ar/api/v1')}">
            </div>
            <div class="field">
              <label for="adm-dbname">Nombre de Base de Datos SpiderWeb (spiderwebdbname)</label>
              <input type="text" id="adm-dbname" name="spiderwebdbname" value="${escapeHtml(config.spiderwebdbname || '')}" placeholder="sw_Usuario_nombreDb">
            </div>
          </div>

          <div class="grid-2">
            <div class="field">
              <label for="adm-apikey">API Key de SpiderWebAPI (spiderapikey)</label>
              <input type="password" id="adm-apikey" name="spiderapikey" value="${escapeHtml(config.spiderapikey || '')}" placeholder="Clave secreta API">
            </div>
            <div class="field">
              <label for="adm-storageid">Spider Cloud Storage ID (spidercloudstrogaeid)</label>
              <input type="text" id="adm-storageid" name="spidercloudstrogaeid" value="${escapeHtml(config.spidercloudstrogaeid || '')}" placeholder="Ej: 47">
            </div>
          </div>

          <div class="field" style="margin-top:0.5rem;">
            <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; font-weight:500;">
              <input type="checkbox" id="chk-admin-migrate" name="migrate_to_remote" checked>
              Si el modo es Remoto (SpiderWebAPI), migrar datos locales a los remotos, usar los remotos y conservar respaldo local
            </label>
          </div>

          <div id="admin-spider-output" class="stat-box" style="display:none; margin-block:0.75rem; font-family:monospace; font-size:0.85rem; word-break:break-all;"></div>

          <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem; margin-top:1rem;">
            <div style="display:flex; gap:0.5rem; flex-wrap:wrap;">
              <button type="button" class="btn" id="btn-admin-test-spider"><i class="fa-solid fa-bolt"></i> Probar Conexión</button>
              <button type="button" class="btn" id="btn-admin-migrate-remote" style="border-color:var(--brand); color:var(--brand);">
                <i class="fa-solid fa-right-left"></i> Migrar Local → Remoto (Backup Local)
              </button>
            </div>
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Configuración del Motor</button>
          </div>
          ${
            config.last_migration_at
              ? `<p class="text-muted" style="margin:0.65rem 0 0 0; font-size:0.85rem;">
                   <i class="fa-solid fa-circle-check text-ok"></i> Última migración remota: <strong>${escapeHtml(config.last_migration_at.replace('T', ' ').slice(0, 19))}</strong>
                   ${config.last_local_backup ? `· Backup local creado: <code>${escapeHtml(config.last_local_backup)}</code>` : ''}
                 </p>`
              : ''
          }
        </form>
      </section>

      <!-- Respaldos Locales (Backups de Seguridad) -->
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.75rem;">
          <div>
            <h2 style="margin:0;"><i class="fa-solid fa-box-archive"></i> Respaldos Locales (Backup de Seguridad)</h2>
            <p class="text-muted" style="margin:0.25rem 0 0 0;">
              Al conectar un proveedor remoto como SpiderWebAPI, los datos locales se conservan aquí como respaldo seguro.
            </p>
          </div>
          <button type="button" class="btn btn-sm btn-primary" id="btn-admin-create-backup">
            <i class="fa-solid fa-plus"></i> Crear Backup Local Ahora
          </button>
        </div>

        <div style="margin-top:0.75rem;">
          ${
            backups.length === 0
              ? '<p class="text-muted">Aún no hay archivos de respaldo en <code>data/backups/</code>.</p>'
              : `<div style="display:flex; flex-direction:column; gap:0.5rem;">
                  ${backups
                    .map(
                      b => `<div class="stat-box" style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:0.5rem;">
                        <div>
                          <code>${escapeHtml(b.filename)}</code>
                          <span class="badge">${(b.size / 1024).toFixed(1)} KB</span>
                          <small class="text-muted"> · ${escapeHtml(b.createdAt.replace('T', ' ').slice(0, 19))}</small>
                        </div>
                        <button type="button" class="btn btn-sm" data-admin-action="restore-backup" data-filename="${escapeHtml(b.filename)}">
                          <i class="fa-solid fa-clock-rotate-left"></i> Restaurar Backup
                        </button>
                      </div>`
                    )
                    .join('')}
                </div>`
          }
        </div>
      </section>

      <!-- Gestión de Usuarios y Roles -->
      <section class="card">
        <h2><i class="fa-solid fa-users"></i> Usuarios Registrados en el SaaS (${users.length})</h2>
        <p class="text-muted">Supervisa los usuarios del sistema y asigna permisos de Administrador.</p>

        <div style="overflow-x:auto; margin-top:0.75rem;">
          <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
            <thead>
              <tr style="border-bottom:2px solid var(--border); text-align:left;">
                <th style="padding:0.6rem 0.5rem;">ID</th>
                <th style="padding:0.6rem 0.5rem;">Nombre</th>
                <th style="padding:0.6rem 0.5rem;">Correo</th>
                <th style="padding:0.6rem 0.5rem;">Rol</th>
                <th style="padding:0.6rem 0.5rem;">Pareja</th>
                <th style="padding:0.6rem 0.5rem;">Registro</th>
                <th style="padding:0.6rem 0.5rem; text-align:right;">Acción</th>
              </tr>
            </thead>
            <tbody>
              ${users
                .map(u => {
                  const isAdmin = u.role === 'admin';
                  const isSelf = u.id === state.user.id;
                  return `
                    <tr style="border-bottom:1px solid var(--border);">
                      <td style="padding:0.6rem 0.5rem; font-weight:700;">#${u.id}</td>
                      <td style="padding:0.6rem 0.5rem;">${escapeHtml(u.first_name)} ${escapeHtml(u.last_name)}</td>
                      <td style="padding:0.6rem 0.5rem;"><code>${escapeHtml(u.email)}</code></td>
                      <td style="padding:0.6rem 0.5rem;">
                        <span class="badge ${isAdmin ? 'badge-success' : ''}" style="${isAdmin ? 'background:#10b98120; color:var(--ok); border:1px solid var(--ok);' : ''}">
                          ${isAdmin ? '<i class="fa-solid fa-crown"></i> admin' : '<i class="fa-solid fa-user"></i> user'}
                        </span>
                      </td>
                      <td style="padding:0.6rem 0.5rem;">
                        ${u.couple_id ? `<span class="badge">Pareja #${u.couple_id}</span>` : '<span class="text-muted">Sin pareja</span>'}
                      </td>
                      <td style="padding:0.6rem 0.5rem; font-size:0.8rem; color:var(--muted);">${escapeHtml(String(u.created_at || '').slice(0, 10))}</td>
                      <td style="padding:0.6rem 0.5rem; text-align:right;">
                        ${
                          isSelf
                            ? '<small class="text-muted">(Tu cuenta)</small>'
                            : `<button type="button" class="btn btn-sm ${isAdmin ? 'btn-danger' : 'btn-primary'}" data-admin-action="toggle-role" data-user-id="${u.id}" data-target-role="${isAdmin ? 'user' : 'admin'}">
                                ${isAdmin ? '<i class="fa-solid fa-user-minus"></i> Quitar Admin' : '<i class="fa-solid fa-crown"></i> Hacer Admin'}
                              </button>`
                        }
                      </td>
                    </tr>
                  `;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;

  // Event Listeners del Dashboard
  document.getElementById('btn-admin-exit')?.addEventListener('click', () => {
    exitAdminView();
  });

  document.getElementById('btn-admin-logout')?.addEventListener('click', async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    state.token = '';
    state.user = null;
    localStorage.removeItem('hifa_token');
    showStatus('Sesión cerrada.');
    renderAdminView();
  });

  document.getElementById('btn-admin-test-spider')?.addEventListener('click', async () => {
    const out = document.getElementById('admin-spider-output');
    if (!out) return;
    out.style.display = 'block';
    out.textContent = 'Probando conexión con SpiderWebAPI...';
    try {
      const res = await api('/api/admin/spiderweb/test', {
        method: 'POST',
        body: {
          spiderweb_api_url: document.getElementById('adm-api-url')?.value,
          spiderwebdbname: document.getElementById('adm-dbname')?.value,
          spiderapikey: document.getElementById('adm-apikey')?.value,
          spidercloudstrogaeid: document.getElementById('adm-storageid')?.value
        }
      });
      out.innerHTML = res.ok
        ? `<span class="text-ok"><i class="fa-solid fa-circle-check"></i> Conexión exitosa:</span> ${escapeHtml(JSON.stringify(res.databases || res.data || 'OK'))}`
        : `<span class="text-warning"><i class="fa-solid fa-triangle-exclamation"></i> Aviso de SpiderWebAPI:</span> ${escapeHtml(res.error)}`;
    } catch (err) {
      out.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark"></i> Error:</span> ${escapeHtml(err.message)}`;
    }
  });

  document.getElementById('form-admin-setup')?.addEventListener('submit', async e => {
    e.preventDefault();
    const out = document.getElementById('admin-spider-output');
    const migrateChecked = Boolean(document.getElementById('chk-admin-migrate')?.checked);
    const dbMode = document.getElementById('adm-db-mode')?.value;
    if (migrateChecked && dbMode === 'spiderweb' && out) {
      out.style.display = 'block';
      out.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando backup local y migrando datos hacia SpiderWebAPI...';
    }
    try {
      const res = await api('/api/admin/setup', {
        method: 'POST',
        body: {
          db_mode: dbMode,
          storage_mode: document.getElementById('adm-storage-mode')?.value,
          spiderweb_api_url: document.getElementById('adm-api-url')?.value,
          spiderwebdbname: document.getElementById('adm-dbname')?.value,
          spiderapikey: document.getElementById('adm-apikey')?.value,
          spidercloudstrogaeid: document.getElementById('adm-storageid')?.value,
          migrate_to_remote: migrateChecked
        }
      });
      state.config = res.config;
      if (res.migration) {
        showStatus(`Migración completada: ${res.migration.tablesMigrated} tablas y ${res.migration.rowsMigrated} registros migrados. Backup local: ${res.migration.backup.filename}`);
      } else {
        showStatus('Configuración del motor de base de datos actualizada.');
      }
      await renderAdminView();
    } catch (err) {
      if (out) {
        out.style.display = 'block';
        out.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark"></i> ${escapeHtml(err.message)}</span>`;
      }
      showStatus(err.message, true);
    }
  });

  // Migrar manualmente local -> remoto SpiderWebAPI (dejando respaldo local)
  document.getElementById('btn-admin-migrate-remote')?.addEventListener('click', async () => {
    const out = document.getElementById('admin-spider-output');
    const btn = document.getElementById('btn-admin-migrate-remote');
    if (btn) btn.disabled = true;
    if (out) {
      out.style.display = 'block';
      out.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Creando backup local, subiendo archivos y migrando tablas SQL a SpiderWebAPI...';
    }
    try {
      const res = await api('/api/admin/migrate', {
        method: 'POST',
        body: {
          spiderweb_api_url: document.getElementById('adm-api-url')?.value,
          spiderwebdbname: document.getElementById('adm-dbname')?.value,
          spiderapikey: document.getElementById('adm-apikey')?.value,
          spidercloudstrogaeid: document.getElementById('adm-storageid')?.value
        }
      });
      state.config = res.config;
      showStatus(`Migración exitosa: ${res.tablesMigrated} tablas, ${res.rowsMigrated} filas y ${res.filesMigrated} archivos migrados. Respaldo local guardado.`);
      await renderAdminView();
    } catch (err) {
      if (out) {
        out.style.display = 'block';
        out.innerHTML = `<span class="text-danger"><i class="fa-solid fa-circle-xmark"></i> Error de migración:</span> ${escapeHtml(err.message)}`;
      }
      showStatus(err.message, true);
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Crear backup local manual
  document.getElementById('btn-admin-create-backup')?.addEventListener('click', async () => {
    try {
      const res = await api('/api/admin/backups', { method: 'POST', body: {} });
      showStatus(`Respaldo local creado: ${res.backup?.filename}`);
      await renderAdminView();
    } catch (err) {
      showStatus(err.message, true);
    }
  });

  // Restaurar un backup local
  container.querySelectorAll('[data-admin-action="restore-backup"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const filename = btn.dataset.filename;
      if (!confirm(`¿Restaurar el respaldo local "${filename}"? Se guardará una copia de seguridad del estado actual antes de restaurar.`)) {
        return;
      }
      try {
        const res = await api('/api/admin/backups/restore', {
          method: 'POST',
          body: { filename }
        });
        showStatus(`Base de datos restaurada desde ${res.restoredFrom}. Copia previa: ${res.safetyBackup}`);
        await renderAdminView();
      } catch (err) {
        showStatus(err.message, true);
      }
    });
  });

  // Forzar sincronización de base de datos a la nube
  document.getElementById('btn-admin-sync-cloud')?.addEventListener('click', async () => {
    const statusEl = document.getElementById('admin-cloud-sync-status');
    const btn = document.getElementById('btn-admin-sync-cloud');
    if (btn) btn.disabled = true;
    if (statusEl) statusEl.innerHTML = '<span class="text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Sincronizando base de datos a SpiderWebAPI Cloud Storage...</span>';
    try {
      const res = await api('/api/admin/cloud-sync', { method: 'POST', body: {} });
      if (res.ok) {
        if (statusEl) statusEl.innerHTML = `<span class="text-ok"><i class="fa-solid fa-circle-check"></i> Sincronización exitosa (${res.result?.size || 0} bytes guardados en la nube).</span>`;
        showStatus('Base de datos sincronizada con SpiderWebAPI Storage.');
      } else {
        if (statusEl) statusEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> Error: ${escapeHtml(res.result?.error || 'No se pudo sincronizar')}</span>`;
      }
    } catch (err) {
      if (statusEl) statusEl.innerHTML = `<span class="text-danger"><i class="fa-solid fa-triangle-exclamation"></i> ${escapeHtml(err.message)}</span>`;
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Delegar cambio de roles
  container.querySelectorAll('[data-admin-action="toggle-role"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const targetUserId = btn.dataset.userId;
      const targetRole = btn.dataset.targetRole;
      try {
        await api(`/api/admin/users/${targetUserId}/role`, {
          method: 'POST',
          body: { role: targetRole }
        });
        showStatus(`Rol de usuario actualizado a ${targetRole}.`);
        await renderAdminView();
      } catch (err) {
        showStatus(err.message, true);
      }
    });
  });
}

export function initAdmin(ctx) {
  adminCtx = ctx;

  // Botón en el header del app shell (visible solo para admin)
  document.getElementById('btn-admin-mode')?.addEventListener('click', () => {
    enterAdminView();
  });

  // Si cargó directamente con la ruta /admin
  if (isAdminRoute()) {
    renderAdminView();
  }

  // Manejo de historial del navegador (atrás/adelante)
  window.addEventListener('popstate', () => {
    if (isAdminRoute()) {
      renderAdminView();
    } else {
      document.getElementById('admin-view').hidden = true;
      bootstrap();
    }
  });
}

