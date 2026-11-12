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
  const session = db.prepare('SELECT user_id FROM sessions WHERE token = ?').get(token);
  if (!session) return null;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.user_id);
  if (!user) return null;
  delete user.password_hash;
  user.tastes = safeJson(user.tastes_json, {});
  return { user, token };
}

module.exports = { hashPassword, verifyPassword, getAuthUser };
