module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

  if (apiPath === '/api/lists' && req.method === 'GET') {
    const lists = db.prepare('SELECT * FROM lists WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
    const items = db.prepare('SELECT * FROM list_items WHERE couple_id = ? ORDER BY checked ASC, id ASC').all(coupleId);
    for (const l of lists) {
      l.items = items.filter(i => i.list_id === l.id);
      l.totalPrice = l.items.reduce((acc, i) => acc + Number(i.price || 0), 0);
      l.checkedPrice = l.items.filter(i => i.checked).reduce((acc, i) => acc + Number(i.price || 0), 0);
    }
    return send(200, { lists });
  }

  if (apiPath === '/api/lists' && req.method === 'POST') {
    const body = await c.body();
    if (!body.name) return send(400, { error: 'Nombre de lista requerido' });
    const info = db.prepare('INSERT INTO lists (couple_id, name) VALUES (?, ?)').run(coupleId, body.name.trim());
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/lists/') && apiPath.endsWith('/items') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const listId = Number(parts[parts.length - 2]);
    const body = await c.body();
    if (!body.name) return send(400, { error: 'Nombre del ítem requerido' });
    const info = db
      .prepare('INSERT INTO list_items (list_id, couple_id, name, price, quantity, created_by) VALUES (?, ?, ?, ?, ?, ?)')
      .run(listId, coupleId, body.name.trim(), Number(body.price || 0), String(body.quantity || '1'), user.id);
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/lists/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM list_items WHERE list_id = ? AND couple_id = ?').run(id, coupleId);
    db.prepare('DELETE FROM lists WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/list-items/') && req.method === 'PATCH') {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    db.prepare('UPDATE list_items SET checked = ? WHERE id = ? AND couple_id = ?').run(body.checked ? 1 : 0, id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/list-items/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM list_items WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
