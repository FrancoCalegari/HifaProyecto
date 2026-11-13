const crypto = require('node:crypto');
const { parseCookies } = require('./http');
const { safeJson } = require('./helpers');

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt, key] = stored.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

function getSessionSecret() {
  return (
    process.env.SESSION_SECRET ||
    process.env.spiderapikey ||
    process.env.ADMIN_PASSWORD ||
    'hifa-local-dev-secret'
  );
}

function createSessionToken(user) {
  const payload = {
    uid: Number(user.id),
    email: String(user.email || '').trim().toLowerCase(),
    iat: Date.now(),
    exp: Date.now() + 30 * 24 * 60 * 60 * 1000
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  return `v1.${encoded}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('v1.')) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [, encoded, sig] = parts;
  const expected = crypto.createHmac('sha256', getSessionSecret()).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || !payload.uid || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function getAuthUser(db, req) {
  let token = '';
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else {
    const cookies = parseCookies(req);
    token = cookies.hifa_token || '';
  }
  if (!token) return null;

  let user = null;
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (session) {
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  } else {
    const payload = verifySessionToken(token);
    if (payload) {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.uid);
      if ((!user || String(user.email || '').toLowerCase() !== payload.email) && payload.email) {
        user = db.prepare('SELECT * FROM users WHERE LOWER(email) = ?').get(payload.email);
      }
    }
  }

  if (!user) return null;
  delete user.password_hash;
  user.tastes = safeJson(user.tastes_json, {});
  return { user, token };
}

module.exports = { hashPassword, verifyPassword, createSessionToken, verifySessionToken, getAuthUser };
