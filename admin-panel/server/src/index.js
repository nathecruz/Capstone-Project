import { assertConfig, config } from './config.js';
import { closePool, query } from './db.js';
import { migrate } from './db/migrate.js';
import { createApp } from './app.js';

assertConfig();
await migrate();

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`[admin] HabitAI Admin Panel API listening on http://localhost:${config.port}`);
});
server.on('error', async (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[admin] Port ${config.port} is already in use. Another copy of the Admin Panel is probably still running; stop it (or set API_PORT in server/.env) and try again.`);
  } else {
    console.error('[admin] Server error:', error);
  }
  await closePool();
  process.exit(1);
});

// Hourly cleanup of expired admin sessions.
const cleanup = setInterval(() => {
  query('DELETE FROM admin_sessions WHERE expires_at <= $1', [Date.now()]).catch(() => {});
}, 60 * 60 * 1000);
cleanup.unref();

async function shutdown(signal) {
  console.log(`[admin] ${signal} received, shutting down`);
  server.close();
  await closePool();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
