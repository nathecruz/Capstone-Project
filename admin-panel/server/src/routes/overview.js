import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { activityEventsSql, addDays, dateRange, expectedCheckIns, ratio, todayInZone } from '../lib/metrics.js';
import { hasPermission } from '../lib/permissions.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const RANGES = [7, 30, 90];

export async function loadCategoryOrder() {
  const { rows } = await query('SELECT label, sort_order AS "sortOrder", is_active AS "isActive" FROM habit_categories ORDER BY sort_order, label');
  return rows;
}

/**
 * One row per category with habit and completion counts. `slot` is the category's
 * position in the managed order, so a category keeps the same chart color everywhere.
 */
export function buildCategoryRows(managed, habitRows, completionRows) {
  const rows = new Map();
  const ensure = (label) => {
    const name = String(label || '').trim() || 'Uncategorized';
    const key = name.toLowerCase();
    if (!rows.has(key)) rows.set(key, { category: name, slot: -1, habits: 0, completions: 0 });
    return rows.get(key);
  };
  managed.forEach((category, index) => { ensure(category.label).slot = index; });
  for (const habit of habitRows) ensure(habit.category).habits += 1;
  for (const row of completionRows) ensure(row.category).completions += row.completions;

  let nextSlot = managed.length;
  return [...rows.values()]
    .sort((a, b) => (a.slot === -1) - (b.slot === -1) || a.slot - b.slot || a.category.localeCompare(b.category))
    .map((row) => (row.slot === -1 ? { ...row, slot: nextSlot++ } : row))
    .filter((row) => row.habits > 0 || row.completions > 0);
}

