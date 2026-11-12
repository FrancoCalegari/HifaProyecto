module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/capsules' && req.method === 'GET') {
    const rows = db
      .prepare(
        `SELECT c.*, u.first_name as author_name
         FROM time_capsules c
         LEFT JOIN users u ON u.id = c.author_user_id
         WHERE c.couple_id = ?
         ORDER BY c.unlock_at ASC`
      )
      .all(coupleId);
    const now = Date.now();
    const capsules = rows.map(c => {
      const unlockMs = new Date(c.unlock_at).getTime();
      const locked = Number.isFinite(unlockMs) && unlockMs > now;
      return {
        id: c.id,
        title: c.title,
        author_user_id: c.author_user_id,
        author_name: c.author_name,
        unlock_at: c.unlock_at,
        created_at: c.created_at,
        locked,
        body: locked ? '🔒 Esta carta está sellada en la cápsula del tiempo hasta la fecha de desbloqueo.' : c.body,
        photo_url: locked ? '' : c.photo_url
      };
    });
    return send(200, { capsules });
  }

  if (apiPath === '/api/capsules' && req.method === 'POST') {
    const body = await c.body();
    if (!body.title || !body.body || !body.unlock_at) {
      return send(400, { error: 'Título, mensaje y fecha/hora de desbloqueo son obligatorios.' });
    }
    const info = db
      .prepare('INSERT INTO time_capsules (couple_id, author_user_id, title, body, photo_url, unlock_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(coupleId, user.id, body.title.trim(), body.body, body.photo_url || '', body.unlock_at);
    if (partner) {
      notifyPartner(
        coupleId,
        partner.id,
        'Nueva Cápsula del Tiempo',
        `${user.first_name} dedicó una carta que se desbloqueará en ${body.unlock_at}.`,
        'capsule'
      );
    }
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/capsules/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM time_capsules WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
