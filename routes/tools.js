const { safeJson, computeMenstrualProjections } = require('../lib/helpers');

module.exports = async function handle(c) {
  const { req, apiPath, ctx, db, user, partner, coupleId, send } = c;
  const { generateAiPlans } = ctx;

  if (apiPath === '/api/roulettes' && req.method === 'GET') {
    const rows = db.prepare('SELECT * FROM roulettes WHERE couple_id = ? ORDER BY id DESC').all(coupleId);
    for (const r of rows) r.options = safeJson(r.options_json, []);
    return send(200, { roulettes: rows });
  }

  if (apiPath === '/api/roulettes' && req.method === 'POST') {
    const body = await c.body();
    const options = Array.isArray(body.options)
      ? body.options.map(s => String(s).trim()).filter(Boolean)
      : String(body.options || '')
          .split(',')
          .map(s => s.trim())
          .filter(Boolean);
    if (!body.name || options.length < 2) {
      return send(400, { error: 'Nombre y al menos 2 opciones son requeridos.' });
    }
    const info = db
      .prepare('INSERT INTO roulettes (couple_id, name, options_json) VALUES (?, ?, ?)')
      .run(coupleId, body.name.trim(), JSON.stringify(options));
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/roulettes/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM roulettes WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  // Herramientas: Planes aleatorios de la semana + IA
  if (apiPath === '/api/plans' && req.method === 'GET') {
    const plans = db
      .prepare('SELECT * FROM weekly_plans WHERE couple_id IS NULL OR couple_id = ? ORDER BY selected_for_week DESC, id DESC')
      .all(coupleId);
    return send(200, { plans });
  }

  if (apiPath === '/api/plans' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title) return send(400, { error: 'Título del plan requerido' });
    const info = db
      .prepare('INSERT INTO weekly_plans (couple_id, title, category, weather, source, proposed_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(coupleId, body.title.trim(), body.category || 'Cita', body.weather || 'Cualquiera', 'user', user.id);
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath === '/api/plans/random' && req.method === 'POST') {
    const plans = db.prepare('SELECT * FROM weekly_plans WHERE couple_id IS NULL OR couple_id = ?').all(coupleId);
    if (plans.length === 0) return send(400, { error: 'No hay planes cargados' });
    const chosen = plans[Math.floor(Math.random() * plans.length)];
    db.prepare('UPDATE weekly_plans SET selected_for_week = 0 WHERE couple_id = ? OR couple_id IS NULL').run(coupleId);
    db.prepare('UPDATE weekly_plans SET selected_for_week = 1 WHERE id = ?').run(chosen.id);
    chosen.selected_for_week = 1;
    return send(200, { chosen });
  }

  if (apiPath === '/api/plans/ai' && req.method === 'POST') {
    const myTastes = user.tastes || {};
    const pTastes = partner?.tastes || {};
    const coupleContext = {
      foods: [myTastes.favorite_food, pTastes.favorite_food],
      movies: [myTastes.favorite_series_movies, pTastes.favorite_series_movies],
      weathers: [myTastes.favorite_weather, pTastes.favorite_weather],
      plans: [myTastes.favorite_plan, pTastes.favorite_plan],
      extra: [myTastes.additional_tastes, pTastes.additional_tastes]
    };
    const aiResult = await generateAiPlans(coupleContext);
    const ins = db.prepare(
      'INSERT INTO weekly_plans (couple_id, title, category, weather, source, proposed_by) VALUES (?, ?, ?, ?, \'ai\', ?)'
    );
    const inserted = [];
    for (const p of aiResult.plans) {
      const info = ins.run(coupleId, p.title, p.category || 'IA', p.weather || 'Cualquiera', user.id);
      inserted.push({ id: Number(info.lastInsertRowid), ...p, source: 'ai' });
    }
    return send(200, { provider: aiResult.provider, plans: inserted });
  }

  if (apiPath.startsWith('/api/plans/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM weekly_plans WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  // Herramientas: Calendario de Ciclo Menstrual
  if (apiPath === '/api/menstrual' && req.method === 'GET') {
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const data = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });
    return send(200, { menstrual: computeMenstrualProjections(data) });
  }

  if (apiPath === '/api/menstrual' && req.method === 'PUT') {
    const body = await c.body();
    const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
    const current = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });
    const nextData = {
      lastStart: body.lastStart ?? current.lastStart,
      periodDays: Number(body.periodDays || current.periodDays || 5),
      cycleDays: Number(body.cycleDays || current.cycleDays || 28),
      notes: body.notes ?? current.notes ?? '',
      history: Array.isArray(body.history) ? body.history : current.history || []
    };
    if (body.lastStart && !nextData.history.includes(body.lastStart)) {
      nextData.history = [body.lastStart, ...nextData.history].slice(0, 12);
    }
    db.prepare('UPDATE couples SET menstrual_data_json = ? WHERE id = ?').run(JSON.stringify(nextData), coupleId);
    return send(200, { menstrual: computeMenstrualProjections(nextData) });
  }

  return false;
};
