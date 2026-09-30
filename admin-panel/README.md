# HabitAI Admin Panel

A web dashboard for authorized administrators (PSAU faculty and system managers) to oversee the
HabitAI habit-tracking system. It lives in `admin-panel/` of the HabitAI repository and connects to the same
**Neon PostgreSQL** database as the app backend (`backend/`).

## Features

| Area | What it does |
| --- | --- |
| **Overview** | Active students, check-ins, completion rate, new students (with change vs. the previous period), DAU/WAU/MAU and stickiness, daily trend, engagement funnel, habits by category, sign-in heatmap, recent admin activity, support queue. |
| **Analytics** (anonymized) | Impact over time (weekly completion rate, check-ins per active student, active students), completion rate by category, check-ins by weekday, streak distribution, reminder times, habit frequency, demographic breakdowns (gender, age group, region), weekly retention cohorts, tokens, rewards and achievements. No names or emails are shown; groups smaller than the configurable **k-anonymity** threshold are combined or withheld. CSV export of every aggregated dataset. |
| **Users** | Search, filter and sort all accounts; create accounts (with generated temporary passwords); edit details; **assign roles**; **deactivate / reactivate**; reset passwords; sign out of all devices; permanent delete (with typed confirmation). A detail page shows habits, check-ins, sign-ins and achievements. |
| **Habit categories** | System-wide category management: create, edit icon/color/description, reorder, hide or show in the app, delete unused ones. Categories in use cannot be renamed or deleted, so existing habits and analytics stay consistent. |
| **Notifications** | Notification **templates** with placeholders (`{{first_name}}`, `{{habit_count}}`, `{{best_streak}}`, …) and a live in-app preview; send to audiences (all students, recently active, inactive, students without habits, or one account); sent history with **read rate**; edit the automatic **habit reminder** text and **achievement** notifications. |
| **Support** | Issue reports (with attachments) and feature suggestions from the app; change status, keep notes, optionally notify the student. |
| **Audit log** | Every admin action and sign-in, searchable and exportable to CSV. |
| **Settings** | Change your password, privacy threshold (k), inactivity window, and system health (database latency, table sizes, sessions). |

### Roles

| Role | Access |
| --- | --- |
| Student (`user`) | Mobile app only. |
| PSAU Faculty (`faculty`) | Overview, anonymized Analytics, and read-only Categories and Notifications. No personal data. |
| System Administrator (`admin`) | Everything, including user management, support, audit log and settings. |

At least one active administrator must always remain; you cannot change your own role or deactivate yourself.

## Tech stack

- **Server:** Node.js, Express 5, `pg` (Neon PostgreSQL with verified TLS + channel binding), bcrypt, Zod validation, Helmet (CSP), express-rate-limit, cookie sessions (HttpOnly, SameSite=Strict) with a CSRF header check.
- **Client:** React 19 + TypeScript, Vite, React Router, Tailwind CSS v4, Recharts, lucide-react. Light and dark themes, responsive down to phone width, every chart has a table view.
- **Tests:** Node test runner (`npm test`).

## Getting started

Requirements: Node.js 20.19+ (tested on Node 24).

```bash
npm run install:all
```

Create `server/.env` from `server/.env.example` and set `DATABASE_URL` to the Neon connection string
(the same one the app backend uses). Then:

```bash
npm run dev
```

- Admin Panel: http://localhost:5174
- API: http://localhost:4000 (Vite proxies `/api` to it)

The server applies its own database migration on start (idempotent). It adds `role` and `status`
columns to `users` and creates `admin_sessions`, `habit_categories`, `notification_templates`,
`notification_broadcasts`, `admin_audit_log` and `admin_settings`. It never removes app data.

### Creating administrator accounts

```bash
npm run create-admin -- --email admin@psau.edu.ph --name "Maria Santos"
npm run create-admin -- --email faculty@psau.edu.ph --name "Jose Reyes" --role faculty
npm run create-admin -- --email existing.user@gmail.com --role admin        # promote an existing account
npm run create-admin -- --email admin@psau.edu.ph --reset-password           # issue a new temporary password
```

A generated temporary password is printed once (or written to a file with `--save <file>`).
Sign in and change it under **Settings → My account**. More staff can then be added from **Users**.

## Production

```bash
npm run build     # builds client/dist
npm start         # serves the API and the built client on API_PORT/PORT
```

Or with Docker:

```bash
docker build -t habitai-admin .
docker run -p 4000:4000 --env-file server/.env habitai-admin
```

On Render it is the `habitai-admin` service in the repository's root `render.yaml` (Docker, free
plan). It reuses the backend's `DATABASE_URL` and sets `NODE_ENV=production` and
`TRUST_PROXY=true`; syncing the Blueprint creates and deploys it. HTTPS is required in production
because the session cookie is `Secure`. See the Admin Panel section of `DEPLOYMENT.md`.

## Changes made to the HabitAI app

So that Admin Panel decisions take effect in the mobile app:

- `backend/server-neon.js`
  - Adds the `role`/`status` columns if missing.
  - Rejects sign-in for deactivated accounts (HTTP 403) and ends their existing sessions.
  - New public endpoint `GET /api/habit-categories` returning the active managed categories.
  - Leaderboards list active students only (staff accounts are excluded).
- `backend/scripts/send-web-push-reminders.js` + `services/web-push-reminders.js`
  - Uses the Admin Panel's **Habit reminder** template (`{{habit}}` placeholder) when active.
  - Skips deactivated accounts.
- `frontend/app/(tabs)/add.tsx` + `frontend/authentication/authService.ts`
  - The Add Habit screen loads categories (label, icon, color) from `/api/habit-categories`,
    falling back to the built-in list when offline.

Redeploy the app backend and frontend for these to reach production.

## Privacy notes

Analytics pages only receive aggregated numbers from the server. Staff accounts are excluded from
student statistics. Demographic groups and cohorts below the k threshold (default 3, adjustable
2–20 in Settings) are merged into “Other groups” or hidden. Personal data (names, emails) is only
visible to administrators in account management and support, and every such action is audited.
