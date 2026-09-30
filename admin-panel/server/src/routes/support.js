import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('support:view');
const canManage = requirePermission('support:manage');

const ISSUE_STATUSES = ['open', 'in_progress', 'resolved', 'closed'];
const SUGGESTION_STATUSES = ['new', 'under_review', 'planned', 'done', 'declined'];
const ISSUE_STATUS_LABELS = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed' };

const ATTACHMENT_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
};

router.get('/issues', canView, async (request, response) => {
  const status = ISSUE_STATUSES.includes(request.query.status) ? request.query.status : null;
  const { rows } = await query(
    `SELECT i.id, i.topic, i.timing, i.description, i.status, i.admin_notes AS "adminNotes", i.created_at AS "createdAt",
            i.updated_at AS "updatedAt", i.attachment_name AS "attachmentName",
            (i.attachment_data IS NOT NULL) AS "hasAttachment",
            u.id AS "userId", u.full_name AS "userName", u.email AS "userEmail"
       FROM issue_reports i JOIN users u ON u.id = i.user_id
      WHERE ($1::text IS NULL OR i.status = $1)
      ORDER BY CASE i.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, i.created_at DESC
      LIMIT 200`,
    [status],
  );
  const counts = await query('SELECT status, count(*)::int AS count FROM issue_reports GROUP BY status');
  response.json({ ok: true, items: rows, counts: Object.fromEntries(counts.rows.map((row) => [row.status, row.count])) });
});

router.get('/issues/:id/attachment', canView, async (request, response) => {
  const { rows } = await query('SELECT attachment_name AS name, attachment_data AS data FROM issue_reports WHERE id = $1', [request.params.id]);
  const attachment = rows[0];
  if (!attachment?.data) throw new HttpError(404, 'This report has no stored attachment.');
  const extension = String(attachment.name || '').toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? '';
  const type = ATTACHMENT_TYPES[extension] ?? 'application/octet-stream';
  const safeName = String(attachment.name || 'attachment').replace(/[^\w.-]+/g, '_').slice(0, 100);
  response.setHeader('Content-Type', type);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'");
  response.setHeader('Content-Disposition', `${type === 'application/octet-stream' ? 'attachment' : 'inline'}; filename="${safeName}"`);
  response.send(attachment.data);
});

const issueUpdateSchema = z.object({
  status: z.enum(ISSUE_STATUSES),
  adminNotes: z.string().trim().max(1000).default(''),
  notifyUser: z.boolean().default(false),
}).strict();

router.patch('/issues/:id', canManage, async (request, response) => {
  const input = validate(issueUpdateSchema, request.body);
  const { rows } = await query('SELECT id, user_id AS "userId", topic, status FROM issue_reports WHERE id = $1', [request.params.id]);
  const issue = rows[0];
  if (!issue) throw new HttpError(404, 'Issue report not found.');

  await withTransaction(async (client) => {
    const now = Date.now();
    await client.query('UPDATE issue_reports SET status = $1, admin_notes = $2, updated_at = $3 WHERE id = $4', [input.status, input.adminNotes, now, issue.id]);
    if (input.notifyUser && input.status !== issue.status) {
      await client.query(
        `INSERT INTO notifications(id, user_id, type, title, body, created_at) VALUES ($1, $2, 'system', $3, $4, $5)`,
        [
          `${issue.userId}:notification:support:${crypto.randomUUID()}`,
          issue.userId,
          `Your report is now ${ISSUE_STATUS_LABELS[input.status].toLowerCase()}`,
          `We updated your report about "${issue.topic}".${input.adminNotes ? ` ${input.adminNotes}` : ''}`.slice(0, 600),
          now,
        ],
      );
    }
    await audit(request, {
      action: 'support.issue_updated',
      targetType: 'issue',
      targetId: issue.id,
      summary: `Marked issue "${issue.topic}" as ${ISSUE_STATUS_LABELS[input.status]}`,
      details: { from: issue.status, to: input.status, notified: input.notifyUser },
    }, client);
  });
  response.json({ ok: true });
});

router.get('/suggestions', canView, async (_request, response) => {
  const { rows } = await query(
    `SELECT s.id, s.suggestion, s.status, s.created_at AS "createdAt", s.updated_at AS "updatedAt",
            u.full_name AS "userName", u.email AS "userEmail"
       FROM feature_suggestions s JOIN users u ON u.id = s.user_id
      ORDER BY s.created_at DESC LIMIT 200`,
  );
  response.json({ ok: true, items: rows });
});

router.patch('/suggestions/:id', canManage, async (request, response) => {
  const input = validate(z.object({ status: z.enum(SUGGESTION_STATUSES) }).strict(), request.body);
  const result = await query('UPDATE feature_suggestions SET status = $1, updated_at = $2 WHERE id = $3 RETURNING suggestion', [input.status, Date.now(), request.params.id]);
  if (!result.rowCount) throw new HttpError(404, 'Suggestion not found.');
  await audit(request, {
    action: 'support.suggestion_updated',
    targetType: 'suggestion',
    targetId: request.params.id,
    summary: `Set suggestion status to ${input.status.replace('_', ' ')}`,
    details: { status: input.status },
  });
  response.json({ ok: true });
});

export default router;
