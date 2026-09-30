// Entry point for `npm start` / Render. The API runs on Neon PostgreSQL only
// (the old single-file SQLite server was removed so every fix lives in one place).
import { isTemplateValue, loadEnvironment } from './config/env.js';

loadEnvironment();

if (!process.env.DATABASE_URL?.trim() || isTemplateValue(process.env.DATABASE_URL)) {
  console.error('DATABASE_URL is not set. Put your Neon connection string in backend/.env or the root .env (see backend/.env.example).');
  process.exit(1);
}

await import('./server-neon.js');
