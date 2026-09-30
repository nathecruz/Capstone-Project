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
import { verifyMailer } from './services/mailer.js';
import { scheduleMaintenance } from './services/maintenance.js';

assertProductionConfig();
await ensureNeonSchema({ log: console.log });
void verifyMailer();
const maintenance = scheduleMaintenance();

const server = createApp().listen(config.port, '0.0.0.0', () => console.log(`Neon Insights API listening on http://0.0.0.0:${config.port}`));

async function shutdown() {
  clearInterval(maintenance);
  server.close();
  await closeDatabase();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
