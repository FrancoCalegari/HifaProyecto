const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { initDb } = require('./db');
const { sendJson, readBody } = require('./lib/http');
const { getAuthUser } = require('./lib/auth');
const { MIME_TYPES } = require('./lib/helpers');
const { createCoupleHelpers } = require('./lib/couple');

// Rutas públicas (sin autenticación), en orden.
const publicRoutes = [require('./routes/setup'), require('./routes/auth')];

// Rutas de administración (requieren rol admin, sin necesidad de pareja)
const adminRoutes = [require('./routes/admin')];

// Rutas autenticadas que no requieren pareja vinculada.
const userRoutes = [require('./routes/me')];

// Rutas autenticadas que requieren couple_id.
const coupleRoutes = [
  require('./routes/profile'),
  require('./routes/dashboard'),
  require('./routes/economy'),
  require('./routes/tasks'),
  require('./routes/lists'),
  require('./routes/calendar'),
  require('./routes/tools'),
  require('./routes/cycle'),
  require('./routes/notes'),
  require('./routes/daily'),
  require('./routes/cravings'),
  require('./routes/capsules'),
  require('./routes/goals'),
  require('./routes/notebooks')
];

async function runRoutes(routes, c) {
  for (const handle of routes) {
    if (await handle(c)) return true;
  }
  return false;
}

async function handleApi(c) {
  if (await runRoutes(publicRoutes, c)) return;

  // Require authentication for all following routes
  const auth = getAuthUser(c.db, c.req);
  if (!auth) return c.send(401, { error: 'No autenticado' });
  c.user = auth.user;

  if (await runRoutes(adminRoutes, c)) return;

  if (await runRoutes(userRoutes, c)) return;

  // Guard: Following routes require couple_id
  if (!c.user.couple_id) {
    return c.send(400, { error: 'Primero debes vincularte con tu pareja.' });
  }
  c.coupleId = c.user.couple_id;
  c.partner = c.getPartner(c.user);

  if (await runRoutes(coupleRoutes, c)) return;

  return c.send(404, { error: 'Endpoint no encontrado' });
}

function createApp(customDataDir) {
  const ctx = initDb(customDataDir);
  const { db, uploadsDir } = ctx;
  const { notifyPartner, getPartner, ensureMonthlyRecoveryReset } = createCoupleHelpers(db);

  const handler = async (req, res) => {
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
        });
        return res.end();
      }

      const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const pathname = urlObj.searchParams.get('__route') || urlObj.pathname;

      // Detectar operaciones de mutación para sincronizar con la nube si aplica
      const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
      if (isMutation && ctx.scheduleDbSync) {
        res.on('finish', () => {
          if (!ctx._closed && res.statusCode >= 200 && res.statusCode < 400) {
            ctx.scheduleDbSync(process.env.VERCEL ? 300 : 2500);
          }
        });
      }

      // Serve uploaded files
      if (pathname.startsWith('/uploads/') && req.method === 'GET') {
        const fileName = path.basename(pathname);
        const filePath = path.join(uploadsDir, fileName);
        if (!fs.existsSync(filePath)) {
          res.writeHead(404);
          return res.end('Not found');
        }
        const ext = path.extname(fileName).toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        return fs.createReadStream(filePath).pipe(res);
      }

      // API Routes (also aliased under /api/v1/* for mobile app compatibility)
      const apiPath = pathname.startsWith('/api/v1/')
        ? '/api/' + pathname.slice('/api/v1/'.length)
        : pathname;

      if (apiPath.startsWith('/api/')) {
        return await handleApi({
          req,
          res,
          apiPath,
          urlObj,
          ctx,
          db,
          user: null,
          partner: null,
          coupleId: null,
          body: () => readBody(req),
          send: (status, data, headers) => (sendJson(res, status, data, headers), true),
          notifyPartner,
          getPartner,
          ensureMonthlyRecoveryReset
        });
      }

      // Serve Static Frontend from ./public
      const publicDir = path.join(__dirname, 'public');
      let safeRel = pathname === '/' || pathname === '/admin' ? 'index.html' : pathname.replace(/^\/+/, '');
      let filePath = path.join(publicDir, safeRel);
      if (!filePath.startsWith(publicDir) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        filePath = path.join(publicDir, 'index.html');
      }
      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      fs.createReadStream(filePath).pipe(res);
    } catch (err) {
      sendJson(res, 500, { error: err.message || 'Error interno del servidor' });
    }
  };

  const server = http.createServer(handler);

  return { server, handler, ctx };
}

let defaultInstance = null;
let defaultPromise = null;
let reloadPromise = null;

function getDefaultDataDir() {
  return process.env.DATA_DIR || (process.env.VERCEL ? path.join('/tmp', 'hifa-data') : undefined);
}

async function reloadDefaultAppFromCloud() {
  if (reloadPromise) return reloadPromise;
  reloadPromise = (async () => {
    try {
      const dataDir = getDefaultDataDir();
      if (defaultInstance && defaultInstance.ctx) {
        defaultInstance.ctx._closed = true;
        try { defaultInstance.ctx.db.close(); } catch (_) {}
      }
      const { restoreDbFromCloud } = require('./lib/cloud-sync');
      await restoreDbFromCloud(dataDir, { force: true });
      const app = createApp(dataDir);
      app.ctx.reloadFromCloud = reloadDefaultAppFromCloud;
      defaultInstance = app;
      return app;
    } finally {
      reloadPromise = null;
    }
  })();
  return reloadPromise;
}

async function getDefaultApp() {
  if (defaultInstance) return defaultInstance;
  if (!defaultPromise) {
    defaultPromise = (async () => {
      const dataDir = getDefaultDataDir();
      if (process.env.VERCEL || process.env.CLOUD_SYNC === '1') {
        const { restoreDbFromCloud } = require('./lib/cloud-sync');
        await restoreDbFromCloud(dataDir);
      }
      const app = createApp(dataDir);
      app.ctx.reloadFromCloud = reloadDefaultAppFromCloud;
      defaultInstance = app;
      return defaultInstance;
    })();
  }
  return defaultPromise;
}

const defaultHandler = async (req, res) => {
  const app = await getDefaultApp();
  return app.handler(req, res);
};

defaultHandler.createApp = createApp;
defaultHandler.getDefaultApp = getDefaultApp;

if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  const { server } = createApp();
  server.listen(port, () => {
    console.log(`Hifa SaaS ejecutándose en http://localhost:${port}`);
  });
}

module.exports = defaultHandler;
module.exports.default = defaultHandler;
module.exports.createApp = createApp;
