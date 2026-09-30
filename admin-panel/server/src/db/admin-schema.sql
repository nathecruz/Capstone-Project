-- HabitAI Admin Panel schema.
-- Every statement is idempotent so the migration can run on every server start.
-- The base tables (users, habits, notifications, ...) are owned by the HabitAI app backend.

-- Roles and account status on the shared users table ---------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_changed_at BIGINT;
-- Owned by the app backend; created here too so admin-created accounts can be marked verified.
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_consent_at BIGINT;

UPDATE users SET role = 'admin' WHERE is_admin = TRUE AND role = 'user';
UPDATE users SET is_admin = (role = 'admin') WHERE is_admin <> (role = 'admin');

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('user', 'faculty', 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('active', 'deactivated'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS users_role_status_idx ON users(role, status);
CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at DESC);
CREATE INDEX IF NOT EXISTS login_activity_date_idx ON login_activity(login_date_time);
CREATE INDEX IF NOT EXISTS habit_completions_date_idx ON habit_completions(completed_date);
CREATE INDEX IF NOT EXISTS user_app_state_updated_idx ON user_app_state(updated_at);

-- Daily activity written by the app backend (created here too so start-up order does not matter).
CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX IF NOT EXISTS user_activity_days_date_idx ON user_activity_days(activity_date);

-- Habit schedule columns written by the app backend; used for live streaks (lib/streaks.js).
ALTER TABLE habits ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS start_date TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS reminder_days JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Admin panel sessions (separate from mobile app sessions) ---------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at BIGINT NOT NULL,
  last_seen_at BIGINT NOT NULL,
  expires_at BIGINT NOT NULL,
  ip TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS admin_sessions_user_idx ON admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS admin_sessions_expires_idx ON admin_sessions(expires_at);

-- System-wide habit categories (read by the app via GET /api/habit-categories) --
CREATE TABLE IF NOT EXISTS habit_categories (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  icon TEXT NOT NULL DEFAULT 'ellipse-outline',
  color TEXT NOT NULL DEFAULT '#7A6AED',
  description TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS habit_categories_label_unique ON habit_categories (LOWER(label));

-- Notification templates and broadcasts --------------------------------------
CREATE TABLE IF NOT EXISTS notification_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('system', 'reminder')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS notification_templates_name_unique ON notification_templates (LOWER(name));

CREATE TABLE IF NOT EXISTS notification_broadcasts (
  id TEXT PRIMARY KEY,
  template_id TEXT REFERENCES notification_templates(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  audience TEXT NOT NULL,
  audience_label TEXT NOT NULL DEFAULT '',
  recipient_count INTEGER NOT NULL DEFAULT 0,
  sent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  sent_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notification_broadcasts_sent_idx ON notification_broadcasts(sent_at DESC);

-- Support workflow columns on app-owned tables --------------------------------
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS admin_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE feature_suggestions ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'new';
ALTER TABLE feature_suggestions ADD COLUMN IF NOT EXISTS updated_at BIGINT;

-- Audit trail and settings -----------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_email TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip TEXT NOT NULL DEFAULT '',
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON admin_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON admin_audit_log(action);

CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at BIGINT NOT NULL
);
