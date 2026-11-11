const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { initDb } = require('./db');

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

function defaultAvatarSvg(name) {
  const initials = (name || 'HP')
    .split(/\s+/)
    .map(s => s[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect width="120" height="120" rx="60" fill="#e11d48"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="sans-serif" font-size="44" font-weight="bold">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function createApp(customDataDir) {
  const ctx = initDb(customDataDir);
  const { db, uploadsDir, getConfig, updateConfig, spiderSqlQuery, spiderListDatabases, saveUploadFile, generateAiPlans } = ctx;

  function parseCookies(req) {
    const raw = req.headers.cookie || '';
    const out = {};
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=');
      if (idx > -1) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    }
    return out;
  }

  function getAuthUser(req) {
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

  function safeJson(str, fallback) {
    try {
      return str ? JSON.parse(str) : fallback;
    } catch {
      return fallback;
    }
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    const payload = JSON.stringify(data);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      ...extraHeaders
    });
    res.end(payload);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', chunk => {
        size += chunk.length;
        if (size > 15 * 1024 * 1024) {
          reject(new Error('Payload demasiado grande (máx 15MB)'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch {
          resolve({});
        }
      });
      req.on('error', reject);
    });
  }

  function notifyPartner(coupleId, targetUserId, title, body, type = 'info') {
    db.prepare(
      'INSERT INTO notifications (couple_id, target_user_id, title, body, type) VALUES (?, ?, ?, ?, ?)'
    ).run(coupleId, targetUserId || null, title, body, type);
  }

  function getPartner(user) {
    if (!user.couple_id) return null;
    const couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(user.couple_id);
    if (!couple) return null;
    const partnerId = couple.user1_id === user.id ? couple.user2_id : couple.user1_id;
    if (!partnerId) return null;
    const p = db.prepare('SELECT * FROM users WHERE id = ?').get(partnerId);
    if (!p) return null;
    delete p.password_hash;
    p.tastes = safeJson(p.tastes_json, {});
    return p;
  }

  function ensureMonthlyRecoveryReset(couple) {
    const currentMonth = new Date().toISOString().slice(0, 7);
    if (couple.streak_recovery_month !== currentMonth) {
      db.prepare('UPDATE couples SET streak_recoveries_left = 3, streak_recovery_month = ? WHERE id = ?').run(
        currentMonth,
        couple.id
      );
      couple.streak_recoveries_left = 3;
      couple.streak_recovery_month = currentMonth;
    }
    return couple;
  }

  const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        });
        return res.end();
      }

      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.pathname;

      // Serve uploaded files
      if (pathname.startsWith('/uploads/') && req.method === 'GET') {
        const fileName = path.basename(pathname);
        const filePath = path.join(uploadsDir, fileName);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          return res.end('Not found');
        }
        const ext = path.extname(fileName).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
      }

      // API Routes (also aliased under /api/v1/* for mobile app compatibility)
      const apiPath = pathname.startsWith('/api/v1/')
        ? '/api/' + pathname.slice('/api/v1/'.length)
        : pathname;

      if (apiPath.startsWith('/api/')) {
        // 1. First-time Setup & SpiderWebAPI Config
        if (apiPath === '/api/setup' && req.method === 'GET') {
          const cfg = getConfig();
          return sendJson(res, 200, { config: cfg });
        }

        if (apiPath === '/api/setup' && req.method === 'POST') {
          const body = await readBody(req);
          const updated = updateConfig({
            db_mode: body.db_mode || 'local',
            storage_mode: body.storage_mode || 'local',
            spiderwebdbname: body.spiderwebdbname,
            spiderapikey: body.spiderapikey,
            spidercloudstrogaeid: body.spidercloudstrogaeid,
            spiderweb_api_url: body.spiderweb_api_url,
            setup_completed: '1'
          });
          return sendJson(res, 200, { ok: true, config: updated });
        }

        if (apiPath === '/api/spiderweb/test' && req.method === 'POST') {
          const body = await readBody(req);
          if (body.spiderapikey) updateConfig(body);
          try {
            if (body.query) {
              const data = await spiderSqlQuery(body.query);
              return sendJson(res, 200, { ok: true, data });
            }
            const dbs = await spiderListDatabases();
            return sendJson(res, 200, { ok: true, databases: dbs });
          } catch (err) {
            return sendJson(res, 200, { ok: false, error: err.message });
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
              return res.end(buf);
            }
          } catch (_) {}
          const fallback = urlObj.searchParams.get('fallback');
          if (fallback) {
            res.writeHead(302, { Location: fallback });
            return res.end();
          }
          return sendJson(res, 404, { error: 'Archivo remoto no encontrado' });
        }

        // 2. Auth Endpoints
        if (apiPath === '/api/auth/register' && req.method === 'POST') {
          const body = await readBody(req);
          const { first_name, last_name, age, email, password, avatar_url } = body;
          if (!first_name || !last_name || !email || !password || !age) {
            return sendJson(res, 400, { error: 'Nombre, apellido, edad, correo y contraseña(s) son obligatorios.' });
          }
          const cleanEmail = String(email).trim().toLowerCase();
          const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(cleanEmail);
          if (exists) {
            return sendJson(res, 409, { error: 'El correo ya está registrado.' });
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

          return sendJson(
            res,
            201,
            { token, user },
            { 'Set-Cookie': `hifa_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` }
          );
        }

        if (apiPath === '/api/auth/login' && req.method === 'POST') {
          const body = await readBody(req);
          const cleanEmail = String(body.email || '').trim().toLowerCase();
          const user = db.prepare('SELECT * FROM users WHERE email = ?').get(cleanEmail);
          if (!user || !verifyPassword(body.password || '', user.password_hash)) {
            return sendJson(res, 401, { error: 'Credenciales inválidas.' });
          }
          const token = crypto.randomBytes(24).toString('hex');
          db.prepare('INSERT INTO sessions (token, user_id) VALUES (?, ?)').run(token, user.id);
          delete user.password_hash;
          user.tastes = safeJson(user.tastes_json, {});
          return sendJson(
            res,
            200,
            { token, user },
            { 'Set-Cookie': `hifa_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000` }
          );
        }

        if (apiPath === '/api/auth/logout' && req.method === 'POST') {
          const auth = getAuthUser(req);
          if (auth) {
            db.prepare('DELETE FROM sessions WHERE token = ?').run(auth.token);
          }
          return sendJson(
            res,
            200,
            { ok: true },
            { 'Set-Cookie': 'hifa_token=; Path=/; HttpOnly; Max-Age=0' }
          );
        }

        // Upload endpoint (works authenticated or during registration)
        if (apiPath === '/api/upload' && req.method === 'POST') {
          const body = await readBody(req);
          const { filename = 'upload.png', dataUrl = '' } = body;
          const match = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
          if (!match) return sendJson(res, 400, { error: 'Formato dataUrl inválido' });
          const mimeType = match[1];
          const buffer = Buffer.from(match[2], 'base64');
          const saved = await saveUploadFile(filename, buffer, mimeType);
          return sendJson(res, 200, saved);
        }

        // Require authentication for all following routes
        const auth = getAuthUser(req);
        if (!auth) {
          return sendJson(res, 401, { error: 'No autenticado' });
        }
        const { user } = auth;

        if (apiPath === '/api/me' && req.method === 'GET') {
          let couple = null;
          let partner = null;
          let notifications = [];
          if (user.couple_id) {
            couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(user.couple_id);
            if (couple) {
              couple = ensureMonthlyRecoveryReset(couple);
              couple.shared_info = safeJson(couple.shared_info_json, {});
              couple.menstrual_data = safeJson(couple.menstrual_data_json, {});
              partner = getPartner(user);
            }
            notifications = db
              .prepare(
                'SELECT * FROM notifications WHERE couple_id = ? AND (target_user_id IS NULL OR target_user_id = ?) ORDER BY id DESC LIMIT 30'
              )
              .all(user.couple_id, user.id);
          }
          return sendJson(res, 200, {
            user,
            partner,
            couple,
            notifications,
            config: getConfig()
          });
        }

        // 3. Couple Linking & Fase 1 Form
        if (apiPath === '/api/couple/code' && req.method === 'POST') {
          const newCode = 'HIFA-' + crypto.randomBytes(3).toString('hex').toUpperCase();
          db.prepare('UPDATE users SET pair_code = ? WHERE id = ?').run(newCode, user.id);
          return sendJson(res, 200, { pair_code: newCode });
        }

        if (apiPath === '/api/couple/link' && req.method === 'POST') {
          const body = await readBody(req);
          const code = String(body.code || '').trim().toUpperCase();
          if (!code) return sendJson(res, 400, { error: 'Ingresa un código de vinculación.' });
          if (user.couple_id) return sendJson(res, 400, { error: 'Ya estás vinculado en pareja.' });

          const target = db.prepare('SELECT * FROM users WHERE UPPER(pair_code) = ?').get(code);
          if (!target) return sendJson(res, 404, { error: 'Código no encontrado.' });
          if (target.id === user.id) return sendJson(res, 400, { error: 'No puedes vincularte con tu propio código.' });
          if (target.couple_id) return sendJson(res, 400, { error: 'Ese usuario ya está vinculado con otra cuenta.' });

          const currentMonth = new Date().toISOString().slice(0, 7);
          const cInfo = db
            .prepare('INSERT INTO couples (user1_id, user2_id, streak_recovery_month) VALUES (?, ?, ?)')
            .run(target.id, user.id, currentMonth);
          const coupleId = Number(cInfo.lastInsertRowid);

          db.prepare('UPDATE users SET couple_id = ? WHERE id IN (?, ?)').run(coupleId, target.id, user.id);

          // Seed starter wallets, list, roulette & notebook for the new couple
          const insWallet = db.prepare(
            'INSERT INTO wallets (couple_id, name, type, owner_user_id, details, initial_balance) VALUES (?, ?, ?, ?, ?, ?)'
          );
          insWallet.run(coupleId, 'Efectivo Compartido', 'efectivo', null, 'Caja común', 0);
          insWallet.run(coupleId, `Billetera Virtual (${target.first_name})`, 'billetera_virtual', target.id, 'MercadoPago / Alias', 0);
          insWallet.run(coupleId, `Tarjeta / Billetera (${user.first_name})`, 'tarjeta_credito', user.id, 'Visa / Master', 0);

          const lInfo = db.prepare('INSERT INTO lists (couple_id, name) VALUES (?, ?)').run(coupleId, 'Compras del Súper');
          db.prepare('INSERT INTO list_items (list_id, couple_id, name, price, quantity, created_by) VALUES (?, ?, ?, ?, ?, ?)').run(
            lInfo.lastInsertRowid,
            coupleId,
            'Café y cosas ricas para el desayuno',
            4500,
            '1',
            user.id
          );

          db.prepare('INSERT INTO roulettes (couple_id, name, options_json) VALUES (?, ?, ?)').run(
            coupleId,
            '¿Qué cenamos hoy?',
            JSON.stringify(['Sushi', 'Pizzas caseras', 'Hamburguesas', 'Pastas', 'Tacos', 'Empanadas'])
          );

          const nbInfo = db
            .prepare('INSERT INTO notebooks (couple_id, title, icon, created_by) VALUES (?, ?, ?, ?)')
            .run(coupleId, 'Nuestro Cuaderno de Viajes y Sueños', '✈️', user.id);
          db.prepare('INSERT INTO notebook_pages (notebook_id, couple_id, title, markdown_content) VALUES (?, ?, ?, ?)').run(
            nbInfo.lastInsertRowid,
            coupleId,
            'Lugares por visitar',
            '# Lugares que queremos conocer juntos\n\n- [x] Primer paseo juntos\n- [ ] Escapada de fin de semana\n- [ ] Viaje soñado\n\n> Escriban aquí sus ideas, fotos y listas en **Markdown**.'
          );

          notifyPartner(
            coupleId,
            target.id,
            '¡Pareja vinculada!',
            `${user.first_name} se vinculó contigo. ¡Completen el formulario de pareja!`,
            'couple'
          );

          return sendJson(res, 200, { ok: true, couple_id: coupleId });
        }

        // Guard: Following routes require couple_id (except user settings)
        if (apiPath === '/api/settings/user' && req.method === 'PUT') {
          const body = await readBody(req);
          const firstName = body.first_name || user.first_name;
          const lastName = body.last_name || user.last_name;
          const age = body.age !== undefined ? Number(body.age) : user.age;
          const email = body.email ? String(body.email).trim().toLowerCase() : user.email;
          const avatarUrl = body.avatar_url !== undefined ? body.avatar_url : user.avatar_url;
          const theme = body.theme || user.theme;
          const language = body.language || user.language;
          const currency = body.currency || user.currency;
          const notificationsEnabled = body.notifications_enabled !== undefined ? (body.notifications_enabled ? 1 : 0) : user.notifications_enabled;

          db.prepare(
            `UPDATE users SET first_name = ?, last_name = ?, age = ?, email = ?, avatar_url = ?, theme = ?, language = ?, currency = ?, notifications_enabled = ? WHERE id = ?`
          ).run(firstName, lastName, age, email, avatarUrl, theme, language, currency, notificationsEnabled, user.id);

          if (body.new_password && String(body.new_password).length >= 4) {
            db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(body.new_password), user.id);
          }

          const updatedUser = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
          delete updatedUser.password_hash;
          updatedUser.tastes = safeJson(updatedUser.tastes_json, {});
          return sendJson(res, 200, { ok: true, user: updatedUser });
        }

        if (!user.couple_id) {
          return sendJson(res, 400, { error: 'Primero debes vincularte con tu pareja.' });
        }
        const coupleId = user.couple_id;
        const partner = getPartner(user);

        // Fase 1: Formulario de la pareja (fecha de inicio obligatoria + talles + gustos de cada uno)
        if (apiPath === '/api/couple/profile' && req.method === 'PUT') {
          const body = await readBody(req);
          if (!body.relationship_start) {
            return sendJson(res, 400, { error: 'La fecha de inicio de la relación es obligatoria.' });
          }
          const couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId);
          const mergedShared = {
            ...safeJson(couple.shared_info_json, {}),
            ...(body.shared_info || {})
          };
          db.prepare('UPDATE couples SET relationship_start = ?, shared_info_json = ? WHERE id = ?').run(
            body.relationship_start,
            JSON.stringify(mergedShared),
            coupleId
          );

          // Cada usuario completa únicamente SU información; al guardar queda marcado como completado.
          db.prepare('UPDATE users SET tastes_json = ?, profile_completed = 1 WHERE id = ?').run(
            JSON.stringify(body.my_tastes || {}),
            user.id
          );
          const partnerDone = Boolean(partner && partner.profile_completed);
          if (partner && !user.profile_completed) {
            notifyPartner(
              coupleId,
              partner.id,
              partnerDone ? '¡Dashboard desbloqueado!' : 'Tu pareja completó su formulario',
              partnerDone
                ? `${user.first_name} guardó su formulario. ¡Ya pueden ver el dashboard de la pareja!`
                : `${user.first_name} ya guardó su información. Falta la tuya.`,
              'couple'
            );
          }

          return sendJson(res, 200, { ok: true, profiles_ready: partnerDone });
        }

        // Dashboard rápido (solo disponible cuando ambos guardaron su formulario)
        if (apiPath === '/api/dashboard' && req.method === 'GET') {
          const couple = ensureMonthlyRecoveryReset(db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId));
          if (!(user.profile_completed && partner?.profile_completed && couple.relationship_start)) {
            return sendJson(res, 403, { error: 'Ambos deben guardar el formulario para ver el dashboard.' });
          }
          const today = new Date().toISOString().slice(0, 10);
          const nowIso = new Date().toISOString().slice(0, 16);
          const one = (sql, ...p) => db.prepare(sql).get(...p);

          const daysTogether = Math.max(
            0,
            Math.floor((Date.now() - new Date(couple.relationship_start + 'T00:00:00').getTime()) / 86400000)
          );
          const fin = one(
            `SELECT COALESCE(SUM(CASE WHEN kind='ingreso' THEN amount ELSE -amount END),0) AS net,
                    COALESCE(SUM(CASE WHEN kind='egreso' AND substr(date,1,7)=? THEN amount ELSE 0 END),0) AS month_expense
             FROM transactions WHERE couple_id = ?`,
            today.slice(0, 7),
            coupleId
          );
          const wallets = one('SELECT COALESCE(SUM(initial_balance),0) AS s FROM wallets WHERE couple_id = ?', coupleId).s;
          const yesterday = getOffsetDate(today, -1);
          const streakAlive = couple.last_streak_date === today || couple.last_streak_date === yesterday;
          const ansToday = one(
            'SELECT COUNT(DISTINCT user_id) AS c FROM daily_answers WHERE couple_id = ? AND date_str = ?',
            coupleId,
            today
          ).c;
          const mens = safeJson(couple.menstrual_data_json, {});
          const mensProj = mens.lastStart ? computeMenstrualProjections(mens) : null;

          return sendJson(res, 200, {
            days_together: daysTogether,
            relationship_start: couple.relationship_start,
            motto: safeJson(couple.shared_info_json, {}).motto || '',
            balance: Number(wallets) + Number(fin.net),
            month_expense: Number(fin.month_expense),
            streak_count: streakAlive ? couple.streak_count : 0,
            longest_streak: couple.longest_streak,
            answered_today: ansToday,
            pending_tasks: db
              .prepare('SELECT id, title, priority, due_datetime FROM tasks WHERE couple_id = ? AND completed = 0 ORDER BY due_datetime = \'\', due_datetime ASC LIMIT 5')
              .all(coupleId),
            upcoming_events: db
              .prepare('SELECT id, title, start_datetime FROM calendar_events WHERE couple_id = ? AND start_datetime >= ? ORDER BY start_datetime ASC LIMIT 4')
              .all(coupleId, nowIso),
            active_goals: db
              .prepare('SELECT id, title, goal_type, current_value, target_value FROM goals WHERE couple_id = ? AND finished = 0 ORDER BY id DESC LIMIT 4')
              .all(coupleId),
            pending_cravings: one(
              "SELECT COUNT(*) AS c FROM cravings WHERE couple_id = ? AND owner_user_id = ? AND status = 'suggested'",
              coupleId,
              user.id
            ).c,
            next_capsule: one(
              'SELECT title, unlock_at FROM time_capsules WHERE couple_id = ? AND unlock_at > ? ORDER BY unlock_at ASC LIMIT 1',
              coupleId,
              nowIso
            ) || null,
            week_plan: one('SELECT title, category FROM weekly_plans WHERE (couple_id = ? OR couple_id IS NULL) AND selected_for_week = 1', coupleId) || null,
            next_period: mensProj?.nextPeriodStart || '',
            me: { first_name: user.first_name, avatar_url: user.avatar_url, tastes: user.tastes },
            partner: { first_name: partner.first_name, avatar_url: partner.avatar_url, tastes: partner.tastes }
          });
        }

        // Fase 2: Economía (Billeteras, Movimientos Globales, Analítica por medio de pago y Analítica Global)
        if (apiPath === '/api/economy' && req.method === 'GET') {
          const wallets = db.prepare('SELECT * FROM wallets WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
          const transactions = db
            .prepare(
              `SELECT t.*, w.name as wallet_name, w.type as wallet_type, u.first_name as user_first_name, u.last_name as user_last_name
               FROM transactions t
               LEFT JOIN wallets w ON w.id = t.wallet_id
               LEFT JOIN users u ON u.id = t.user_id
               WHERE t.couple_id = ?
               ORDER BY t.date DESC, t.id DESC`
            )
            .all(coupleId);

          // Enrich wallets with their specific analytics
          const walletMap = {};
          for (const w of wallets) {
            w.income = 0;
            w.expense = 0;
            w.balance = Number(w.initial_balance || 0);
            w.transactions = [];
            walletMap[w.id] = w;
          }

          let globalIncome = 0;
          let globalExpense = 0;
          const catTotals = {};

          for (const tx of transactions) {
            const amt = Number(tx.amount || 0);
            const w = walletMap[tx.wallet_id];
            if (tx.kind === 'ingreso') {
              globalIncome += amt;
              if (w) {
                w.income += amt;
                w.balance += amt;
              }
            } else {
              globalExpense += amt;
              if (w) {
                w.expense += amt;
                w.balance -= amt;
              }
            }
            if (w) w.transactions.push(tx);

            const key = `${tx.kind}::${tx.category}`;
            if (!catTotals[key]) {
              catTotals[key] = { kind: tx.kind, category: tx.category, total: 0, count: 0 };
            }
            catTotals[key].total += amt;
            catTotals[key].count += 1;
          }

          return sendJson(res, 200, {
            wallets,
            transactions,
            globalAnalytics: {
              totalIncome: globalIncome,
              totalExpense: globalExpense,
              netBalance: globalIncome - globalExpense,
              byCategory: Object.values(catTotals).sort((a, b) => b.total - a.total)
            }
          });
        }

        if (apiPath === '/api/wallets' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.name || !body.type) return sendJson(res, 400, { error: 'Nombre y tipo de billetera requeridos.' });
          const ownerId = body.owner_user_id ? Number(body.owner_user_id) : null;
          const info = db
            .prepare('INSERT INTO wallets (couple_id, name, type, owner_user_id, details, initial_balance) VALUES (?, ?, ?, ?, ?, ?)')
            .run(coupleId, body.name.trim(), body.type, ownerId, body.details || '', Number(body.initial_balance || 0));
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/wallets/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM transactions WHERE wallet_id = ? AND couple_id = ?').run(id, coupleId);
          db.prepare('DELETE FROM wallets WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath === '/api/transactions' && req.method === 'POST') {
          const body = await readBody(req);
          const { wallet_id, user_id, kind, scope, mode, category, amount, description, date } = body;
          if (!wallet_id || !kind || !category || !amount) {
            return sendJson(res, 400, { error: 'Billetera, tipo, categoría y monto son obligatorios.' });
          }
          const whoId = user_id ? Number(user_id) : user.id;
          const txDate = date || new Date().toISOString().slice(0, 10);
          const info = db
            .prepare(
              `INSERT INTO transactions (couple_id, wallet_id, user_id, kind, scope, mode, category, amount, description, date)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              coupleId,
              Number(wallet_id),
              whoId,
              kind,
              scope || 'compartido',
              mode || 'transferencia',
              category.trim(),
              Number(amount),
              description || '',
              txDate
            );
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/transactions/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM transactions WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Fase 2: Tareas y Tableros compartidos
        if (apiPath === '/api/tasks' && req.method === 'GET') {
          const tasks = db.prepare('SELECT * FROM tasks WHERE couple_id = ? ORDER BY completed ASC, id DESC').all(coupleId);
          return sendJson(res, 200, { tasks });
        }

        if (apiPath === '/api/tasks' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: 'Título requerido' });
          const info = db
            .prepare(
              'INSERT INTO tasks (couple_id, board_name, title, priority, assigned_to, due_datetime, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
            )
            .run(
              coupleId,
              (body.board_name || 'General').trim(),
              body.title.trim(),
              body.priority || 'media',
              body.assigned_to || 'both',
              body.due_datetime || '',
              user.id
            );
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/tasks/') && req.method === 'PATCH') {
          const id = Number(apiPath.split('/').pop());
          const body = await readBody(req);
          if (body.completed !== undefined) {
            db.prepare('UPDATE tasks SET completed = ? WHERE id = ? AND couple_id = ?').run(body.completed ? 1 : 0, id, coupleId);
          }
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath.startsWith('/api/tasks/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM tasks WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Fase 2: Listas (Compras, etc.)
        if (apiPath === '/api/lists' && req.method === 'GET') {
          const lists = db.prepare('SELECT * FROM lists WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
          const items = db.prepare('SELECT * FROM list_items WHERE couple_id = ? ORDER BY checked ASC, id ASC').all(coupleId);
          for (const l of lists) {
            l.items = items.filter(i => i.list_id === l.id);
            l.totalPrice = l.items.reduce((acc, i) => acc + Number(i.price || 0), 0);
            l.checkedPrice = l.items.filter(i => i.checked).reduce((acc, i) => acc + Number(i.price || 0), 0);
          }
          return sendJson(res, 200, { lists });
        }

        if (apiPath === '/api/lists' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.name) return sendJson(res, 400, { error: 'Nombre de lista requerido' });
          const info = db.prepare('INSERT INTO lists (couple_id, name) VALUES (?, ?)').run(coupleId, body.name.trim());
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/lists/') && apiPath.endsWith('/items') && req.method === 'POST') {
          const parts = apiPath.split('/');
          const listId = Number(parts[parts.length - 2]);
          const body = await readBody(req);
          if (!body.name) return sendJson(res, 400, { error: 'Nombre del ítem requerido' });
          const info = db
            .prepare('INSERT INTO list_items (list_id, couple_id, name, price, quantity, created_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run(listId, coupleId, body.name.trim(), Number(body.price || 0), String(body.quantity || '1'), user.id);
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/lists/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM list_items WHERE list_id = ? AND couple_id = ?').run(id, coupleId);
          db.prepare('DELETE FROM lists WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath.startsWith('/api/list-items/') && req.method === 'PATCH') {
          const id = Number(apiPath.split('/').pop());
          const body = await readBody(req);
          db.prepare('UPDATE list_items SET checked = ? WHERE id = ? AND couple_id = ?').run(body.checked ? 1 : 0, id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath.startsWith('/api/list-items/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM list_items WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Fase 2: Calendario & Notificaciones
        if (apiPath === '/api/calendar' && req.method === 'GET') {
          const events = db
            .prepare('SELECT * FROM calendar_events WHERE couple_id = ? ORDER BY start_datetime ASC')
            .all(coupleId);
          return sendJson(res, 200, { events });
        }

        if (apiPath === '/api/calendar' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title || !body.start_datetime) {
            return sendJson(res, 400, { error: 'Título y fecha/hora son obligatorios' });
          }
          const info = db
            .prepare(
              `INSERT INTO calendar_events (couple_id, title, description, start_datetime, end_datetime, remind_offset_value, remind_offset_unit, created_by)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              coupleId,
              body.title.trim(),
              body.description || '',
              body.start_datetime,
              body.end_datetime || '',
              Number(body.remind_offset_value ?? 30),
              body.remind_offset_unit || 'minutes',
              user.id
            );
          if (partner) {
            notifyPartner(
              coupleId,
              partner.id,
              'Nuevo evento agendado',
              `${user.first_name} agendó "${body.title.trim()}" para ${body.start_datetime}`,
              'calendar'
            );
          }
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/calendar/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM calendar_events WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath === '/api/notifications/read' && req.method === 'POST') {
          db.prepare('UPDATE notifications SET read = 1 WHERE couple_id = ? AND (target_user_id IS NULL OR target_user_id = ?)').run(
            coupleId,
            user.id
          );
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Ruleta
        if (apiPath === '/api/roulettes' && req.method === 'GET') {
          const rows = db.prepare('SELECT * FROM roulettes WHERE couple_id = ? ORDER BY id DESC').all(coupleId);
          for (const r of rows) r.options = safeJson(r.options_json, []);
          return sendJson(res, 200, { roulettes: rows });
        }

        if (apiPath === '/api/roulettes' && req.method === 'POST') {
          const body = await readBody(req);
          const options = Array.isArray(body.options)
            ? body.options.map(s => String(s).trim()).filter(Boolean)
            : String(body.options || '')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
          if (!body.name || options.length < 2) {
            return sendJson(res, 400, { error: 'Nombre y al menos 2 opciones son requeridos.' });
          }
          const info = db
            .prepare('INSERT INTO roulettes (couple_id, name, options_json) VALUES (?, ?, ?)')
            .run(coupleId, body.name.trim(), JSON.stringify(options));
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/roulettes/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM roulettes WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Planes aleatorios de la semana + IA
        if (apiPath === '/api/plans' && req.method === 'GET') {
          const plans = db
            .prepare('SELECT * FROM weekly_plans WHERE couple_id IS NULL OR couple_id = ? ORDER BY selected_for_week DESC, id DESC')
            .all(coupleId);
          return sendJson(res, 200, { plans });
        }

        if (apiPath === '/api/plans' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: 'Título del plan requerido' });
          const info = db
            .prepare('INSERT INTO weekly_plans (couple_id, title, category, weather, source, proposed_by) VALUES (?, ?, ?, ?, ?, ?)')
            .run(coupleId, body.title.trim(), body.category || 'Cita', body.weather || 'Cualquiera', 'user', user.id);
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath === '/api/plans/random' && req.method === 'POST') {
          const plans = db.prepare('SELECT * FROM weekly_plans WHERE couple_id IS NULL OR couple_id = ?').all(coupleId);
          if (plans.length === 0) return sendJson(res, 400, { error: 'No hay planes cargados' });
          const chosen = plans[Math.floor(Math.random() * plans.length)];
          db.prepare('UPDATE weekly_plans SET selected_for_week = 0 WHERE couple_id = ? OR couple_id IS NULL').run(coupleId);
          db.prepare('UPDATE weekly_plans SET selected_for_week = 1 WHERE id = ?').run(chosen.id);
          chosen.selected_for_week = 1;
          return sendJson(res, 200, { chosen });
        }

        if (apiPath === '/api/plans/ai' && req.method === 'POST') {
          const myTastes = user.tastes || {};
          const pTastes = partner?.tastes || {};
          const coupleContext = {
            foods: [myTastes.favorite_food, pTastes.favorite_food],
            movies: [myTastes.favorite_series_movies, pTastes.favorite_series_movies],
            weathers: [myTastes.favorite_weather, pTastes.favorite_weather],
            plans: [myTastes.favorite_plan, pTastes.favorite_plan],
            extra: [myTastes.additional_tastes, pTastes.additional_tastes]
          };
          const aiResult = await generateAiPlans(coupleContext);
          const ins = db.prepare(
            'INSERT INTO weekly_plans (couple_id, title, category, weather, source, proposed_by) VALUES (?, ?, ?, ?, \'ai\', ?)'
          );
          const inserted = [];
          for (const p of aiResult.plans) {
            const info = ins.run(coupleId, p.title, p.category || 'IA', p.weather || 'Cualquiera', user.id);
            inserted.push({ id: Number(info.lastInsertRowid), ...p, source: 'ai' });
          }
          return sendJson(res, 200, { provider: aiResult.provider, plans: inserted });
        }

        if (apiPath.startsWith('/api/plans/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM weekly_plans WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Calendario de Ciclo Menstrual
        if (apiPath === '/api/menstrual' && req.method === 'GET') {
          const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
          const data = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });
          return sendJson(res, 200, { menstrual: computeMenstrualProjections(data) });
        }

        if (apiPath === '/api/menstrual' && req.method === 'PUT') {
          const body = await readBody(req);
          const couple = db.prepare('SELECT menstrual_data_json FROM couples WHERE id = ?').get(coupleId);
          const current = safeJson(couple.menstrual_data_json, { lastStart: '', periodDays: 5, cycleDays: 28, history: [] });
          const nextData = {
            lastStart: body.lastStart ?? current.lastStart,
            periodDays: Number(body.periodDays || current.periodDays || 5),
            cycleDays: Number(body.cycleDays || current.cycleDays || 28),
            notes: body.notes ?? current.notes ?? '',
            history: Array.isArray(body.history) ? body.history : current.history || []
          };
          if (body.lastStart && !nextData.history.includes(body.lastStart)) {
            nextData.history = [body.lastStart, ...nextData.history].slice(0, 12);
          }
          db.prepare('UPDATE couples SET menstrual_data_json = ? WHERE id = ?').run(JSON.stringify(nextData), coupleId);
          return sendJson(res, 200, { menstrual: computeMenstrualProjections(nextData) });
        }

        // Herramientas: "Notitas" (sobrescribe la anterior y envía notificación "Nota nueva" a la pareja)
        if (apiPath === '/api/notitas' && req.method === 'GET') {
          const rows = db
            .prepare(
              `SELECT n.*, u.first_name, u.avatar_url
               FROM notitas n
               JOIN users u ON u.id = n.author_user_id
               WHERE n.couple_id = ?`
            )
            .all(coupleId);
          return sendJson(res, 200, { notitas: rows });
        }

        if (apiPath === '/api/notitas' && req.method === 'POST') {
          const body = await readBody(req);
          const textContent = (body.text_content || '').trim();
          const drawingDataUrl = body.drawing_data_url || '';
          if (!textContent && !drawingDataUrl) {
            return sendJson(res, 400, { error: 'Escribe una notita o haz un dibujo para tu pareja.' });
          }
          // Overwrite previous notita from this user
          db.prepare(
            `INSERT INTO notitas (couple_id, author_user_id, text_content, drawing_data_url, updated_at)
             VALUES (?, ?, ?, ?, datetime('now'))
             ON CONFLICT(couple_id, author_user_id)
             DO UPDATE SET text_content = excluded.text_content, drawing_data_url = excluded.drawing_data_url, updated_at = datetime('now')`
          ).run(coupleId, user.id, textContent, drawingDataUrl);

          if (partner) {
            const preview = textContent ? `: "${textContent}"` : ' (con un dibujo especial 🎨)';
            notifyPartner(coupleId, partner.id, 'Nota nueva', `${user.first_name} te dejó una nota nueva${preview}`, 'notita');
          }
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Notas compartidas (con fotos)
        if (apiPath === '/api/notes' && req.method === 'GET') {
          const notes = db
            .prepare(
              `SELECT n.*, u.first_name as author_name
               FROM shared_notes n
               LEFT JOIN users u ON u.id = n.author_user_id
               WHERE n.couple_id = ?
               ORDER BY n.id DESC`
            )
            .all(coupleId);
          return sendJson(res, 200, { notes });
        }

        if (apiPath === '/api/notes' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: 'Título requerido' });
          const info = db
            .prepare('INSERT INTO shared_notes (couple_id, author_user_id, title, content, photo_url) VALUES (?, ?, ?, ?, ?)')
            .run(coupleId, user.id, body.title.trim(), body.content || '', body.photo_url || '');
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/notes/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM shared_notes WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Pregunta del Día + Racha + Recuperar Racha (3 por mes)
        if (apiPath === '/api/daily-question' && req.method === 'GET') {
          const today = urlObj.searchParams.get('date') || new Date().toISOString().slice(0, 10);
          let couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId);
          couple = ensureMonthlyRecoveryReset(couple);

          const questions = db.prepare('SELECT * FROM daily_questions ORDER BY id ASC').all();
          const daySeed = Number(today.replace(/-/g, '')) || 1;
          const question = questions[daySeed % questions.length];

          const answers = db
            .prepare(
              `SELECT a.*, u.first_name
               FROM daily_answers a
               JOIN users u ON u.id = a.user_id
               WHERE a.couple_id = ? AND a.date_str = ?`
            )
            .all(coupleId, today);

          const yesterday = getOffsetDate(today, -1);
          const streakBroken =
            couple.last_streak_date &&
            couple.last_streak_date !== today &&
            couple.last_streak_date !== yesterday &&
            couple.longest_streak > 0;

          return sendJson(res, 200, {
            date: today,
            question,
            answers,
            streak_count: streakBroken ? 0 : couple.streak_count,
            stored_streak_before_break: couple.streak_count,
            longest_streak: couple.longest_streak,
            last_streak_date: couple.last_streak_date,
            streak_broken: Boolean(streakBroken),
            streak_recoveries_left: couple.streak_recoveries_left,
            streak_recovery_month: couple.streak_recovery_month
          });
        }

        if (apiPath === '/api/daily-question/answer' && req.method === 'POST') {
          const body = await readBody(req);
          const answerText = String(body.answer_text || '').trim();
          if (!answerText) return sendJson(res, 400, { error: 'Escribe tu respuesta.' });
          const today = body.date || new Date().toISOString().slice(0, 10);
          const questions = db.prepare('SELECT * FROM daily_questions ORDER BY id ASC').all();
          const daySeed = Number(today.replace(/-/g, '')) || 1;
          const question = questions[daySeed % questions.length];

          db.prepare(
            `INSERT INTO daily_answers (couple_id, question_id, date_str, user_id, answer_text)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(couple_id, date_str, user_id)
             DO UPDATE SET answer_text = excluded.answer_text`
          ).run(coupleId, question.id, today, user.id, answerText);

          // Check if both answered today
          const answersToday = db
            .prepare('SELECT COUNT(DISTINCT user_id) as c FROM daily_answers WHERE couple_id = ? AND date_str = ?')
            .get(coupleId, today).c;

          let couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId);
          couple = ensureMonthlyRecoveryReset(couple);

          if (answersToday >= 2 && couple.last_streak_date !== today) {
            const yesterday = getOffsetDate(today, -1);
            let nextStreak = 1;
            if (couple.last_streak_date === yesterday) {
              nextStreak = Number(couple.streak_count || 0) + 1;
            }
            const nextLongest = Math.max(Number(couple.longest_streak || 0), nextStreak);
            db.prepare('UPDATE couples SET streak_count = ?, longest_streak = ?, last_streak_date = ? WHERE id = ?').run(
              nextStreak,
              nextLongest,
              today,
              coupleId
            );
            couple.streak_count = nextStreak;
            couple.longest_streak = nextLongest;
            couple.last_streak_date = today;
          }

          return sendJson(res, 200, {
            ok: true,
            both_answered: answersToday >= 2,
            streak_count: couple.streak_count,
            longest_streak: couple.longest_streak
          });
        }

        if (apiPath === '/api/daily-question/recover' && req.method === 'POST') {
          const body = await readBody(req);
          const today = body.date || new Date().toISOString().slice(0, 10);
          let couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId);
          couple = ensureMonthlyRecoveryReset(couple);

          if (couple.streak_recoveries_left <= 0) {
            return sendJson(res, 400, { error: 'Ya usaste las 3 recuperaciones de racha de este mes.' });
          }
          const yesterday = getOffsetDate(today, -1);
          const restoredStreak = Math.max(Number(couple.streak_count || 0), Number(couple.longest_streak || 1));
          const left = couple.streak_recoveries_left - 1;
          db.prepare(
            'UPDATE couples SET streak_count = ?, last_streak_date = ?, streak_recoveries_left = ? WHERE id = ?'
          ).run(restoredStreak, yesterday, left, coupleId);

          return sendJson(res, 200, {
            ok: true,
            streak_count: restoredStreak,
            streak_recoveries_left: left,
            last_streak_date: yesterday
          });
        }

        // Herramientas: Antojos y Sugerir Antojo
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
          return sendJson(res, 200, { cravings });
        }

        if (apiPath === '/api/cravings' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: '¿Qué quieren? es obligatorio.' });
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
          return sendJson(res, 201, { id: Number(info.lastInsertRowid), status });
        }

        if (apiPath.startsWith('/api/cravings/') && apiPath.endsWith('/respond') && req.method === 'POST') {
          const parts = apiPath.split('/');
          const id = Number(parts[parts.length - 2]);
          const body = await readBody(req);
          const accept = Boolean(body.accept);
          if (accept) {
            db.prepare("UPDATE cravings SET status = 'active' WHERE id = ? AND couple_id = ?").run(id, coupleId);
          } else {
            db.prepare("UPDATE cravings SET status = 'rejected' WHERE id = ? AND couple_id = ?").run(id, coupleId);
          }
          return sendJson(res, 200, { ok: true, status: accept ? 'active' : 'rejected' });
        }

        if (apiPath.startsWith('/api/cravings/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM cravings WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Cápsula del Tiempo
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
          return sendJson(res, 200, { capsules });
        }

        if (apiPath === '/api/capsules' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title || !body.body || !body.unlock_at) {
            return sendJson(res, 400, { error: 'Título, mensaje y fecha/hora de desbloqueo son obligatorios.' });
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
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/capsules/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM time_capsules WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Metas / Proyectos (Monetaria, Progreso/Rutina, Tiempo + Finalizado)
        if (apiPath === '/api/goals' && req.method === 'GET') {
          const goals = db
            .prepare(
              `SELECT g.*, u.first_name as creator_name
               FROM goals g
               LEFT JOIN users u ON u.id = g.created_by
               WHERE g.couple_id = ?
               ORDER BY g.finished ASC, g.id DESC`
            )
            .all(coupleId);
          return sendJson(res, 200, { goals });
        }

        if (apiPath === '/api/goals' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title || !body.goal_type) {
            return sendJson(res, 400, { error: 'Título y tipo de meta son obligatorios.' });
          }
          const info = db
            .prepare(
              `INSERT INTO goals (couple_id, created_by, title, description, goal_type, target_value, current_value, frequency, target_date, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              coupleId,
              user.id,
              body.title.trim(),
              body.description || '',
              body.goal_type,
              Number(body.target_value || 1),
              Number(body.current_value || 0),
              body.frequency || 'diaria',
              body.target_date || '',
              body.created_at || new Date().toISOString()
            );
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/goals/') && apiPath.endsWith('/progress') && req.method === 'POST') {
          const parts = apiPath.split('/');
          const id = Number(parts[parts.length - 2]);
          const body = await readBody(req);
          const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND couple_id = ?').get(id, coupleId);
          if (!goal) return sendJson(res, 404, { error: 'Meta no encontrada' });

          const delta = Number(body.delta ?? 1);
          const nextVal = Number(goal.current_value || 0) + delta;
          const finished = goal.target_value > 0 && nextVal >= goal.target_value ? 1 : goal.finished;
          const today = new Date().toISOString().slice(0, 10);
          db.prepare('UPDATE goals SET current_value = ?, last_checkin_date = ?, finished = ? WHERE id = ?').run(
            nextVal,
            today,
            finished,
            id
          );
          return sendJson(res, 200, { ok: true, current_value: nextVal, finished });
        }

        if (apiPath.startsWith('/api/goals/') && apiPath.endsWith('/finish') && req.method === 'POST') {
          const parts = apiPath.split('/');
          const id = Number(parts[parts.length - 2]);
          db.prepare('UPDATE goals SET finished = 1 WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true, finished: 1 });
        }

        if (apiPath.startsWith('/api/goals/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM goals WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        // Herramientas: Cuadernos y Páginas Markdown
        if (apiPath === '/api/notebooks' && req.method === 'GET') {
          const notebooks = db.prepare('SELECT * FROM notebooks WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
          const pages = db.prepare('SELECT * FROM notebook_pages WHERE couple_id = ? ORDER BY id ASC').all(coupleId);
          for (const nb of notebooks) {
            nb.pages = pages.filter(p => p.notebook_id === nb.id);
          }
          return sendJson(res, 200, { notebooks });
        }

        if (apiPath === '/api/notebooks' && req.method === 'POST') {
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: 'Título del cuaderno requerido' });
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
          return sendJson(res, 201, { id: nbId });
        }

        if (apiPath.startsWith('/api/notebooks/') && apiPath.endsWith('/pages') && req.method === 'POST') {
          const parts = apiPath.split('/');
          const nbId = Number(parts[parts.length - 2]);
          const body = await readBody(req);
          if (!body.title) return sendJson(res, 400, { error: 'Título de página requerido' });
          const info = db
            .prepare('INSERT INTO notebook_pages (notebook_id, couple_id, title, markdown_content) VALUES (?, ?, ?, ?)')
            .run(nbId, coupleId, body.title.trim(), body.markdown_content || `# ${body.title.trim()}\n`);
          return sendJson(res, 201, { id: Number(info.lastInsertRowid) });
        }

        if (apiPath.startsWith('/api/notebooks/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM notebook_pages WHERE notebook_id = ? AND couple_id = ?').run(id, coupleId);
          db.prepare('DELETE FROM notebooks WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath.startsWith('/api/pages/') && req.method === 'PUT') {
          const id = Number(apiPath.split('/').pop());
          const body = await readBody(req);
          db.prepare(
            "UPDATE notebook_pages SET title = COALESCE(?, title), markdown_content = COALESCE(?, markdown_content), updated_at = datetime('now') WHERE id = ? AND couple_id = ?"
          ).run(body.title ?? null, body.markdown_content ?? null, id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        if (apiPath.startsWith('/api/pages/') && req.method === 'DELETE') {
          const id = Number(apiPath.split('/').pop());
          db.prepare('DELETE FROM notebook_pages WHERE id = ? AND couple_id = ?').run(id, coupleId);
          return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 404, { error: 'Endpoint no encontrado' });
      }

      // Serve Static Frontend from ./public
      const publicDir = path.join(__dirname, 'public');
      let safeRel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      let filePath = path.join(publicDir, safeRel);
      if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(publicDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8' });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Error interno del servidor' });
    }
  });

  return { server, ctx };
}

function getOffsetDate(dateStr, offsetDays) {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function computeMenstrualProjections(data) {
  const cycleDays = Number(data.cycleDays || 28);
  const periodDays = Number(data.periodDays || 5);
  let nextPeriodStart = '';
  let nextPeriodEnd = '';
  let ovulationDate = '';
  let fertileWindow = '';

  if (data.lastStart) {
    nextPeriodStart = getOffsetDate(data.lastStart, cycleDays);
    nextPeriodEnd = getOffsetDate(nextPeriodStart, periodDays - 1);
    ovulationDate = getOffsetDate(nextPeriodStart, -14);
    fertileWindow = `${getOffsetDate(ovulationDate, -4)} al ${getOffsetDate(ovulationDate, 1)}`;
  }
  return {
    ...data,
    cycleDays,
    periodDays,
    nextPeriodStart,
    nextPeriodEnd,
    ovulationDate,
    fertileWindow
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`Hifa SaaS ejecutándose en http://localhost:${port}`);
  });
}

module.exports = { createApp };

