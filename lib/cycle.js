const { getOffsetDate } = require('./helpers');

/**
 * Calcula la diferencia en días entre dos fechas 'YYYY-MM-DD' (date1 - date2).
 */
function diffDays(date1, date2) {
  const d1 = new Date(date1 + 'T00:00:00Z');
  const d2 = new Date(date2 + 'T00:00:00Z');
  return Math.round((d1 - d2) / 86400000);
}

/**
 * Motor de análisis algorítmico y proyección del ciclo menstrual.
 * Luego de al menos 3 ciclos registrados (período de 3 meses), activa el análisis
 * estadístico para proyectar con precisión la duración real, regularidad,
 * próximas fechas de menstruación, ovulación y ventana fértil.
 */
function analyzeAndProjectMenstrual(coupleId, db, settings = {}) {
  const baseCycleDays = Number(settings.cycleDays || 28);
  const basePeriodDays = Number(settings.periodDays || 5);
  const contraceptiveMethod = settings.contraceptive_method || 'pastillas_28';

  // 1. Recolectar fechas de inicio de período desde:
  // a) menstrual_logs marcados explícitamente como inicio de período o primer día con flujo
  const logs = db
    .prepare('SELECT date, flow, is_period_start FROM menstrual_logs WHERE couple_id = ? ORDER BY date ASC')
    .all(coupleId);

  const startDatesSet = new Set();

  // Si hay lastStart configurado
  if (settings.lastStart) {
    startDatesSet.add(settings.lastStart);
  }

  // Si hay historial de fechas en settings.history
  if (Array.isArray(settings.history)) {
    for (const h of settings.history) {
      if (typeof h === 'string' && h.length === 10) {
        startDatesSet.add(h);
      } else if (h && typeof h === 'object' && h.startDate) {
        startDatesSet.add(h.startDate);
      }
    }
  }

  // De los logs diarios: detectar días marcados como is_period_start o inicios de sangrado
  let previousHadFlow = false;
  for (const log of logs) {
    const hasFlow = log.flow && log.flow !== 'ninguno';
    if (log.is_period_start === 1) {
      startDatesSet.add(log.date);
    } else if (hasFlow && !previousHadFlow) {
      // Inicio de flujo tras días sin flujo
      startDatesSet.add(log.date);
    }
    previousHadFlow = hasFlow;
  }

  const sortedStarts = Array.from(startDatesSet).sort();

  // 2. Calcular intervalos entre inicios consecutivos de ciclo
  const intervals = [];
  for (let i = 0; i < sortedStarts.length - 1; i++) {
    const d = diffDays(sortedStarts[i + 1], sortedStarts[i]);
    // Considerar intervalos biológicamente posibles para un ciclo (18 a 55 días)
    if (d >= 18 && d <= 55) {
      intervals.push({
        from: sortedStarts[i],
        to: sortedStarts[i + 1],
        days: d
      });
    }
  }

  // 3. Evaluar condición de los 3 meses / 3 ciclos
  const cyclesRecorded = intervals.length;
  const algorithmActive = cyclesRecorded >= 3;

  let averageCycleDays = baseCycleDays;
  let averagePeriodDays = basePeriodDays;
  let regularity = 'En aprendizaje (se necesitan 3 ciclos)';
  let stdDev = 0;

  if (algorithmActive) {
    const totalDays = intervals.reduce((acc, it) => acc + it.days, 0);
    averageCycleDays = Math.round(totalDays / intervals.length);

    // Calcular desviación estándar
    const variance = intervals.reduce((acc, it) => acc + Math.pow(it.days - averageCycleDays, 2), 0) / intervals.length;
    stdDev = Math.round(Math.sqrt(variance) * 10) / 10;

    if (stdDev <= 1.5) {
      regularity = `Muy Regular (variación ±${stdDev} días)`;
    } else if (stdDev <= 3.5) {
      regularity = `Regular (variación ±${stdDev} días)`;
    } else {
      regularity = `Irregular (variación ±${stdDev} días)`;
    }

    // Calcular duración media de sangrado observada en logs si hay registros
    const flowDaysCount = logs.filter(l => l.flow && l.flow !== 'ninguno').length;
    if (flowDaysCount >= 3 && sortedStarts.length > 0) {
      const estimatedAvg = Math.round(flowDaysCount / sortedStarts.length);
      if (estimatedAvg >= 2 && estimatedAvg <= 10) {
        averagePeriodDays = estimatedAvg;
      }
    }
  }

  // 4. Proyecciones futuras
  const latestStart = sortedStarts.length > 0 ? sortedStarts[sortedStarts.length - 1] : settings.lastStart || '';

  const cycleLengthToUse = algorithmActive ? averageCycleDays : baseCycleDays;
  const periodLengthToUse = algorithmActive ? averagePeriodDays : basePeriodDays;

  let nextPeriodStart = '';
  let nextPeriodEnd = '';
  let ovulationDate = '';
  let fertileWindow = '';
  const upcomingCycles = [];

  if (latestStart) {
    let currentCycleStart = latestStart;
    // Si la fecha más reciente ya pasó hace más de un ciclo, avanzar hasta la siguiente fecha futura
    const today = new Date().toISOString().slice(0, 10);
    while (diffDays(today, currentCycleStart) > cycleLengthToUse) {
      currentCycleStart = getOffsetDate(currentCycleStart, cycleLengthToUse);
    }

    // Proyectar los próximos 3 ciclos futuros
    let iterStart = currentCycleStart;
    for (let c = 1; c <= 3; c++) {
      const pStart = getOffsetDate(iterStart, cycleLengthToUse);
      const pEnd = getOffsetDate(pStart, periodLengthToUse - 1);
      const ovDate = getOffsetDate(pStart, -14);
      const fStart = getOffsetDate(ovDate, -5);
      const fEnd = getOffsetDate(ovDate, 1);

      if (c === 1) {
        nextPeriodStart = pStart;
        nextPeriodEnd = pEnd;
        ovulationDate = ovDate;
        fertileWindow = `${fStart} al ${fEnd}`;
      }

      upcomingCycles.push({
        cycleNumber: c,
        periodStart: pStart,
        periodEnd: pEnd,
        ovulationDate: ovDate,
        fertileStart: fStart,
        fertileEnd: fEnd
      });

      iterStart = pStart;
    }
  }

  return {
    settings: {
      ...settings,
      contraceptive_method: contraceptiveMethod,
      cycleDays: baseCycleDays,
      periodDays: basePeriodDays,
      lastStart: latestStart
    },
    projections: {
      lastStart: latestStart,
      cycleDays: cycleLengthToUse,
      periodDays: periodLengthToUse,
      nextPeriodStart,
      nextPeriodEnd,
      ovulationDate,
      fertileWindow,
      upcomingCycles
    },
    analysis: {
      algorithmActive,
      cyclesRecorded,
      cyclesNeeded: 3,
      progressPercent: Math.min(100, Math.round((cyclesRecorded / 3) * 100)),
      averageCycleDays,
      averagePeriodDays,
      standardDeviation: stdDev,
      regularity,
      recordedStarts: sortedStarts,
      intervals
    }
  };
}

module.exports = {
  diffDays,
  analyzeAndProjectMenstrual
};

