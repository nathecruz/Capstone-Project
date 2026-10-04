CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  date_of_birth TEXT NOT NULL DEFAULT '',
  gender TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  about TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  created_at BIGINT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
  ON users (LOWER(username)) WHERE username <> '';

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_activity (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  login_date_time TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS login_activity_user_created_idx ON login_activity(user_id, created_at DESC);
ALTER TABLE login_activity ADD COLUMN IF NOT EXISTS login_date_time TIMESTAMPTZ;
UPDATE login_activity SET login_date_time = to_timestamp(created_at / 1000.0) WHERE login_date_time IS NULL;
ALTER TABLE login_activity ALTER COLUMN login_date_time SET DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE login_activity ALTER COLUMN login_date_time SET NOT NULL;

CREATE TABLE IF NOT EXISTS password_reset_requests (
  email TEXT PRIMARY KEY,
  otp_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  verified_at BIGINT,
  created_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard_users (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  avatar TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS leaderboard_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points >= 0),
  avatar TEXT NOT NULL DEFAULT '',
  recorded_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS leaderboard_snapshots_recorded_idx ON leaderboard_snapshots(recorded_at DESC);

CREATE TABLE IF NOT EXISTS leaderboard_daily_points (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, recorded_date)
);
ALTER TABLE leaderboard_daily_points DROP CONSTRAINT IF EXISTS leaderboard_daily_points_points_check;
CREATE INDEX IF NOT EXISTS leaderboard_daily_points_date_idx ON leaderboard_daily_points(recorded_date);

CREATE TABLE IF NOT EXISTS user_app_state (
  id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS user_app_state_user_updated_idx ON user_app_state(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS habits (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  meta TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  icon TEXT NOT NULL,
  color TEXT NOT NULL,
  goal INTEGER NOT NULL DEFAULT 1,
  progress INTEGER NOT NULL DEFAULT 0,
  total TEXT NOT NULL DEFAULT '',
  streak INTEGER NOT NULL DEFAULT 0,
  done BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reminder_time TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS habits_user_sort_idx ON habits(user_id, sort_order);
-- Schedule of each habit, so the Admin Panel and AI can compute live streaks from check-ins.
ALTER TABLE habits ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS start_date TEXT NOT NULL DEFAULT '';
ALTER TABLE habits ADD COLUMN IF NOT EXISTS reminder_days JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  progress INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Fresh plan',
  details_json JSONB NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS goals_user_updated_idx ON goals(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS goal_steps (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  description TEXT NOT NULL,
  due_date TEXT NOT NULL DEFAULT '',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (goal_id, step_index)
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  preferences_json JSONB NOT NULL,
  ring_interval INTEGER NOT NULL DEFAULT 30,
  snooze_frequency TEXT NOT NULL DEFAULT 'Once',
  updated_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS token_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  label TEXT NOT NULL,
  transaction_date TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS token_transactions_user_date_idx ON token_transactions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS achievements (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL REFERENCES achievements(id) ON DELETE CASCADE,
  earned_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, achievement_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read_at BIGINT,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS notifications_user_created_idx ON notifications(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription_json JSONB NOT NULL,
  time_zone TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx ON web_push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS web_push_deliveries (
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  reminder_date DATE NOT NULL,
  reminder_time TEXT NOT NULL,
  attempted_at BIGINT NOT NULL DEFAULT 0,
  sent_at BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (subscription_id, habit_id, reminder_date, reminder_time)
);

CREATE TABLE IF NOT EXISTS web_push_snooze_tokens (
  token_hash TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  snooze_count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL,
  consumed_at BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_push_snooze_tokens_expiry_idx ON web_push_snooze_tokens(expires_at);

CREATE TABLE IF NOT EXISTS web_push_snooze_queue (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES web_push_subscriptions(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  snooze_count INTEGER NOT NULL,
  scheduled_at BIGINT NOT NULL,
  attempted_at BIGINT NOT NULL DEFAULT 0,
  sent_at BIGINT NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS web_push_snooze_queue_due_idx
  ON web_push_snooze_queue(scheduled_at, sent_at, attempted_at);

CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  token_cost INTEGER NOT NULL CHECK (token_cost >= 0),
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reward_id TEXT NOT NULL REFERENCES rewards(id),
  token_cost INTEGER NOT NULL,
  redeemed_at BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS habit_completions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  habit_id TEXT NOT NULL,
  completed_date DATE NOT NULL,
  completed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, habit_id, completed_date)
);
CREATE INDEX IF NOT EXISTS habit_completions_user_date_idx
  ON habit_completions(user_id, completed_date);

CREATE TABLE IF NOT EXISTS issue_reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  timing TEXT NOT NULL,
  description TEXT NOT NULL,
  attachment_name TEXT,
  attachment_uri TEXT,
  attachment_data BYTEA,
  status TEXT NOT NULL DEFAULT 'open',
  created_at BIGINT NOT NULL
);
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS attachment_data BYTEA;
ALTER TABLE issue_reports ADD COLUMN IF NOT EXISTS updated_at BIGINT;
CREATE INDEX IF NOT EXISTS issue_reports_user_created_idx ON issue_reports(user_id, created_at DESC);

-- One-time data migrations that must never run twice.
CREATE TABLE IF NOT EXISTS app_migrations (
  name TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

-- Email verification codes sent after sign-up or an email change.
CREATE TABLE IF NOT EXISTS email_verification_codes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL
);

-- One row per student per day they used the app (Asia/Manila calendar days).
-- Engagement analytics read this instead of keeping every app-state snapshot.
CREATE TABLE IF NOT EXISTS user_activity_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  activity_date DATE NOT NULL,
  PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX IF NOT EXISTS user_activity_days_date_idx ON user_activity_days(activity_date);

CREATE TABLE IF NOT EXISTS feature_suggestions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  suggestion TEXT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS feature_suggestions_user_created_idx ON feature_suggestions(user_id, created_at DESC);

-- Habit Buddy: the student's mascot, its name and what it wears. Items bought with tokens are in
-- buddy_items (the token spend itself is in token_transactions).
CREATE TABLE IF NOT EXISTS user_buddy (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL DEFAULT 'Habi',
  head_item TEXT NOT NULL DEFAULT '',
  hand_item TEXT NOT NULL DEFAULT '',
  room_item TEXT NOT NULL DEFAULT '',
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS buddy_items (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  bought_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, item_id)
);

-- Streak Freeze: freezes held (bought with tokens, at most two) and the days they covered. A
-- frozen day neither counts toward nor breaks a streak.
CREATE TABLE IF NOT EXISTS user_streak_freezes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  available INTEGER NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL
);
-- Daily claim: one row per day the student claimed the daily reward (day 1 to 7 of the calendar).
CREATE TABLE IF NOT EXISTS daily_claims (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  claim_date DATE NOT NULL,
  cycle_day INTEGER NOT NULL,
  amount INTEGER NOT NULL,
  claimed_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, claim_date)
);
CREATE TABLE IF NOT EXISTS streak_freeze_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  freeze_date DATE NOT NULL,
  used_at BIGINT NOT NULL,
  PRIMARY KEY (user_id, freeze_date)
);
