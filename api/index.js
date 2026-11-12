// api/index.js - Entry point para Vercel Serverless Functions
const path = require('node:path');
const { createApp } = require('../server');
const { restoreDbFromCloud } = require('../lib/cloud-sync');

let appInstance = null;
let initPromise = null;

async function getApp() {
  if (appInstance) return appInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const dataDir = process.env.DATA_DIR || path.join('/tmp', 'hifa-data');
      // En arranque en frío, restaurar el último snapshot de hifa.db desde Cloud Storage si existe
      await restoreDbFromCloud(dataDir);
      appInstance = createApp(dataDir);
      return appInstance;
    })();
  }
  return initPromise;
}

module.exports = async (req, res) => {
  const app = await getApp();
  return app.handler(req, res);
};

