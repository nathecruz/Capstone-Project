// Exports every table of the HabitAI database to one JSON file (no pg_dump needed).
// Usage: npm run backup            -> backend/data/backups/habitai-<timestamp>.json
// Neon also keeps point-in-time history; this file is an extra, portable copy.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import '../config/index.js';
import { closeDatabase, query } from '../db/client.js';

const backupDirectory = path.resolve(process.env.BACKUP_DIR || path.join(process.cwd(), 'data', 'backups'));
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destination = path.join(backupDirectory, `habitai-${timestamp}.json`);

try {
  mkdirSync(backupDirectory, { recursive: true });
  const tables = await query(`SELECT table_name AS name FROM information_schema.tables
    WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const backup = { createdAt: new Date().toISOString(), tables: {} };
  for (const { name } of tables.rows) {
    const rows = await query(`SELECT * FROM "${name.replace(/"/g, '""')}"`);
    backup.tables[name] = rows.rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Buffer.isBuffer(value) ? { base64: value.toString('base64') } : value])));
  }
  writeFileSync(destination, JSON.stringify(backup));
  const total = Object.values(backup.tables).reduce((sum, rows) => sum + rows.length, 0);
  console.log(`Backup written to ${destination} (${tables.rowCount} tables, ${total} rows). It contains personal data: store it securely.`);
} finally {
  await closeDatabase();
}
