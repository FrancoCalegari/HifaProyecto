import { ctx, renderActiveTab } from './shell/router.js';
import { bootstrap, initAuth, setSessionRouter } from './shell/session.js';
import { initDialogs } from './shell/dialogs.js';
import { initEvents } from './shell/events.js';
import { initAdmin, isAdminRoute, renderAdminView } from './shell/admin.js';

document.addEventListener('DOMContentLoaded', () => {
  setSessionRouter({ renderActiveTab });
  initDialogs(ctx);
  initAuth();
  initEvents(ctx);
  initAdmin(ctx);
  if (isAdminRoute()) {
    renderAdminView();
  } else {
    bootstrap();
  }
});

