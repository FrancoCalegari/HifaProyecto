import { api } from '../core/api.js';
import { escapeHtml } from '../core/utils.js';

let currentMonthStr = new Date().toISOString().slice(0, 7); // 'YYYY-MM'
let cachedCycleData = null;
let currentDaySelected = '';

const METHOD_LABELS = {
  pastillas_28: 'Pastillas (28 días: 21 activas + 7 placebo)',
  pastillas_24_4: 'Pastillas (28 días: 24 activas + 4 placebo)',
  pastillas_21: 'Pastillas (21 días con descanso)',
  diu_hormonal: 'DIU Hormonal',
  diu_cobre: 'DIU de Cobre',
  implante: 'Implante Subdérmico',
  inyeccion: 'Inyección Anticonceptiva',
  parche: 'Parche Transdérmico',
  preservativo: 'Preservativo / De barrera',
  ritmo_natural: 'Método del Ritmo / Natural',
  ninguno: 'Sin método anticonceptivo'
};

const MONTH_NAMES = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
];

function formatDisplayDate(dateStr) {
  if (!dateStr || dateStr.length < 10) return '';
  const [y, m, d] = dateStr.split('-');
  return `${d} de ${MONTH_NAMES[parseInt(m, 10) - 1]} de ${y}`;
}

