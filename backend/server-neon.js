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
import { closeDatabase } from './db/client.js';
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
// Habit reminders on their exact minute while the API is awake (GitHub Actions covers the rest).
if (startReminderClock()) console.log('Reminder clock on: Web Push reminders are sent on their minute while the API is awake.');

// Free Render instances sleep when idle. This API starts when a student opens the app, so it
// wakes the ML service too; its forecast is then ready by the time Insights asks for it.
if (config.ml.key) {
  fetch(`${config.ml.url.replace(/\/$/, '')}/healthz`, { signal: AbortSignal.timeout(120000) }).catch(() => {});
}

async function shutdown() {
  clearInterval(maintenance);
  stopReminderClock();
  server.close();
  await closeDatabase();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
