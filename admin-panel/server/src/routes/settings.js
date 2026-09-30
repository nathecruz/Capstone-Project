import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { validate } from '../lib/http.js';
import { getSettings, saveSetting } from '../lib/settings.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';

const router = Router();

router.get('/', requireAuth, async (_request, response) => {
  response.json({ ok: true, settings: await getSettings(), timeZone: config.timeZone, appName: config.appName });
});

const settingsSchema = z.object({
  anonymityThreshold: z.number().int().min(2).max(20),
  inactiveDays: z.number().int().min(3).max(90),
}).strict();

router.put('/', requirePermission('settings:manage'), async (request, response) => {
  const input = validate(settingsSchema, request.body);
  const before = await getSettings();
  await saveSetting('anonymity_threshold', input.anonymityThreshold, request.admin.id);
  await saveSetting('inactive_days', input.inactiveDays, request.admin.id);
  await audit(request, {
    action: 'settings.updated',
    targetType: 'settings',
    summary: `Updated settings (privacy threshold ${input.anonymityThreshold}, inactivity ${input.inactiveDays} days)`,
    details: { before, after: input },
  });
  response.json({ ok: true, settings: await getSettings() });
});

router.get('/system', requirePermission('settings:manage'), async (_request, response) => {
  const started = performance.now();
  await query('SELECT 1');
  const latencyMs = Math.round(performance.now() - started);
  const [info, tables, sessions] = await Promise.all([
    query(`SELECT current_database() AS database, split_part(version(), ' ', 2) AS version, pg_database_size(current_database()) AS bytes`),
    query(
      `SELECT relname AS name, n_live_tup::int AS rows, pg_total_relation_size(relid) AS bytes
         FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY pg_total_relation_size(relid) DESC`,
    ),
    query(
      `SELECT (SELECT count(*)::int FROM sessions WHERE expires_at > $1) AS "appSessions",
              (SELECT count(*)::int FROM admin_sessions WHERE expires_at > $1) AS "adminSessions",
              (SELECT count(*)::int FROM web_push_subscriptions) AS "pushSubscriptions"`,
      [Date.now()],
    ),
  ]);
  response.json({
    ok: true,
    database: { ...info.rows[0], latencyMs, host: new URL(config.databaseUrl).hostname },
    tables: tables.rows,
    sessions: sessions.rows[0],
    server: { node: process.version, uptimeSeconds: Math.round(process.uptime()), timeZone: config.timeZone },
  });
});

export default router;
