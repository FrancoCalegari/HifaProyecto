const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('./server');

async function runTests() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hifa-test-'));
  const { server } = createApp(tmpDir);

  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  async function req(endpoint, method = 'GET', body = null, token = '') {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json();
    assert.ok(res.ok, `Request ${method} ${endpoint} failed: ${JSON.stringify(data)}`);
    return data;
  }

  try {
    // -1. Smoke test: Verify static files and ES module entrypoint
    const indexRes = await fetch(`${baseUrl}/`);
    assert.equal(indexRes.status, 200);
    const indexHtml = await indexRes.text();
    assert.ok(indexHtml.includes('/js/main.js'), 'index.html must reference /js/main.js');

    const mainJsRes = await fetch(`${baseUrl}/js/main.js`);
    assert.equal(mainJsRes.status, 200);
    assert.ok(mainJsRes.headers.get('content-type').includes('javascript'));

    // 0. Check First-Time Setup & SpiderWebAPI config
    const setup0 = await req('/api/setup');
    assert.equal(setup0.config.spidercloudstrogaeid, '47');

    // 1. Fase 1: Register two users (with default avatar fallback)
    const u1 = await req('/api/auth/register', 'POST', {
      first_name: 'Franco',
      last_name: 'Calegari',
      age: 26,
      email: 'franco@hifa.test',
      password: 'secret123'
    });
    assert.ok(u1.token);
    assert.ok(u1.user.avatar_url.startsWith('data:image/svg+xml'));
    assert.ok(u1.user.pair_code.startsWith('HIFA-'));

    const u2 = await req('/api/auth/register', 'POST', {
      first_name: 'Sofía',
      last_name: 'Gómez',
      age: 25,
      email: 'sofia@hifa.test',
      password: 'secret123'
    });
    assert.ok(u2.token);

    // 2. Link couple using u1's pair_code
    const linkRes = await req('/api/couple/link', 'POST', { code: u1.user.pair_code }, u2.token);
    assert.ok(linkRes.couple_id);

    // 3. Complete Couple Profile (mandatory relationship_start + clothing sizes + tastes)
    await req(
      '/api/couple/profile',
      'PUT',
      {
        relationship_start: '2023-05-14',
        shared_info: { motto: 'Siempre juntos' },
        my_tastes: {
          shirt_size: 'L',
          pants_size: '42',
          shoe_size: '42',
          favorite_food: 'Asado y pastas',
          favorite_flowers: 'Rosa roja',
          favorite_brands: 'Nike',
          favorite_series_movies: 'Interstellar',
          favorite_color: 'Azul',
          favorite_weather: 'Templado',
          favorite_plan: 'Ruta y mate',
          additional_tastes: 'Helado de dulce de leche'
        }
      },
      u1.token
    );
    const lock = await fetch(`${baseUrl}/api/dashboard`, { headers: { Authorization: `Bearer ${u1.token}` } });
    assert.equal(lock.status, 403);
    const second = await req(
      '/api/couple/profile',
      'PUT',
      { relationship_start: '2023-05-14', my_tastes: { favorite_food: 'Sushi', favorite_color: 'Lila' } },
      u2.token
    );
    assert.equal(second.profiles_ready, true);
    const dash = await req('/api/dashboard', 'GET', null, u1.token);
    assert.ok(dash.days_together > 0);
    assert.equal(dash.partner.tastes.favorite_food, 'Sushi');

    // 4. Fase 2: Economy (Wallets, Transactions, Wallet-specific & Global Analytics)
    const econ0 = await req('/api/economy', 'GET', null, u1.token);
    assert.ok(econ0.wallets.length >= 3);
    const walletId = econ0.wallets[0].id;

    await req(
      '/api/transactions',
      'POST',
      {
        wallet_id: walletId,
        user_id: u1.user.id,
        kind: 'ingreso',
        scope: 'compartido',
        mode: 'transferencia',
        category: 'Sueldo',
        amount: 500000,
        description: 'Ingreso mensual',
        date: '2026-11-01'
      },
      u1.token
    );

    await req(
      '/api/transactions',
      'POST',
      {
        wallet_id: walletId,
        user_id: u2.user.id,
        kind: 'egreso',
        scope: 'compartido',
        mode: 'efectivo',
        category: 'Supermercado',
        amount: 85000,
        description: 'Compra mensual',
        date: '2026-11-02'
      },
      u2.token
    );

    const econ1 = await req('/api/economy', 'GET', null, u1.token);
    assert.equal(econ1.globalAnalytics.totalIncome, 500000);
    assert.equal(econ1.globalAnalytics.totalExpense, 85000);
    assert.equal(econ1.globalAnalytics.netBalance, 415000);
    assert.equal(econ1.globalAnalytics.byCategory.length, 2);

    // 5. Tasks & Lists & Calendar
    const taskRes = await req(
      '/api/tasks',
      'POST',
      { board_name: 'Hogar', title: 'Pagar alquiler', priority: 'alta', assigned_to: 'both', due_datetime: '2026-11-15T10:00' },
      u1.token
    );
    await req(`/api/tasks/${taskRes.id}`, 'PATCH', { completed: true }, u2.token);

    const listRes = await req('/api/lists', 'POST', { name: 'Ferretería' }, u1.token);
    const itemRes = await req(`/api/lists/${listRes.id}/items`, 'POST', { name: 'Lámpara LED', price: 3500, quantity: '2' }, u1.token);
    await req(`/api/list-items/${itemRes.id}`, 'PATCH', { checked: true }, u2.token);

    await req(
      '/api/calendar',
      'POST',
      { title: 'Cena Aniversario', start_datetime: '2026-11-20T21:00', remind_offset_value: 2, remind_offset_unit: 'days' },
      u1.token
    );

    // 6. "Notitas" overwrite + "Nota nueva" notification
    await req('/api/notitas', 'POST', { text_content: 'Primera notita' }, u1.token);
    await req('/api/notitas', 'POST', { text_content: 'Segunda notita que sobrescribe' }, u1.token);
    const { notitas } = await req('/api/notitas', 'GET', null, u2.token);
    const francoNotita = notitas.find(n => n.author_user_id === u1.user.id);
    assert.equal(francoNotita.text_content, 'Segunda notita que sobrescribe');
    const me2 = await req('/api/me', 'GET', null, u2.token);
    assert.ok(me2.notifications.some(n => n.title === 'Nota nueva' && n.body.includes('Segunda notita')));

    // 7. Daily Question & Streak + 3 Monthly Recoveries
    await req('/api/daily-question/answer', 'POST', { date: '2026-11-08', answer_text: 'Viajar a Bariloche' }, u1.token);
    const ans2 = await req('/api/daily-question/answer', 'POST', { date: '2026-11-08', answer_text: 'Recorrer el sur juntos' }, u2.token);
    assert.equal(ans2.both_answered, true);
    assert.equal(ans2.streak_count, 1);

    // Next consecutive day increments streak to 2
    await req('/api/daily-question/answer', 'POST', { date: '2026-11-09', answer_text: 'Cocinar pastas' }, u1.token);
    const ansDay2 = await req('/api/daily-question/answer', 'POST', { date: '2026-11-09', answer_text: 'Hacer ñoquis' }, u2.token);
    assert.equal(ansDay2.streak_count, 2);
    assert.equal(ansDay2.longest_streak, 2);

    // Recover streak decrements available monthly recoveries (3 -> 2)
    const rec = await req('/api/daily-question/recover', 'POST', { date: '2026-11-11' }, u1.token);
    assert.equal(rec.streak_recoveries_left, 2);

    // 8. Cravings + Suggest Craving + Partner Accepts -> automatically in active cravings
    const sug = await req(
      '/api/cravings',
      'POST',
      { title: 'Perfume floral', price: 45000, suggest_to_partner: true, description: 'Regalo sorpresa' },
      u1.token
    );
    assert.equal(sug.status, 'suggested');
    await req(`/api/cravings/${sug.id}/respond`, 'POST', { accept: true }, u2.token);
    const { cravings } = await req('/api/cravings', 'GET', null, u2.token);
    const accepted = cravings.find(c => c.id === sug.id);
    assert.equal(accepted.status, 'active');
    assert.equal(accepted.owner_user_id, u2.user.id);

    // 9. Time Capsule lock/unlock
    await req('/api/capsules', 'POST', { title: 'Carta Futura', body: 'Secreto futuro', unlock_at: '2099-01-01T00:00' }, u1.token);
    await req('/api/capsules', 'POST', { title: 'Carta Pasada', body: 'Ya se puede leer', unlock_at: '2020-01-01T00:00' }, u1.token);
    const { capsules } = await req('/api/capsules', 'GET', null, u2.token);
    const futureCap = capsules.find(c => c.title === 'Carta Futura');
    const pastCap = capsules.find(c => c.title === 'Carta Pasada');
    assert.equal(futureCap.locked, true);
    assert.notEqual(futureCap.body, 'Secreto futuro');
    assert.equal(pastCap.locked, false);
    assert.equal(pastCap.body, 'Ya se puede leer');

    // 10. Goals (Monetary, Habit, Time + Finish action)
    const gMon = await req(
      '/api/goals',
      'POST',
      { title: 'Dinero para una casa', goal_type: 'monetary', target_value: 1200000, current_value: 200000 },
      u1.token
    );
    await req(`/api/goals/${gMon.id}/progress`, 'POST', { delta: 300000 }, u2.token);
    await req(`/api/goals/${gMon.id}/finish`, 'POST', {}, u1.token);
    const { goals } = await req('/api/goals', 'GET', null, u1.token);
    assert.equal(goals[0].finished, 1);
    assert.equal(goals[0].current_value, 500000);

    // 11. Notebooks & Pages (Markdown) + Menstrual Cycle + Weekly Plans AI
    const nb = await req('/api/notebooks', 'POST', { title: 'Recetas de Pareja', icon: '🍝' }, u1.token);
    const pg = await req(`/api/notebooks/${nb.id}/pages`, 'POST', { title: 'Pastas', markdown_content: '# Ñoquis\n- [ ] Papa\n- [ ] Harina' }, u1.token);
    assert.ok(pg.id);

    const mens = await req('/api/menstrual', 'PUT', { lastStart: '2026-11-01', cycleDays: 28, periodDays: 5 }, u2.token);
    assert.equal(mens.menstrual.nextPeriodStart, '2026-11-29');

    const aiPlans = await req('/api/plans/ai', 'POST', {}, u1.token);
    assert.ok(aiPlans.plans.length >= 3);

    console.log('✓ Todos los tests de Fase 1, Fase 2, Herramientas y SpiderWebAPI pasaron correctamente.');
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

