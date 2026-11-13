const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { restoreDbFromCloud, syncDbToCloud, scheduleDbSync, getLastSyncTime } = require('./lib/cloud-sync');
const ai = require('./lib/ai');

// Load .env or .env.production if present
const envFiles = [
  path.join(__dirname, '.env.production'),
  path.join(__dirname, '.env')
];
for (const envPath of envFiles) {
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!(key in process.env)) process.env[key] = val;
    }
  }
}

function initDb(customDataDir) {
  const defaultDataDir = process.env.VERCEL
    ? path.join('/tmp', 'hifa-data')
    : path.join(__dirname, 'data');
  const dataDir = customDataDir || process.env.DATA_DIR || defaultDataDir;
  const uploadsDir = path.join(dataDir, 'uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });

  const dbPath = path.join(dataDir, 'hifa.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS couples (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user1_id INTEGER,
      user2_id INTEGER,
      relationship_start TEXT DEFAULT '',
      shared_info_json TEXT DEFAULT '{}',
      streak_count INTEGER DEFAULT 0,
      longest_streak INTEGER DEFAULT 0,
      last_streak_date TEXT DEFAULT '',
      streak_recoveries_left INTEGER DEFAULT 3,
      streak_recovery_month TEXT DEFAULT '',
      menstrual_data_json TEXT DEFAULT '{"lastStart":"","periodDays":5,"cycleDays":28,"history":[]}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      avatar_url TEXT DEFAULT '',
      couple_id INTEGER,
      pair_code TEXT UNIQUE,
      role TEXT DEFAULT 'user',
      theme TEXT DEFAULT 'system',
      language TEXT DEFAULT 'es',
      currency TEXT DEFAULT 'ARS',
      notifications_enabled INTEGER DEFAULT 1,
      tastes_json TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS wallets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      owner_user_id INTEGER,
      details TEXT DEFAULT '',
      initial_balance REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      wallet_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      scope TEXT DEFAULT 'compartido',
      mode TEXT DEFAULT 'transferencia',
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT DEFAULT '',
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS recurring_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      wallet_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      category TEXT DEFAULT 'Suscripciones y Servicios',
      amount REAL NOT NULL,
      day_of_month INTEGER NOT NULL,
      scope TEXT DEFAULT 'compartido',
      mode TEXT DEFAULT 'debito_automatico',
      description TEXT DEFAULT '',
      active INTEGER DEFAULT 1,
      last_processed_date TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      board_name TEXT DEFAULT 'General',
      title TEXT NOT NULL,
      priority TEXT DEFAULT 'media',
      assigned_to TEXT DEFAULT 'both',
      due_datetime TEXT DEFAULT '',
      completed INTEGER DEFAULT 0,
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS list_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      list_id INTEGER NOT NULL,
      couple_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL DEFAULT 0,
      quantity TEXT DEFAULT '1',
      checked INTEGER DEFAULT 0,
      created_by INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      start_datetime TEXT NOT NULL,
      end_datetime TEXT DEFAULT '',
      remind_offset_value INTEGER DEFAULT 30,
      remind_offset_unit TEXT DEFAULT 'minutes',
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      target_user_id INTEGER,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS roulettes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      options_json TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS weekly_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'Cita',
      weather TEXT DEFAULT 'Cualquiera',
      source TEXT DEFAULT 'system',
      selected_for_week INTEGER DEFAULT 0,
      proposed_by INTEGER,
      description TEXT DEFAULT '',
      location TEXT DEFAULT '',
      planned_by TEXT DEFAULT '',
      planned_date TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      rating INTEGER DEFAULT 0,
      journal_text TEXT DEFAULT '',
      mood TEXT DEFAULT '',
      media_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notitas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      author_user_id INTEGER NOT NULL,
      text_content TEXT DEFAULT '',
      drawing_data_url TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(couple_id, author_user_id)
    );

    CREATE TABLE IF NOT EXISTS shared_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      author_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS daily_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_text TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      date_str TEXT NOT NULL,
      user_id INTEGER NOT NULL,
      answer_text TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(couple_id, date_str, user_id)
    );

    CREATE TABLE IF NOT EXISTS cravings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      owner_user_id INTEGER NOT NULL,
      suggested_by_user_id INTEGER,
      status TEXT DEFAULT 'active',
      title TEXT NOT NULL,
      url TEXT DEFAULT '',
      price REAL DEFAULT 0,
      photo_url TEXT DEFAULT '',
      description TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS time_capsules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      author_user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      photo_url TEXT DEFAULT '',
      unlock_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS goals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      created_by INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      goal_type TEXT NOT NULL,
      target_value REAL DEFAULT 1,
      current_value REAL DEFAULT 0,
      frequency TEXT DEFAULT 'diaria',
      last_checkin_date TEXT DEFAULT '',
      target_date TEXT DEFAULT '',
      finished INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      icon TEXT DEFAULT '📓',
      created_by INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notebook_pages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      notebook_id INTEGER NOT NULL,
      couple_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      markdown_content TEXT DEFAULT '',
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menstrual_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      couple_id INTEGER NOT NULL,
      date TEXT NOT NULL,
      contraceptive TEXT DEFAULT '',
      intimacy INTEGER DEFAULT 0,
      flow TEXT DEFAULT 'ninguno',
      is_period_start INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(couple_id, date)
    );

    CREATE TABLE IF NOT EXISTS media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      local_filename TEXT NOT NULL UNIQUE,
      local_url TEXT NOT NULL,
      remote_file_id TEXT DEFAULT '',
      remote_url TEXT DEFAULT '',
      mime_type TEXT DEFAULT 'application/octet-stream',
      file_size INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_menstrual_logs_couple_date ON menstrual_logs(couple_id, date);
  `);

  // Migración para bases ya existentes
  try { db.exec('ALTER TABLE users ADD COLUMN profile_completed INTEGER DEFAULT 0'); } catch (_) {}
  try { db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'"); } catch (_) {}
  const planMigrations = [
    "ALTER TABLE weekly_plans ADD COLUMN description TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN location TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN planned_by TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN planned_date TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN status TEXT DEFAULT 'pending'",
    "ALTER TABLE weekly_plans ADD COLUMN rating INTEGER DEFAULT 0",
    "ALTER TABLE weekly_plans ADD COLUMN journal_text TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN mood TEXT DEFAULT ''",
    "ALTER TABLE weekly_plans ADD COLUMN media_json TEXT DEFAULT '[]'"
  ];
  for (const sql of planMigrations) {
    try { db.exec(sql); } catch (_) {}
  }

  // Seed cuenta de Administrador por defecto si no existe ninguno
  try {
    const adminUser = db.prepare("SELECT id FROM users WHERE role = 'admin'").get();
    if (!adminUser) {
      const adminEmail = process.env.ADMIN_EMAIL || 'admin@hifa.saas';
      const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
      const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
      if (!exists) {
        const { hashPassword } = require('./lib/auth');
        const { defaultAvatarSvg } = require('./lib/helpers');
        db.prepare(`
          INSERT INTO users (first_name, last_name, age, email, password_hash, avatar_url, pair_code, role, profile_completed)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
        `).run('Admin', 'SaaS', 30, adminEmail, hashPassword(adminPass), defaultAvatarSvg('Admin SaaS'), 'HIFA-ADMIN', 'admin');
      } else {
        db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(exists.id);
      }
    }
  } catch (err) {
    console.error('Aviso al sembrar admin:', err.message);
  }

  // Seed default system_config from .env if not yet populated
  const isVercel = process.env.VERCEL === '1';
  const defaultMode = isVercel || process.env.NODE_ENV === 'production' ? 'spiderweb' : 'local';
  const setCfgDefault = db.prepare('INSERT OR IGNORE INTO system_config (key, value) VALUES (?, ?)');
  setCfgDefault.run('db_mode', process.env.DB_MODE || defaultMode);
  setCfgDefault.run('storage_mode', process.env.STORAGE_MODE || defaultMode);
  setCfgDefault.run('spiderwebdbname', process.env.spiderwebdbname || 'sw_Franco Calegari_hifaRemote');
  setCfgDefault.run('spiderapikey', process.env.spiderapikey || 'a6ccadadd08b030c1acbe89bbe66c202b6c9658736165072ab3fa5719b3749cf');
  setCfgDefault.run('spidercloudstrogaeid', process.env.spidercloudstrogaeid || '47');
  setCfgDefault.run('spiderweb_api_url', process.env.SPIDERWEB_API_URL || 'https://spiderwebargapi.com.ar/api/v1');
  setCfgDefault.run('ai_provider', process.env.AI_PROVIDER || 'spideria');
  setCfgDefault.run('spider_ai_model', process.env.SPIDER_AI_MODEL || '');
  setCfgDefault.run('spider_ai_apikey', process.env.SPIDER_AI_APIKEY || '');
  setCfgDefault.run('gemini_apikey', process.env.GEMINI_API_KEY || '');
  setCfgDefault.run('gemini_model', process.env.GEMINI_MODEL || ai.DEFAULT_GEMINI_MODEL);
  setCfgDefault.run('setup_completed', isVercel ? '1' : '0');

  // En Vercel no existe almacenamiento local persistente: forzar modo remoto
  if (isVercel) {
    const forceCfg = db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    forceCfg.run('db_mode', 'spiderweb');
    forceCfg.run('storage_mode', 'spiderweb');
  }

  // Seed daily questions if empty
  const qCount = db.prepare('SELECT COUNT(*) as c FROM daily_questions').get().c;
  if (qCount === 0) {
    const questions = [
      '¿Cuál fue tu primer pensamiento cuando nos conocimos?',
      '¿Qué lugar del mundo sueñas con que visitemos juntos?',
      '¿Cuál es tu recuerdo favorito de nosotros hasta ahora?',
      '¿Qué pequeño gesto mío te hace sentir más querido/a en el día a día?',
      'Si tuviéramos un fin de semana libre sin límite de presupuesto, ¿qué haríamos?',
      '¿Qué canción sientes que describe mejor nuestra relación?',
      '¿Cuál es una meta que te gustaría que cumplamos juntos este año?',
      '¿Qué comida prepararías para una cena romántica perfecta en casa?',
      '¿Qué es algo nuevo que te gustaría que aprendamos o probemos en pareja?',
      '¿Qué película o serie podríamos ver mil veces sin cansarnos?'
    ];
    const insQ = db.prepare('INSERT INTO daily_questions (question_text) VALUES (?)');
    for (const q of questions) insQ.run(q);
  }

  // Seed default preloaded weekly plans (couple_id IS NULL)
  const pCount = db.prepare('SELECT COUNT(*) as c FROM weekly_plans WHERE couple_id IS NULL').get().c;
  if (pCount === 0) {
    const defaultPlans = [
      ['Noche de pizzas caseras y maratón de películas', 'Gastronomía', 'Frío / Lluvia'],
      ['Picnic al atardecer en el parque con mate y cosas ricas', 'Aire libre', 'Soleado / Templado'],
      ['Cita sin pantallas: juegos de mesa y charla con vino o postre', 'En casa', 'Cualquiera'],
      ['Salir a conocer una cafetería o heladería nueva del barrio', 'Salida', 'Soleado / Templado'],
      ['Cocinar juntos una receta que nunca hayamos probado', 'Gastronomía', 'Cualquiera'],
      ['Paseo nocturno y mirar las estrellas con música compartida', 'Romántico', 'Despejado'],
      ['Tarde de spa en casa con masajes y mascarillas', 'Relax', 'Frío / Lluvia']
    ];
    const insP = db.prepare('INSERT INTO weekly_plans (couple_id, title, category, weather, source) VALUES (NULL, ?, ?, ?, \'system\')');
    for (const [title, cat, weather] of defaultPlans) insP.run(title, cat, weather);
  }

  function getConfig() {
    const rows = db.prepare('SELECT key, value FROM system_config').all();
    const cfg = {};
    for (const r of rows) cfg[r.key] = r.value;
    return cfg;
  }

  function updateConfig(updates) {
    const stmt = db.prepare('INSERT INTO system_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) stmt.run(k, String(v));
    }
    return getConfig();
  }

  // SpiderWebAPI Adapter (SQL, Storage, SpiderIA)
  async function spiderSqlQuery(query) {
    const cfg = getConfig();
    const apiUrl = cfg.spiderweb_api_url || 'https://spiderwebargapi.com.ar/api/v1';
    const res = await fetch(`${apiUrl}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': cfg.spiderapikey
      },
      body: JSON.stringify({ database: cfg.spiderwebdbname, query })
    });
    return res.json();
  }

  async function spiderListDatabases() {
    const cfg = getConfig();
    const apiUrl = cfg.spiderweb_api_url || 'https://spiderwebargapi.com.ar/api/v1';
    const res = await fetch(`${apiUrl}/databases`, {
      headers: { 'X-API-KEY': cfg.spiderapikey }
    });
    return res.json();
  }

  async function saveUploadFile(filename, buffer, mimeType = 'application/octet-stream') {
    const cfg = getConfig();
    const safeName = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    // Always keep a local copy for fast self-hosted access & resilience
    const localPath = path.join(uploadsDir, safeName);
    fs.writeFileSync(localPath, buffer);
    let fileUrl = `/uploads/${safeName}`;
    let remoteResult = null;

    let remoteFileId = '';
    let remoteUrl = '';

    if (cfg.storage_mode === 'spiderweb' && cfg.spiderapikey && cfg.spidercloudstrogaeid) {
      try {
        const apiUrl = cfg.spiderweb_api_url || 'https://spiderwebargapi.com.ar/api/v1';
        const form = new FormData();
        form.append('files', new Blob([buffer], { type: mimeType }), safeName);
        const resp = await fetch(`${apiUrl}/storage/projects/${cfg.spidercloudstrogaeid}/files`, {
          method: 'POST',
          headers: { 'X-API-KEY': cfg.spiderapikey, 'User-Agent': 'Hifa-SaaS/1.0' },
          body: form
        });
        remoteResult = await resp.json();
        const uploadFile = remoteResult.file || remoteResult.files?.[0];
        if (uploadFile && uploadFile.id) {
          remoteFileId = String(uploadFile.id);
          fileUrl = `/api/storage/remote/${uploadFile.id}?fallback=${encodeURIComponent(fileUrl)}`;
          remoteUrl = fileUrl;
        }
      } catch (err) {
        // Fallback to local URL if remote storage is unreachable
        remoteResult = { error: err.message };
      }
    }

    try {
      db.prepare(`
        INSERT INTO media_assets (local_filename, local_url, remote_file_id, remote_url, mime_type, file_size)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(local_filename) DO UPDATE SET
          remote_file_id = COALESCE(NULLIF(excluded.remote_file_id, ''), media_assets.remote_file_id),
          remote_url = COALESCE(NULLIF(excluded.remote_url, ''), media_assets.remote_url),
          mime_type = excluded.mime_type,
          file_size = excluded.file_size
      `).run(safeName, `/uploads/${safeName}`, remoteFileId, remoteUrl, mimeType, buffer.length);
    } catch (_) {}

    return { url: fileUrl, localUrl: `/uploads/${safeName}`, remote: remoteResult };
  }

  async function generateAiPlans(coupleContext) {
    return ai.generateAiPlans(getConfig(), coupleContext);
  }

  async function listSpiderAiModels(overrides = {}) {
    return ai.listSpiderAiModels(getConfig(), overrides);
  }

  async function testAiConfig(overrides = {}) {
    return ai.testAiConfig(getConfig(), overrides);
  }

  const ctx = {
    db,
    dataDir,
    uploadsDir,
    getConfig,
    updateConfig,
    spiderSqlQuery,
    spiderListDatabases,
    saveUploadFile,
    generateAiPlans,
    listSpiderAiModels,
    testAiConfig,
    syncDbToCloud: () => syncDbToCloud(ctx),
    scheduleDbSync: (delay) => scheduleDbSync(ctx, delay),
    getLastSyncTime
  };

  return ctx;
}

module.exports = { initDb };

