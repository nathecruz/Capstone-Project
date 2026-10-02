# HabitAI Project

This monorepo is organized into separate application layers:

- `frontend/` — Expo + React Native mobile/web app
- `backend/` — Node/Express backend services
- `ml-service/` — Python FastAPI machine learning prediction service

## Neon database data layer

The backend includes a PostgreSQL schema and connection layer for the Neon database.
Copy `backend/.env.example` to the backend environment and set `DATABASE_URL` to
the pooled connection string from Neon. Create the tables with:

```bash
cd backend
npm run db:migrate:neon
```

This creates all account, session, app-state, habit, goal, preference, reward,
achievement, notification, leaderboard, password-reset, and support tables in
the `public` schema. It also seeds the system's default reward and achievement
catalogs without creating placeholder users or activity.
Habit completion history is written through `/api/habit-completions`; clients
must not use `completionDates` in synced app state as an authoritative source.
The backend requires `DATABASE_URL` (Neon or any PostgreSQL); the old SQLite fallback
was removed so there is a single data layer to test and maintain.

## Admin Panel

`admin-panel/` is the web dashboard for PSAU faculty and administrators (user roles and
deactivation, habit categories, notification templates, usage statistics and anonymized
analytics). It shares the Neon database with the app and is deployed as the `habitai-admin`
service in `render.yaml`. See [admin-panel/README.md](admin-panel/README.md) for local setup and
creating the first administrator account.

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the system diagram, API modules, data model
and the data flows for sign-in, sync, password reset (OTP), AI features, reminders and the
Admin Panel.

- The `frontend` app handles UI, local-first state and sync; all API calls go through
  `frontend/authentication/authService.ts`, and AI calls through `frontend/utils/ai-client.ts`.
- The `backend` API is split into `config/`, `db/`, `http/`, `routes/` and `services/`
  (entry point `server-neon.js`, started through `server.js`).
- The `ml-service` handles prediction and recommendation logic for habit forecasting.

Backend checks:

```bash
npm --prefix backend run lint        # syntax-checks every backend module
npm --prefix backend run test:unit   # services, prompts, email templates, reminders
npm --prefix backend test            # unit tests + PostgreSQL API integration test
```

The integration test needs `TEST_DATABASE_URL` (use a Neon branch, direct host without
`-pooler`); it creates a random private schema, runs the real server against it and drops
the schema afterwards. Without the variable it is skipped. GitHub Actions
(`.github/workflows/ci.yml`) runs backend, frontend and ML checks on every push and pull
request, and the integration test too when the `TEST_DATABASE_URL` secret is set.

Configuration: the backend reads `backend/.env` and then the root `.env`; a value that is
still a template placeholder (for example `your-groq-api-key`) is ignored in favour of a
real one from the other file. Neon Auth (`AUTH_URL`, `JWKS_URL`, `EXPO_PUBLIC_AUTH_URL`) is
optional: sign-in uses the backend's own accounts and hashed session tokens.

## ML service setup

Use Python 3.12 for the ML service.

