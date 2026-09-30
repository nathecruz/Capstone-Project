import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { addDays, todayInZone } from '../lib/metrics.js';
import { getSettings } from '../lib/settings.js';
import { loadLiveStreaks } from '../lib/streaks.js';
import { TEMPLATE_VARIABLES, recipientVariables, renderTemplate, sampleVariables, unknownPlaceholders } from '../lib/templates.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('notifications:view');
const canManage = requirePermission('notifications:manage');

// The app groups notifications by type: "achievement" -> Achievements, contains "system" -> System, else Reminders.
const TYPES = ['system', 'reminder'];

const templateFields = {
  name: z.string().trim().min(2).max(80),
  type: z.enum(TYPES),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  description: z.string().trim().max(200),
  isActive: z.boolean(),
};
const createTemplateSchema = z.object({ ...templateFields, description: templateFields.description.default(''), isActive: templateFields.isActive.default(true) }).strict();
const updateTemplateSchema = z.object(templateFields).partial().strict();

function assertPlaceholders(...texts) {
  const unknown = texts.flatMap((text) => (text ? unknownPlaceholders(text) : []));
  if (unknown.length) throw new HttpError(400, `Unknown placeholder(s): ${[...new Set(unknown)].map((key) => `{{${key}}}`).join(', ')}`);
}

async function listTemplates() {
  const { rows } = await query(
    `SELECT t.id, t.name, t.type, t.title, t.body, t.description, t.is_active AS "isActive", t.is_system AS "isSystem",
            t.created_at AS "createdAt", t.updated_at AS "updatedAt",
            (SELECT count(*)::int FROM notification_broadcasts b WHERE b.template_id = t.id) AS "timesSent",
            (SELECT max(b.sent_at) FROM notification_broadcasts b WHERE b.template_id = t.id) AS "lastSentAt"
       FROM notification_templates t
      ORDER BY t.is_system DESC, lower(t.name)`,
  );
  return rows;
}

router.get('/templates', canView, async (_request, response) => {
  response.json({ ok: true, templates: await listTemplates(), variables: TEMPLATE_VARIABLES, sample: sampleVariables(config.appName) });
});

