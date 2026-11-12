const { getOffsetDate } = require('../lib/helpers');

module.exports = async function handle(c) {
  const { req, apiPath, urlObj, db, user, coupleId, send, ensureMonthlyRecoveryReset } = c;

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

    return send(200, {
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
    const body = await c.body();
    const answerText = String(body.answer_text || '').trim();
    if (!answerText) return send(400, { error: 'Escribe tu respuesta.' });
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

    return send(200, {
      ok: true,
      both_answered: answersToday >= 2,
      streak_count: couple.streak_count,
      longest_streak: couple.longest_streak
    });
  }

  if (apiPath === '/api/daily-question/recover' && req.method === 'POST') {
    const body = await c.body();
    const today = body.date || new Date().toISOString().slice(0, 10);
    let couple = db.prepare('SELECT * FROM couples WHERE id = ?').get(coupleId);
    couple = ensureMonthlyRecoveryReset(couple);

    if (couple.streak_recoveries_left <= 0) {
      return send(400, { error: 'Ya usaste las 3 recuperaciones de racha de este mes.' });
    }
    const yesterday = getOffsetDate(today, -1);
    const restoredStreak = Math.max(Number(couple.streak_count || 0), Number(couple.longest_streak || 1));
    const left = couple.streak_recoveries_left - 1;
    db.prepare(
      'UPDATE couples SET streak_count = ?, last_streak_date = ?, streak_recoveries_left = ? WHERE id = ?'
    ).run(restoredStreak, yesterday, left, coupleId);

    return send(200, {
      ok: true,
      streak_count: restoredStreak,
      streak_recoveries_left: left,
      last_streak_date: yesterday
    });
  }

  return false;
};
