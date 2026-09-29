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

The root `render.yaml` deploys all three services as one Blueprint:

- `habitai-ml`: FastAPI service. Render generates its `ML_SERVICE_API_KEY`.
- `habitai-backend`: Express API. Its ML service URL and API key are linked automatically.
- `habitai-frontend`: Expo web export hosted as a Static Site. Its API URLs are linked automatically to the backend; its Neon Auth URL is provided separately.

1. Create or connect a Neon project and have its `DATABASE_URL`, `AUTH_URL`, `JWKS_URL`, and public Neon Auth base URL ready. The JWKS URL must end in `/.well-known/jwks.json`. The frontend auth URL is the Neon Auth base URL used by the client, not the backend API URL.
2. Push the repository to GitHub.
3. In Render, select **New** -> **Blueprint** and connect this repository.
4. Provide the prompted values, including backend Neon credentials, `ALLOWED_ORIGINS`, Gemini API key, SMTP settings, and the frontend `EXPO_PUBLIC_AUTH_URL`. For `ALLOWED_ORIGINS`, enter the frontend's Render origin (for example, `https://habitai-frontend.onrender.com`). If Render assigns a different URL, update it in the backend after the first sync.
5. Deploy the Blueprint. Keep `ML_MODEL_RELEASE_APPROVED=false` until real approved training outcomes and an independent holdout report have been verified.
6. `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AI_API_URL` are injected from the backend URL. `EXPO_PUBLIC_AUTH_URL` must point to the Neon Auth client endpoint. It is compiled into the public web bundle, so it must be a public URL, never a secret. Render only prompts for `sync: false` values when a Blueprint is first created; add or update this value in the service's Environment settings after that.

### Mobile web push reminders

Web Push lets scheduled reminders arrive when the browser/PWA is backgrounded or closed. The Render Cron service runs once per minute and has a minimum charge of $1/month, plus usage.

1. Generate a VAPID key pair locally from the `backend` directory:

	```powershell
	npm run push:generate-vapid-keys
	```

2. In Render, open `habitai-backend` -> **Environment** and set `WEB_PUSH_VAPID_PUBLIC_KEY` and `WEB_PUSH_VAPID_PRIVATE_KEY` to the generated values. Keep the private key secret and do not commit it. Set `WEB_PUSH_VAPID_SUBJECT` to a contact email in `mailto:` form.
3. Confirm the `habitai-web-push` Cron Job is created and its database/VAPID variables reference the backend service. Render does not prompt for new `sync: false` secrets when syncing an existing Blueprint, so add the keys in the dashboard.
4. Deploy the frontend over HTTPS. On iPhone, open the site in Safari, add HabitMind to the Home Screen, open that installed web app, then enable Custom Reminders and allow notifications. On Android, use Chrome and allow notifications.

The dispatcher checks saved habit schedules, custom weekdays, and each device timezone. Delivery is normally within a minute; after a delayed or interrupted Cron run, it retries reminders up to five minutes late. Mobile operating systems may apply their own notification delivery policies.

For Vercel frontend-only hosting, set the project root to `frontend` and add these build-time environment variables in Project Settings:

- `EXPO_PUBLIC_API_URL`: deployed backend HTTPS URL
- `EXPO_PUBLIC_AUTH_URL`: Neon Auth client endpoint

The Vercel config runs `npm ci` and `npm run export:web`, publishing `dist`. The web output is a single-page app, so `frontend/vercel.json` rewrites direct route requests such as `/login` to `index.html`.

## 3) Important production notes

- The backend checks that `ML_SERVICE_URL` is not localhost in production.
- The ML service returns HTTP 503 until `ML_MODEL_RELEASE_APPROVED=true` and a valid evaluated model is present. The included synthetic demo data is not production training data.
- Render uses `/healthz` to verify that each service is running; `/health` reports dependency/model readiness and may return HTTP 503 until the ML release is approved.
- The backend requires `AUTH_URL` and `JWKS_URL` when using the production Neon database.
- Full production readiness validation also requires `GEMINI_API_KEY` and an SMTP username/password pair; without them, AI or password-reset email features are unavailable and the production readiness check fails.
- The app validates that `ML_SERVICE_API_KEY` is a real secret and not a placeholder.
- The backend also expects `ALLOWED_ORIGINS` to be defined in production.
- If you want AI features, set `GEMINI_API_KEY`.

After the first Blueprint sync assigns the Render service URLs, run `npm run check:env:deployment` with the production values set in the process environment or local ignored `.env`. It verifies the required database, auth, origins, and HTTPS URLs while warning if Gemini/email features are unavailable and confirming ML remains disabled. Do not commit the local `.env`. After a real model passes the independent holdout requirements, run `npm run check:env:production` as the stricter ML-release gate.

## 4) Deployment order

When using the Render Blueprint, create the Neon database first, then sync the Blueprint so Render can resolve the linked service URLs. For a manual deployment, use this order:

1. Neon database
2. ML service
3. Backend
4. Frontend

That keeps the environment variables aligned and avoids broken API calls.

## 5) Files prepared in this repo

- [render.yaml](render.yaml)
- [frontend/vercel.json](frontend/vercel.json) (optional, if deploying the frontend on Vercel instead)

These are the deployment configs for the free stack.