function getMonthYearLabel(monthStr) {
  const [y, m] = monthStr.split('-');
  return `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}`;
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function isDateInRange(targetDate, startDate, endDate) {
  if (!targetDate || !startDate || !endDate) return false;
  return targetDate >= startDate && targetDate <= endDate;
}

export async function renderCycleTab(container, ctx) {
  try {
    cachedCycleData = await api(`/api/cycle?month=${currentMonthStr}`);
  } catch (err) {
    container.innerHTML = `<section class="card"><p class="text-danger">Error al cargar datos del ciclo: ${escapeHtml(err.message)}</p></section>`;
    return;
  }

  const { settings, projections, analysis, logs, todayLog } = cachedCycleData;
  const todayStr = new Date().toISOString().slice(0, 10);

  // Mapear logs del mes por fecha
  const logsMap = new Map();
  for (const log of logs || []) {
    logsMap.set(log.date, log);
  }

  // Desglosar año y mes
  const [yearNum, monthNum] = currentMonthStr.split('-').map(Number);
  const firstDay = new Date(yearNum, monthNum - 1, 1);
  const startDayOfWeek = (firstDay.getDay() + 6) % 7; // Lun = 0 ... Dom = 6
  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const prevMonthDays = new Date(yearNum, monthNum - 1, 0).getDate();

  // Conjunto de fechas proyectadas
  const upcomingCycles = projections.upcomingCycles || [];

  // Armar cuadrícula del calendario
  let calendarCellsHtml = '';

  // 1. Días del mes anterior (padding)
  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthDays - i;
    calendarCellsHtml += `
      <div class="cycle-day-cell cycle-cell-muted">
        <span class="cycle-cell-num">${dayNum}</span>
      </div>`;
  }

  // 2. Días del mes actual
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = String(d).padStart(2, '0');
    const dateStr = `${currentMonthStr}-${dayStr}`;
    const isToday = dateStr === todayStr;
    const log = logsMap.get(dateStr);

    // Chequear predicciones futuras
    let isPredPeriod = false;
    let isPredOvulation = false;
    let isPredFertile = false;

    for (const cyc of upcomingCycles) {
      if (isDateInRange(dateStr, cyc.periodStart, cyc.periodEnd)) {
        isPredPeriod = true;
      }
      if (dateStr === cyc.ovulationDate) {
        isPredOvulation = true;
      } else if (isDateInRange(dateStr, cyc.fertileStart, cyc.fertileEnd)) {
        isPredFertile = true;
      }
    }

    // Clases CSS del día
    const classes = ['cycle-day-cell'];
    if (isToday) classes.push('cycle-cell-today');
    if (log?.flow && log.flow !== 'ninguno') classes.push(`cycle-flow-${log.flow}`);
    if (isPredPeriod && (!log || log.flow === 'ninguno')) classes.push('cycle-cell-pred-period');
    if (isPredOvulation) classes.push('cycle-cell-pred-ovulation');
    else if (isPredFertile) classes.push('cycle-cell-pred-fertile');

    // Indicador de método anticonceptivo
    let pillHtml = '';
    if (log?.contraceptive === 'tomado') {
      pillHtml = `<span class="cycle-pill-badge pill-taken" title="Anticonceptivo tomado"><i class="fa-solid fa-circle-check"></i> Tomado</span>`;
    } else if (log?.contraceptive === 'olvidado') {
      pillHtml = `<span class="cycle-pill-badge pill-forgotten" title="Anticonceptivo olvidado"><i class="fa-solid fa-circle-xmark"></i> Olvidado</span>`;
    } else if (log?.contraceptive === 'placebo') {
      pillHtml = `<span class="cycle-pill-badge pill-placebo" title="Placebo / descanso"><i class="fa-regular fa-circle"></i> Placebo</span>`;
    }

    // Indicador de intimidad
    let fireHtml = '';
    if (log?.intimacy === 1) {
      fireHtml = `<span class="cycle-fire-badge" title="Relaciones sexuales registradas"><i class="fa-solid fa-fire" style="color:#ef4444;"></i></span>`;
    }

    // Indicador de flujo
    let flowHtml = '';
    if (log?.flow === 'ligero') {
      flowHtml = `<span class="cycle-flow-tag" title="Flujo ligero / manchado"><i class="fa-solid fa-droplet" style="color:#f43f5e;"></i></span>`;
    } else if (log?.flow === 'moderado') {
      flowHtml = `<span class="cycle-flow-tag" title="Flujo moderado"><i class="fa-solid fa-droplet" style="color:#e11d48;"></i></span>`;
    } else if (log?.flow === 'abundante') {
      flowHtml = `<span class="cycle-flow-tag" title="Flujo abundante"><i class="fa-solid fa-droplet" style="color:#be123c;"></i><i class="fa-solid fa-droplet" style="color:#be123c; font-size:0.75em; margin-left:-2px;"></i></span>`;
    }

    // Indicador inicio de período
    let startHtml = '';
    if (log?.is_period_start === 1) {
      startHtml = `<span class="cycle-start-tag" title="Primer día de menstruación"><i class="fa-solid fa-star"></i> Inicio</span>`;
    }

    // Etiquetas de predicción
    let predTagHtml = '';
    if (isPredPeriod && (!log || log.flow === 'ninguno')) {
      predTagHtml = `<span class="cycle-pred-tag pred-period" title="Período estimado por algoritmo"><i class="fa-solid fa-droplet"></i> Previsto</span>`;
    } else if (isPredOvulation) {
      predTagHtml = `<span class="cycle-pred-tag pred-ovulation" title="Día de ovulación estimada"><i class="fa-solid fa-spa"></i> Ovulación</span>`;
    } else if (isPredFertile) {
      predTagHtml = `<span class="cycle-pred-tag pred-fertile" title="Ventana fértil"><i class="fa-solid fa-seedling"></i> Fértil</span>`;
    }

    calendarCellsHtml += `
      <div class="${classes.join(' ')}" data-action="cycle-open-day-dialog" data-date="${dateStr}">
        <div class="cycle-cell-header">
          <span class="cycle-cell-num">${d}</span>
          ${isToday ? '<span class="cycle-today-chip">Hoy</span>' : ''}
          ${fireHtml}
        </div>
        <div class="cycle-cell-body">
          ${startHtml}
          ${flowHtml}
          ${pillHtml}
          ${predTagHtml}
          ${log?.notes ? `<span class="cycle-note-dot" title="${escapeHtml(log.notes)}"><i class="fa-regular fa-comment-dots"></i></span>` : ''}
        </div>
      </div>`;
  }

  // 3. Días del mes siguiente (padding para completar la semana)
  const totalRendered = startDayOfWeek + daysInMonth;
  const remainingCells = (7 - (totalRendered % 7)) % 7;
  for (let i = 1; i <= remainingCells; i++) {
    calendarCellsHtml += `
      <div class="cycle-day-cell cycle-cell-muted">
        <span class="cycle-cell-num">${i}</span>
      </div>`;
  }

  // Resumen del algoritmo de 3 meses
  const isAlgoReady = Boolean(analysis?.algorithmActive);
  const cyclesCount = analysis?.cyclesRecorded || 0;
  const progressPercent = Math.min(100, Math.round((cyclesCount / 3) * 100));

  let algoBannerHtml = '';
  if (isAlgoReady) {
    algoBannerHtml = `
      <section class="card cycle-algo-card algo-active">
        <div class="cycle-algo-head">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span class="badge badge-success"><i class="fa-solid fa-wand-magic-sparkles"></i> Algoritmo Inteligente Activo</span>
            <span class="text-muted">(${cyclesCount} ciclos registrados analizados)</span>
          </div>
          <button type="button" class="btn btn-sm" data-action="cycle-open-settings"><i class="fa-solid fa-gear"></i> Configuración</button>
        </div>
        <div class="grid-3" style="margin-block:0.75rem;">
          <div class="stat-box">
            <span class="text-muted">Duración real de tu ciclo</span>
            <strong style="font-size:1.3rem; color:var(--brand);">${analysis.averageCycleDays} días</strong>
            <small class="text-muted">${escapeHtml(analysis.regularity)}</small>
          </div>
          <div class="stat-box">
            <span class="text-muted">Duración de sangrado</span>
            <strong style="font-size:1.3rem;">${analysis.averagePeriodDays} días</strong>
            <small class="text-muted">Promedio calculado</small>
          </div>
          <div class="stat-box">
            <span class="text-muted">Próxima fecha prevista</span>
            <strong style="font-size:1.3rem; color:var(--ok);">${projections.nextPeriodStart ? escapeHtml(projections.nextPeriodStart) : 'Por determinar'}</strong>
            <small class="text-muted">Ventana fértil: ${projections.fertileWindow ? escapeHtml(projections.fertileWindow) : 'N/A'}</small>
          </div>
        </div>
      </section>
    `;
  } else {
    algoBannerHtml = `
      <section class="card cycle-algo-card algo-learning">
        <div class="cycle-algo-head">
          <div style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
            <span class="badge" style="background:#fef3c7; color:#92400e; border:1px solid #fde68a;"><i class="fa-solid fa-hourglass-half"></i> Calibración Algorítmica (${cyclesCount}/3 ciclos)</span>
            <strong>Período de aprendizaje en curso</strong>
          </div>
          <button type="button" class="btn btn-sm btn-primary" data-action="cycle-open-settings"><i class="fa-solid fa-gear"></i> Cargar Períodos Anteriores</button>
        </div>
        <p class="text-muted" style="margin-block:0.5rem; font-size:0.92rem;">
          El algoritmo requiere al menos <strong>3 ciclos menstruales (un período de 3 meses)</strong> para aprender el patrón biológico individual de la pareja y calcular con precisión estadística las próximas fechas de menstruación y ovulación.
        </p>
        <div class="cycle-progress-bar-bg" title="${progressPercent}% de aprendizaje completado">
          <div class="cycle-progress-bar-fill" style="width: ${progressPercent}%;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--muted); margin-top:0.3rem;">
          <span>Progreso: ${cyclesCount} de 3 ciclos registrados</span>
          <span>${progressPercent}% completado</span>
        </div>
      </section>
    `;
  }

  // Método actual configurado
  const currentMethodName = METHOD_LABELS[settings?.contraceptive_method] || settings?.contraceptive_method || 'Sin especificar';

  container.innerHTML = `
    <div style="display:flex; flex-direction:column; gap:1.25rem;">
      <!-- Barra superior de navegación y estado -->
      <section class="card">
        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:1rem;">
          <div>
            <h2 style="margin:0; display:flex; align-items:center; gap:0.5rem;"><i class="fa-solid fa-spa" style="color:var(--brand);"></i> Calendario y Control del Ciclo Menstrual</h2>
            <p class="text-muted" style="margin:0.25rem 0 0 0;">
              Método actual: <strong>${escapeHtml(currentMethodName)}</strong> · Duración base: <strong>${settings.cycleDays} días</strong>
            </p>
          </div>
          <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary" data-action="cycle-log-today"><i class="fa-solid fa-plus"></i> Registrar Hoy</button>
            <button type="button" class="btn" data-action="cycle-open-settings"><i class="fa-solid fa-gear"></i> Método y Ajustes</button>
          </div>
        </div>
      </section>

      <!-- Banner Algorítmico -->
      ${algoBannerHtml}

      <!-- Navegación por Meses y Leyenda -->
      <section class="card">
        <div class="cycle-calendar-toolbar">
          <div style="display:flex; align-items:center; gap:0.5rem;">
            <button type="button" class="btn btn-sm" data-action="cycle-prev-month" title="Mes anterior"><i class="fa-solid fa-chevron-left"></i> Anterior</button>
            <h3 style="margin:0; min-width:180px; text-align:center;">${getMonthYearLabel(currentMonthStr)}</h3>
            <button type="button" class="btn btn-sm" data-action="cycle-next-month" title="Mes siguiente">Siguiente <i class="fa-solid fa-chevron-right"></i></button>
            <button type="button" class="btn btn-sm" data-action="cycle-today"><i class="fa-solid fa-calendar-day"></i> Hoy</button>
          </div>

          <!-- Leyenda Visual -->
          <div class="cycle-legend">
            <span class="legend-item"><i class="fa-solid fa-circle" style="color:#22c55e; font-size:0.7em;"></i> Tomado</span>
            <span class="legend-item"><i class="fa-solid fa-circle" style="color:#ef4444; font-size:0.7em;"></i> Olvidado</span>
            <span class="legend-item"><i class="fa-regular fa-circle" style="color:#94a3b8; font-size:0.7em;"></i> Placebo</span>
            <span class="legend-item"><i class="fa-solid fa-fire" style="color:#ef4444;"></i> Intimidad</span>
            <span class="legend-item"><i class="fa-solid fa-droplet" style="color:#e11d48;"></i> Flujo</span>
            <span class="legend-item"><span class="legend-icon" style="background:#f43f5e33; border:1px dashed #f43f5e;"></span> Predicción</span>
          </div>
        </div>

        <!-- Grilla del Calendario -->
        <div class="cycle-calendar-grid">
          <div class="cycle-col-header">Lun</div>
          <div class="cycle-col-header">Mar</div>
          <div class="cycle-col-header">Mié</div>
          <div class="cycle-col-header">Jue</div>
          <div class="cycle-col-header">Vie</div>
          <div class="cycle-col-header">Sáb</div>
          <div class="cycle-col-header">Dom</div>
          ${calendarCellsHtml}
        </div>
      </section>

      <!-- Próximos Ciclos Proyectados (si hay fecha inicial o análisis) -->
      ${
        upcomingCycles.length > 0
          ? `<section class="card">
              <h3><i class="fa-solid fa-clock-rotate-left"></i> Próximos Ciclos Estimados</h3>
              <div class="grid-3">
                ${upcomingCycles
                  .map(
                    (cyc, idx) => `
                    <div class="stat-box">
                      <strong>Ciclo ${idx + 1} (${formatDisplayDate(cyc.periodStart)})</strong>
                      <div style="margin-top:0.4rem; font-size:0.88rem; display:flex; flex-direction:column; gap:0.25rem;">
                        <span><i class="fa-solid fa-droplet" style="color:#e11d48;"></i> Menstruación: <strong>${formatDisplayDate(cyc.periodStart)}</strong> al <strong>${formatDisplayDate(cyc.periodEnd)}</strong></span>
                        <span><i class="fa-solid fa-spa" style="color:var(--brand);"></i> Ovulación estimada: <strong>${formatDisplayDate(cyc.ovulationDate)}</strong></span>
                        <span><i class="fa-solid fa-seedling" style="color:var(--ok);"></i> Ventana fértil: <strong>${cyc.fertileStart.slice(5)}</strong> al <strong>${cyc.fertileEnd.slice(5)}</strong></span>
                      </div>
                    </div>`
                  )
                  .join('')}
              </div>
            </section>`
          : ''
      }
    </div>

    <!-- Modal Nativo: Registro Diario del Ciclo -->
    <dialog id="dialog-cycle-day-log" aria-labelledby="dialog-cycle-day-title">
      <h2 id="dialog-cycle-day-title"><i class="fa-solid fa-calendar-day"></i> Registro del Día</h2>
      <p class="text-muted" id="dialog-cycle-day-subtitle">Cargando...</p>
      <div id="cycle-day-dialog-error" class="card text-danger" style="display:none; margin-block:0.5rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;"></div>
      
      <form id="form-cycle-day-log">
        <input type="hidden" id="log-date" name="date" value="">

        <!-- Anticonceptivo -->
        <div class="field">
          <label><strong><i class="fa-solid fa-pills"></i> Método Anticonceptivo (Hoy)</strong></label>
          <div class="cycle-radio-group">
            <label class="cycle-radio-btn">
              <input type="radio" name="contraceptive" value="tomado">
              <span class="btn-visual"><i class="fa-solid fa-circle-check" style="color:#22c55e;"></i> Tomado</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="contraceptive" value="olvidado">
              <span class="btn-visual"><i class="fa-solid fa-circle-xmark" style="color:#ef4444;"></i> Olvidado</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="contraceptive" value="placebo">
              <span class="btn-visual"><i class="fa-regular fa-circle" style="color:#94a3b8;"></i> Placebo / Descanso</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="contraceptive" value="" checked>
              <span class="btn-visual"><i class="fa-solid fa-minus"></i> Sin Registro</span>
            </label>
          </div>
        </div>

        <!-- Relaciones Íntimas -->
        <div class="field" style="margin-top:1rem;">
          <label><strong><i class="fa-solid fa-fire" style="color:#ef4444;"></i> Intimidad y Vida Sexual</strong></label>
          <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; padding:0.5rem; background:var(--surface-alt); border-radius:8px; border:1px solid var(--border);">
            <input type="checkbox" id="log-intimacy" name="intimacy" value="1" style="width:1.2rem; height:1.2rem;">
            <span><i class="fa-solid fa-fire" style="color:#ef4444;"></i> <strong>Hubo relaciones sexuales en este día</strong></span>
          </label>
        </div>

        <!-- Flujo Menstrual -->
        <div class="field" style="margin-top:1rem;">
          <label><strong><i class="fa-solid fa-droplet" style="color:#e11d48;"></i> Flujo Menstrual</strong></label>
          <div class="cycle-radio-group">
            <label class="cycle-radio-btn">
              <input type="radio" name="flow" value="ninguno" checked>
              <span class="btn-visual">Ninguno</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="flow" value="ligero">
              <span class="btn-visual"><i class="fa-solid fa-droplet" style="color:#f43f5e;"></i> Ligero / Manchado</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="flow" value="moderado">
              <span class="btn-visual"><i class="fa-solid fa-droplet" style="color:#e11d48;"></i> Moderado</span>
            </label>
            <label class="cycle-radio-btn">
              <input type="radio" name="flow" value="abundante">
              <span class="btn-visual"><i class="fa-solid fa-droplet" style="color:#be123c;"></i> Abundante</span>
            </label>
          </div>
        </div>

        <!-- Inicio de ciclo -->
        <div class="field" style="margin-top:0.75rem;">
          <label style="display:flex; align-items:center; gap:0.5rem; cursor:pointer; padding:0.5rem; background:var(--surface-alt); border-radius:8px; border:1px solid var(--border);">
            <input type="checkbox" id="log-is-period-start" name="is_period_start" value="1" style="width:1.2rem; height:1.2rem;">
            <span><i class="fa-solid fa-star" style="color:#f59e0b;"></i> <strong>Marcar como primer día de período (Inicio de ciclo)</strong></span>
          </label>
        </div>

        <!-- Notas / Síntomas -->
        <div class="field" style="margin-top:0.75rem;">
          <label for="log-notes">Notas, síntomas o estado de ánimo (opcional)</label>
          <input type="text" id="log-notes" name="notes" placeholder="Ej: Cólicos leves, dolor de cabeza, buen humor...">
        </div>

        <!-- Botones de acción -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:1.25rem; gap:0.5rem; flex-wrap:wrap;">
          <div>
            <button type="button" class="btn btn-danger" id="btn-delete-day-log" data-action="cycle-delete-day-log" style="display:none;"><i class="fa-solid fa-trash-can"></i> Borrar Registro</button>
          </div>
          <div style="display:flex; gap:0.5rem;">
            <button type="button" class="btn" data-action="cycle-close-day-dialog">Cancelar</button>
            <button type="submit" class="btn btn-primary">Guardar Día</button>
          </div>
        </div>
      </form>
    </dialog>

    <!-- Modal Nativo: Configuración del Método y Ciclo -->
    <dialog id="dialog-cycle-settings" aria-labelledby="dialog-cycle-settings-title">
      <h2 id="dialog-cycle-settings-title"><i class="fa-solid fa-gear"></i> Configuración del Método y Ciclo</h2>
      <p class="text-muted">Ajusta tu método anticonceptivo actual, duración base y períodos pasados para calibrar las predicciones algorítmicas.</p>
      <div id="cycle-settings-dialog-error" class="card text-danger" style="display:none; margin-block:0.5rem; padding:0.5rem 0.75rem; border-color:var(--danger); background:rgba(255,0,0,0.08); font-size:0.9rem;"></div>

      <form id="form-cycle-settings">
        <div class="field">
          <label for="cfg-contraceptive-method">Método anticonceptivo principal *</label>
          <select id="cfg-contraceptive-method" name="contraceptive_method" required>
            ${Object.entries(METHOD_LABELS)
              .map(
                ([val, label]) =>
                  `<option value="${val}" ${settings?.contraceptive_method === val ? 'selected' : ''}>${escapeHtml(label)}</option>`
              )
              .join('')}
          </select>
        </div>

        <div class="grid-2">
          <div class="field">
            <label for="cfg-cycle-days">Duración típica del ciclo (días) *</label>
            <input type="number" id="cfg-cycle-days" name="cycleDays" value="${settings.cycleDays || 28}" min="18" max="50" required>
            <small class="text-muted">Habitualmente entre 25 y 35 días.</small>
          </div>
          <div class="field">
            <label for="cfg-period-days">Duración del sangrado (días) *</label>
            <input type="number" id="cfg-period-days" name="periodDays" value="${settings.periodDays || 5}" min="2" max="12" required>
            <small class="text-muted">Habitualmente entre 3 y 7 días.</small>
          </div>
        </div>

        <div class="field">
          <label for="cfg-last-start">Fecha de inicio del último período</label>
          <input type="date" id="cfg-last-start" name="lastStart" value="${settings.lastStart || ''}">
        </div>

        <div class="field">
          <label for="cfg-history">Historial de inicios anteriores (separados por coma)</label>
          <input type="text" id="cfg-history" name="history_raw" value="${(settings.history || []).join(', ')}" placeholder="Ej: 2026-08-14, 2026-09-11, 2026-10-09">
          <small class="text-muted"><i class="fa-regular fa-lightbulb"></i> <strong>Tip:</strong> Si ingresas las fechas de tus últimos 3 meses, ¡el algoritmo predictivo inteligente se activará de inmediato!</small>
        </div>

        <div style="display:flex; justify-content:flex-end; gap:0.5rem; margin-top:1.25rem;">
          <button type="button" class="btn" data-action="cycle-close-settings">Cancelar</button>
          <button type="submit" class="btn btn-primary">Guardar Configuración</button>
        </div>
      </form>
    </dialog>
  `;
}

