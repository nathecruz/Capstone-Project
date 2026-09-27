import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDatabase, query, withTransaction } from '../db/client.js';
import { seedCatalog } from '../db/seed-data.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(scriptDirectory, '..', 'db', 'schema.sql');

try {
  const schema = await readFile(schemaPath, 'utf8');
  await withTransaction((connection) => connection.query(schema));
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT ''");
  const appStateId = await query(`
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user_app_state' AND column_name = 'id'
  `);
  if (appStateId.rows.length === 0) {
    await withTransaction(async (connection) => {
      await connection.query('DROP INDEX IF EXISTS user_app_state_user_updated_idx');
      await connection.query('ALTER TABLE user_app_state RENAME TO user_app_state_legacy');
      await connection.query(`
        CREATE TABLE user_app_state (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          state_json JSONB NOT NULL,
          updated_at BIGINT NOT NULL
        )
      `);
      await connection.query('INSERT INTO user_app_state(id,user_id,state_json,updated_at) SELECT gen_random_uuid(),user_id,state_json,updated_at FROM user_app_state_legacy');
      await connection.query('DROP TABLE user_app_state_legacy');
      await connection.query('CREATE INDEX user_app_state_user_updated_idx ON user_app_state(user_id, updated_at DESC)');
    });
  }
  await query('ALTER TABLE login_activity ADD COLUMN IF NOT EXISTS login_date_time TIMESTAMPTZ');
  await query('UPDATE login_activity SET login_date_time = to_timestamp(created_at / 1000.0) WHERE login_date_time IS NULL');
  await query('ALTER TABLE login_activity ALTER COLUMN login_date_time SET DEFAULT CURRENT_TIMESTAMP');
  await query('ALTER TABLE login_activity ALTER COLUMN login_date_time SET NOT NULL');
  await withTransaction(seedCatalog);
  const result = await query(`
    SELECT table_name AS name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  console.log(`Neon schema ready: ${result.rows.map((row) => row.name).join(', ')}`);
  const catalogs = await query(`
    SELECT
      (SELECT COUNT(*)::integer FROM achievements) AS achievements,
      (SELECT COUNT(*)::integer FROM rewards) AS rewards
  `);
  console.log(`Catalog rows ready: ${catalogs.rows[0].achievements} achievements, ${catalogs.rows[0].rewards} rewards`);
} finally {
  await closeDatabase();
}
