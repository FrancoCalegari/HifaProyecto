const { safeJson } = require('./helpers');

function createCoupleHelpers(db) {
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

  return { notifyPartner, getPartner, ensureMonthlyRecoveryReset };
}

module.exports = { createCoupleHelpers };
