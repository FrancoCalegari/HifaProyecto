import { getCurrentFeature } from './router.js';
import { initMobileDrawer } from './mobile-nav.js';

export function initEvents(ctx) {
  initMobileDrawer(ctx);
  // Navegación en la barra lateral
  document.getElementById('nav-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn || !btn.dataset.tab) return;
    ctx.goto(btn.dataset.tab);
  });

  // Clicks delegados a nivel de documento (captura modales nativos en Top Layer y contenido activo)
  document.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;

    try {
      if (action === 'goto-tab') {
        return ctx.goto(btn.dataset.tab);
      }
      if (action === 'go-couple') {
        return ctx.goto('couple');
      }
      if (action === 'open-setup-dialog') {
        return ctx.openSetup();
      }

      const feature = getCurrentFeature();
      if (feature?.actions?.[action]) {
        return await feature.actions[action](ctx, btn);
      }
    } catch (err) {
      ctx.showStatus(err.message, true);
    }
  });

  // Submits delegados en formularios (document-level para capturar modales nativos)
  document.addEventListener('submit', async e => {
    const form = e.target.closest('form') || e.target;
    if (!form || !form.id) return;
    if (form.id === 'form-login' || form.id === 'form-register' || form.id === 'form-setup') return;

    e.preventDefault();
    const fd = new FormData(form);
    const data = Object.fromEntries(fd.entries());
    const feature = getCurrentFeature();

    try {
      if (feature?.forms) {
        // Buscar por id del form
        if (form.id && feature.forms[form.id]) {
          return await feature.forms[form.id](ctx, data, form);
        }
        // O buscar por clase
        for (const cls of form.classList) {
          if (feature.forms[cls]) {
            return await feature.forms[cls](ctx, data, form);
          }
        }
      }

      // Fallback: buscar en todas las features registradas si no coincidió en currentFeature
      for (const f of ctx.features || []) {
        if (f?.forms?.[form.id]) {
          return await f.forms[form.id](ctx, data, form);
        }
      }
    } catch (err) {
      console.error('Error al procesar formulario:', err);
      ctx.showStatus(err.message, true);
    }
  });

  // Changes delegados a nivel de documento (para checkboxes de markdown, listas, etc.)
  document.addEventListener('change', async e => {
    const feature = getCurrentFeature();
    if (!feature?.changes) return;

    try {
      for (const [selector, handler] of Object.entries(feature.changes)) {
        if (e.target.matches(selector)) {
          return await handler(ctx, e.target);
        }
      }
    } catch (err) {
      ctx.showStatus(err.message, true);
    }
  });
}