function openDayModal(dateStr) {
  currentDaySelected = dateStr;
  const dialog = document.getElementById('dialog-cycle-day-log');
  if (!dialog) return;

  const errBox = document.getElementById('cycle-day-dialog-error');
  if (errBox) errBox.style.display = 'none';

  document.getElementById('dialog-cycle-day-title').innerHTML = `<i class="fa-solid fa-calendar-day"></i> Registro Diario`;
  document.getElementById('dialog-cycle-day-subtitle').textContent = formatDisplayDate(dateStr);
  document.getElementById('log-date').value = dateStr;

  // Buscar si ya existe log para este día en cachedCycleData
  const existingLog = (cachedCycleData?.logs || []).find(l => l.date === dateStr) ||
    (cachedCycleData?.allLogs || []).find(l => l.date === dateStr);

  // Setear formulario
  const contraceptiveRadios = document.querySelectorAll('#form-cycle-day-log input[name="contraceptive"]');
  contraceptiveRadios.forEach(r => {
    r.checked = (r.value === (existingLog?.contraceptive || ''));
  });

  const flowRadios = document.querySelectorAll('#form-cycle-day-log input[name="flow"]');
  flowRadios.forEach(r => {
    r.checked = (r.value === (existingLog?.flow || 'ninguno'));
  });

  document.getElementById('log-intimacy').checked = Boolean(existingLog?.intimacy);
  document.getElementById('log-is-period-start').checked = Boolean(existingLog?.is_period_start);
  document.getElementById('log-notes').value = existingLog?.notes || '';

  const deleteBtn = document.getElementById('btn-delete-day-log');
  if (deleteBtn) {
    deleteBtn.style.display = existingLog ? 'inline-block' : 'none';
  }

  if (!dialog.open) {
    dialog.showModal();
  }
}

