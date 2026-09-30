# Free deployment guide for HabitAI

This project is designed as a 3-part app:

- Frontend: Expo app
- Backend: Node.js + Express
- ML service: Python + FastAPI

For a free capstone deployment, the easiest stack is:

- Neon -> PostgreSQL database
- Render -> backend API
- Render -> ML API
- Render Static Site -> frontend web app

## 1) Create the database on Neon

1. Go to https://neon.tech
2. Create a free project
3. Copy the connection string
4. Save it as `DATABASE_URL`

Use the same values described in [README.md](README.md) and [.env.example](.env.example).

## 2) Deploy the system on Render

The root `render.yaml` deploys all services as one Blueprint:

- `habitai-ml`: FastAPI service. Render generates its `ML_SERVICE_API_KEY`.
- `habitai-backend`: Express API. Its ML service URL and API key are linked automatically.
- `habitai-frontend`: Expo web export hosted as a Static Site. Its API URLs are linked automatically to the backend; its Neon Auth URL is provided separately.
- `habitai-admin`: Admin Panel (`admin-panel/`, Docker). It builds the React client, serves it from its Express API, reuses the backend's `DATABASE_URL`, and applies its own idempotent migration at start-up.
- `habitai-web-push` (commented out in `render.yaml`): Cron job that sends Web Push reminders every minute. Render cron jobs are paid, so it is disabled until the workspace has a payment method; see below.

1. Create or connect a Neon project and have its `DATABASE_URL` ready. Neon Auth (`AUTH_URL`, `JWKS_URL`, `EXPO_PUBLIC_AUTH_URL`) is optional: HabitAI signs users in with its own accounts and hashed session tokens. If you set them, the JWKS URL must end in `/.well-known/jwks.json`.
2. Push the repository to GitHub.
3. In Render, select **New** -> **Blueprint** and connect this repository.
4. Provide the prompted values, including backend Neon credentials, `ALLOWED_ORIGINS`, Gemini API keys, SMTP settings, and the frontend `EXPO_PUBLIC_AUTH_URL`. Use `GEMINI_API_KEY_GOALS`, `GEMINI_API_KEY_COACH`, and `GEMINI_API_KEY_ASSISTANT` for the goal planner, habit coach, and support/progress assistant; the generic `GEMINI_API_KEY` remains a fallback. `SUPPORT_EMAIL` is optional; if omitted, issue reports go to the configured SMTP sender. For `ALLOWED_ORIGINS`, enter the frontend's Render origin (for example, `https://habitai-frontend.onrender.com`). If Render assigns a different URL, update it in the backend after the first sync.
5. Deploy the Blueprint. Keep `ML_MODEL_RELEASE_APPROVED=false` until real approved training outcomes and an independent holdout report have been verified.
6. `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AI_API_URL` are injected from the backend URL. `EXPO_PUBLIC_AUTH_URL` must point to the Neon Auth client endpoint. It is compiled into the public web bundle, so it must be a public URL, never a secret. Render only prompts for `sync: false` values when a Blueprint is first created; add or update this value in the service's Environment settings after that.

### Mobile web push reminders

Web Push lets scheduled reminders arrive when the browser/PWA is backgrounded or closed. The Render Cron service runs once per minute and has a minimum charge of $1/month, plus usage.

1. From the repository root, configure local VAPID keys and import usable SMTP settings from the root `.env` into the ignored backend environment file:

	```powershell
	node backend/scripts/generate-vapid-keys.js --configure-local
	```

2. From `backend/.env`, copy `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT` into the `habitai-backend` service's Render **Environment**. Never commit or share the private key. `WEB_PUSH_API_URL` is linked to the backend service URL in the Blueprint.
3. Add a payment method to the Render workspace and uncomment the `habitai-web-push` block in `render.yaml` (a paid resource in the Blueprint makes every sync fail with `need_payment_info`, including changes to free services). Confirm the `habitai-web-push` Cron Job is created and its database/VAPID variables reference the backend service. Render does not prompt for new `sync: false` secrets when syncing an existing Blueprint, so add the keys in the dashboard.
4. Deploy the frontend over HTTPS. On iPhone, open the site in Safari, add HabitAI to the Home Screen, open that installed web app, then enable Custom Reminders and allow notifications. On Android, use Chrome and allow notifications.

The dispatcher checks saved habit schedules, custom weekdays, and each device timezone. Web Push reminders include a one-use Snooze action; the cron delivers snoozed reminders using the saved interval and count. Delivery is normally within a minute; after a delayed or interrupted Cron run, it retries reminders up to five minutes late. Mobile operating systems may apply their own notification delivery policies.

Issue report attachments are stored in Neon (`BYTEA`) and can be forwarded to `SUPPORT_EMAIL` through the configured SMTP account. The backend clears attachment bytes 30 days after a report is resolved or closed, and after 180 days at most, so the free 0.5 GB database does not fill up. Malware scanning is not yet integrated; for higher volumes, move attachments to object storage (Cloudflare R2, S3, Supabase Storage) and keep only the object key in the database.

