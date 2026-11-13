const { safeJson } = require('../lib/helpers');

function parseRouletteOptions(raw) {
  return Array.isArray(raw)
    ? raw.map(s => String(s).trim()).filter(Boolean)
    : String(raw || '')
        .split(/[\n,]/)
        .map(s => s.trim())
        .filter(Boolean);
}

function normalizePlanMedia(raw) {
  const list = Array.isArray(raw) ? raw : safeJson(raw, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(item => item && typeof item.url === 'string' && item.url.trim())
    .map(item => ({
      url: item.url.trim(),
      type: item.type === 'video' ? 'video' : 'image',
      name: String(item.name || '').trim()
    }));
}

function hydratePlan(row) {
  if (!row) return row;
  row.media = normalizePlanMedia(row.media_json);
  return row;
}

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
    const options = parseRouletteOptions(body.options);
    if (!body.name || options.length < 2) {
      return send(400, { error: 'Nombre y al menos 2 opciones son requeridos.' });
    }
    const info = db
      .prepare('INSERT INTO roulettes (couple_id, name, options_json) VALUES (?, ?, ?)')
      .run(coupleId, body.name.trim(), JSON.stringify(options));
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/roulettes/') && req.method === 'PUT') {
    const id = Number(apiPath.split('/').pop());
    const existing = db.prepare('SELECT * FROM roulettes WHERE id = ? AND couple_id = ?').get(id, coupleId);
    if (!existing) return send(404, { error: 'Ruleta no encontrada.' });
    const body = await c.body();
    const name = String(body.name || existing.name).trim();
    const options = body.options !== undefined ? parseRouletteOptions(body.options) : safeJson(existing.options_json, []);
    if (!name || options.length < 2) {
      return send(400, { error: 'Nombre y al menos 2 opciones son requeridos.' });
    }
    db.prepare('UPDATE roulettes SET name = ?, options_json = ? WHERE id = ? AND couple_id = ?').run(
      name,
      JSON.stringify(options),
      id,
      coupleId
    );
    const updated = db.prepare('SELECT * FROM roulettes WHERE id = ?').get(id);
    updated.options = safeJson(updated.options_json, []);
    return send(200, { ok: true, roulette: updated });
  }

  if (apiPath.startsWith('/api/roulettes/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM roulettes WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  // Módulo de Planes (Citas), IA y Journaling
  if (apiPath === '/api/plans' && req.method === 'GET') {
    const plans = db
      .prepare(`
        SELECT * FROM weekly_plans
        WHERE couple_id IS NULL OR couple_id = ?
        ORDER BY selected_for_week DESC, COALESCE(NULLIF(planned_date, ''), created_at) DESC, id DESC
      `)
      .all(coupleId)
      .map(hydratePlan);
    return send(200, { plans });
  }

  if (apiPath === '/api/plans' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title || !String(body.title).trim()) {
      return send(400, { error: 'Título del plan requerido' });
    }
    const media = normalizePlanMedia(body.media);
    const status = body.status === 'completed' ? 'completed' : 'pending';
    const rating = Math.max(0, Math.min(5, Number(body.rating || 0) || 0));
    const info = db
      .prepare(`
        INSERT INTO weekly_plans (
          couple_id, title, category, weather, source, proposed_by,
          description, location, planned_by, planned_date, status, rating, journal_text, mood, media_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        coupleId,
        String(body.title).trim(),
        String(body.category || 'Cita').trim(),
        String(body.weather || 'Cualquiera').trim(),
        'user',
        user.id,
        String(body.description || '').trim(),
        String(body.location || '').trim(),
        String(body.planned_by || user.first_name || '').trim(),
        String(body.planned_date || '').trim(),
        status,
        rating,
        String(body.journal_text || '').trim(),
        String(body.mood || '').trim(),
        JSON.stringify(media)
      );
    const created = hydratePlan(db.prepare('SELECT * FROM weekly_plans WHERE id = ?').get(Number(info.lastInsertRowid)));
    return send(201, { id: created.id, plan: created });
  }

  if (apiPath === '/api/plans/random' && req.method === 'POST') {
    const plans = db.prepare('SELECT * FROM weekly_plans WHERE couple_id IS NULL OR couple_id = ?').all(coupleId);
    if (plans.length === 0) return send(400, { error: 'No hay planes cargados' });
    const chosen = plans[Math.floor(Math.random() * plans.length)];
    db.prepare('UPDATE weekly_plans SET selected_for_week = 0 WHERE couple_id = ? OR couple_id IS NULL').run(coupleId);
    db.prepare('UPDATE weekly_plans SET selected_for_week = 1 WHERE id = ?').run(chosen.id);
    chosen.selected_for_week = 1;
    return send(200, { chosen: hydratePlan(chosen) });
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
      'INSERT INTO weekly_plans (couple_id, title, category, weather, source, proposed_by, planned_by) VALUES (?, ?, ?, ?, \'ai\', ?, \'SpiderIA\')'
    );
    const inserted = [];
    for (const p of aiResult.plans) {
      const info = ins.run(coupleId, p.title, p.category || 'IA', p.weather || 'Cualquiera', user.id);
      inserted.push({ id: Number(info.lastInsertRowid), ...p, source: 'ai', planned_by: 'SpiderIA', media: [] });
    }
    return send(200, { provider: aiResult.provider, plans: inserted });
  }

  if (apiPath.match(/^\/api\/plans\/\d+\/select$/) && req.method === 'POST') {
    const id = Number(apiPath.split('/')[3]);
    const target = db.prepare('SELECT * FROM weekly_plans WHERE id = ? AND (couple_id IS NULL OR couple_id = ?)').get(id, coupleId);
    if (!target) return send(404, { error: 'Plan no encontrado' });
    db.prepare('UPDATE weekly_plans SET selected_for_week = 0 WHERE couple_id = ? OR couple_id IS NULL').run(coupleId);
    db.prepare('UPDATE weekly_plans SET selected_for_week = 1 WHERE id = ?').run(id);
    target.selected_for_week = 1;
    return send(200, { ok: true, chosen: hydratePlan(target) });
  }

  if (apiPath.match(/^\/api\/plans\/\d+$/) && req.method === 'PUT') {
    const id = Number(apiPath.split('/').pop());
    const existing = db.prepare('SELECT * FROM weekly_plans WHERE id = ? AND (couple_id IS NULL OR couple_id = ?)').get(id, coupleId);
    if (!existing) return send(404, { error: 'Plan no encontrado' });

    const body = await c.body();
    const title = body.title !== undefined ? String(body.title).trim() : existing.title;
    if (!title) return send(400, { error: 'Título del plan requerido' });

    const category = body.category !== undefined ? String(body.category).trim() || 'Cita' : existing.category;
    const weather = body.weather !== undefined ? String(body.weather).trim() || 'Cualquiera' : existing.weather;
    const description = body.description !== undefined ? String(body.description).trim() : (existing.description || '');
    const location = body.location !== undefined ? String(body.location).trim() : (existing.location || '');
    const plannedBy = body.planned_by !== undefined ? String(body.planned_by).trim() : (existing.planned_by || '');
    const plannedDate = body.planned_date !== undefined ? String(body.planned_date).trim() : (existing.planned_date || '');
    const status = body.status !== undefined ? (body.status === 'completed' ? 'completed' : 'pending') : (existing.status || 'pending');
    const rating = body.rating !== undefined ? Math.max(0, Math.min(5, Number(body.rating || 0) || 0)) : Number(existing.rating || 0);
    const journalText = body.journal_text !== undefined ? String(body.journal_text).trim() : (existing.journal_text || '');
    const mood = body.mood !== undefined ? String(body.mood).trim() : (existing.mood || '');
    const media = body.media !== undefined ? normalizePlanMedia(body.media) : normalizePlanMedia(existing.media_json);

    let savedId = id;
    if (existing.couple_id === null) {
      // Clonar plan base del sistema en un registro editable propio de la pareja
      const wasSelected = existing.selected_for_week ? 1 : 0;
      if (wasSelected) {
        db.prepare('UPDATE weekly_plans SET selected_for_week = 0 WHERE id = ?').run(id);
      }
      const info = db
        .prepare(`
          INSERT INTO weekly_plans (
            couple_id, title, category, weather, source, selected_for_week, proposed_by,
            description, location, planned_by, planned_date, status, rating, journal_text, mood, media_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          coupleId, title, category, weather, existing.source || 'system', wasSelected, user.id,
          description, location, plannedBy, plannedDate, status, rating, journalText, mood, JSON.stringify(media)
        );
      savedId = Number(info.lastInsertRowid);
    } else {
      db.prepare(`
        UPDATE weekly_plans SET
          title = ?, category = ?, weather = ?, description = ?, location = ?,
          planned_by = ?, planned_date = ?, status = ?, rating = ?,
          journal_text = ?, mood = ?, media_json = ?
        WHERE id = ? AND couple_id = ?
      `).run(
        title, category, weather, description, location,
        plannedBy, plannedDate, status, rating,
        journalText, mood, JSON.stringify(media),
        id, coupleId
      );
    }

    const updated = hydratePlan(db.prepare('SELECT * FROM weekly_plans WHERE id = ?').get(savedId));
    return send(200, { ok: true, id: savedId, plan: updated });
  }

  if (apiPath.startsWith('/api/plans/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM weekly_plans WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
