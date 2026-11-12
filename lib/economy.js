function processRecurringDebits(coupleId, db, notifyPartner) {
  const today = new Date().toISOString().slice(0, 10);
  const currentYearMonth = today.slice(0, 7);
  const currentDay = Number(today.slice(8, 10));
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const maxDaysInMonth = new Date(year, month, 0).getDate();

  const services = db
    .prepare('SELECT * FROM recurring_services WHERE couple_id = ? AND active = 1')
    .all(coupleId);

  let appliedCount = 0;
  for (const s of services) {
    const targetDay = Math.min(Number(s.day_of_month || 1), maxDaysInMonth);
    // Si ya estamos en o pasamos el día del débito en este mes y aún no se cobró este mes
    if (currentDay >= targetDay && s.last_processed_date !== currentYearMonth) {
      const debitDate = `${currentYearMonth}-${String(targetDay).padStart(2, '0')}`;
      const desc = `Débito automático: ${s.name}${s.description ? ` (${s.description})` : ''}`;

      db.prepare(
        `INSERT INTO transactions (couple_id, wallet_id, user_id, kind, scope, mode, category, amount, description, date)
         VALUES (?, ?, ?, 'egreso', ?, ?, ?, ?, ?, ?)`
      ).run(
        coupleId,
        s.wallet_id,
        s.user_id,
        s.scope || 'compartido',
        s.mode || 'debito_automatico',
        s.category || 'Servicios y Suscripciones',
        Number(s.amount),
        desc,
        debitDate
      );

      db.prepare('UPDATE recurring_services SET last_processed_date = ? WHERE id = ?').run(
        currentYearMonth,
        s.id
      );

      appliedCount++;
      if (notifyPartner) {
        notifyPartner(
          coupleId,
          null,
          'Débito automático aplicado',
          `Se descontó "${s.name}" (${s.category}) por $${s.amount} de la fecha ${debitDate}.`,
          'economy'
        );
      }
    }
  }
  return appliedCount;
}

module.exports = { processRecurringDebits };

