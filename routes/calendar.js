module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/calendar' && req.method === 'GET') {
    const events = db
      .prepare('SELECT * FROM calendar_events WHERE couple_id = ? ORDER BY start_datetime ASC')
      .all(coupleId);
    return send(200, { events });
  }

  if (apiPath === '/api/calendar' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title || !body.start_datetime) {
      return send(400, { error: 'Título y fecha/hora son obligatorios' });
    }
    const info = db
      .prepare(
        `INSERT INTO calendar_events (couple_id, title, description, start_datetime, end_datetime, remind_offset_value, remind_offset_unit, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        coupleId,
        body.title.trim(),
        body.description || '',
        body.start_datetime,
        body.end_datetime || '',
        Number(body.remind_offset_value ?? 30),
        body.remind_offset_unit || 'minutes',
        user.id
      );
    if (partner) {
      notifyPartner(
        coupleId,
        partner.id,
        'Nuevo evento agendado',
        `${user.first_name} agendó "${body.title.trim()}" para ${body.start_datetime}`,
        'calendar'
      );
    }
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/calendar/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM calendar_events WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath === '/api/notifications/read' && req.method === 'POST') {
    db.prepare('UPDATE notifications SET read = 1 WHERE couple_id = ? AND (target_user_id IS NULL OR target_user_id = ?)').run(
      coupleId,
      user.id
    );
    return send(200, { ok: true });
  }

  return false;
};