```bash
cd ml-service
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:ML_SERVICE_API_KEY = "replace-with-a-long-random-secret"
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Configure the same `ML_SERVICE_API_KEY` value in the backend environment. The
backend uses it to authenticate requests to the ML service.

## Frontend app setup

```bash
cd frontend
npm install
npm run web
```

The app runs as a web app in the browser and is no longer configured for Android build setup.

## Convenient run commands

From the project root, you can launch both the backend and frontend together:

```bash
npm install
npm run dev
```

This starts:
- the backend API on http://localhost:8787
- the Expo frontend app on http://localhost:8081

You can also run them individually:

```bash
npm run backend
npm run frontend
```

## Docker stack

Docker Compose runs the backend, ML service, and a production static frontend
served by Nginx. Copy `.env.example` to `.env`, set a real `DATABASE_URL` for
Neon/PostgreSQL, replace `ML_SERVICE_API_KEY` with a long random value, and set
the public `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_AI_API_URL`, and
`EXPO_PUBLIC_AUTH_URL` values as appropriate. Then run:

```bash
docker compose up --build
```

The services are available at:

- Frontend: http://localhost:8081
- Backend: http://localhost:8787
- ML service: http://localhost:8000

The frontend image statically exports Expo routes and serves them on port 80
inside the container (mapped to host port 8081). Public Expo URLs are embedded
at image build time, so rebuild the frontend after changing them. The
`.env.docker` file is not required. Compose healthchecks use `/healthz` liveness
endpoints; ML readiness is separate, so the app can start while production
predictions remain disabled pending model approval.

The Docker backend uses the same Neon/PostgreSQL database as the deployed data
layer and runs the schema migration before starting. Issue-report attachments
are stored in the database (see the capability notes below).

For local development, point `DATABASE_URL` at a Neon branch or a local PostgreSQL. For Docker, set the
root `.env` values for `DATABASE_URL`, `ML_SERVICE_API_KEY`, and the public
frontend API and auth URLs in the root `.env` before running
`docker compose up --build`.

## Notes

The ML service is intentionally separated from the frontend to keep the app architecture clean and scalable. The frontend should not own the Python ML environment or prediction service logic.

## Current capability boundaries

- Saved goals are persisted in the authenticated app-state record and synchronized across signed-in devices.
- Points, tokens and streaks are owned by the server. Check-ins are recorded in `habit_completions`; each one earns 20 points and 5 tokens through the `token_transactions` ledger (`backend/services/wallet.js`), undoing a check-in takes them back, and AI Coach questions and reward redemptions are charged on the server. Streaks are recomputed from check-in dates and each habit's schedule (`backend/services/streaks.js`, mirrored in `frontend/utils/streaks.ts`): a missed scheduled day resets the streak, unscheduled days do not.
- Leaderboards are authenticated community data. The server derives member identity from the session and points from recorded habit completions; client-supplied names and points are rejected. Students appear as first name + last initial, and can hide themselves under Settings → Preferences.
- New accounts must agree to the Privacy Notice (RA 10173) and confirm their email with a 6-digit code before using the app (`REQUIRE_EMAIL_VERIFICATION`, default on; skipped automatically when SMTP is not configured). Accounts created before this feature are treated as verified. Students can download all their data as JSON from Settings → Preferences (`GET /api/auth/export`).
- Habit and smart reminders use local device notifications and require a native iOS/Android build plus notification permission; the web build does not deliver scheduled device reminders. Smart reminders are scheduled after a habit is saved, using recent activity and prediction guidance when available.
- Issue reports accept real multipart uploads for JPG, PNG, WEBP, and MP4 files up to 10MB. Files are validated by magic bytes and stored in the database (`issue_reports.attachment_data`) so every backend instance can serve them to the Admin Panel. To keep the free Neon tier small, a daily job (`backend/services/maintenance.js`) clears attachments 30 days after a report is resolved/closed and after 180 days at most. For larger volumes, move attachments to object storage (Cloudflare R2, S3, Supabase Storage) and store only the object key.
- Password reset emails use configurable SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and optional `SMTP_FROM`). Use a project mailbox or a transactional provider (Brevo, Resend, Mailgun) for production: a personal Gmail is limited to about 500 emails a day, and every signup now sends a verification code. Gmail still works through `smtp.gmail.com` with an App Password for development. Codes are 6 digits, valid for 10 minutes, limited to 5 attempts, and sent as branded HTML emails; a security notice is emailed after every password change. The backend verifies the SMTP login at start-up and logs the result.
- AI Coach, the AI Assistant and AI Goals use Groq through `GROQ_API_KEY` and `GROQ_MODEL` (default `llama-3.3-70b-versatile`); check a key with `npm --prefix backend run smoke:ai`. Prompts live in `backend/services/ai-prompts.js`; the server grounds every answer in the student's habits and check-ins from the database (`backend/services/ai-context.js`), and the Help & Support assistant answers from a built-in app guide. The Insights Assistant clearly labels its local guidance fallback; the Coach does not charge tokens when the AI service is unavailable. AI Goals requires the AI service and does not fabricate a generated plan when the service is unavailable. Goal plans no longer present uncalibrated numeric potential/confidence scores.
- AI screens use the live backend when `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_AI_API_URL` is configured; otherwise they explicitly fall back to local guidance.
- ML predictions remain a prototype until the service is retrained and evaluated with approved anonymized real outcomes; the app labels every forecast as an estimate. `npm --prefix backend run ml:export` builds the anonymized training and holdout CSVs from real check-ins (see `ml-service/README.md`). Bootstrap model scores are not production evidence. HabitAI does not collect session duration; the prediction service imputes that optional feature from the trained model's training-set mean instead of sending a fabricated per-user duration.
- Retraining requires `ML_TRAINING_DATASET` to point to an approved anonymized outcomes CSV; the service no longer creates synthetic bootstrap training rows during retraining.
