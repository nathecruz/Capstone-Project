import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { audit } from '../lib/audit.js';
import { HttpError, validate } from '../lib/http.js';
import { addDays, todayInZone } from '../lib/metrics.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const canView = requirePermission('categories:view');
const canManage = requirePermission('categories:manage');

// Ionicons names understood by the HabitAI app (verified against @expo/vector-icons).
export const CATEGORY_ICONS = [
  'heart-outline', 'bulb-outline', 'locate-outline', 'leaf-outline', 'school-outline', 'ellipsis-horizontal',
  'barbell-outline', 'fitness-outline', 'walk-outline', 'bicycle-outline', 'water-outline', 'restaurant-outline',
  'cafe-outline', 'moon-outline', 'sunny-outline', 'medkit-outline', 'book-outline', 'code-slash-outline',
  'calculator-outline', 'flask-outline', 'language-outline', 'briefcase-outline', 'time-outline', 'wallet-outline',
  'people-outline', 'chatbubbles-outline', 'home-outline', 'musical-notes-outline', 'brush-outline', 'happy-outline',
  'globe-outline', 'star-outline', 'planet-outline',
];

const fields = {
  label: z.string().trim().min(2).max(40),
  icon: z.enum(CATEGORY_ICONS),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'Color must be a hex value like #5B42D8.'),
  description: z.string().trim().max(200),
  isActive: z.boolean(),
};
// Zod 4 applies .default() even inside .partial(), so defaults live only on the create schema.
const createSchema = z.object({ ...fields, description: fields.description.default(''), isActive: fields.isActive.default(true) }).strict();
const updateSchema = z.object(fields).partial().strict();

function slugify(label) {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'category';
}

async function listCategories() {
  const since = addDays(todayInZone(config.timeZone), -29);
  const { rows } = await query(
    `SELECT c.id, c.label, c.icon, c.color, c.description, c.sort_order AS "sortOrder", c.is_active AS "isActive",
            c.created_at AS "createdAt", c.updated_at AS "updatedAt",
            COALESCE(u.habits, 0)::int AS "habitCount",
            COALESCE(u.students, 0)::int AS "studentCount",
            COALESCE(cc.completions, 0)::int AS "completions30d"
       FROM habit_categories c
       LEFT JOIN (
         SELECT lower(h.category) AS key, count(*) AS habits, count(DISTINCT h.user_id) AS students
           FROM habits h GROUP BY 1
       ) u ON u.key = lower(c.label)
       LEFT JOIN (
         SELECT lower(h.category) AS key, count(*) AS completions
           FROM habit_completions hc
           JOIN habits h ON h.id = hc.user_id || ':habit:' || hc.habit_id
          WHERE hc.completed_date >= $1::date
          GROUP BY 1
       ) cc ON cc.key = lower(c.label)
      ORDER BY c.sort_order, c.label`,
    [since],
  );
  // Categories still used by habits but no longer in the managed list.
  const unmanaged = await query(
    `SELECT h.category AS label, count(*)::int AS "habitCount", count(DISTINCT h.user_id)::int AS "studentCount"
       FROM habits h
      WHERE NOT EXISTS (SELECT 1 FROM habit_categories c WHERE lower(c.label) = lower(h.category))
      GROUP BY h.category ORDER BY 2 DESC`,
  );
  return { categories: rows, unmanaged: unmanaged.rows };
}

router.get('/', canView, async (_request, response) => {
  response.json({ ok: true, ...(await listCategories()), icons: CATEGORY_ICONS });
});

async function assertLabelFree(label, exceptId = null) {
  const { rowCount } = await query('SELECT 1 FROM habit_categories WHERE lower(label) = lower($1) AND ($2::text IS NULL OR id <> $2)', [label, exceptId]);
  if (rowCount) throw new HttpError(409, `A category named "${label}" already exists.`);
}

