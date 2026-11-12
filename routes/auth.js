const crypto = require('node:crypto');
const { hashPassword, verifyPassword } = require('../lib/auth');
const { safeJson, defaultAvatarSvg } = require('../lib/helpers');

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
      { 'Set-Cookie': `hifa_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` }
    );
  }

  if (apiPath === '/api/auth/login' && req.method === 'POST') {
    const body = await c.body();
    const cleanEmail = String(body.email || '').trim().toLowerCase();
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
    if (!user || !verifyPassword(body.password || '', user.password_hash)) {
      return send(401, { error: 'Credenciales inválidas.' });
    }
    const token = crypto.randomBytes(24).toString('hex');
    db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
    delete user.password_hash;
    user.tastes = safeJson(user.tastes_json, {});
    return send(200,
      { token, user },
      { 'Set-Cookie': `hifa_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` }
    );
  }

  if (apiPath === '/api/auth/logout' && req.method === 'POST') {
    const auth = getAuthUser(req);
    if (auth) {
      db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.token);
    }
    return send(200,
      { ok: true },
      { 'Set-Cookie': 'hifa_token=; Path=/; HttpOnly; Max-Age=0' }
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
