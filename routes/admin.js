module.exports = async function handle(c) {
  const { req, apiPath, ctx, db, user, send } = c;
  const { getConfig, updateConfig, spiderSqlQuery, spiderListDatabases } = ctx;

  if (!apiPath.startsWith('/api/admin')) return false;

  // Acceso restringido exclusivamente al rol 'admin'
  if (!user || user.role !== 'admin') {
    return send(403, { error: 'Acceso restringido: Se requiere rol de administrador.' });
  }

  // 1. Resumen y métricas del SaaS
  if (apiPath === '/api/admin/overview' && req.method === 'GET') {
    const config = getConfig();
    const users = db.prepare('SELECT id, first_name, last_name, email, role, couple_id, pair_code, created_at FROM users ORDER BY id ASC').all();
    const couples = db.prepare('SELECT id, created_at FROM couples ORDER BY id ASC').all();
    const stats = {
      usersCount: users.length,
      couplesCount: couples.length,
      walletsCount: db.prepare('SELECT COUNT(*) as c FROM wallets').get().c,
      transactionsCount: db.prepare('SELECT COUNT(*) as c FROM transactions').get().c,
      logsCount: db.prepare('SELECT COUNT(*) as c FROM menstrual_logs').get().c
    };

    return send(200, {
      config,
      stats,
      users,
      couples,
      cloudSync: {
        lastSync: ctx.getLastSyncTime?.(),
        isVercel: process.env.VERCEL === '1',
        dataDir: ctx.dataDir
      }
    });
  }

  // 2. Configurar motor de base de datos y SaaS
  if (apiPath === '/api/admin/setup' && req.method === 'POST') {
    const body = await c.body();
    const updated = updateConfig({
      db_mode: body.db_mode || 'local',
      storage_mode: body.storage_mode || 'local',
      spiderwebdbname: body.spiderwebdbname,
      spiderapikey: body.spiderapikey,
      spidercloudstrogaeid: body.spidercloudstrogaeid,
      spiderweb_api_url: body.spiderweb_api_url,
      setup_completed: '1'
    });
    return send(200, { ok: true, config: updated });
  }

  // 3. Probar conexión con SpiderWebAPI
  if (apiPath === '/api/admin/spiderweb/test' && req.method === 'POST') {
    const body = await c.body();
    if (body.spiderapikey) updateConfig(body);
    try {
      if (body.query) {
        const data = await spiderSqlQuery(body.query);
        return send(200, { ok: true, data });
      }
      const dbs = await spiderListDatabases();
      return send(200, { ok: true, databases: dbs });
    } catch (err) {
      return send(200, { ok: false, error: err.message });
    }
  }

  // 4. Cambiar rol de un usuario
  if (apiPath.startsWith('/api/admin/users/') && apiPath.endsWith('/role') && req.method === 'POST') {
    const parts = apiPath.split('/');
    const targetUserId = Number(parts[parts.length - 2]);
    const body = await c.body();
    const newRole = body.role === 'admin' ? 'admin' : 'user';

    // Evitar que el administrador se auto-despoje del rol si es el único
    if (targetUserId === user.id && newRole !== 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'admin'").get().c;
      if (adminCount <= 1) {
        return send(400, { error: 'No puedes quitarte el rol de administrador porque eres el único administrador en el sistema.' });
      }
    }

    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(newRole, targetUserId);
    return send(200, { ok: true, targetUserId, newRole });
  }

  // 5. Forzar sincronización de base de datos a la nube
  if (apiPath === '/api/admin/cloud-sync' && req.method === 'POST') {
    if (typeof ctx.syncDbToCloud === 'function') {
      const result = await ctx.syncDbToCloud();
      return send(200, { ok: result.ok, result, lastSync: ctx.getLastSyncTime?.() });
    }
    return send(400, { error: 'Sincronizador en la nube no disponible.' });
  }

  return send(404, { error: 'Endpoint de administración no encontrado' });
};

