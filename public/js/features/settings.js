import { state } from '../core/state.js';
import { api } from '../core/api.js';
import { escapeHtml, applyTheme } from '../core/utils.js';
import { fileToUploadedUrl } from '../core/upload.js';

/* ================= FASE 2: CONFIGURACIÓN INDIVIDUAL Y EN PAREJA ================= */
function renderSettingsTab(container) {
  const u = state.user;
  container.innerHTML = `
    <div class="grid-2">
      <section class="card">
        <h2><i class="fa-solid fa-user"></i> Configuración Individual del Usuario</h2>
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
          <button type="submit" class="btn btn-primary"><i class="fa-solid fa-floppy-disk"></i> Guardar Mis Preferencias</button>
        </form>
      </section>

      <section class="card">
        ${
          state.user.role === 'admin'
            ? `<h2><i class="fa-solid fa-crown" style="color:#f59e0b;"></i> Configuración del SaaS y Motor Cloud</h2>
               <p class="text-muted">Estado de vinculación: <strong>${state.partner ? `Vinculado con ${escapeHtml(state.partner.first_name)} ${escapeHtml(state.partner.last_name)}` : 'Pendiente de vincular'}</strong></p>
               <p class="text-muted">Motor DB activo: <strong>${escapeHtml(state.config.db_mode || 'local')}</strong> · Cloud Storage: <strong>${escapeHtml(state.config.storage_mode || 'local')}</strong></p>
               <div style="display:flex; gap:0.5rem; flex-wrap:wrap; margin-top:0.75rem;">
                 <button type="button" class="btn btn-primary" data-action="open-setup-dialog"><i class="fa-solid fa-gear"></i> Configuración SpiderWebAPI</button>
                 <button type="button" class="btn" onclick="window.location.pathname='/admin'"><i class="fa-solid fa-crown" style="color:#f59e0b;"></i> Panel de Admin</button>
               </div>`
            : `<h2><i class="fa-solid fa-heart"></i> Estado de tu Cuenta en Pareja</h2>
               <p class="text-muted">Estado de vinculación: <strong>${state.partner ? `Vinculado con ${escapeHtml(state.partner.first_name)} ${escapeHtml(state.partner.last_name)}` : 'Pendiente de vincular'}</strong></p>
               <p class="text-muted"><i class="fa-solid fa-cloud" style="color:var(--brand);"></i> Servicio Hifa Cloud activo · Tu información y la de tu pareja se encuentran protegidas y sincronizadas automáticamente.</p>`
        }
      </section>
    </div>
  `;
}

export default {
  id: 'settings',
  render: renderSettingsTab,
  actions: {
    'open-setup-dialog': (ctx) => ctx.openSetup()
  },
  forms: {
    'form-user-settings': async (ctx, data, form) => {
      const avatarUrl = await fileToUploadedUrl(document.getElementById('set-avatar-file'));
      const payload = {
        ...data,
        notifications_enabled: form.querySelector('[name="notifications_enabled"]').checked
      };
      if (avatarUrl) payload.avatar_url = avatarUrl;
      const res = await api('/api/settings/user', { method: 'PUT', body: payload });
      state.user = res.user;
      applyTheme(state.user.theme);
      ctx.showStatus('Configuración guardada.');
      ctx.refresh();
    }
  }
};