router.get('/', requirePermission('dashboard:view'), async (request, response) => {
  const range = RANGES.includes(Number(request.query.range)) ? Number(request.query.range) : 30;
  const tz = config.timeZone;
  const today = todayInZone(tz);
  const start = addDays(today, -(range - 1));
  const prevStart = addDays(start, -range);
  const prevEnd = addDays(start, -1);
  const eventsSince = prevStart < addDays(today, -29) ? prevStart : addDays(today, -29);

  const [accounts, activity, signups, completions, habits, categoryCompletions, funnel, heatmap, categories] = await Promise.all([
    query(
      `SELECT count(*) FILTER (WHERE role = 'user')::int AS students,
              count(*) FILTER (WHERE role = 'user' AND status = 'deactivated')::int AS deactivated,
              count(*) FILTER (WHERE role IN ('faculty', 'admin'))::int AS staff,
              count(*) FILTER (WHERE role = 'user' AND (to_timestamp(created_at / 1000.0) AT TIME ZONE $1)::date >= $2::date)::int AS "newInRange",
              count(*) FILTER (WHERE role = 'user' AND (to_timestamp(created_at / 1000.0) AT TIME ZONE $1)::date BETWEEN $3::date AND $4::date)::int AS "newPrev"
         FROM users`,
      [tz, start, prevStart, prevEnd],
    ),
    query(
      `WITH events AS (${activityEventsSql('$1', '$2')}),
            s AS (SELECT DISTINCT e.user_id, e.day FROM events e JOIN users u ON u.id = e.user_id WHERE u.role = 'user')
       SELECT (SELECT count(DISTINCT user_id) FROM s WHERE day >= $3::date)::int AS active,
              (SELECT count(DISTINCT user_id) FROM s WHERE day BETWEEN $4::date AND $5::date)::int AS "activePrev",
              (SELECT count(DISTINCT user_id) FROM s WHERE day = $6::date)::int AS dau,
              (SELECT count(DISTINCT user_id) FROM s WHERE day >= $7::date)::int AS wau,
              (SELECT count(DISTINCT user_id) FROM s WHERE day >= $8::date)::int AS mau,
              (SELECT COALESCE(json_agg(json_build_object('day', day, 'users', n)), '[]'::json)
                 FROM (SELECT day, count(DISTINCT user_id)::int AS n FROM s WHERE day >= $3::date GROUP BY day) d) AS daily`,
      [eventsSince, tz, start, prevStart, prevEnd, today, addDays(today, -6), addDays(today, -29)],
    ),
    query(
      `SELECT (to_timestamp(created_at / 1000.0) AT TIME ZONE $1)::date AS day, count(*)::int AS n
         FROM users WHERE role = 'user' AND (to_timestamp(created_at / 1000.0) AT TIME ZONE $1)::date >= $2::date
        GROUP BY 1`,
      [tz, start],
    ),
    query(
      `SELECT hc.completed_date AS day, count(*)::int AS n
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date AND hc.completed_date <= $2::date
        GROUP BY 1`,
      [prevStart, today],
    ),
    query(
      `SELECT h.id, h.user_id AS "userId", h.meta, h.category
         FROM habits h JOIN users u ON u.id = h.user_id AND u.role = 'user'`,
    ),
    query(
      `SELECT h.category, count(*)::int AS completions
         FROM habit_completions hc
         JOIN habits h ON h.id = hc.user_id || ':habit:' || hc.habit_id
         JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date
        GROUP BY 1`,
      [start],
    ),
    query(
      `SELECT count(*)::int AS registered,
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM habits h WHERE h.user_id = u.id))::int AS "createdHabit",
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM habit_completions c WHERE c.user_id = u.id))::int AS "completedHabit",
              count(*) FILTER (WHERE EXISTS (SELECT 1 FROM habit_completions c WHERE c.user_id = u.id AND c.completed_date >= $1::date))::int AS "checkedInRange"
         FROM users u WHERE u.role = 'user'`,
      [start],
    ),
    query(
      `SELECT extract(isodow FROM la.login_date_time AT TIME ZONE $1)::int AS dow,
              extract(hour FROM la.login_date_time AT TIME ZONE $1)::int AS hour,
              count(*)::int AS n
         FROM login_activity la JOIN users u ON u.id = la.user_id AND u.role = 'user'
        WHERE la.login_date_time >= ($2::date::timestamp AT TIME ZONE $1)
        GROUP BY 1, 2`,
      [tz, start],
    ),
    loadCategoryOrder(),
  ]);

  const account = accounts.rows[0];
  const act = activity.rows[0];

  const completionsByDay = new Map(completions.rows.map((row) => [row.day, row.n]));
  const signupsByDay = new Map(signups.rows.map((row) => [row.day, row.n]));
  const activeByDay = new Map((act.daily || []).map((row) => [row.day, row.users]));
  const days = dateRange(start, today);
  const series = days.map((day) => ({
    day,
    activeUsers: activeByDay.get(day) ?? 0,
    newUsers: signupsByDay.get(day) ?? 0,
    completions: completionsByDay.get(day) ?? 0,
  }));

  const sumCompletions = (from, to) => completions.rows.filter((row) => row.day >= from && row.day <= to).reduce((sum, row) => sum + row.n, 0);
  const completionsInRange = sumCompletions(start, today);
  const completionsPrev = sumCompletions(prevStart, prevEnd);
  const expected = habits.rows.reduce((sum, habit) => sum + expectedCheckIns(habit, start, today, tz), 0);
  const expectedPrev = habits.rows.reduce((sum, habit) => sum + expectedCheckIns(habit, prevStart, prevEnd, tz), 0);
  const studentsWithHabits = new Set(habits.rows.map((habit) => habit.userId)).size;

  const categoryBreakdown = buildCategoryRows(categories, habits.rows, categoryCompletions.rows);

  const heat = heatmap.rows.map((row) => ({ dow: row.dow, hour: row.hour, count: row.n }));

  const payload = {
    ok: true,
    range,
    period: { start, end: today, prevStart, prevEnd, timeZone: tz },
    kpis: {
      students: account.students,
      deactivated: account.deactivated,
      staff: account.staff,
      newStudents: account.newInRange,
      newStudentsPrev: account.newPrev,
      activeStudents: act.active,
      activeStudentsPrev: act.activePrev,
      dau: act.dau,
      wau: act.wau,
      mau: act.mau,
      stickiness: act.mau ? act.dau / act.mau : null,
      habits: habits.rowCount,
      habitsPerStudent: account.students ? habits.rowCount / account.students : 0,
      studentsWithHabits,
      completions: completionsInRange,
      completionsPrev,
      completionRate: ratio(completionsInRange, expected),
      completionRatePrev: ratio(completionsPrev, expectedPrev),
    },
    series,
    categoryBreakdown,
    funnel: [
      { stage: 'Registered', students: funnel.rows[0].registered },
      { stage: 'Created a habit', students: funnel.rows[0].createdHabit },
      { stage: 'Completed a habit', students: funnel.rows[0].completedHabit },
      { stage: `Checked in (last ${range} days)`, students: funnel.rows[0].checkedInRange },
    ],
    loginHeatmap: heat,
  };

  const extras = [];
  if (hasPermission(request.admin.role, 'support:view')) {
    extras.push(query(
      `SELECT (SELECT count(*)::int FROM issue_reports WHERE status IN ('open', 'in_progress')) AS "openIssues",
              (SELECT count(*)::int FROM feature_suggestions WHERE status = 'new') AS "newSuggestions"`,
    ).then(({ rows }) => { payload.support = rows[0]; }));
  }
  if (hasPermission(request.admin.role, 'audit:view')) {
    extras.push(query(
      `SELECT id, actor_email AS "actorEmail", action, summary, created_at AS "createdAt"
         FROM admin_audit_log WHERE action NOT LIKE 'auth.%' ORDER BY created_at DESC LIMIT 8`,
    ).then(({ rows }) => { payload.recentActivity = rows; }));
  }
  await Promise.all(extras);
  response.json(payload);
});

export default router;
