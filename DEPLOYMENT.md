# Deployment guide for HabitAI

This project is designed as a 3-part app:

- Frontend: Expo app
- Backend: Node.js + Express
- ML service: Python + FastAPI

For a capstone deployment, the easiest stack is free except for the backend:

- Neon -> PostgreSQL database
- Render -> backend API, on the paid Starter plan so it never sleeps and sends every reminder on time
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
- `habitai-backend`: Express API, on the Starter plan (paid, always on). Its ML service URL and API key are linked automatically. Add a payment method to the Render workspace before syncing the Blueprint: without one, every sync fails with `need_payment_info`, including changes to the free services.
- `habitai-frontend`: Expo web export hosted as a Static Site. Its API URLs are linked automatically to the backend.
- `habitai-admin`: Admin Panel (`admin-panel/`, Docker). It builds the React client, serves it from its Express API, reuses the backend's `DATABASE_URL`, and applies its own idempotent migration at start-up.
- `habitai-web-push` (commented out in `render.yaml`): Cron job that sends Web Push reminders every minute. Render cron jobs are paid, so it is disabled until the workspace has a payment method; see below.

1. Create or connect a Neon project and have its `DATABASE_URL` ready. Neon Auth (`AUTH_URL`, `JWKS_URL`) is optional: HabitAI signs users in with its own accounts and hashed session tokens. If you set them, the JWKS URL must end in `/.well-known/jwks.json`.
2. Push the repository to GitHub.
3. In Render, select **New** -> **Blueprint** and connect this repository.
4. Provide the prompted values, including backend Neon credentials, `ALLOWED_ORIGINS`, the Groq API key (`GROQ_API_KEY` from console.groq.com, used by the goal planner, habit coach, and support/progress assistant), and email settings. `SUPPORT_EMAIL` is optional; if omitted, issue reports go to the configured SMTP sender. For `ALLOWED_ORIGINS`, enter the frontend's Render origin (for example, `https://habitai-frontend.onrender.com`). If Render assigns a different URL, update it in the backend after the first sync.
5. Deploy the Blueprint. Keep `ML_MODEL_RELEASE_APPROVED=false` until real approved training outcomes and an independent holdout report have been verified.
6. `EXPO_PUBLIC_API_URL` and `EXPO_PUBLIC_AI_API_URL` are injected from the backend URL. Render only prompts for `sync: false` values when a Blueprint is first created; add or update them in each service's Environment settings after that.

### Android app builds

The EAS `preview` and `production` profiles set `EXPO_PUBLIC_API_URL` to the deployed backend URL so standalone Android builds can reach the account API. Build a new APK with `eas build --platform android --profile preview` (or use the `production` profile for a production build). Install the newly built APK; changing the profile does not update APKs that are already installed. Development builds can continue using the local API URL inferred from the Expo development server.

The Android app schedules the next two weeks of reminders on the phone itself, so they come while HabitAI is closed, even without internet. While the app is not open, a background reminder sync (`frontend/hooks/app-state/reminder-sync.ts`, with `expo-background-task`) runs about every hour, only with internet and never while the app is on screen: it schedules the reminders of habits changed on another device (a habit added on the web, a check-in elsewhere) and sets every alarm again in case the phone cleared it. It asks `GET /api/app-state/version` with a signed sync token, which the backend answers from memory (`backend/services/state-versions.js`), so hundreds of phones asking never keep Neon awake; it fetches the state only when that changed, with `?background=1`, which is not counted as a day of activity in the Admin Panel.

Habit reminders in the Android app use exact alarms, so they come on their minute instead of being delayed by Android (most of all while the phone dozes). `frontend/plugins/with-exact-alarms.js` declares `USE_EXACT_ALARM` (granted on install from Android 13) and `SCHEDULE_EXACT_ALARM` for Android 12. Google Play only accepts `USE_EXACT_ALARM` in alarm and calendar apps: before publishing there, declare only `SCHEDULE_EXACT_ALARM` and ask students to allow "Alarms & reminders" for HabitAI, which Android 14 and later leave off for new installs. Some phone makers' battery savers can still delay or stop reminders; excluding HabitAI from battery optimization avoids that.

