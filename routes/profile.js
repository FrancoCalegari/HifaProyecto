const { safeJson } = require('../lib/helpers');

module.exports = async function handle(c) {
  const { req, apiPath, db, user, partner, coupleId, send, notifyPartner } = c;

  if (apiPath === '/api/couple/profile' && req.method === 'PUT') {
    const body = await c.body();
    if (!body.relationship_start) {
      return send(400, { error: 'La fecha de inicio de la relación es obligatoria.' });
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

    return send(200, { ok: true, profiles_ready: partnerDone });
  }

  return false;
};
