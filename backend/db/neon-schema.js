// Idempotent Neon schema setup, shared by the API start-up and `npm run db:migrate:neon`.
import { readFile } from 'node:fs/promises';
import { query, withTransaction } from './client.js';
import { seedCatalog } from './seed-data.js';
import { retireRewards } from '../services/rewards.js';
import { splitFullName } from '../lib/names.js';
import { backfillActivityFromSnapshots } from '../services/activity.js';

/** Runs a data migration exactly once per database, recorded in app_migrations. */
async function runOnce(name, migration) {
  const claimed = await query('INSERT INTO app_migrations(name, applied_at) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING name', [name, Date.now()]);
  if (!claimed.rowCount) return false;
  try {
    await migration();
    return true;
  } catch (error) {
    await query('DELETE FROM app_migrations WHERE name = $1', [name]);
    throw error;
  }
}

export async function ensureNeonSchema({ log = () => {} } = {}) {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await withTransaction((connection) => connection.query(schema));
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS region TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS about TEXT NOT NULL DEFAULT ''");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT');
  // Managed from the HabitAI Admin Panel: role (user/faculty/admin) and account status (active/deactivated).
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_at BIGINT');
  // First and last name are stored separately; full_name stays as "First Last".
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''");
  // The Custom Title reward; rewards can be retired (kept for old redemptions, no longer sold).
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_title TEXT NOT NULL DEFAULT ''");
  // Habit Buddy rooms (backgrounds bought with tokens).
  await query("ALTER TABLE user_buddy ADD COLUMN IF NOT EXISTS room_item TEXT NOT NULL DEFAULT ''");
  await query('ALTER TABLE rewards ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE');

  const appStateId = await query(`
    SELECT 1 FROM information_schema.columns
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
  await query("DELETE FROM notifications WHERE type='habit-reminder' AND body LIKE 'Reminder set for %'");
  await withTransaction(seedCatalog);

  // Accounts created before email verification existed are treated as verified (once only).
  // Token rewards that did nothing are retired and refunded; Premium Themes and Custom Title now work.
  await runOnce('token-rewards-real-2026-10', () => withTransaction((connection) => retireRewards(connection)));
  await runOnce('email-verification-backfill', () => query('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL'));

  // Accounts created with a single full name get a first and last name once; students can correct them in the app.
  await runOnce('split-full-names', async () => {
    const accounts = await query("SELECT id, full_name AS \"fullName\" FROM users WHERE first_name = '' AND last_name = ''");
    for (const account of accounts.rows) {
      const { firstName, lastName } = splitFullName(account.fullName);
      await query('UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3', [firstName, lastName, account.id]);
    }
  });

  // Keep day-level engagement history before services/maintenance.js trims old snapshots.
  await backfillActivityFromSnapshots();
}
