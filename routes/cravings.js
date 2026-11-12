module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/cravings' && req.method === 'GET') {
    const cravings = db
      .prepare(
        `SELECT c.*, u.first_name as owner_name, s.first_name as suggested_by_name
         FROM cravings c
         LEFT JOIN users u ON u.id = c.owner_user_id
         LEFT JOIN users s ON s.id = c.suggested_by_user_id
         WHERE c.couple_id = ? AND c.status != 'rejected'
         ORDER BY c.id DESC`
      )
      .all(coupleId);
    return send(200, { cravings });
  }

  if (apiPath === '/api/cravings' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title) return send(400, { error: '¿Qué quieren? es obligatorio.' });
    const isSuggestion = Boolean(body.suggest_to_partner && partner);
    const ownerId = isSuggestion ? partner.id : user.id;
    const suggestedBy = isSuggestion ? user.id : null;
    const status = isSuggestion ? 'suggested' : 'active';

    const info = db
      .prepare(
        `INSERT INTO cravings (couple_id, owner_user_id, suggested_by_user_id, status, title, url, price, photo_url, description)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        coupleId,
        ownerId,
        suggestedBy,
        status,
        body.title.trim(),
        body.url || '',
        Number(body.price || 0),
        body.photo_url || '',
        body.description || ''
      );

    if (isSuggestion && partner) {
      notifyPartner(
        coupleId,
        partner.id,
        'Sugerencia de antojo',
        `${user.first_name} te sugirió un antojo: "${body.title.trim()}". ¡Acepta o rechaza!`,
        'craving'
      );
    }
    return send(201, { id: Number(info.lastInsertRowid), status });
  }

  if (apiPath.startsWith('/api/cravings/') && apiPath.endsWith('/respond') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const id = Number(parts[parts.length - 2]);
    const body = await c.body();
    const accept = Boolean(body.accept);
    if (accept) {
      db.prepare("UPDATE cravings SET status = 'active' WHERE id = ? AND couple_id = ?").run(id, coupleId);
    } else {
      db.prepare("UPDATE cravings SET status = 'rejected' WHERE id = ? AND couple_id = ?").run(id, coupleId);
    }
    return send(200, { ok: true, status: accept ? 'active' : 'rejected' });
  }

  if (apiPath.startsWith('/api/cravings/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM cravings WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
