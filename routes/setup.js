const { getAuthUser } = require('../lib/auth');

module.exports = async function handle(c) {
  const { req, res, apiPath, urlObj, ctx, db, send } = c;
  const { getConfig, updateConfig, spiderSqlQuery, spiderListDatabases } = ctx;

  if (apiPath === '/api/setup' && req.method === 'GET') {
    const cfg = getConfig();
    const auth = getAuthUser(db, req);
    if (auth && auth.user.role === 'admin') {
      return send(200, { config: cfg });
    }
    return send(200, {
      config: {
        db_mode: cfg.db_mode,
        storage_mode: cfg.storage_mode,
        spidercloudstrogaeid: cfg.spidercloudstrogaeid,
        setup_completed: cfg.setup_completed
      }
    });
  }

  if (apiPath === '/api/setup' && req.method === 'POST') {
    const auth = getAuthUser(db, req);
    if (!auth || auth.user.role !== 'admin') {
      return send(403, { error: 'Acceso denegado: Se requiere rol de administrador para modificar el motor del SaaS.' });
    }

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

  if (apiPath === '/api/spiderweb/test' && req.method === 'POST') {
    const auth = getAuthUser(db, req);
    if (!auth || auth.user.role !== 'admin') {
      return send(403, { error: 'Acceso denegado: Se requiere rol de administrador.' });
    }
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

  if (apiPath.startsWith('/api/storage/remote/') && req.method === 'GET') {
    const fileId = apiPath.split('/').pop();
    const cfg = getConfig();
    try {
      const resp = await fetch(`${cfg.spiderweb_api_url}/storage/files/${fileId}`, {
        headers: { 'X-API-KEY': cfg.spiderapikey }
      });
      if (resp.ok) {
        const buf = Buffer.from(await resp.arrayBuffer());
        res.writeHead(200, { 'Content-Type': resp.headers.get('content-type') || 'application/octet-stream' });
        res.end(buf);
        return true;
      }
    } catch (_) {}
    const fallback = urlObj.searchParams.get('fallback');
    if (fallback) {
      res.writeHead(302, { Location: fallback });
      res.end();
      return true;
    }
    return send(404, { error: 'Archivo remoto no encontrado' });
  }

  return false;
};
