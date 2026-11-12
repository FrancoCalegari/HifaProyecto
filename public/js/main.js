import { ctx, renderActiveTab } from './shell/router.js';
import { bootstrap, initAuth, setSessionRouter } from './shell/session.js';
import { initDialogs } from './shell/dialogs.js';
import { initEvents } from './shell/events.js';

document.addEventListener('DOMContentLoaded', () => {
  setSessionRouter({ renderActiveTab });
  initDialogs(ctx);
  initAuth();
  initEvents(ctx);
  bootstrap();
});

