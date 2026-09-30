import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { toCsv, validate } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  category: z.enum(['all', 'auth', 'user', 'category', 'template', 'notification', 'achievement', 'support', 'analytics', 'settings']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});

function filters(input) {
  const search = input.search ? `%${input.search.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : '';
  return {
    where: `($1 = '' OR summary ILIKE $1 OR actor_email ILIKE $1) AND ($2 = 'all' OR action LIKE $2 || '.%')`,
    params: [search, input.category],
  };
}

router.get('/', requirePermission('audit:view'), async (request, response) => {
  const input = validate(listSchema, request.query);
  const { where, params } = filters(input);
  const { rows } = await query(
    `SELECT id, actor_email AS "actorEmail", action, target_type AS "targetType", target_id AS "targetId",
            summary, details, ip, created_at AS "createdAt", count(*) OVER ()::int AS total
       FROM admin_audit_log WHERE ${where}
      ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
    [...params, input.pageSize, (input.page - 1) * input.pageSize],
  );
  response.json({ ok: true, items: rows.map(({ total: _total, ...row }) => row), total: rows[0]?.total ?? 0, page: input.page, pageSize: input.pageSize });
});

router.get('/export.csv', requirePermission('audit:view'), async (request, response) => {
  const input = validate(listSchema, request.query);
  const { where, params } = filters(input);
  const { rows } = await query(
    `SELECT to_char(to_timestamp(created_at / 1000.0), 'YYYY-MM-DD HH24:MI:SS') AS at, actor_email, action, summary, ip
       FROM admin_audit_log WHERE ${where} ORDER BY created_at DESC LIMIT 10000`,
    params,
  );
  const csv = toCsv(rows, [
    { key: 'at', label: 'Time (UTC)' },
    { key: 'actor_email', label: 'Actor' },
    { key: 'action', label: 'Action' },
    { key: 'summary', label: 'Summary' },
    { key: 'ip', label: 'IP address' },
  ]);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', 'attachment; filename="habitai-audit-log.csv"');
  response.send(`﻿${csv}`);
});

export default router;
