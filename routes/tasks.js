module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

  if (apiPath === '/api/tasks' && req.method === 'GET') {
    const tasks = db.prepare('SELECT * FROM tasks WHERE couple_id = ? ORDER BY completed ASC, id DESC').all(coupleId);
    return send(200, { tasks });
  }

  if (apiPath === '/api/tasks' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title) return send(400, { error: 'Título requerido' });
    const info = db
      .prepare(
        'INSERT INTO tasks (couple_id, board_name, title, priority, assigned_to, due_datetime, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(
        coupleId,
        (body.board_name || 'General').trim(),
        body.title.trim(),
        body.priority || 'media',
        body.assigned_to || 'both',
        body.due_datetime || '',
        user.id
      );
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/tasks/') && req.method === 'PATCH') {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    if (body.completed !== undefined) {
      db.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND couple_id = ?').run(body.completed ? 1 : 0, id, coupleId);
    }
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/tasks/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM tasks WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
