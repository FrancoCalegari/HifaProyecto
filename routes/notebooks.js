module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

  if (apiPath === '/api/notebooks' && req.method === 'GET') {
    const notebooks = db.prepare('SELECT * FROM notebooks WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
    const pages = db.prepare('SELECT * FROM notebook_pages WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
    for (const nb of notebooks) {
      nb.pages = pages.filter(p => p.notebook_id === nb.id);
    }
    return send(200, { notebooks });
  }

  if (apiPath === '/api/notebooks' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title) return send(400, { error: 'Título del cuaderno requerido' });
    const info = db
      .prepare('INSERT INTO notebooks (couple_id, title, icon, created_by) VALUES (?, ?, ?, ?)')
      .run(coupleId, body.title.trim(), body.icon || '📓', user.id);
    const nbId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO notebook_pages (notebook_id, couple_id, title, markdown_content) VALUES (?, ?, ?, ?)').run(
      nbId,
      coupleId,
      'Página 1',
      `# ${body.title.trim()}\n\nEscribe aquí texto, listas, fotos o checkboxes:\n- [ ] Idea 1\n- [x] Idea 2`
    );
    return send(201, { id: nbId });
  }

  if (apiPath.startsWith('/api/notebooks/') && apiPath.endsWith('/pages') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const nbId = Number(parts[parts.length - 2]);
    const body = await c.body();
    if (!body.title) return send(400, { error: 'Título de página requerido' });
    const info = db
      .prepare('INSERT INTO notebook_pages (notebook_id, couple_id, title, markdown_content) VALUES (?, ?, ?, ?)')
      .run(nbId, coupleId, body.title.trim(), body.markdown_content || `# ${body.title.trim()}\n`);
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/notebooks/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM notebook_pages WHERE notebook_id = ? AND couple_id = ?').run(id, coupleId);
    db.prepare('DELETE FROM notebooks WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/pages/') && req.method === 'PUT') {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    db.prepare(
      "UPDATE notebook_pages SET title = COALESCE(?, title), markdown_content = COALESCE(?, markdown_content), updated_at = datetime('now') WHERE id = ? AND couple_id = ?"
    ).run(body.title ?? null, body.markdown_content ?? null, id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/pages/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM notebook_pages WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
