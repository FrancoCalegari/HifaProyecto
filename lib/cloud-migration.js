const fs = require('node:fs');
const path = require('node:path');
const { syncDbToCloud } = require('./cloud-sync');

function getBackupsDir(ctx) {
  const dir = path.join(ctx.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Crea un respaldo local de hifa.db en data/backups/
 */
function createLocalBackup(ctx, label = 'manual') {
  const backupsDir = getBackupsDir(ctx);
  const dbPath = path.join(ctx.dataDir, 'hifa.db');
  if (!fs.existsSync(dbPath)) {
    throw new Error('No se encontró la base de datos local para respaldar.');
  }

  try {
    ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch (_) {}

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safeLabel = String(label || 'manual').replace(/[^a-zA-Z0-9_-]/g, '');
  const filename = `hifa-backup-${safeLabel}-${stamp}.db`;
  const targetPath = path.join(backupsDir, filename);

  fs.copyFileSync(dbPath, targetPath);
  const stat = fs.statSync(targetPath);

  return {
    filename,
    path: targetPath,
    size: stat.size,
    createdAt: new Date().toISOString()
  };
}

/**
 * Lista los respaldos locales disponibles en data/backups/
 */
function listLocalBackups(ctx) {
  const backupsDir = getBackupsDir(ctx);
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter(f => f.endsWith('.db'))
    .map(f => {
      const st = fs.statSync(path.join(backupsDir, f));
      return {
        filename: f,
        size: st.size,
        createdAt: st.mtime.toISOString()
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * Restaura un respaldo local hacia la base de datos activa (hifa.db)
 * creando primero un respaldo de seguridad del estado actual.
 */
function restoreLocalBackup(ctx, filename) {
  const safeName = path.basename(String(filename || ''));
  const backupsDir = getBackupsDir(ctx);
  const backupPath = path.join(backupsDir, safeName);

  if (!safeName.endsWith('.db') || !fs.existsSync(backupPath)) {
    throw new Error('Archivo de respaldo local no encontrado.');
  }

  const head = Buffer.alloc(16);
  const fd = fs.openSync(backupPath, 'r');
  fs.readSync(fd, head, 0, 16, 0);
  fs.closeSync(fd);
  if (head.subarray(0, 15).toString() !== 'SQLite format 3') {
    throw new Error('El archivo seleccionado no es una base de datos SQLite válida.');
  }

  // Respaldar estado actual antes de restaurar
  const safety = createLocalBackup(ctx, 'pre-restore');

  const escapedPath = backupPath.replace(/'/g, "''");
  ctx.db.exec(`ATTACH DATABASE '${escapedPath}' AS bak;`);
  try {
    const tables = ctx.db
      .prepare("SELECT name FROM bak.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(r => r.name);

    ctx.db.exec('PRAGMA foreign_keys = OFF; BEGIN TRANSACTION;');
    for (const table of tables) {
      const existsLocal = ctx.db
        .prepare("SELECT name FROM main.sqlite_master WHERE type='table' AND name = ?")
        .get(table);
      if (!existsLocal) continue;

      const localCols = ctx.db.prepare(`PRAGMA main.table_info("${table}")`).all().map(c => c.name);
      const bakCols = ctx.db.prepare(`PRAGMA bak.table_info("${table}")`).all().map(c => c.name);
      const commonCols = localCols.filter(c => bakCols.includes(c));
      if (commonCols.length === 0) continue;

      const colsList = commonCols.map(c => `"${c}"`).join(', ');
      ctx.db.exec(`DELETE FROM main."${table}";`);
      ctx.db.exec(`INSERT INTO main."${table}" (${colsList}) SELECT ${colsList} FROM bak."${table}";`);
    }
    ctx.db.exec('COMMIT; PRAGMA foreign_keys = ON;');
  } catch (err) {
    try { ctx.db.exec('ROLLBACK; PRAGMA foreign_keys = ON;'); } catch (_) {}
    throw err;
  } finally {
    try { ctx.db.exec('DETACH DATABASE bak;'); } catch (_) {}
  }

  return { ok: true, restoredFrom: safeName, safetyBackup: safety.filename };
}

function escapeMysqlValue(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL';
  if (typeof val === 'boolean') return val ? '1' : '0';
  if (Buffer.isBuffer(val)) return `X'${val.toString('hex')}'`;
  return (
    "'" +
    String(val)
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\0/g, '\\0')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r') +
    "'"
  );
}

/**
 * Convierte el esquema de una tabla SQLite a MySQL (SpiderWebAPI SQL)
 */
function buildMysqlCreateTable(db, tableName) {
  const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all();
  const indexes = db.prepare(`PRAGMA index_list("${tableName}")`).all();

  const uniqueColSets = [];
  const indexedCols = new Set();
  for (const idx of indexes) {
    if (!idx.unique) continue;
    const idxCols = db.prepare(`PRAGMA index_info("${idx.name}")`).all().map(c => c.name);
    if (idxCols.length > 0) {
      uniqueColSets.push(idxCols);
      idxCols.forEach(c => indexedCols.add(c));
    }
  }

  const pkCols = cols.filter(c => c.pk > 0);
  pkCols.forEach(c => indexedCols.add(c.name));

  const defs = [];
  for (const col of cols) {
    const colType = String(col.type || 'TEXT').toUpperCase();
    const isSingleIntPk = pkCols.length === 1 && col.pk === 1 && colType === 'INTEGER';

    if (isSingleIntPk) {
      defs.push(`\`${col.name}\` INT AUTO_INCREMENT PRIMARY KEY`);
      continue;
    }

    let mysqlType = 'LONGTEXT';
    if (colType === 'INTEGER') mysqlType = 'BIGINT';
    else if (colType === 'REAL') mysqlType = 'DOUBLE';
    else if (indexedCols.has(col.name)) mysqlType = 'VARCHAR(255)';

    const nullable = col.notnull ? ' NOT NULL' : '';
    defs.push(`\`${col.name}\` ${mysqlType}${nullable}`);
  }

  if (pkCols.length > 1 || (pkCols.length === 1 && String(pkCols[0].type || '').toUpperCase() !== 'INTEGER')) {
    const pkList = pkCols.map(c => `\`${c.name}\``).join(', ');
    defs.push(`PRIMARY KEY (${pkList})`);
  }

  uniqueColSets.forEach((colSet, i) => {
    // Evitar duplicar si coincide exactamente con PK simple
    if (colSet.length === 1 && pkCols.length === 1 && colSet[0] === pkCols[0].name) return;
    const colsSql = colSet.map(c => `\`${c}\``).join(', ');
    defs.push(`UNIQUE KEY \`uq_${tableName}_${i}\` (${colsSql})`);
  });

  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (${defs.join(', ')}) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`;
}

/**
 * Migra los archivos locales de data/uploads/ hacia SpiderWebAPI Cloud Storage
 */
async function migrateLocalUploadsToSpiderWeb(ctx) {
  const cfg = ctx.getConfig();
  const apiUrl = cfg.spiderweb_api_url || process.env.SPIDERWEB_API_URL || 'https://spiderwebargapi.com.ar/api/v1';
  const apiKey = cfg.spiderapikey || process.env.spiderapikey;
  const projectId = cfg.spidercloudstrogaeid || process.env.spidercloudstrogaeid;

  if (!apiKey || !projectId) {
    return { filesMigrated: 0, skipped: true, reason: 'Sin credenciales de Spider Cloud Storage' };
  }

  if (!fs.existsSync(ctx.uploadsDir)) {
    return { filesMigrated: 0 };
  }

  const localFiles = fs.readdirSync(ctx.uploadsDir).filter(f => !f.startsWith('.'));
  let filesMigrated = 0;
  const urlMapping = new Map();
  const errors = [];

  for (const fileName of localFiles) {
    const fullPath = path.join(ctx.uploadsDir, fileName);
    if (!fs.statSync(fullPath).isFile()) continue;

    try {
      const buf = fs.readFileSync(fullPath);
      const form = new FormData();
      form.append('files', new Blob([buf]), fileName);

      const resp = await fetch(`${apiUrl}/storage/projects/${projectId}/files`, {
        method: 'POST',
        headers: { 'X-API-KEY': apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
        body: form,
        signal: AbortSignal.timeout(15000)
      });
      const json = await resp.json();
      const uploaded = json.file || json.files?.[0];
      if (uploaded && uploaded.id) {
        filesMigrated++;
        urlMapping.set(`/uploads/${fileName}`, `/api/storage/remote/${uploaded.id}?fallback=${encodeURIComponent(`/uploads/${fileName}`)}`);
      }
    } catch (err) {
      errors.push(`Archivo ${fileName}: ${err.message}`);
    }
  }

  // Actualizar referencias /uploads/... en columnas de URL manteniendo fallback local
  if (urlMapping.size > 0) {
    const targets = [
      ['users', 'avatar_url'],
      ['shared_notes', 'photo_url'],
      ['cravings', 'photo_url'],
      ['time_capsules', 'photo_url']
    ];
    for (const [table, col] of targets) {
      for (const [oldUrl, newUrl] of urlMapping.entries()) {
        try {
          ctx.db.prepare(`UPDATE "${table}" SET "${col}" = ? WHERE "${col}" = ?`).run(newUrl, oldUrl);
        } catch (_) {}
      }
    }
  }

  return { filesMigrated, errors };
}

/**
 * Migra toda la base de datos local SQLite a SpiderWebAPI SQL + Cloud Storage,
 * crea un respaldo local previo, activa el modo remoto ('spiderweb') y sincroniza el snapshot.
 */
async function migrateLocalToSpiderWeb(ctx) {
  const cfg = ctx.getConfig();
  const apiUrl = cfg.spiderweb_api_url || process.env.SPIDERWEB_API_URL || 'https://spiderwebargapi.com.ar/api/v1';
  const apiKey = cfg.spiderapikey || process.env.spiderapikey;
  const dbName = cfg.spiderwebdbname || process.env.spiderwebdbname;

  if (!apiKey || !dbName) {
    throw new Error('Faltan credenciales de SpiderWebAPI (spiderapikey y spiderwebdbname).');
  }

  // 1. Verificar conexión con SpiderWebAPI SQL
  const ping = await ctx.spiderSqlQuery('SELECT 1 AS ok');
  if (!ping || ping.success === false) {
    throw new Error(ping?.error || 'No se pudo conectar con la base de datos remota SpiderWebAPI.');
  }

  // 2. Crear respaldo local obligatorio antes de migrar
  const backup = createLocalBackup(ctx, 'pre-spiderweb');

  // 3. Migrar archivos locales de /uploads a Spider Cloud Storage (dejando locales como respaldo)
  const uploadsResult = await migrateLocalUploadsToSpiderWeb(ctx);

  // 4. Migrar tablas y filas hacia SpiderWebAPI SQL
  const tables = ctx.db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC")
    .all()
    .map(r => r.name);

  let tablesMigrated = 0;
  let rowsMigrated = 0;
  const errors = [...(uploadsResult.errors || [])];

  for (const table of tables) {
    try {
      const ddl = buildMysqlCreateTable(ctx.db, table);
      const ddlRes = await ctx.spiderSqlQuery(ddl);
      if (ddlRes && ddlRes.success === false) {
        errors.push(`Tabla ${table} (DDL): ${ddlRes.error}`);
        continue;
      }

      const rows = ctx.db.prepare(`SELECT * FROM "${table}"`).all();
      tablesMigrated++;

      if (rows.length === 0) continue;

      const colNames = Object.keys(rows[0]);
      const colsSql = colNames.map(c => `\`${c}\``).join(', ');

      // Insertar en lotes respetando tamaño máximo de payload
      let batch = [];
      let batchBytes = 0;

      const flushBatch = async () => {
        if (batch.length === 0) return;
        const sql = `REPLACE INTO \`${table}\` (${colsSql}) VALUES ${batch.join(', ')}`;
        const insRes = await ctx.spiderSqlQuery(sql);
        if (insRes && insRes.success === false) {
          errors.push(`Tabla ${table} (INSERT): ${insRes.error}`);
        } else {
          rowsMigrated += batch.length;
        }
        batch = [];
        batchBytes = 0;
      };

      for (const row of rows) {
        const vals = colNames.map(c => escapeMysqlValue(row[c])).join(', ');
        const tuple = `(${vals})`;
        if (batch.length >= 25 || (batch.length > 0 && batchBytes + tuple.length > 150000)) {
          await flushBatch();
        }
        batch.push(tuple);
        batchBytes += tuple.length;
      }
      await flushBatch();
    } catch (err) {
      errors.push(`Tabla ${table}: ${err.message}`);
    }
  }

  // 5. Activar modo remoto y guardar referencia del backup local
  const updatedConfig = ctx.updateConfig({
    db_mode: 'spiderweb',
    storage_mode: cfg.spidercloudstrogaeid ? 'spiderweb' : cfg.storage_mode || 'local',
    last_migration_at: new Date().toISOString(),
    last_local_backup: backup.filename,
    setup_completed: '1'
  });

  // 6. Sincronizar también el snapshot SQLite completo en Spider Cloud Storage
  const cloudSnapshot = await syncDbToCloud(ctx);

  return {
    ok: true,
    backup,
    tablesMigrated,
    rowsMigrated,
    filesMigrated: uploadsResult.filesMigrated || 0,
    cloudSnapshot,
    config: updatedConfig,
    errors
  };
}

module.exports = {
  createLocalBackup,
  listLocalBackups,
  restoreLocalBackup,
  migrateLocalToSpiderWeb
};

