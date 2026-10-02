import { config, isConfiguredSecret } from '../config/index.js';
import { query } from '../db/client.js';
import { getAiModel, isAiConfigured } from '../services/groq.js';
import { getEmailConfig } from '../services/mailer.js';

async function isMlServiceReady() {
  try {
    const response = await fetch(`${config.ml.url.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(Math.min(config.timeoutMs, 3000)) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && (!config.isProduction || health.modelReady === true);
  } catch {
    return false;
  }
}

export default function registerHealthRoutes(app) {
  // Liveness for Render/Docker: the process is up.
  app.get('/healthz', (_request, response) => {
    response.json({ ok: true });
  });

  // Readiness: database, AI, email and ML dependencies.
  app.get('/health', async (_request, response) => {
    try {
      await query('SELECT 1');
      const aiConfigured = isAiConfigured();
      const mlConfigured = isConfiguredSecret(config.ml.key, !config.isProduction);
      const mlServiceReady = !config.isProduction || await isMlServiceReady();
      const ready = !config.isProduction || (aiConfigured && mlConfigured && mlServiceReady);
      response.status(ready ? 200 : 503).json({ ok: ready, database: 'neon', aiConfigured, aiProvider: 'groq', aiModel: getAiModel(), emailConfigured: getEmailConfig().configured, mlConfigured, mlServiceReady, mlServiceUrl: config.ml.url });
    } catch {
      response.status(503).json({ ok: false, database: 'neon' });
    }
  });
}
