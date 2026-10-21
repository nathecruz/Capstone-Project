// Idempotent Neon schema setup, shared by the API start-up and `npm run db:migrate:neon`.
import { readFile } from 'node:fs/promises';
import { query, withTransaction } from './client.js';
import { seedCatalog } from './seed-data.js';
import { retireRewards } from '../services/rewards.js';
import { splitFullName } from '../lib/names.js';
import { backfillActivityFromSnapshots } from '../services/activity.js';
import { stampAllSnapshots } from '../services/app-state-store.js';

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
  // Sign-in protection: wrong passwords in a row (from any network) pause sign-in for a while.
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_logins INTEGER NOT NULL DEFAULT 0');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_at BIGINT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS login_locked_until BIGINT');
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_at BIGINT');
  // First and last name are stored separately; full_name stays as "First Last".
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT NOT NULL DEFAULT ''");
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT ''");
  // The Custom Title reward; rewards can be retired (kept for old redemptions, no longer sold).
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS custom_title TEXT NOT NULL DEFAULT ''");
  // The Profile Frames reward: the frame chosen for the student's photo.
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_frame TEXT NOT NULL DEFAULT ''");
  // The account day (services/account-day.js): the student's time zone ('' until the app sends one)
  // and the earliest day still open after a time zone change.
  await query("ALTER TABLE users ADD COLUMN IF NOT EXISTS time_zone TEXT NOT NULL DEFAULT ''");
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS day_floor DATE');
  // Leaderboard rows are known by this random 12-hex id, never by the internal user id. The default
  // runs for each row, also for accounts that exist when the column is added.
  await query('ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id TEXT NOT NULL DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 12)');
  await query('CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_unique ON users(public_id)');
  // Habit Buddy rooms (backgrounds bought with tokens).
  await query("ALTER TABLE user_buddy ADD COLUMN IF NOT EXISTS room_item TEXT NOT NULL DEFAULT ''");
  // Habit Buddy gear: a worn accessory (scarf, glasses, medal...) alongside the hat and held item.
  await query("ALTER TABLE user_buddy ADD COLUMN IF NOT EXISTS accessory_item TEXT NOT NULL DEFAULT ''");
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
  // Token rewards that did nothing are retired and refunded; the real rewards' descriptions are kept
  // current (now more themes and frames), so a new key re-syncs them.
  await runOnce('token-rewards-real-2026-11', () => withTransaction((connection) => retireRewards(connection)));
  await runOnce('email-verification-backfill', () => query('UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL'));

  // Accounts created with a single full name get a first and last name once; students can correct them in the app.
  await runOnce('split-full-names', async () => {
    const accounts = await query("SELECT id, full_name AS \"fullName\" FROM users WHERE first_name = '' AND last_name = ''");
    for (const account of accounts.rows) {
      const { firstName, lastName } = splitFullName(account.fullName);
      await query('UPDATE users SET first_name = $1, last_name = $2 WHERE id = $3', [firstName, lastName, account.id]);
    }
  });

  // Sessions last 30 days from sign-in instead of 7: those still open get the same 30 days (once).
  await runOnce('sessions-30-days', () => query('UPDATE sessions SET expires_at = expires_at + $1 WHERE expires_at > $2', [23 * 24 * 60 * 60 * 1000, Date.now()]));

  // Habits last one week. Those made before have no last day yet: every account's latest snapshot
  // gives them the end of this week, saved as a newer snapshot the apps rebase on (once).
  await runOnce('habits-weekly-reset', () => stampAllSnapshots({ log }));

  // Keep day-level engagement history before services/maintenance.js trims old snapshots.
  await backfillActivityFromSnapshots();
}
