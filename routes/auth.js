const crypto = require('node:crypto');
const { hashPassword, verifyPassword, getAuthUser } = require('../lib/auth');
const { safeJson, defaultAvatarSvg } = require('../lib/helpers');

function cookieFlags(req) {
  const isHttps = req.headers['x-forwarded-proto'] === 'https' || process.env.VERCEL === '1';
  return `Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${isHttps ? '; Secure' : ''}`;
}

module.exports = async function handle(c) {
  const { req, apiPath, ctx, db, user, send } = c;
  const { saveUploadFile } = ctx;

  if (apiPath === '/api/auth/register' && req.method === 'POST') {
    const body = await c.body();
    const { first_name, last_name, age, email, password, avatar_url } = body;
    if (!first_name || !last_name || !email || !password || !age) {
      return send(400, { error: 'Nombre, apellido, edad, correo y contraseña(s) son obligatorios.' });
    }
    const cleanEmail = String(email).trim().toLowerCase();
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
    if (exists) {
      return send(409, { error: 'El correo ya está registrado.' });
    }
    const pairCode = 'HIFA-' + crypto.randomBytes(3).toString('hex').toUpperCase();
    const finalAvatar = avatar_url && avatar_url.trim() ? avatar_url.trim() : defaultAvatarSvg(`${first_name} ${last_name}`);
    const pwHash = hashPassword(password);
    const info = db
      .prepare(
        'INSERT INTO users (first_name, last_name, age, email, password_hash, avatar_url, pair_code) VALUES (?, ?, ?, ?, ?, ?, ?)'
      )
      .run(first_name.trim(), last_name.trim(), Number(age), cleanEmail, pwHash, finalAvatar, pairCode);

    const userId = Number(info.lastInsertRowid);
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, userId);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    delete user.password_hash;
    user.tastes = safeJson(user.tastes_json, {});

    return send(201,
      { token, user },
      { 'Set-Cookie': `hifa_token=${token}; ${cookieFlags(req)}` }
    );
  }

  if (apiPath === '/api/auth/login' && req.method === 'POST') {
    const body = await c.body();
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const rawPassword = String(body.password || '');
    let activeDb = db;
    let activeCtx = ctx;
    let foundUser = activeDb.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);

    if (!foundUser || !verifyPassword(rawPassword, foundUser.password_hash)) {
      const cfg = typeof activeCtx.getConfig === 'function' ? activeCtx.getConfig() : {};
      const isCloudMode =
        process.env.VERCEL === '1' ||
        process.env.CLOUD_SYNC === '1' ||
        cfg.db_mode === 'spiderweb';

      if (isCloudMode && typeof activeCtx.reloadFromCloud === 'function') {
        try {
          const reloaded = await activeCtx.reloadFromCloud();
          if (reloaded && reloaded.ctx && reloaded.ctx.db) {
            activeCtx = reloaded.ctx;
            activeDb = reloaded.ctx.db;
            foundUser = activeDb.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
          }
        } catch (err) {
          console.error('[Auth] Error al recargar DB desde Cloud Storage:', err.message);
        }
      }

      if ((!foundUser || !verifyPassword(rawPassword, foundUser.password_hash)) &&
          cfg.db_mode === 'spiderweb' && cfg.spiderapikey && cfg.spiderwebdbname &&
          typeof activeCtx.spiderSqlQuery === 'function') {
        try {
          const escapedEmail = cleanEmail.replace(/'/g, "''");
          const remoteRes = await activeCtx.spiderSqlQuery(
            `SELECT * FROM users WHERE LOWER(email) = '${escapedEmail}' LIMIT 1`
          );
          const remoteUser = remoteRes && Array.isArray(remoteRes.result) ? remoteRes.result[0] : null;
          if (remoteUser && verifyPassword(rawPassword, remoteUser.password_hash)) {
            activeDb.prepare(`
              INSERT INTO users (id, first_name, last_name, age, email, password_hash, avatar_url, couple_id, pair_code, tastes_json, profile_completed, role)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(email) DO UPDATE SET
                first_name = excluded.first_name,
                last_name = excluded.last_name,
                age = excluded.age,
                password_hash = excluded.password_hash,
                avatar_url = excluded.avatar_url,
                couple_id = excluded.couple_id,
                pair_code = excluded.pair_code,
                tastes_json = excluded.tastes_json,
                profile_completed = excluded.profile_completed,
                role = excluded.role
            `).run(
              remoteUser.id,
              remoteUser.first_name || 'Usuario',
              remoteUser.last_name || '',
              Number(remoteUser.age || 18),
              cleanEmail,
              remoteUser.password_hash,
              remoteUser.avatar_url || '',
              remoteUser.couple_id || null,
              remoteUser.pair_code || ('HIFA-' + crypto.randomBytes(3).toString('hex').toUpperCase()),
              remoteUser.tastes_json || '{}',
              Number(remoteUser.profile_completed || 0),
              remoteUser.role || 'user'
            );
            foundUser = activeDb.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(cleanEmail);
          }
        } catch (err) {
          console.error('[Auth] Error al consultar usuario remoto en SpiderWebAPI:', err.message);
        }
      }
    }

    if (!foundUser || !verifyPassword(rawPassword, foundUser.password_hash)) {
      return send(401, { error: 'Credenciales inválidas.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    activeDb.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, foundUser.id);
    if (activeCtx !== ctx && typeof activeCtx.scheduleDbSync === 'function') {
      activeCtx.scheduleDbSync(process.env.VERCEL ? 300 : 2500);
    }
    delete foundUser.password_hash;
    foundUser.tastes = safeJson(foundUser.tastes_json, {});
    return send(200,
      { token, user: foundUser },
      { 'Set-Cookie': `hifa_token=${token}; ${cookieFlags(req)}` }
    );
  }

  if (apiPath === '/api/auth/logout' && req.method === 'POST') {
    const auth = getAuthUser(db, req);
    if (auth) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.token);
    }
    return send(200,
      { ok: true },
      { 'Set-Cookie': 'hifa_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' }
    );
  }

  // Upload endpoint (works authenticated or during registration)
  if (apiPath === '/api/upload' && req.method === 'POST') {
    const body = await c.body();
    const { filename = 'upload.png', dataUrl = '' } = body;
    const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
    if (!match) return send(400, { error: 'Formato dataUrl inválido' });
    const mimeType = match[1];
    const buffer = Buffer.from(match[2], 'base64');
    const saved = await saveUploadFile(filename, buffer, mimeType);
    return send(200, saved);
  }

  return false;
};
