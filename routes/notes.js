module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/notitas' && req.method === 'GET') {
    const rows = db
      .prepare(
        `SELECT n.*, u.first_name, u.avatar_url
         FROM notitas n
         JOIN users u ON u.id = n.author_user_id
         WHERE n.couple_id = ?`
      )
      .all(coupleId);
    return send(200, { notitas: rows });
  }

  if (apiPath === '/api/notitas' && req.method === 'POST') {
    const body = await c.body();
    const textContent = (body.text_content || '').trim();
    const drawingDataUrl = body.drawing_data_url || '';
    if (!textContent && !drawingDataUrl) {
      return send(400, { error: 'Escribe una notita o haz un dibujo para tu pareja.' });
    }
    // Overwrite previous notita from this user
    db.prepare(
      `INSERT INTO notitas (couple_id, author_user_id, text_content, drawing_data_url, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(couple_id, author_user_id)
       DO UPDATE SET text_content = excluded.text_content, drawing_data_url = excluded.drawing_data_url, updated_at = datetime('now')`
    ).run(coupleId, user.id, textContent, drawingDataUrl);

    if (partner) {
      const preview = textContent ? `: "${textContent}"` : ' (con un dibujo especial 🎨)';
      notifyPartner(coupleId, partner.id, 'Nota nueva', `${user.first_name} te dejó una nota nueva${preview}`, 'notita');
    }
    return send(200, { ok: true });
  }

  // Herramientas: Notas compartidas (con fotos)
  if (apiPath === '/api/notes' && req.method === 'GET') {
    const notes = db
      .prepare(
        `SELECT n.*, u.first_name as author_name
         FROM shared_notes n
         LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.couple_id = ?
         ORDER BY n.id DESC`
      )
      .all(coupleId);
    return send(200, { notes });
  }

  if (apiPath === '/api/notes' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title) return send(400, { error: 'Título requerido' });
    const info = db
      .prepare('INSERT INTO shared_notes (couple_id, author_user_id, title, content, photo_url) VALUES (?, ?, ?, ?, ?)')
      .run(coupleId, user.id, body.title.trim(), body.content || '', body.photo_url || '');
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/notes/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM shared_notes WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
