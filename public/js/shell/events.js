import { getCurrentFeature } from './router.js';

export function initEvents(ctx) {
  // Navegación en la barra lateral
  document.getElementById('nav-list')?.addEventListener('click', e => {
    const btn = e.target.closest('.nav-btn');
    if (!btn || !btn.dataset.tab) return;
    ctx.goto(btn.dataset.tab);
  });

  const container = document.getElementById('tab-content');
  if (!container) return;

  // Clicks delegados en el contenido activo
  container.addEventListener('click', async e => {
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

  // Submits delegados en formularios dentro de #tab-content
  container.addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.target;
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
    } catch (err) {
      ctx.showStatus(err.message, true);
    }
  });

  // Changes delegados (para checkboxes de markdown, etc.)
  container.addEventListener('change', async e => {
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