router.post('/templates', canManage, async (request, response) => {
  const input = validate(createTemplateSchema, request.body);
  assertPlaceholders(input.title, input.body);
  const duplicate = await query('SELECT 1 FROM notification_templates WHERE lower(name) = lower($1)', [input.name]);
  if (duplicate.rowCount) throw new HttpError(409, 'A template with this name already exists.');
  const id = crypto.randomUUID();
  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO notification_templates(id, name, type, title, body, description, is_active, is_system, created_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, $9, $9)`,
      [id, input.name, input.type, input.title, input.body, input.description, input.isActive, request.admin.id, now],
    );
    await audit(request, { action: 'template.created', targetType: 'template', targetId: id, summary: `Created template "${input.name}"` }, client);
  });
  response.status(201).json({ ok: true, templates: await listTemplates() });
});

router.patch('/templates/:id', canManage, async (request, response) => {
  const input = validate(updateTemplateSchema, request.body);
  assertPlaceholders(input.title, input.body);
  const { rows } = await query('SELECT id, name, type, is_system AS "isSystem" FROM notification_templates WHERE id = $1', [request.params.id]);
  const template = rows[0];
  if (!template) throw new HttpError(404, 'Template not found.');
  if (template.isSystem && input.type && input.type !== template.type) throw new HttpError(409, 'The type of an automatic template cannot be changed.');
  if (input.name && input.name.toLowerCase() !== template.name.toLowerCase()) {
    const duplicate = await query('SELECT 1 FROM notification_templates WHERE lower(name) = lower($1) AND id <> $2', [input.name, template.id]);
    if (duplicate.rowCount) throw new HttpError(409, 'A template with this name already exists.');
  }

  const columns = { name: 'name', type: 'type', title: 'title', body: 'body', description: 'description', isActive: 'is_active' };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (input[key] !== undefined) {
      values.push(input[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return response.json({ ok: true, templates: await listTemplates() });
  values.push(Date.now(), template.id);

  await withTransaction(async (client) => {
    await client.query(`UPDATE notification_templates SET ${sets.join(', ')}, updated_at = $${values.length - 1} WHERE id = $${values.length}`, values);
    await audit(request, { action: 'template.updated', targetType: 'template', targetId: template.id, summary: `Updated template "${input.name ?? template.name}"`, details: { changed: Object.keys(input) } }, client);
  });
  response.json({ ok: true, templates: await listTemplates() });
});

router.delete('/templates/:id', canManage, async (request, response) => {
  const { rows } = await query('SELECT id, name, is_system AS "isSystem" FROM notification_templates WHERE id = $1', [request.params.id]);
  const template = rows[0];
  if (!template) throw new HttpError(404, 'Template not found.');
  if (template.isSystem) throw new HttpError(409, 'Automatic templates cannot be deleted. Deactivate it to fall back to the built-in text.');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM notification_templates WHERE id = $1', [template.id]);
    await audit(request, { action: 'template.deleted', targetType: 'template', targetId: template.id, summary: `Deleted template "${template.name}"` }, client);
  });
  response.json({ ok: true, templates: await listTemplates() });
});

// ---------------------------------------------------------------------------
// Audiences and broadcasts

const audienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }).strict(),
  z.object({ kind: z.literal('active') }).strict(),
  z.object({ kind: z.literal('inactive') }).strict(),
  z.object({ kind: z.literal('no_habits') }).strict(),
  z.object({ kind: z.literal('users'), userIds: z.array(z.string().min(1).max(80)).min(1).max(500) }).strict(),
]);

async function resolveAudience(audience) {
  const { inactiveDays } = await getSettings();
  const since = addDays(todayInZone(config.timeZone), -(inactiveDays - 1));
  const activeSql = `EXISTS (
      SELECT 1 FROM login_activity la WHERE la.user_id = u.id AND la.login_date_time >= ($1::date::timestamp AT TIME ZONE $2)
    ) OR EXISTS (
      SELECT 1 FROM user_app_state s WHERE s.user_id = u.id AND s.updated_at >= extract(epoch FROM ($1::date::timestamp AT TIME ZONE $2)) * 1000
    ) OR EXISTS (
      SELECT 1 FROM habit_completions hc WHERE hc.user_id = u.id AND hc.completed_date >= $1::date
    )`;

  const activityParams = [since, config.timeZone];
  const filters = {
    all: { sql: "u.role = 'user'", params: [], label: 'All students' },
    active: { sql: `u.role = 'user' AND (${activeSql})`, params: activityParams, label: `Students active in the last ${inactiveDays} days` },
    inactive: { sql: `u.role = 'user' AND NOT (${activeSql})`, params: activityParams, label: `Students inactive for ${inactiveDays}+ days` },
    no_habits: { sql: "u.role = 'user' AND NOT EXISTS (SELECT 1 FROM habits h WHERE h.user_id = u.id)", params: [], label: 'Students without habits' },
    users: { sql: 'u.id = ANY($1::text[])', params: [audience.userIds], label: '' },
  };
  const filter = filters[audience.kind];
  const { rows } = await query(
    `SELECT u.id, u.full_name AS "fullName", u.username,
            (SELECT count(*)::int FROM habits h WHERE h.user_id = u.id) AS "habitCount",
            ARRAY(SELECT h.id FROM habits h WHERE h.user_id = u.id) AS "habitIds"
       FROM users u
      WHERE u.status = 'active' AND (${filter.sql})`,
    filter.params,
  );
  // {{best_streak}} uses live streaks, not the value stored at the student's last sync.
  const liveStreaks = rows.length ? await loadLiveStreaks(config.timeZone) : new Map();
  for (const recipient of rows) {
    recipient.bestStreak = Math.max(0, ...(recipient.habitIds || []).map((habitId) => liveStreaks.get(habitId) ?? 0));
    delete recipient.habitIds;
  }
  const label = audience.kind === 'users'
    ? (rows.length === 1 ? `1 selected account` : `${rows.length} selected accounts`)
    : filter.label;
  return { recipients: rows, label };
}

router.post('/audience-preview', canView, async (request, response) => {
  const audience = validate(audienceSchema, request.body?.audience);
  const { recipients, label } = await resolveAudience(audience);
  response.json({ ok: true, count: recipients.length, label });
});

const broadcastSchema = z.object({
  templateId: z.string().max(80).nullable().default(null),
  type: z.enum(TYPES),
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  audience: audienceSchema,
}).strict();

router.post('/broadcasts', canManage, async (request, response) => {
  const input = validate(broadcastSchema, request.body);
  assertPlaceholders(input.title, input.body);
  if (/\{\{\s*habit\s*\}\}/i.test(input.title + input.body)) {
    throw new HttpError(400, '{{habit}} is only available in the automatic habit reminder template.');
  }
  if (input.templateId) {
    const template = await query('SELECT is_system AS "isSystem" FROM notification_templates WHERE id = $1', [input.templateId]);
    if (!template.rowCount) throw new HttpError(404, 'Template not found.');
    if (template.rows[0].isSystem) throw new HttpError(409, 'Automatic templates cannot be broadcast manually.');
  }

  const { recipients, label } = await resolveAudience(input.audience);
  if (!recipients.length) throw new HttpError(400, 'No active accounts match this audience.');

  const broadcastId = crypto.randomUUID();
  const now = Date.now();
  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO notification_broadcasts(id, template_id, type, title, body, audience, audience_label, recipient_count, sent_by, sent_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [broadcastId, input.templateId, input.type, input.title, input.body, input.audience.kind, label, recipients.length, request.admin.id, now],
    );
    for (let index = 0; index < recipients.length; index += 500) {
      const batch = recipients.slice(index, index + 500);
      const ids = [];
      const users = [];
      const titles = [];
      const bodies = [];
      for (const recipient of batch) {
        const variables = recipientVariables(recipient, config.appName);
        ids.push(`${recipient.id}:notification:broadcast:${broadcastId}`);
        users.push(recipient.id);
        titles.push(renderTemplate(input.title, variables).slice(0, 160));
        bodies.push(renderTemplate(input.body, variables).slice(0, 600));
      }
      await client.query(
        `INSERT INTO notifications(id, user_id, type, title, body, created_at)
         SELECT id, user_id, $5, title, body, $6
           FROM unnest($1::text[], $2::text[], $3::text[], $4::text[]) AS t(id, user_id, title, body)
         ON CONFLICT (id) DO NOTHING`,
        [ids, users, titles, bodies, input.type, now],
      );
    }
    await audit(request, {
      action: 'notification.broadcast',
      targetType: 'broadcast',
      targetId: broadcastId,
      summary: `Sent "${input.title}" to ${recipients.length} account(s) (${label})`,
      details: { audience: input.audience.kind, recipients: recipients.length, templateId: input.templateId },
    }, client);
  });

  response.status(201).json({ ok: true, id: broadcastId, recipients: recipients.length });
});

router.get('/broadcasts', canView, async (request, response) => {
  const page = Math.max(1, Number(request.query.page) || 1);
  const pageSize = 20;
  const { rows } = await query(
    `SELECT b.id, b.type, b.title, b.body, b.audience, b.audience_label AS "audienceLabel", b.recipient_count AS "recipientCount",
            b.sent_at AS "sentAt", t.name AS "templateName", u.full_name AS "sentBy",
            COALESCE(r.delivered, 0)::int AS delivered, COALESCE(r.read, 0)::int AS read,
            count(*) OVER ()::int AS total
       FROM notification_broadcasts b
       LEFT JOIN notification_templates t ON t.id = b.template_id
       LEFT JOIN users u ON u.id = b.sent_by
       LEFT JOIN LATERAL (
         SELECT count(*) AS delivered, count(n.read_at) AS read
           FROM notifications n
          WHERE n.id LIKE '%:notification:broadcast:' || b.id
       ) r ON TRUE
      ORDER BY b.sent_at DESC
      LIMIT $1 OFFSET $2`,
    [pageSize, (page - 1) * pageSize],
  );
  response.json({ ok: true, items: rows, total: rows[0]?.total ?? 0, page, pageSize });
});

// ---------------------------------------------------------------------------
// Automatic achievement notifications (the app uses achievements.name/description as title/body)

router.get('/achievements', canView, async (_request, response) => {
  const { rows } = await query(
    `SELECT a.id, a.name, a.description,
            (SELECT count(*)::int FROM user_achievements ua WHERE ua.achievement_id = a.id) AS "earnedBy"
       FROM achievements a ORDER BY a.id`,
  );
  response.json({ ok: true, achievements: rows });
});

router.patch('/achievements/:id', canManage, async (request, response) => {
  const input = validate(z.object({ name: z.string().trim().min(2).max(60), description: z.string().trim().min(2).max(200) }).strict(), request.body);
  const { rows } = await query('SELECT id, name FROM achievements WHERE id = $1', [request.params.id]);
  if (!rows[0]) throw new HttpError(404, 'Achievement not found.');
  const duplicate = await query('SELECT 1 FROM achievements WHERE lower(name) = lower($1) AND id <> $2', [input.name, rows[0].id]);
  if (duplicate.rowCount) throw new HttpError(409, 'Another achievement already uses this name.');
  await withTransaction(async (client) => {
    await client.query('UPDATE achievements SET name = $1, description = $2 WHERE id = $3', [input.name, input.description, rows[0].id]);
    await audit(request, { action: 'achievement.updated', targetType: 'achievement', targetId: rows[0].id, summary: `Updated achievement notification "${input.name}"` }, client);
  });
  response.json({ ok: true });
});

export default router;
