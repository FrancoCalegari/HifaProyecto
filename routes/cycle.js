const { safeJson } = require('../lib/helpers');
const { analyzeAndProjectMenstrual } = require('../lib/cycle');

module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

  // 1. Obtener información y calendario del ciclo
  if (apiPath === '/api/cycle' && req.method === 'GET') {
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const settings = safeJson(couple.menstrual_data_json, {
      lastStart: '',
      periodDays: 5,
      cycleDays: 28,
      contraceptive_method: 'pastillas_28',
      history: []
    });

    const monthParam = c.urlObj.searchParams.get('month') || new Date().toISOString().slice(0, 7);
    const logs = db
      .prepare('SELECT * FROM menstrual_logs WHERE couple_id = ? AND date LIKE ? ORDER BY date ASC')
      .all(coupleId, `${monthParam}%`);

    const allLogs = db
      .prepare('SELECT date, contraceptive, intimacy, flow, is_period_start, notes FROM menstrual_logs WHERE couple_id = ?')
      .all(coupleId);

    const today = new Date().toISOString().slice(0, 10);
    const todayLog = db
      .prepare('SELECT * FROM menstrual_logs WHERE couple_id = ? AND date = ?')
      .get(coupleId, today) || null;

    const result = analyzeAndProjectMenstrual(coupleId, db, settings);

    return send(200, {
      month: monthParam,
      settings: result.settings,
      projections: result.projections,
      analysis: result.analysis,
      logs,
      allLogs,
      todayLog
    });
  }

  // 2. Registrar o actualizar el día en el calendario de ciclo
  if (apiPath === '/api/cycle/log' && req.method === 'POST') {
    const body = await c.body();
    const { date, contraceptive, intimacy, flow, is_period_start, notes } = body;

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return send(400, { error: 'Fecha válida requerida (formato YYYY-MM-DD).' });
    }

    const cleanContraceptive = String(contraceptive || '').trim();
    const intimacyVal = (intimacy === true || intimacy === 1 || intimacy === '1') ? 1 : 0;
    const flowVal = ['ninguno', 'ligero', 'moderado', 'abundante'].includes(flow) ? flow : 'ninguno';
    const isStartVal = (is_period_start === true || is_period_start === 1 || is_period_start === '1') ? 1 : 0;
    const notesVal = String(notes || '').trim();

    db.prepare(
      `INSERT INTO menstrual_logs (couple_id, date, contraceptive, intimacy, flow, is_period_start, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(couple_id, date) DO UPDATE SET
         contraceptive = excluded.contraceptive,
         intimacy = excluded.intimacy,
         flow = excluded.flow,
         is_period_start = excluded.is_period_start,
         notes = excluded.notes`
    ).run(coupleId, date, cleanContraceptive, intimacyVal, flowVal, isStartVal, notesVal);

    // Si se marcó como inicio de período, sincronizar con menstrual_data_json en couples
    if (isStartVal === 1) {
      const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
      const settings = safeJson(couple.menstrual_data_json, {
        lastStart: '',
        periodDays: 5,
        cycleDays: 28,
        contraceptive_method: 'pastillas_28',
        history: []
      });
      settings.lastStart = date;
      const historyList = Array.isArray(settings.history) ? settings.history : [];
      if (!historyList.includes(date)) {
        settings.history = [date, ...historyList].slice(0, 12);
      }
      db.prepare('UPDATE couples SET menstrual_data_json = ? WHERE id = ?').run(JSON.stringify(settings), coupleId);
    }

    const coupleAfter = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const settingsAfter = safeJson(coupleAfter.menstrual_data_json, {});
    const projected = analyzeAndProjectMenstrual(coupleId, db, settingsAfter);

    const savedLog = db.prepare('SELECT * FROM menstrual_logs WHERE couple_id = ? AND date = ?').get(coupleId, date);
    return send(200, { ok: true, log: savedLog, ...projected });
  }

  // 3. Eliminar registro de un día
  if (apiPath.startsWith('/api/cycle/log/') && req.method === 'DELETE') {
    const targetDate = apiPath.split('/').pop();
    db.prepare('DELETE FROM menstrual_logs WHERE couple_id = ? AND date = ?').run(coupleId, targetDate);
    return send(200, { ok: true });
  }

  // 4. Configurar método y parámetros del ciclo
  if (apiPath === '/api/cycle/settings' && (req.method === 'PUT' || req.method === 'POST')) {
    const body = await c.body();
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const current = safeJson(couple.menstrual_data_json, {
      lastStart: '',
      periodDays: 5,
      cycleDays: 28,
      contraceptive_method: 'pastillas_28',
      history: []
    });

    const nextSettings = {
      ...current,
      contraceptive_method: body.contraceptive_method || current.contraceptive_method || 'pastillas_28',
      cycleDays: Number(body.cycleDays || current.cycleDays || 28),
      periodDays: Number(body.periodDays || current.periodDays || 5),
      lastStart: body.lastStart ?? current.lastStart ?? '',
      notes: body.notes ?? current.notes ?? '',
      history: Array.isArray(body.history) ? body.history : current.history || []
    };

    if (body.lastStart && !nextSettings.history.includes(body.lastStart)) {
      nextSettings.history = [body.lastStart, ...nextSettings.history].slice(0, 12);
    }

    db.prepare('UPDATE couples SET menstrual_data_json = ? WHERE id = ?').run(JSON.stringify(nextSettings), coupleId);
    const projected = analyzeAndProjectMenstrual(coupleId, db, nextSettings);

    return send(200, { ok: true, ...projected });
  }

  // 5. Compatibilidad hacia atrás con /api/menstrual (para pruebas existentes y clientes móviles)
  if (apiPath === '/api/menstrual' && req.method === 'GET') {
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const current = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });
    const res = analyzeAndProjectMenstrual(coupleId, db, current);
    return send(200, { menstrual: res.projections });
  }

  if (apiPath === '/api/menstrual' && req.method === 'PUT') {
    const body = await c.body();
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const current = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });

    const nextSettings = {
      ...current,
      lastStart: body.lastStart ?? current.lastStart,
      periodDays: Number(body.periodDays || current.periodDays || 5),
      cycleDays: Number(body.cycleDays || current.cycleDays || 28),
      notes: body.notes ?? current.notes ?? '',
      history: Array.isArray(body.history) ? body.history : current.history || []
    };

    if (body.lastStart && !nextSettings.history.includes(body.lastStart)) {
      nextSettings.history = [body.lastStart, ...nextSettings.history].slice(0, 12);
    }

    db.prepare('UPDATE couples SET menstrual_data_json = ? WHERE id = ?').run(JSON.stringify(nextSettings), coupleId);
    const res = analyzeAndProjectMenstrual(coupleId, db, nextSettings);
    return send(200, { menstrual: res.projections });
  }

  return false;
};