### Mobile web push reminders

Web Push lets scheduled reminders arrive when the browser/PWA is backgrounded or closed, on every device where the student turned reminders on (Chrome and Android, Microsoft Edge, Firefox, Safari, and HabitAI installed on an iPhone's Home Screen). Two senders share the work, and each delivery is claimed in the database so nothing is sent twice:

- The backend's **reminder clock** ([backend/services/web-push-clock.js](backend/services/web-push-clock.js)) sends each reminder on its exact minute and picks up new or changed reminder times within seconds. It needs only the VAPID keys on the Render backend. On the Starter plan the backend never sleeps, so this covers every reminder, also while no student has HabitAI open.
- Only for a backend on the free plan, which sleeps after 15 idle minutes: a free GitHub Actions workflow ([.github/workflows/web-push-reminders.yml](.github/workflows/web-push-reminders.yml)) sends reminders while it sleeps. It needs the repository secrets in step 3; without them every run ends immediately. It is a poor substitute: GitHub starts scheduled runs far less often than asked (late October to early November 2026: 3 to 7 hours apart), so most reminders due while the free backend sleeps arrive late or not at all. With the Starter backend, leave the secrets out. The paid Render cron job is kept in `render.yaml` as a commented-out alternative.

How the senders protect the Neon quota: the workflow is scheduled every 5 minutes (GitHub may start runs hours apart), but most runs only read a cached plan of reminder times and exit without touching the database. It connects to Neon every 30 minutes to rebuild the plan, and otherwise only when a reminder or a snooze follow-up is due, waiting inside the job (up to 35 minutes) so the reminder goes out on the minute. The backend's reminder clock also reads the database only at reminder minutes, on changes and every 30 minutes. (Polling the database every few minutes would keep Neon awake all month, about 186 CU-hours, above the free 100 CU-hours, and the database would be suspended until the next month.) With the backend always on, its reminder clock does those reads around the clock, and students using HabitAI add their own: check the compute usage of the Neon project (its Usage page) now and then, and move to a paid Neon plan before it reaches the free limit.

1. From the repository root, configure local VAPID keys and import usable SMTP settings from the root `.env` into the ignored backend environment file:

	```powershell
	node backend/scripts/generate-vapid-keys.js --configure-local
	```

2. From `backend/.env`, copy `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, and `WEB_PUSH_VAPID_SUBJECT` into the `habitai-backend` service's Render **Environment**. Never commit or share the private key. If the backend starts without them, it makes a key pair itself, keeps it in the database (`server_keys`, [backend/services/vapid-keys.js](backend/services/vapid-keys.js)) and uses it from then on, so web reminders work without this step; keys set in Render always win, and browsers subscribed with the other key subscribe again by themselves.
3. Only for a backend on the free plan: in GitHub, open the repository's **Settings → Secrets and variables → Actions** and add the repository secrets `DATABASE_URL` (the backend's Neon URL), `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY` and `WEB_PUSH_VAPID_SUBJECT`, with exactly the same values as the Render backend (browsers subscribed with that public key). Only the repository owner can add secrets. Optionally add the variable `WEB_PUSH_API_URL` if the backend URL is not `https://habitai-backend.onrender.com`. Then open **Actions → Web Push reminders → Run workflow** with "Rebuild the reminder plan now" checked; after that it runs by itself every 5 minutes. GitHub disables scheduled workflows after 60 days without commits, so re-enable it there if it stops.
   - Paid alternative: add a payment method to the Render workspace and uncomment the `habitai-web-push` block in `render.yaml` (a paid resource in the Blueprint makes every sync fail with `need_payment_info`, including changes to free services). Confirm the `habitai-web-push` Cron Job is created and its database/VAPID variables reference the backend service. Render does not prompt for new `sync: false` secrets when syncing an existing Blueprint, so add the keys in the dashboard.
4. Deploy the frontend over HTTPS. On iPhone, open the site in Safari, add HabitAI to the Home Screen, open that installed web app, then enable Custom Reminders and allow notifications. On Android, use Chrome and allow notifications.
5. Check a device in HabitAI under **Settings & Preferences → Check reminders** (Notifications → settings): it shows whether the server can send reminders and whether this browser (or, in the Android app, the phone) is set up, lists the phone's next reminders, and sends a test reminder a minute later, so HabitAI can be closed first and the test seen arriving like a reminder. Some phones' battery savers (Infinix, Tecno and itel's Phone Master; Xiaomi, Oppo, realme and Vivo) stop Chrome or HabitAI in the background: the check lists what to allow.

The senders check saved habit schedules, custom weekdays, and each device timezone. Web Push reminders include a one-use Snooze action, delivered using the saved interval and count. A habit is only reminded while it can still be checked in: once its last reminder time has passed it is missed for the day. A reminder or snooze due after that (for example one the backend slept through) is not sent, each push expires at the end of the habit's last reminder minute (or at midnight for a habit without one) so a phone that was offline or asleep never shows it later, Snooze is left off a reminder whose snooze would come back too late, and a Snooze or Done tapped too late is refused with a message. Reminders and snoozes arrive within about a second of their minute while the backend is awake (always, on the Starter plan), including times added a minute earlier. A free backend that sleeps leaves them to GitHub Actions, which can start its runs hours late (a late reminder is still sent up to 30 minutes late while its habit can still be checked in, never twice; later than that it is dropped), and reminder times changed in the app are then picked up at the next 30-minute refresh. A laptop gets reminders while its browser is running (it may stay running in the background after its windows close); a phone gets them even with HabitAI closed. Mobile operating systems may apply their own notification delivery policies.

Issue report attachments are stored in Neon (`BYTEA`) and can be forwarded to `SUPPORT_EMAIL` through the configured SMTP account. The backend clears attachment bytes 30 days after a report is resolved or closed, and after 180 days at most, so the free 0.5 GB database does not fill up. Malware scanning is not yet integrated; for higher volumes, move attachments to object storage (Cloudflare R2, S3, Supabase Storage) and keep only the object key in the database.

### Email sender

Sign-ups send a verification code and password resets send a code, so email must work in production. **Free Render web services block outbound SMTP (ports 25, 465 and 587)**, so Gmail or any other SMTP server times out there. The backend therefore sends through Brevo's HTTPS API:

1. Create a free account at [brevo.com](https://www.brevo.com) (300 emails a day).
2. Under **Senders, domains & dedicated IPs → Senders**, add and verify the address the emails should come from (a project Gmail works; Brevo emails it a confirmation link).
3. Under **SMTP & API → API keys**, generate an API key.
4. In the Render dashboard, open **habitai-backend → Environment** and set `BREVO_API_KEY` (the key) and `EMAIL_FROM` (the verified sender). Save; the service redeploys and its log shows `[mail] Brevo API key verified`.

`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD` and `SMTP_FROM` are only used when `BREVO_API_KEY` is empty (local development or a paid Render plan). `render.yaml` contains no personal address, and values already set on the service are kept when the Blueprint syncs. Set `WEB_PUSH_VAPID_SUBJECT` to a `mailto:` address of the project team. `REQUIRE_EMAIL_VERIFICATION=false` turns verification off if the sender is unavailable.

### Free-tier cold starts

On the Starter plan the backend never sleeps. The free ML service and Admin Panel still sleep after 15 minutes without traffic: Insights' forecasts then come from the rules for about a minute (backend/services/forecast-rules.js), and the Admin Panel's first page takes about a minute. On the free plan the backend does the same: it sleeps after 15 minutes without traffic and takes up to a minute to wake. The app waits up to 60 seconds for API calls (up to 2 minutes per attempt for sign-in, sign-up and password reset; a sign-in whose connection drops while the server boots is sent once more after `/healthz` answers) and shows a "Connecting to HabitAI…" banner after 4 seconds, and a signed-in student keeps the saved session meanwhile. There is no offline mode: the web app cannot be opened without a connection, the service worker only handles Web Push reminders (it deletes the offline app cache older versions kept), and when the phone reports no internet and the server cannot be reached the app shows a "No internet connection" screen. The Starter plan removes the delay. Keeping a free backend awake with an uptime monitor is not an option here: the free services of a workspace share 750 instance hours a month, which one service awake all month nearly uses up, and Render suspends every free service of the workspace when they run out.

For Vercel frontend-only hosting, either set the project root to `frontend` (recommended) or leave it at the repository root. The frontend config supports the first option; the root `vercel.json` supports the second. Add these build-time environment variables in Project Settings:

- `EXPO_PUBLIC_API_URL`: deployed backend HTTPS URL

With `frontend` as the project root, Vercel runs `npm ci` and `npm run export:web`, publishing `dist`. With the repository root, it runs `npm --prefix frontend ci` and `npm --prefix frontend run export:web`, publishing `frontend/dist`. Both configs rewrite direct route requests such as `/login` to `index.html`.

### Admin Panel

1. After the Blueprint sync creates `habitai-admin`, open its URL (for example `https://habitai-admin.onrender.com`). The first request after 15 idle minutes takes about a minute on the free plan.
2. Sign in with an existing administrator account. Faculty and other administrators can use **Request access** on the sign-in page; an administrator approves them under **Users → Access requests**. To create the very first administrator, run `npm run create-admin -- --email you@psau.edu.ph --first-name Juan --last-name "Dela Cruz" --role admin` from `admin-panel/` with `server/.env` pointing at the production `DATABASE_URL`; the temporary password is printed once. Change it under **Settings → My account**, then add other staff from **Users**.
3. The session cookie is `Secure` and `SameSite=Strict`, so the panel only works over HTTPS (Render provides it). No CORS settings are needed because the client and API share one origin.

## 3) Important production notes

- The backend checks that `ML_SERVICE_URL` is not localhost in production.
- The ML service returns HTTP 503 until `ML_MODEL_RELEASE_APPROVED=true` and a valid evaluated model is present. The included synthetic demo data is not production training data.
- Render uses `/healthz` to verify that each service is running; `/health` reports dependency/model readiness and may return HTTP 503 until the ML release is approved.
- The backend no longer requires `AUTH_URL` and `JWKS_URL`; in production it requires `DATABASE_URL`, `ML_SERVICE_URL`, a real `ML_SERVICE_API_KEY` and `ALLOWED_ORIGINS`, and reports all missing values at once.
- Redeploy both the backend and the frontend together: the app now polls `GET /api/app-state?since=` and sends `mode: "support"` for the Help assistant.
- Full production readiness validation requires `GROQ_API_KEY`, plus working email (`BREVO_API_KEY` with `EMAIL_FROM`, or an SMTP username/password pair); without them, AI or verification and password-reset emails are unavailable and the production readiness check fails.
- The app validates that `ML_SERVICE_API_KEY` is a real secret and not a placeholder.
- The backend also expects `ALLOWED_ORIGINS` to be defined in production. An entry may use `*` for the part Vercel changes on every deploy, such as `https://capstone-project-*-team-c14.vercel.app`; `*` only matches letters, digits and dashes.
- AI features need `GROQ_API_KEY` (console.groq.com -> API Keys) on the backend. `GROQ_MODEL` defaults to `llama-3.3-70b-versatile`. On start-up the backend logs `[ai] Groq API key verified; using <model>.` or the reason the check failed.

After the first Blueprint sync assigns the Render service URLs, run `npm run check:env:deployment` with the production values set in the process environment or local ignored `.env`. It verifies the required database, auth, origins, and HTTPS URLs while warning if AI/email features are unavailable and confirming ML remains disabled. Do not commit the local `.env`. After a real model passes the independent holdout requirements, run `npm run check:env:production` as the stricter ML-release gate.

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
