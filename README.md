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
When `DATABASE_URL` is present,
the backend API uses the Neon PostgreSQL runtime; without it, local development
and the existing integration tests use the SQLite fallback.

## Architecture

See **[ARCHITECTURE.md](ARCHITECTURE.md)** for the system diagram, API modules, data model
and the data flows for sign-in, sync, password reset (OTP), AI features, reminders and the
Admin Panel.

- The `frontend` app handles UI, local-first state and sync; all API calls go through
  `frontend/authentication/authService.ts`, and AI calls through `frontend/utils/ai-client.ts`.
- The `backend` API is split into `config/`, `db/`, `http/`, `routes/` and `services/`
  (entry point `server-neon.js`). The SQLite server in `server.js` is only an offline fallback
  used by the API test suite.
- The `ml-service` handles prediction and recommendation logic for habit forecasting.

Backend checks:

```bash
npm --prefix backend run lint        # syntax-checks every backend module
npm --prefix backend run test:unit   # services, prompts, email templates, reminders
npm --prefix backend test            # unit tests + SQLite API integration test
```

Configuration: the backend reads `backend/.env` and then the root `.env`; a value that is
still a template placeholder (for example `your-gemini-api-key`) is ignored in favour of a
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
layer and runs the schema migration before starting. Uploaded issue-report
files still use the container filesystem; production should use managed object
storage and a malware-scanning pipeline for uploaded files.

For local SQLite development, leave `DATABASE_URL` unset and set
`DATABASE_PATH=./data/habitai.sqlite` in `backend/.env`. The SQLite server
creates the same `habit_completions` table automatically. For Docker, set the
root `.env` values for `DATABASE_URL`, `ML_SERVICE_API_KEY`, and the public
frontend API and auth URLs in the root `.env` before running
`docker compose up --build`.

## Notes

The ML service is intentionally separated from the frontend to keep the app architecture clean and scalable. The frontend should not own the Python ML environment or prediction service logic.

## Current capability boundaries

- Saved goals are persisted in the authenticated app-state record and synchronized across signed-in devices.
- Leaderboards are authenticated community data. The server derives member identity from the session and points from recorded habit completions; client-supplied names and points are rejected.
- Habit and smart reminders use local device notifications and require a native iOS/Android build plus notification permission; the web build does not deliver scheduled device reminders. Smart reminders are scheduled after a habit is saved, using recent activity and prediction guidance when available.
- Issue reports accept real multipart uploads for JPG, PNG, WEBP, and MP4 files up to 10MB. Files are stored under `backend/data/uploads` with server-generated names and magic-byte validation; they are not yet connected to cloud storage, malware scanning, or an external ticketing/email workflow.
- Password reset emails use configurable SMTP settings (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, and optional `SMTP_FROM`). Gmail is supported through `smtp.gmail.com` with a Gmail App Password; other SMTP providers can be used with their own credentials. Codes are 6 digits, valid for 10 minutes, limited to 5 attempts, and sent as branded HTML emails; a security notice is emailed after every password change. The backend verifies the SMTP login at start-up and logs the result.
- AI Coach and the AI Assistant use Google Gemini through `GEMINI_API_KEY` and `GEMINI_MODEL` (default `gemini-2.5-flash`, or a valid deployed override). Prompts live in `backend/services/ai-prompts.js`; the server grounds every answer in the student's habits and check-ins from the database (`backend/services/ai-context.js`), and the Help & Support assistant answers from a built-in app guide. The Insights Assistant clearly labels its local guidance fallback; the Coach does not charge tokens when Gemini is unavailable. AI Goals requires Gemini and does not fabricate a generated plan when the service is unavailable. Goal plans no longer present uncalibrated numeric potential/confidence scores.
- AI screens use the live backend when `EXPO_PUBLIC_API_URL` or `EXPO_PUBLIC_AI_API_URL` is configured; otherwise they explicitly fall back to local guidance.
- ML predictions remain a prototype until the service is retrained and evaluated with approved anonymized real outcomes. Bootstrap model scores are not production evidence. HabitAI does not collect session duration; the prediction service imputes that optional feature from the trained model's training-set mean instead of sending a fabricated per-user duration.
- Retraining requires `ML_TRAINING_DATASET` to point to an approved anonymized outcomes CSV; the service no longer creates synthetic bootstrap training rows during retraining.
