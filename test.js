process.env.NODE_ENV = 'test';
process.env.CLOUD_SYNC = '0';
process.env.DB_MODE = 'local';
process.env.STORAGE_MODE = 'local';

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
    assert.ok(!indexHtml.includes('btn-open-notifications'), 'btn-open-notifications must be removed');

    const adminHtmlRes = await fetch(`${baseUrl}/admin`);
    assert.equal(adminHtmlRes.status, 200);

    const mainJsRes = await fetch(`${baseUrl}/js/main.js`);
    assert.equal(mainJsRes.status, 200);
    assert.ok(mainJsRes.headers.get('content-type').includes('javascript'));

    // 0. Check First-Time Setup & SpiderWebAPI config (sin exponer spiderapikey a no-admins)
    const setup0 = await req('/api/setup');
    assert.equal(setup0.config.spidercloudstrogaeid, '47');
    assert.equal(setup0.config.spiderapikey, undefined, 'spiderapikey must NOT be exposed publicly on /api/setup');

    const unauthSpiderTest = await fetch(`${baseUrl}/api/spiderweb/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    assert.equal(unauthSpiderTest.status, 403, '/api/spiderweb/test must require admin role');

    const adminJsCode = fs.readFileSync(path.join(__dirname, 'public', 'js', 'shell', 'admin.js'), 'utf8');
    assert.ok(!adminJsCode.includes('admin123'), 'admin.js must NOT expose default password in UI');

    // 0b. Admin Account & Role Check
    const adminLogin = await req('/api/auth/login', 'POST', {
      email: 'admin@hifa.saas',
      password: 'admin123'
    });
    assert.ok(adminLogin.token);
    assert.equal(adminLogin.user.role, 'admin');

    const adminOverview = await req('/api/admin/overview', 'GET', null, adminLogin.token);
    assert.ok(adminOverview.config);
    assert.ok(adminOverview.stats);
    assert.ok(Array.isArray(adminOverview.users));

    // 1. Fase 1: Register two users (with default avatar fallback)
    const u1 = await req('/api/auth/register', 'POST', {
      first_name: 'Franco',
      last_name: 'Calegari',
      age: 26,
      email: 'franco@hifa.test',
      password: 'secret123'
    });
    assert.ok(u1.token);
    assert.equal(u1.user.role, 'user');
    assert.ok(u1.user.avatar_url.startsWith('data:image/svg+xml'));
    assert.ok(u1.user.pair_code.startsWith('HIFA-'));

    // Non-admin user cannot access admin overview (403 Forbidden)
    const forbiddenRes = await fetch(`${baseUrl}/api/admin/overview`, {
      headers: { Authorization: `Bearer ${u1.token}` }
    });
    assert.equal(forbiddenRes.status, 403);

    // Admin updates db configuration
    const updateRes = await req('/api/admin/setup', 'POST', {
      db_mode: 'local',
      storage_mode: 'local',
      spiderwebdbname: 'sw_test_db',
      spiderapikey: 'key123',
      spidercloudstrogaeid: '99',
      spiderweb_api_url: 'https://spiderwebargapi.com.ar/api/v1'
    }, adminLogin.token);
    assert.equal(updateRes.config.spiderwebdbname, 'sw_test_db');

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

    // 4b. Configurar tarjeta / medio de pago (Modificar datos)
    const updateWalletRes = await req(
      `/api/wallets/${walletId}`,
      'PUT',
      {
        name: 'Cuenta Principal Actualizada',
        type: 'billetera_virtual',
        details: 'Alias hifa.mp / *1234',
        initial_balance: 10000
      },
      u1.token
    );
    assert.equal(updateWalletRes.ok, true);
    assert.equal(updateWalletRes.wallet.name, 'Cuenta Principal Actualizada');
    assert.equal(updateWalletRes.wallet.details, 'Alias hifa.mp / *1234');

    // 4c. Débitos automáticos mensuales por servicios (ej: Disney $7500)
    const srvRes = await req(
      '/api/recurring-services',
      'POST',
      {
        wallet_id: walletId,
        name: 'Disney+',
        amount: 7500,
        day_of_month: 1, // Día 1 (ya transcurrido en el mes actual)
        category: 'Suscripciones y Servicios',
        description: 'Plan Premium'
      },
      u1.token
    );
    assert.ok(srvRes.id);

    // Al consultar la economía, el débito automático del día 1 debe haberse procesado y descontado
    const econ2 = await req('/api/economy', 'GET', null, u1.token);
    assert.ok(econ2.recurringServices.some(s => s.name === 'Disney+' && s.amount === 7500));
    // El gasto total debe ser 85000 + 7500 = 92500
    assert.equal(econ2.globalAnalytics.totalExpense, 92500);
    assert.ok(econ2.transactions.some(t => t.description.includes('Disney+') && t.amount === 7500));

    // Pausar y reanudar servicio
    await req(`/api/recurring-services/${srvRes.id}`, 'PATCH', { active: 0 }, u1.token);
    const srvListP = await req('/api/recurring-services', 'GET', null, u1.token);
    assert.equal(srvListP.services.find(s => s.id === srvRes.id).active, 0);

    await req(`/api/recurring-services/${srvRes.id}`, 'PATCH', { active: 1 }, u1.token);

    // Actualizar servicio con PUT
    const srvPutRes = await req(
      `/api/recurring-services/${srvRes.id}`,
      'PUT',
      {
        name: 'Disney+ y Star+',
        amount: 8200,
        day_of_month: 5,
        category: 'Streaming',
        description: 'Plan Combo+',
        wallet_id: walletId,
        active: 1
      },
      u1.token
    );
    assert.equal(srvPutRes.ok, true);
    const srvListUpdated = await req('/api/recurring-services', 'GET', null, u1.token);
    const updatedSrv = srvListUpdated.services.find(s => s.id === srvRes.id);
    assert.equal(updatedSrv.name, 'Disney+ y Star+');
    assert.equal(updatedSrv.amount, 8200);

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

    // 5b. Editar ítem de lista (nombre, precio, cantidad)
    await req(
      `/api/list-items/${itemRes.id}`,
      'PUT',
      { name: 'Lámpara LED Cálida 12W', price: 4200, quantity: '3' },
      u1.token
    );
    const updatedLists = await req('/api/lists', 'GET', null, u1.token);
    const editedItem = updatedLists.lists.find(l => l.id === listRes.id).items.find(i => i.id === itemRes.id);
    assert.equal(editedItem.name, 'Lámpara LED Cálida 12W');
    assert.equal(editedItem.price, 4200);
    assert.equal(editedItem.quantity, '3');

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

    // 11b. Módulo dedicado de Ciclo Menstrual, Métodos Anticonceptivos y Algoritmo de 3 Meses
    const cycleInit = await req('/api/cycle?month=2026-11', 'GET', null, u1.token);
    assert.equal(cycleInit.month, '2026-11');
    assert.equal(cycleInit.analysis.algorithmActive, false);
    assert.ok(cycleInit.analysis.cyclesRecorded < 3);

    // Configurar método anticonceptivo
    const cycleCfg = await req('/api/cycle/settings', 'PUT', {
      contraceptive_method: 'pastillas_28',
      cycleDays: 29,
      periodDays: 5,
      lastStart: '2026-11-01'
    }, u2.token);
    assert.equal(cycleCfg.settings.contraceptive_method, 'pastillas_28');
    assert.equal(cycleCfg.settings.cycleDays, 29);

    // Registrar un día con anticonceptivo tomado, relaciones sexuales 🔥 y flujo ligero 💧
    const logRes = await req('/api/cycle/log', 'POST', {
      date: '2026-11-15',
      contraceptive: 'tomado',
      intimacy: 1,
      flow: 'ligero',
      is_period_start: 0,
      notes: 'Pastilla tomada a las 21hs. Relaciones con protección.'
    }, u1.token);
    assert.equal(logRes.log.date, '2026-11-15');
    assert.equal(logRes.log.contraceptive, 'tomado');
    assert.equal(logRes.log.intimacy, 1);
    assert.equal(logRes.log.flow, 'ligero');

    // Verificar en GET /api/cycle
    const cycleWithLog = await req('/api/cycle?month=2026-11', 'GET', null, u2.token);
    assert.equal(cycleWithLog.logs.length, 1);
    assert.equal(cycleWithLog.logs[0].contraceptive, 'tomado');
    assert.equal(cycleWithLog.logs[0].intimacy, 1);

    // Activar el análisis algorítmico tras un período de 3 meses / 3 ciclos
    const cycle3Months = await req('/api/cycle/settings', 'PUT', {
      contraceptive_method: 'pastillas_28',
      cycleDays: 28,
      periodDays: 5,
      lastStart: '2026-11-04',
      history: ['2026-11-04', '2026-10-06', '2026-09-08', '2026-08-11']
    }, u2.token);
    assert.equal(cycle3Months.analysis.algorithmActive, true);
    assert.equal(cycle3Months.analysis.cyclesRecorded >= 3, true);
    assert.ok(cycle3Months.analysis.averageCycleDays >= 27 && cycle3Months.analysis.averageCycleDays <= 30);
    assert.ok(cycle3Months.projections.nextPeriodStart.length === 10);
    assert.ok(cycle3Months.projections.ovulationDate.length === 10);

    // Borrar registro de un día
    await req('/api/cycle/log/2026-11-15', 'DELETE', null, u1.token);
    const cycleAfterDel = await req('/api/cycle?month=2026-11', 'GET', null, u1.token);
    assert.equal(cycleAfterDel.logs.length, 0);

    const aiPlans = await req('/api/plans/ai', 'POST', {}, u1.token);
    assert.ok(aiPlans.plans.length >= 3);

    // 11b. Planes (Citas) + Journaling completo (fechas, lugar, quién planeó, calificación, fotos y videos)
    const planCreate = await req('/api/plans', 'POST', {
      title: 'Picnic en el Rosedal',
      category: 'Cita',
      weather: 'Soleado',
      location: 'Bosques de Palermo',
      planned_by: 'Franco',
      planned_date: '2026-11-12',
      description: 'Llevar manta y algo dulce'
    }, u1.token);
    assert.ok(planCreate.id);

    const planUpdated = await req(`/api/plans/${planCreate.id}`, 'PUT', {
      status: 'completed',
      rating: 5,
      mood: 'Romántica',
      journal_text: 'Salió increíble, vimos el atardecer juntos y sacamos muchas fotos.',
      media: [
        { url: '/uploads/pic1.jpg', type: 'image', name: 'pic1.jpg' },
        { url: '/uploads/clip1.mp4', type: 'video', name: 'clip1.mp4' }
      ]
    }, u1.token);
    assert.equal(planUpdated.ok, true);
    assert.equal(planUpdated.plan.status, 'completed');
    assert.equal(planUpdated.plan.rating, 5);
    assert.equal(planUpdated.plan.location, 'Bosques de Palermo');
    assert.equal(planUpdated.plan.planned_by, 'Franco');
    assert.equal(planUpdated.plan.media.length, 2);
    assert.equal(planUpdated.plan.media[1].type, 'video');

    await req(`/api/plans/${planCreate.id}/select`, 'POST', {}, u1.token);
    const { plans: allPlans } = await req('/api/plans', 'GET', null, u1.token);
    const savedPlan = allPlans.find(p => p.id === planCreate.id);
    assert.ok(savedPlan && savedPlan.selected_for_week === 1);

    // También debe poder hacerse journaling sobre un plan base del sistema (clonándolo para la pareja)
    const sysPlan = allPlans.find(p => p.couple_id === null);
    if (sysPlan) {
      const cloned = await req(`/api/plans/${sysPlan.id}`, 'PUT', {
        status: 'completed',
        rating: 4,
        journal_text: 'Probamos este plan base y estuvo genial'
      }, u1.token);
      assert.equal(cloned.ok, true);
      assert.ok(cloned.id !== sysPlan.id, 'System plan journal should clone into couple-owned plan');
    }

    // 12. Ruletas personalizables para tomar decisiones
    const { roulettes: roulettesInitial } = await req('/api/roulettes', 'GET', null, u1.token);
    const initialCount = roulettesInitial.length; // 1 ruleta inicial sembrada por defecto

    const roulCreate = await req('/api/roulettes', 'POST', {
      name: '¿A quién le toca lavar los platos?',
      options: ['Franco', 'Daniela', 'Los dos juntos']
    }, u1.token);
    assert.ok(roulCreate.id);

    const roulUpdate = await req(`/api/roulettes/${roulCreate.id}`, 'PUT', {
      name: '¿Quién lava hoy?',
      options: ['Franco', 'Daniela', 'Piedra papel o tijera', 'Turnarse']
    }, u1.token);
    assert.equal(roulUpdate.ok, true);
    assert.equal(roulUpdate.roulette.name, '¿Quién lava hoy?');
    assert.equal(roulUpdate.roulette.options.length, 4);

    const { roulettes: roulettesAfterAdd } = await req('/api/roulettes', 'GET', null, u1.token);
    assert.equal(roulettesAfterAdd.length, initialCount + 1);
    const foundRoul = roulettesAfterAdd.find(r => r.id === roulCreate.id);
    assert.ok(foundRoul);
    assert.equal(foundRoul.name, '¿Quién lava hoy?');
    assert.equal(foundRoul.options.length, 4);

    await req(`/api/roulettes/${roulCreate.id}`, 'DELETE', null, u1.token);
    const { roulettes: roulettesAfterDel } = await req('/api/roulettes', 'GET', null, u1.token);
    assert.equal(roulettesAfterDel.length, initialCount);

    // 13. Vercel Serverless Entrypoint & Cloud Sync API
    const vercelHandler = require('./api/index');
    assert.equal(typeof vercelHandler, 'function', 'api/index.js must export an async handler function');

    // Test cloud-sync admin endpoint
    const adminSyncRes = await req('/api/admin/cloud-sync', 'POST', {}, adminLogin.token);
    assert.ok(adminSyncRes.ok !== undefined, 'cloud-sync response should return status');

    // 14. Admin Local Backups & Restore
    const backupCreateRes = await req('/api/admin/backups', 'POST', {}, adminLogin.token);
    assert.equal(backupCreateRes.ok, true);
    assert.ok(backupCreateRes.backup.filename.endsWith('.db'));

    const overviewAfterBackup = await req('/api/admin/overview', 'GET', null, adminLogin.token);
    assert.ok(Array.isArray(overviewAfterBackup.backups));
    assert.ok(overviewAfterBackup.backups.some(b => b.filename === backupCreateRes.backup.filename));

    const restoreRes = await req(
      '/api/admin/backups/restore',
      'POST',
      { filename: backupCreateRes.backup.filename },
      adminLogin.token
    );
    assert.equal(restoreRes.ok, true);
    assert.equal(restoreRes.restoredFrom, backupCreateRes.backup.filename);
    assert.ok(restoreRes.safetyBackup.endsWith('.db'));

    // 15. Stateless HMAC Session Tokens (cross-instance serverless auth)
    const { verifySessionToken, getAuthUser } = require('./lib/auth');
    const { DatabaseSync } = require('node:sqlite');
    assert.ok(u1.token.startsWith('v1.'), 'Login/register token should use stateless v1 format');
    const verifiedPayload = verifySessionToken(u1.token);
    assert.ok(verifiedPayload && verifiedPayload.uid && verifiedPayload.email);
    assert.equal(verifySessionToken(`${u1.token}tampered`), null);

    const coldContainerDb = new DatabaseSync(':memory:');
    coldContainerDb.exec(`
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT, password_hash TEXT, tastes_json TEXT);
      CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, created_at TEXT);
    `);
    coldContainerDb.prepare('INSERT INTO users (id, name, email, password_hash, tastes_json) VALUES (?, ?, ?, ?, ?)').run(
      999, 'Franco', verifiedPayload.email, 'x', '{}'
    );
    const resolvedCold = getAuthUser(coldContainerDb, {
      headers: { authorization: `Bearer ${u1.token}` }
    });
    assert.ok(resolvedCold && resolvedCold.user, 'Signed token must authenticate even when sessions table is empty in another container');
    assert.equal(resolvedCold.user.email, verifiedPayload.email);
    coldContainerDb.close();

    // Verify authenticated endpoints succeed with signed token
    const meCheck = await req('/api/me', 'GET', null, u1.token);
    assert.ok(meCheck.user);
    const dashCheck = await req('/api/dashboard', 'GET', null, u1.token);
    assert.ok(typeof dashCheck.days_together === 'number' && dashCheck.me);

    console.log('✓ Todos los tests de Fase 1, Fase 2, Herramientas, Vercel Serverless, Backups y SpiderWebAPI pasaron correctamente.');
  } finally {
    server.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});

