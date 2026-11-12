import { state, profilesReady } from '../core/state.js';
import { showStatus } from '../core/utils.js';
import { bootstrap } from './session.js';
import { openSetupDialog } from './dialogs.js';

import coupleFeature from '../features/couple.js';
import dashboardFeature from '../features/dashboard.js';
import economyFeature from '../features/economy.js';
import tasksFeature from '../features/tasks.js';
import listsFeature from '../features/lists.js';
import calendarFeature from '../features/calendar.js';
import notitasFeature from '../features/notitas.js';
import dailyFeature from '../features/daily.js';
import cravingsFeature from '../features/cravings.js';
import goalsFeature from '../features/goals.js';
import capsulesFeature from '../features/capsules.js';
import notebooksFeature from '../features/notebooks.js';
import toolsFeature from '../features/tools.js';
import cycleFeature from '../features/cycle.js';
import settingsFeature from '../features/settings.js';

const featuresList = [
  coupleFeature,
  dashboardFeature,
  economyFeature,
  tasksFeature,
  listsFeature,
  calendarFeature,
  notitasFeature,
  dailyFeature,
  cravingsFeature,
  goalsFeature,
  capsulesFeature,
  notebooksFeature,
  toolsFeature,
  cycleFeature,
  settingsFeature
];

const featureMap = new Map();
for (const f of featuresList) {
  featureMap.set(f.id, f);
}

let currentFeature = null;

export const ctx = {
  state,
  refresh: () => renderActiveTab(),
  bootstrap,
  goto: (tab) => {
    state.activeTab = tab;
    renderActiveTab();
  },
  showStatus,
  openSetup: openSetupDialog,
  features: featuresList
};

export function getFeature(id) {
  return featureMap.get(id) || null;
}

export function getCurrentFeature() {
  return currentFeature;
}

export async function renderActiveTab() {
  // Limpiar timers o estado previo
  if (state.countdownTimer) {
    clearInterval(state.countdownTimer);
    state.countdownTimer = null;
  }
  if (currentFeature?.unmount) {
    try { currentFeature.unmount(); } catch (_) {}
  }

  document.querySelectorAll('#nav-list .nav-btn').forEach(btn => {
    if (btn.dataset.tab === state.activeTab) {
      btn.setAttribute('aria-current', 'page');
    } else {
      btn.removeAttribute('aria-current');
    }
  });

  const container = document.getElementById('tab-content');
  if (!container) return;

  if (!state.user.couple_id && state.activeTab !== 'couple' && state.activeTab !== 'settings') {
    currentFeature = null;
    container.innerHTML = `<section class="card">
      <h2><i class="fa-solid fa-link"></i> Vincula tu cuenta con tu pareja primero</h2>
      <p>Para desbloquear todas las herramientas de Fase 2 (Economía, Tareas, Listas, Calendario, Ruleta, Pregunta del Día, Antojos, Cápsula del Tiempo, Metas y Cuadernos), primero vincúlate con tu pareja en la pestaña <strong>Pareja y Gustos</strong>.</p>
      <button type="button" class="btn btn-primary" data-action="go-couple"><i class="fa-solid fa-arrow-right"></i> Ir a Vincular Pareja</button>
    </section>`;
    return;
  }

  if (state.user.couple_id && !profilesReady() && state.activeTab !== 'couple' && state.activeTab !== 'settings') {
    currentFeature = null;
    container.innerHTML = `<section class="card">
      <h2><i class="fa-solid fa-file-pen"></i> Falta completar el formulario de pareja</h2>
      <p>Cada uno completa su propia información. Cuando <strong>ambos</strong> la guarden se desbloquea el dashboard y el resto de las herramientas.</p>
      <button type="button" class="btn btn-primary" data-action="go-couple"><i class="fa-solid fa-arrow-right"></i> Ir al formulario</button>
    </section>`;
    return;
  }

  const feature = featureMap.get(state.activeTab);
  if (!feature) {
    container.innerHTML = `<section class="card"><p class="text-muted">Sección no encontrada: ${state.activeTab}</p></section>`;
    return;
  }

  currentFeature = feature;
  await feature.render(container, ctx);
  if (feature.onMount) {
    feature.onMount(ctx);
  }
}

