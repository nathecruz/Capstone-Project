// Check-in proofs (backend/services/check-in-proof.js) for administrators: who proved which habit
// and how (a Focus timer of so many minutes, a walk of so many steps, or a photo), and the photo
// while the app keeps it. Opening a photo is in the audit log. Faculty see anonymized class numbers
// only (Class Pulse), so this page is not theirs.
import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('proofs:view');
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const listSchema = z.object({
  search: z.string().trim().max(100).default(''),
  kind: z.enum(['all', 'timer', 'steps', 'photo']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(100).default(25),
});
const photoSchema = z.object({ userId: z.string().min(1).max(80), habitId: z.string().min(1).max(120), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict();

router.get('/', canView, async (request, response) => {
  const input = validate(listSchema, request.query);
  const search = input.search ? `%${input.search.replace(/[\\%_]/g, (character) => `\\${character}`)}%` : '';
  try {
    const { rows } = await query(
      `SELECT p.user_id AS "userId", p.habit_id AS "habitId", p.completed_date::text AS date, p.kind, p.minutes, p.steps,
              p.created_at AS "createdAt", (p.photo IS NOT NULL) AS "hasPhoto",
              u.full_name AS name, u.username, u.role, COALESCE(NULLIF(h.label, ''), p.habit_id) AS habit, h.category,
              count(*) OVER ()::int AS total
         FROM check_in_proofs p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN habits h ON h.id = p.user_id || ':habit:' || p.habit_id
        WHERE ($1 = '' OR u.full_name ILIKE $1 OR u.username ILIKE $1 OR h.label ILIKE $1) AND ($2 = 'all' OR p.kind = $2)
        ORDER BY p.created_at DESC LIMIT $3 OFFSET $4`,
      [search, input.kind, input.pageSize, (input.page - 1) * input.pageSize],
    );
    response.json({ ok: true, items: rows.map(({ total: _total, createdAt, ...row }) => ({ ...row, createdAt: Number(createdAt) })), total: rows[0]?.total ?? 0, page: input.page, pageSize: input.pageSize });
  } catch (error) {
    // The app's backend creates the table; an Admin Panel deployed first has nothing to show yet.
    if (error?.code === '42P01') return response.json({ ok: true, items: [], total: 0, page: input.page, pageSize: input.pageSize });
    throw error;
  }
});

router.get('/photo', canView, async (request, response) => {
  const input = validate(photoSchema, request.query);
  const { rows } = await query('SELECT photo, photo_type AS "photoType" FROM check_in_proofs WHERE user_id = $1 AND habit_id = $2 AND completed_date = $3', [input.userId, input.habitId, input.date]);
  const row = rows[0];
  if (!row?.photo || !PHOTO_TYPES.includes(row.photoType)) throw new HttpError(404, 'This photo is no longer kept.');
  await audit(request, { action: 'user.proof_photo_viewed', targetType: 'user', targetId: input.userId, summary: `Opened a check-in photo (${input.habitId}, ${input.date})` });
  response.setHeader('Content-Type', row.photoType);
  response.setHeader('Cache-Control', 'private, no-store');
  response.send(row.photo);
});

export default router;
