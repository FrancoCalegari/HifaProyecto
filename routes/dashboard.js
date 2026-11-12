const { safeJson, getOffsetDate, computeMenstrualProjections } = require('../lib/helpers');

module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, ensureMonthlyRecoveryReset } = c;

  if (apiPath === '/api/dashboard' && req.method === 'GET') {
    const couple = ensureMonthlyRecoveryReset(db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId));
    if (!(user.profile_completed && partner?.profile_completed && couple.relationship_start)) {
      return send(403, { error: 'Ambos deben guardar el formulario para ver el dashboard.' });
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

    return send(200, {
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

  return false;
};
