const fs = require('node:fs');
const path = require('node:path');

let isSyncing = false;
let syncTimeout = null;
let lastSyncTime = null;

function getCloudConfig(ctx) {
  const cfg = ctx && typeof ctx.getConfig === 'function' ? ctx.getConfig() : {};
  return {
    apiUrl: process.env.SPIDERWEB_API_URL || cfg.spiderweb_api_url || 'https://spiderwebargapi.com.ar/api/v1',
    apiKey: process.env.spiderapikey || cfg.spiderapikey,
    projectId: process.env.spidercloudstrogaeid || cfg.spidercloudstrogaeid,
    enabled:
      process.env.VERCEL === '1' ||
      process.env.CLOUD_SYNC === '1' ||
      cfg.db_mode === 'spiderweb' ||
      cfg.storage_mode === 'spiderweb'
  };
}

/**
 * Restaura la base de datos hifa.db desde SpiderWebAPI Cloud Storage
 * Útil en arranques en frío de Vercel Serverless (o contenedores efímeros).
 */
async function restoreDbFromCloud(customDataDir, options = {}) {
  const { force = false } = options;
  const defaultDataDir = process.env.VERCEL
    ? path.join('/tmp', 'hifa-data')
    : path.join(__dirname, '..', 'data');
  const dataDir = customDataDir || process.env.DATA_DIR || defaultDataDir;
  const dbPath = path.join(dataDir, 'hifa.db');

  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });

  if (!force && fs.existsSync(dbPath)) {
    return { ok: true, source: 'cached' };
  }

  const cloud = {
    apiUrl: process.env.SPIDERWEB_API_URL || 'https://spiderwebargapi.com.ar/api/v1',
    apiKey: process.env.spiderapikey || 'a6ccadadd08b030c1acbe89bbe66c202b6c9658736165072ab3fa5719b3749cf',
    projectId: process.env.spidercloudstrogaeid || '47'
  };

  if (!cloud.apiKey || !cloud.projectId) {
    return { ok: false, reason: 'missing_credentials' };
  }

  try {
    const listResp = await fetch(`${cloud.apiUrl}/storage/projects/${cloud.projectId}/files`, {
      headers: { 'X-API-KEY': cloud.apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    if (!listResp.ok) return { ok: false, reason: 'remote_fetch_failed' };
    const listJson = await listResp.json();
    const files = listJson.files || [];

    const dbFiles = files.filter(f => f.original_name === 'hifa_production.db' || f.original_name === 'hifa.db');
    if (dbFiles.length === 0) {
      return { ok: true, source: 'fresh_init' };
    }

    dbFiles.sort((a, b) => (b.id || 0) - (a.id || 0));
    const targetFile = dbFiles[0];

    const fileUrl =
      targetFile.url && targetFile.url.startsWith('https://')
        ? targetFile.url
        : `${cloud.apiUrl}/storage/files/${targetFile.id}`;
    const downResp = await fetch(fileUrl, {
      headers: { 'X-API-KEY': cloud.apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
      signal: AbortSignal.timeout(10000)
    });
    if (!downResp.ok) return { ok: false, reason: 'download_failed' };
    const buf = Buffer.from(await downResp.arrayBuffer());

    if (buf.length >= 16 && buf.subarray(0, 15).toString() === 'SQLite format 3') {
      try { fs.unlinkSync(`${dbPath}-wal`); } catch (_) {}
      try { fs.unlinkSync(`${dbPath}-shm`); } catch (_) {}
      fs.writeFileSync(dbPath, buf);
      console.log(`[Hifa Cloud Sync] Base de datos restaurada desde Cloud Storage (archivo #${targetFile.id}, ${buf.length} bytes)`);
      return { ok: true, source: 'restored', fileId: targetFile.id };
    }
  } catch (err) {
    console.error('[Hifa Cloud Sync] Aviso al restaurar DB remota:', err.message);
  }

  return { ok: false, reason: 'error_or_empty' };
}

/**
 * Realiza checkpoint de WAL y sube una copia completa de hifa.db a SpiderWebAPI Cloud Storage.
 */
async function syncDbToCloud(ctx) {
  if (isSyncing) return { ok: false, reason: 'already_syncing' };
  isSyncing = true;

  try {
    const cloud = getCloudConfig(ctx);
    if (!cloud.apiKey || !cloud.projectId) {
      isSyncing = false;
      return { ok: false, reason: 'missing_credentials' };
    }

    const dbPath = path.join(ctx.dataDir, 'hifa.db');
    if (!fs.existsSync(dbPath)) {
      isSyncing = false;
      return { ok: false, reason: 'no_db_file' };
    }

    try {
      ctx.db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (_) {}

    const buf = fs.readFileSync(dbPath);
    if (!buf || buf.length === 0) {
      isSyncing = false;
      return { ok: false, reason: 'empty_db' };
    }

    const form = new FormData();
    form.append('files', new Blob([buf], { type: 'application/x-sqlite3' }), 'hifa_production.db');

    const uploadResp = await fetch(`${cloud.apiUrl}/storage/projects/${cloud.projectId}/files`, {
      method: 'POST',
      headers: { 'X-API-KEY': cloud.apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
      body: form,
      signal: AbortSignal.timeout(10000)
    });

    const upJson = await uploadResp.json();
    if (!upJson.success) {
      isSyncing = false;
      return { ok: false, error: upJson.error || 'upload_failed' };
    }

    const newFile = upJson.files?.[0] || upJson.file;
    const newFileId = newFile?.id;
    lastSyncTime = new Date().toISOString();

    // Limpiar backups anteriores de hifa_production.db
    if (newFileId) {
      try {
        const listResp = await fetch(`${cloud.apiUrl}/storage/projects/${cloud.projectId}/files`, {
          headers: { 'X-API-KEY': cloud.apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
          signal: AbortSignal.timeout(5000)
        });
        const listJson = await listResp.json();
        const oldFiles = (listJson.files || []).filter(
          f => (f.original_name === 'hifa_production.db' || f.original_name === 'hifa.db') && f.id !== newFileId
        );
        for (const old of oldFiles) {
          await fetch(`${cloud.apiUrl}/storage/files/${old.id}`, {
            method: 'DELETE',
            headers: { 'X-API-KEY': cloud.apiKey, 'User-Agent': 'Hifa-SaaS/1.0' },
            signal: AbortSignal.timeout(5000)
          }).catch(() => {});
        }
      } catch (_) {}
    }

    return { ok: true, fileId: newFileId, size: buf.length, timestamp: lastSyncTime };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    isSyncing = false;
  }
}

/**
 * Programa una sincronización diferida (debounce) tras operaciones de escritura
 */
function scheduleDbSync(ctx, delayMs = 2500) {
  const cloud = getCloudConfig(ctx);
  if (!cloud.enabled) return;

  if (syncTimeout) clearTimeout(syncTimeout);
  if (delayMs <= 0) {
    syncDbToCloud(ctx).catch(err => {
      console.error('[Hifa Cloud Sync] Error en sync directo:', err.message);
    });
    return;
  }
  syncTimeout = setTimeout(() => {
    syncDbToCloud(ctx).catch(err => {
      console.error('[Hifa Cloud Sync] Error en sync diferido:', err.message);
    });
  }, delayMs);
}

module.exports = {
  restoreDbFromCloud,
  syncDbToCloud,
  scheduleDbSync,
  getLastSyncTime: () => lastSyncTime
};

