import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

const sourcePath = process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'habitai.sqlite');
const backupDirectory = process.env.BACKUP_DIR || path.join(path.dirname(sourcePath), 'backups');
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const destinationPath = path.join(backupDirectory, `habitai-${timestamp}.sqlite`);

mkdirSync(backupDirectory, { recursive: true });
const database = new Database(sourcePath, { readonly: true });
try {
  await database.backup(destinationPath);
  console.log(`Database backup created at ${destinationPath}`);
} finally {
  database.close();
}