### Email sender

Sign-ups now send a verification code, so use a dedicated sender instead of a personal Gmail (Gmail allows about 500 messages a day and ties delivery to one person's account). Any SMTP provider works: for example Brevo (`smtp-relay.brevo.com`, port 587), Resend (`smtp.resend.com`, port 465) or a PSAU project mailbox. Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` in the Render dashboard; `render.yaml` no longer contains any personal address, and values already set on the service are kept when the Blueprint syncs. Set `WEB_PUSH_VAPID_SUBJECT` to a `mailto:` address of the project team. `REQUIRE_EMAIL_VERIFICATION=false` turns verification off if the sender is unavailable.

### Free-tier cold starts

The Render free web service sleeps after 15 minutes without traffic and takes up to a minute to wake. The app waits up to 60 seconds for API calls and shows a "Connecting to HabitAI…" banner after 4 seconds, and a signed-in student keeps using the cached session meanwhile. To remove the delay, upgrade the backend to a paid instance or ping `/healthz` every 10 minutes from an uptime monitor.

For Vercel frontend-only hosting, either set the project root to `frontend` (recommended) or leave it at the repository root. The frontend config supports the first option; the root `vercel.json` supports the second. Add these build-time environment variables in Project Settings:

- `EXPO_PUBLIC_API_URL`: deployed backend HTTPS URL
- `EXPO_PUBLIC_AUTH_URL`: Neon Auth client endpoint

With `frontend` as the project root, Vercel runs `npm ci` and `npm run export:web`, publishing `dist`. With the repository root, it runs `npm --prefix frontend ci` and `npm --prefix frontend run export:web`, publishing `frontend/dist`. Both configs rewrite direct route requests such as `/login` to `index.html`.

### Admin Panel

1. After the Blueprint sync creates `habitai-admin`, open its URL (for example `https://habitai-admin.onrender.com`). The first request after 15 idle minutes takes about a minute on the free plan.
2. Sign in with an existing administrator account. To create one, run `npm run create-admin -- --email you@psau.edu.ph --role admin` from `admin-panel/` with `server/.env` pointing at the production `DATABASE_URL`; the temporary password is printed once. Change it under **Settings → My account**, then add other staff from **Users**.
3. The session cookie is `Secure` and `SameSite=Strict`, so the panel only works over HTTPS (Render provides it). No CORS settings are needed because the client and API share one origin.

## 3) Important production notes

- The backend checks that `ML_SERVICE_URL` is not localhost in production.
- The ML service returns HTTP 503 until `ML_MODEL_RELEASE_APPROVED=true` and a valid evaluated model is present. The included synthetic demo data is not production training data.
- Render uses `/healthz` to verify that each service is running; `/health` reports dependency/model readiness and may return HTTP 503 until the ML release is approved.
- The backend no longer requires `AUTH_URL` and `JWKS_URL`; in production it requires `DATABASE_URL`, `ML_SERVICE_URL`, a real `ML_SERVICE_API_KEY` and `ALLOWED_ORIGINS`, and reports all missing values at once.
- Redeploy both the backend and the frontend together: the app now polls `GET /api/app-state?since=` and sends `mode: "support"` for the Help assistant.
- Full production readiness validation requires at least one of `GEMINI_API_KEY`, `GEMINI_API_KEY_GOALS`, `GEMINI_API_KEY_COACH`, or `GEMINI_API_KEY_ASSISTANT`, plus an SMTP username/password pair; without them, AI or password-reset email features are unavailable and the production readiness check fails.
- The app validates that `ML_SERVICE_API_KEY` is a real secret and not a placeholder.
- The backend also expects `ALLOWED_ORIGINS` to be defined in production.
- If you want AI features, set the dedicated Gemini keys when possible: `GEMINI_API_KEY_GOALS`, `GEMINI_API_KEY_COACH`, and `GEMINI_API_KEY_ASSISTANT`.

After the first Blueprint sync assigns the Render service URLs, run `npm run check:env:deployment` with the production values set in the process environment or local ignored `.env`. It verifies the required database, auth, origins, and HTTPS URLs while warning if Gemini/email features are unavailable and confirming ML remains disabled. Do not commit the local `.env`. After a real model passes the independent holdout requirements, run `npm run check:env:production` as the stricter ML-release gate.

## 4) Deployment order

When using the Render Blueprint, create the Neon database first, then sync the Blueprint so Render can resolve the linked service URLs. For a manual deployment, use this order:

1. Neon database
2. ML service
3. Backend
4. Frontend
5. Admin Panel

That keeps the environment variables aligned and avoids broken API calls.

## 5) Files prepared in this repo

- [render.yaml](render.yaml)
- [frontend/vercel.json](frontend/vercel.json) (optional, if deploying the frontend on Vercel instead)

These are the deployment configs for the free stack.
