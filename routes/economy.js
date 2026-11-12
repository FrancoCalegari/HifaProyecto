module.exports = async function handle(c) {
  const { req, apiPath, db, user, coupleId, send } = c;

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

    return send(200, {
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
    const body = await c.body();
    if (!body.name || !body.type) return send(400, { error: 'Nombre y tipo de billetera requeridos.' });
    const ownerId = body.owner_user_id ? Number(body.owner_user_id) : null;
    const info = db
      .prepare('INSERT INTO wallets (couple_id, name, type, owner_user_id, details, initial_balance) VALUES (?, ?, ?, ?, ?, ?)')
      .run(coupleId, body.name.trim(), body.type, ownerId, body.details || '', Number(body.initial_balance || 0));
    return send(201, { id: Number(info.lastInsertRowid) });
  }

  if (apiPath.startsWith('/api/wallets/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM transactions WHERE wallet_id = ? AND couple_id = ?').run(id, coupleId);
    db.prepare('DELETE FROM wallets WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

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

  if (apiPath.startsWith('/api/transactions/') && req.method === 'DELETE') {
    const id = Number(apiPath.split('/').pop());
    db.prepare('DELETE FROM transactions WHERE id = ? AND couple_id = ?').run(id, coupleId);
    return send(200, { ok: true });
  }

  return false;
};
