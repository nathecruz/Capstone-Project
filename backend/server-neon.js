// Production API (Neon PostgreSQL). server.js loads this when DATABASE_URL is set.
//
//   config/     environment loading and validation
//   db/         connection pool, schema setup, catalog seeds
//   http/       Express app assembly and rate limits
//   routes/     one module per API area (auth, password reset, app state, habits, AI, ...)
//   services/   business logic shared by the routes (accounts, mail, AI prompts, app-state store)
//
// See ARCHITECTURE.md in the repository root for diagrams of the system and its data flows.
import { assertProductionConfig, config } from './config/index.js';
import { closeDatabase, query } from './db/client.js';
import { ensureNeonSchema } from './db/neon-schema.js';
import { createApp } from './http/app.js';
import { verifyAi } from './services/groq.js';
import { verifyMailer } from './services/mailer.js';
import { scheduleMaintenance } from './services/maintenance.js';
import { startReminderClock, stopReminderClock } from './services/web-push-clock.js';

assertProductionConfig();
await ensureNeonSchema({ log: console.log });
void verifyMailer();
void verifyAi();
const maintenance = scheduleMaintenance();

const server = createApp().listen(config.port, '0.0.0.0', () => console.log(`Neon Insights API listening on http://0.0.0.0:${config.port}`));
// Keep idle connections open longer than the hosting proxy does (Node closes them after 5 s), or the
// proxy can reuse one just as Node closes it and answer a 502 — a sign-in that fails for no reason.
server.keepAliveTimeout = 120_000;
server.headersTimeout = 125_000;
// Habit reminders on their exact minute while the API is awake (GitHub Actions covers the rest).
if (startReminderClock({ query })) console.log('Reminder clock on: Web Push reminders are sent on their minute while the API is awake.');

// Free Render instances sleep when idle. This API starts when a student opens the app, so it
// wakes the ML service too; its forecast is then ready by the time Insights asks for it.
if (config.ml.key) {
  fetch(`${config.ml.url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(120000) }).catch(() => {});
}

async function shutdown() {
  clearInterval(maintenance);
  stopReminderClock();
  // Stop taking requests, let the ones in progress finish (at most 10 s), and close each kept-alive
  // connection as soon as it is idle: with the long keep-alive above, a connection busy at shutdown
  // would otherwise keep serving requests after the database pool below is closed.
  const closed = new Promise((resolve) => server.close(resolve));
  server.closeIdleConnections();
  const sweep = setInterval(() => server.closeIdleConnections(), 500);
  let timeout;
  await Promise.race([closed, new Promise((resolve) => { timeout = setTimeout(resolve, 10_000); })]);
  clearTimeout(timeout);
  clearInterval(sweep);
  server.closeAllConnections();
  await closeDatabase();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
