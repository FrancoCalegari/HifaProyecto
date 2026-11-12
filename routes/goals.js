module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

  if (apiPath === '/api/goals' && req.method === 'GET') {
    const goals = db
      .prepare(
        `SELECT g.*, u.first_name as creator_name
         FROM goals g
         LEFT JOIN users u ON u.id = g.created_by
         WHERE g.couple_id = ?
         ORDER BY g.finished ASC, g.id DESC`
      )
      .all(coupleId);
    return send(200, { goals });
  }

  if (apiPath === '/api/goals' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title || !body.goal_type) {
      return send(400, { error: 'Título y tipo de meta son obligatorios.' });
    }
    const info = db
      .prepare(
        `INSERT INTO goals (couple_id, created_by, title, description, goal_type, target_value, current_value, frequency, target_date, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        coupleId,
        user.id,
        body.title.trim(),
        body.description || '',
        body.goal_type,
        Number(body.target_value || 1),
        Number(body.current_value || 0),
        body.frequency || 'diaria',
        body.target_date || '',
        body.created_at || new Date().toISOString()
      );
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/goals/') && apiPath.endsWith('/progress') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const id = Number(parts[parts.length - 2]);
    const body = await c.body();
    const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND couple_id = ?').get(id, coupleId);
    if (!goal) return send(404, { error: 'Meta no encontrada' });

    const delta = Number(body.delta ?? 1);
    const nextVal = Number(goal.current_value || 0) + delta;
    const finished = goal.target_value > 0 && nextVal >= goal.target_value ? 1 : goal.finished;
    const today = new Date().toISOString().slice(0, 10);
    db.prepare('UPDATE goals SET current_value = ?, last_checkin_date = ?, finished = ? WHERE id = ?').run(
      nextVal,
      today,
      finished,
      id
    );
    return send(200, { ok: true, current_value: nextVal, finished });
  }

  if (apiPath.startsWith('/api/goals/') && apiPath.endsWith('/finish') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const id = Number(parts[parts.length - 2]);
    db.prepare('UPDATE goals SET finished = 1 WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true, finished: 1 });
  }

  if (apiPath.startsWith('/api/goals/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM goals WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