export default {
  id: 'cycle',
  render: renderCycleTab,
  actions: {
    'cycle-prev-month': async (ctx) => {
      currentMonthStr = shiftMonth(currentMonthStr, -1);
      await ctx.refresh();
    },
    'cycle-next-month': async (ctx) => {
      currentMonthStr = shiftMonth(currentMonthStr, 1);
      await ctx.refresh();
    },
    'cycle-today': async (ctx) => {
      currentMonthStr = new Date().toISOString().slice(0, 7);
      await ctx.refresh();
    },
    'cycle-open-settings': () => {
      const dialog = document.getElementById('dialog-cycle-settings');
      if (!dialog) return;
      const errBox = document.getElementById('cycle-settings-dialog-error');
      if (errBox) errBox.style.display = 'none';
      if (!dialog.open) dialog.showModal();
    },
    'cycle-close-settings': () => {
      const dialog = document.getElementById('dialog-cycle-settings');
      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
    },
    'cycle-open-day-dialog': (ctx, el) => {
      const dateStr = el.dataset.date || el.closest('[data-date]')?.dataset.date;
      if (dateStr) {
        openDayModal(dateStr);
      }
    },
    'cycle-close-day-dialog': () => {
      const dialog = document.getElementById('dialog-cycle-day-log');
      if (dialog) {
        try { dialog.close(); } catch (_) {}
        dialog.removeAttribute('open');
      }
    },
    'cycle-log-today': () => {
      const todayStr = new Date().toISOString().slice(0, 10);
      openDayModal(todayStr);
    },
    'cycle-delete-day-log': async (ctx) => {
      if (!currentDaySelected) return;
      if (!confirm(`¿Borrar el registro del día ${currentDaySelected}?`)) return;

      try {
        await api(`/api/cycle/log/${currentDaySelected}`, { method: 'DELETE' });
        const dialog = document.getElementById('dialog-cycle-day-log');
        if (dialog) {
          try { dialog.close(); } catch (_) {}
          dialog.removeAttribute('open');
        }
        ctx.showStatus(`Registro del día ${currentDaySelected} eliminado.`);
        await ctx.refresh();
      } catch (err) {
        const errBox = document.getElementById('cycle-day-dialog-error');
        if (errBox) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        }
      }
    }
  },
  forms: {
    'form-cycle-day-log': async (ctx, data) => {
      const errBox = document.getElementById('cycle-day-dialog-error');
      try {
        if (errBox) errBox.style.display = 'none';

        const payload = {
          date: data.date,
          contraceptive: data.contraceptive || '',
          intimacy: data.intimacy ? 1 : 0,
          flow: data.flow || 'ninguno',
          is_period_start: data.is_period_start ? 1 : 0,
          notes: data.notes || ''
        };

        const res = await api('/api/cycle/log', {
          method: 'POST',
          body: payload
        });

        const dialog = document.getElementById('dialog-cycle-day-log');
        if (dialog) {
          try { dialog.close(); } catch (_) {}
          dialog.removeAttribute('open');
        }

        ctx.showStatus('Día registrado con éxito en el calendario.');
        await ctx.refresh();
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        } else {
          ctx.showStatus(err.message, true);
        }
      }
    },
    'form-cycle-settings': async (ctx, data) => {
      const errBox = document.getElementById('cycle-settings-dialog-error');
      try {
        if (errBox) errBox.style.display = 'none';

        const historyList = String(data.history_raw || '')
          .split(/[,;\n]/)
          .map(s => s.trim())
          .filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s));

        const payload = {
          contraceptive_method: data.contraceptive_method,
          cycleDays: Number(data.cycleDays || 28),
          periodDays: Number(data.periodDays || 5),
          lastStart: data.lastStart || '',
          history: historyList
        };

        await api('/api/cycle/settings', {
          method: 'PUT',
          body: payload
        });

        const dialog = document.getElementById('dialog-cycle-settings');
        if (dialog) {
          try { dialog.close(); } catch (_) {}
          dialog.removeAttribute('open');
        }

        ctx.showStatus('Configuración del ciclo y método actualizada.');
        await ctx.refresh();
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.style.display = 'block';
        } else {
          ctx.showStatus(err.message, true);
        }
      }
    }
  }
};

