const { processRecurringDebits } = require('../lib/economy');

module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/economy' && req.method === 'GET') {
    // Procesar cualquier débito automático pendiente del mes antes de calcular saldos
    processRecurringDebits(coupleId, db, notifyPartner);

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

    const recurringServices = db
      .prepare(
        `SELECT s.*, w.name as wallet_name, w.type as wallet_type, u.first_name as user_first_name
         FROM recurring_services s
         LEFT JOIN wallets w ON w.id = s.wallet_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.couple_id = ?
         ORDER BY s.day_of_month ASC, s.id ASC`
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

    return send(200, {
      wallets,
      transactions,
      recurringServices,
      globalAnalytics: {
        totalIncome: globalIncome,
        totalExpense: globalExpense,
        netBalance: globalIncome - globalExpense,
        byCategory: Object.values(catTotals).sort((a, b) => b.total - a.total)
      }
    });
  }

  // Crear medio de pago / billetera
  if (apiPath === '/api/wallets' && req.method === 'POST') {
    const body = await c.body();
    if (!body.name || !body.type) return send(400, { error: 'Nombre y tipo de billetera requeridos.' });
    const ownerId = body.owner_user_id ? Number(body.owner_user_id) : null;
    const info = db
      .prepare('INSERT INTO wallets (couple_id, name, type, owner_user_id, details, initial_balance) VALUES (?, ?, ?, ?, ?, ?)')
      .run(coupleId, body.name.trim(), body.type, ownerId, body.details || '', Number(body.initial_balance || 0));
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  // Modificar / Configurar medio de pago existente
  if (apiPath.startsWith('/api/wallets/') && (req.method === 'PUT' || req.method === 'PATCH')) {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    const existing = db.prepare('SELECT * FROM wallets WHERE id = ? AND couple_id = ?').get(id, coupleId);
    if (!existing) return send(404, { error: 'Billetera no encontrada' });

    const name = body.name ? body.name.trim() : existing.name;
    const type = body.type || existing.type;
    const ownerId = body.owner_user_id !== undefined ? (body.owner_user_id ? Number(body.owner_user_id) : null) : existing.owner_user_id;
    const details = body.details !== undefined ? body.details : existing.details;
    const initialBalance = body.initial_balance !== undefined ? Number(body.initial_balance) : existing.initial_balance;

    db.prepare(
      `UPDATE wallets SET name = ?, type = ?, owner_user_id = ?, details = ?, initial_balance = ? WHERE id = ? AND couple_id = ?`
    ).run(name, type, ownerId, details, initialBalance, id, coupleId);

    const updated = db.prepare('SELECT * FROM wallets WHERE id = ? AND couple_id = ?').get(id, coupleId);
    return send(200, { ok: true, wallet: updated });
  }

  // Eliminar billetera
  if (apiPath.startsWith('/api/wallets/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM transactions WHERE wallet_id = ? AND couple_id = ?').run(id, coupleId);
    db.prepare('DELETE FROM recurring_services WHERE wallet_id = ? AND couple_id = ?').run(id, coupleId);
    db.prepare('DELETE FROM wallets WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  // Registrar movimiento
  if (apiPath === '/api/transactions' && req.method === 'POST') {
    const body = await c.body();
    const { wallet_id, user_id, kind, scope, mode, category, amount, description, date } = body;
    if (!wallet_id || !kind || !category || !amount) {
      return send(400, { error: 'Billetera, tipo, categoría y monto son obligatorios.' });
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
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  // Eliminar movimiento
  if (apiPath.startsWith('/api/transactions/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM transactions WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  // Servicios recurrentes / débitos mensuales automáticos
  if (apiPath === '/api/recurring-services' && req.method === 'GET') {
    const services = db
      .prepare(
        `SELECT s.*, w.name as wallet_name, w.type as wallet_type, u.first_name as user_first_name
         FROM recurring_services s
         LEFT JOIN wallets w ON w.id = s.wallet_id
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.couple_id = ?
         ORDER BY s.day_of_month ASC, s.id ASC`
      )
      .all(coupleId);
    return send(200, { services });
  }

  if (apiPath === '/api/recurring-services' && req.method === 'POST') {
    const body = await c.body();
    const { wallet_id, name, amount, day_of_month, category, scope, mode, user_id, description } = body;
    if (!wallet_id || !name || !amount || !day_of_month) {
      return send(400, { error: 'Billetera, nombre, monto y día del mes son obligatorios.' });
    }
    const whoId = user_id ? Number(user_id) : user.id;
    const day = Math.min(Math.max(1, Number(day_of_month)), 31);
    const info = db
      .prepare(
        `INSERT INTO recurring_services (couple_id, wallet_id, user_id, name, category, amount, day_of_month, scope, mode, description, active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
      )
      .run(
        coupleId,
        Number(wallet_id),
        whoId,
        name.trim(),
        (category || 'Servicios y Suscripciones').trim(),
        Number(amount),
        day,
        scope || 'compartido',
        mode || 'debito_automatico',
        description || ''
      );

    // Procesar inmediatamente por si el día configurado ya pasó en este mes
    processRecurringDebits(coupleId, db, notifyPartner);

    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/recurring-services/') && req.method === 'PUT') {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    const existing = db.prepare('SELECT * FROM recurring_services WHERE id = ? AND couple_id = ?').get(id, coupleId);
    if (!existing) return send(404, { error: 'Servicio recurrente no encontrado' });

    const name = body.name ? body.name.trim() : existing.name;
    const walletId = body.wallet_id ? Number(body.wallet_id) : existing.wallet_id;
    const userId = body.user_id ? Number(body.user_id) : existing.user_id;
    const amount = body.amount !== undefined ? Number(body.amount) : existing.amount;
    const dayOfMonth = body.day_of_month !== undefined ? Math.min(Math.max(1, Number(body.day_of_month)), 31) : existing.day_of_month;
    const category = body.category !== undefined ? body.category.trim() : existing.category;
    const scope = body.scope || existing.scope;
    const mode = body.mode || existing.mode;
    const description = body.description !== undefined ? body.description : existing.description;
    const active = body.active !== undefined ? (body.active ? 1 : 0) : existing.active;

    db.prepare(
      `UPDATE recurring_services SET
         name = ?, wallet_id = ?, user_id = ?, amount = ?, day_of_month = ?,
         category = ?, scope = ?, mode = ?, description = ?, active = ?
       WHERE id = ? AND couple_id = ?`
    ).run(name, walletId, userId, amount, dayOfMonth, category, scope, mode, description, active, id, coupleId);

    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/recurring-services/') && req.method === 'PATCH') {
    const id = Number(apiPath.split('/').pop());
    const body = await c.body();
    if (body.active !== undefined) {
      db.prepare('UPDATE recurring_services SET active = ? WHERE id = ? AND couple_id = ?').run(body.active ? 1 : 0, id, coupleId);
    }
    return send(200, { ok: true });
  }

  if (apiPath.startsWith('/api/recurring-services/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM recurring_services WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  if (apiPath === '/api/recurring-services/process' && req.method === 'POST') {
    const count = processRecurringDebits(coupleId, db, notifyPartner);
    return send(200, { ok: true, applied: count });
  }

  return false;
};
