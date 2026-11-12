const crypto = require('node:crypto');
const { hashPassword } = require('../lib/auth');
const { safeJson } = require('../lib/helpers');

module.exports = async function handle(c) {
  const { req, apiPath, ctx, db, user, partner, coupleId, send, notifyPartner, getPartner, ensureMonthlyRecoveryReset } = c;
  const { getConfig } = ctx;

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
    return send(200, {
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
    return send(200, { pair_code: newCode });
  }

  if (apiPath === '/api/couple/link' && req.method === 'POST') {
    const body = await c.body();
    const code = String(body.code || '').trim().toUpperCase();
    if (!code) return send(400, { error: 'Ingresa un código de vinculación.' });
    if (user.couple_id) return send(400, { error: 'Ya estás vinculado en pareja.' });

    const target = db.prepare('SELECT * FROM users WHERE UPPER(pair_code) = ?').get(code);
    if (!target) return send(404, { error: 'Código no encontrado.' });
    if (target.id === user.id) return send(400, { error: 'No puedes vincularte con tu propio código.' });
    if (target.couple_id) return send(400, { error: 'Ese usuario ya está vinculado con otra cuenta.' });

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

    return send(200, { ok: true, couple_id: coupleId });
  }

  if (apiPath === '/api/settings/user' && req.method === 'PUT') {
    const body = await c.body();
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
    return send(200, { ok: true, user: updatedUser });
  }

  return false;
};