router.post('/', canManage, async (request, response) => {
  const input = validate(createSchema, request.body);
  await assertLabelFree(input.label);
  let id = slugify(input.label);
  const existing = await query('SELECT id FROM habit_categories WHERE id = $1 OR id LIKE $2', [id, `${id}-%`]);
  if (existing.rowCount) id = `${id}-${existing.rowCount + 1}`;
  const now = Date.now();

  await withTransaction(async (client) => {
    const order = await client.query('SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM habit_categories');
    await client.query(
      `INSERT INTO habit_categories(id, label, icon, color, description, sort_order, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
      [id, input.label, input.icon, input.color.toUpperCase(), input.description, order.rows[0].next, input.isActive, now],
    );
    await audit(request, { action: 'category.created', targetType: 'category', targetId: id, summary: `Created category "${input.label}"`, details: input }, client);
  });
  response.status(201).json({ ok: true, ...(await listCategories()) });
});

router.patch('/:id', canManage, async (request, response) => {
  const input = validate(updateSchema, request.body);
  const { rows } = await query('SELECT id, label, icon, color, description, is_active AS "isActive" FROM habit_categories WHERE id = $1', [request.params.id]);
  const before = rows[0];
  if (!before) throw new HttpError(404, 'Category not found.');

  if (input.label && input.label.toLowerCase() !== before.label.toLowerCase()) {
    await assertLabelFree(input.label, before.id);
    // Habits store the category label, so renaming a category that is in use would orphan them.
    const used = await query('SELECT count(*)::int AS count FROM habits WHERE lower(category) = lower($1)', [before.label]);
    if (used.rows[0].count > 0) {
      throw new HttpError(409, `"${before.label}" is used by ${used.rows[0].count} habit(s) and cannot be renamed. Deactivate it and create a new category instead.`);
    }
  }
  if (input.isActive === false && before.isActive) {
    const active = await query('SELECT count(*)::int AS count FROM habit_categories WHERE is_active AND id <> $1', [before.id]);
    if (active.rows[0].count === 0) throw new HttpError(409, 'At least one category must stay active.');
  }

  const next = { ...before, ...input };
  await withTransaction(async (client) => {
    await client.query(
      'UPDATE habit_categories SET label = $1, icon = $2, color = $3, description = $4, is_active = $5, updated_at = $6 WHERE id = $7',
      [next.label, next.icon, next.color.toUpperCase(), next.description, next.isActive, Date.now(), before.id],
    );
    const changed = Object.keys(input).filter((key) => input[key] !== before[key]);
    const verb = input.isActive === false && before.isActive ? 'Deactivated' : input.isActive === true && !before.isActive ? 'Activated' : 'Updated';
    await audit(request, { action: 'category.updated', targetType: 'category', targetId: before.id, summary: `${verb} category "${next.label}"`, details: { changed } }, client);
  });
  response.json({ ok: true, ...(await listCategories()) });
});

router.post('/reorder', canManage, async (request, response) => {
  const { ids } = validate(z.object({ ids: z.array(z.string().min(1).max(60)).min(1).max(100) }).strict(), request.body);
  await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id FROM habit_categories');
    const known = new Set(rows.map((row) => row.id));
    if (ids.length !== known.size || ids.some((id) => !known.has(id)) || new Set(ids).size !== ids.length) {
      throw new HttpError(400, 'The new order must list every category exactly once.');
    }
    for (const [index, id] of ids.entries()) {
      await client.query('UPDATE habit_categories SET sort_order = $1, updated_at = $2 WHERE id = $3', [index, Date.now(), id]);
    }
    await audit(request, { action: 'category.reordered', targetType: 'category', summary: 'Reordered habit categories', details: { ids } }, client);
  });
  response.json({ ok: true, ...(await listCategories()) });
});

router.delete('/:id', canManage, async (request, response) => {
  const { rows } = await query('SELECT id, label, is_active AS "isActive" FROM habit_categories WHERE id = $1', [request.params.id]);
  const category = rows[0];
  if (!category) throw new HttpError(404, 'Category not found.');
  const used = await query('SELECT count(*)::int AS count FROM habits WHERE lower(category) = lower($1)', [category.label]);
  if (used.rows[0].count > 0) {
    throw new HttpError(409, `"${category.label}" is used by ${used.rows[0].count} habit(s). Deactivate it instead so existing habits keep their category.`);
  }
  if (category.isActive) {
    const active = await query('SELECT count(*)::int AS count FROM habit_categories WHERE is_active AND id <> $1', [category.id]);
    if (active.rows[0].count === 0) throw new HttpError(409, 'At least one category must stay active.');
  }
  await withTransaction(async (client) => {
    await client.query('DELETE FROM habit_categories WHERE id = $1', [category.id]);
    await audit(request, { action: 'category.deleted', targetType: 'category', targetId: category.id, summary: `Deleted category "${category.label}"` }, client);
  });
  response.json({ ok: true, ...(await listCategories()) });
});

export default router;
