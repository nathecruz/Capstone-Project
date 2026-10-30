import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { query, queryIfTable } from '../db.js';
import { audit } from '../lib/audit.js';
import { activeUntilOf, hasHabitEnded } from '../lib/habit-week.js';
import { toCsv, validate } from '../lib/http.js';
import {
  AGE_BRACKET_ORDER,
  REMINDER_PERIOD_ORDER,
  STREAK_BUCKET_ORDER,
  activityEventsSql,
  addDays,
  ageBracket,
  expectedPerWeek,
  habitFirstDay,
  habitFrequency,
  mondayOf,
  ratio,
  reminderPeriod,
  streakBucket,
  suppressSmallGroups,
  todayInZone,
  withholdSmallBalances,
} from '../lib/metrics.js';
import { getSettings } from '../lib/settings.js';
import { loadLiveStreaks } from '../lib/streaks.js';
import { byKindOrder, flowTotals, SHOWCASE_REWARD_ID, tokenKindSql } from '../lib/token-kinds.js';
import { requirePermission } from '../middleware/auth.js';
import { buildCategoryRows, loadCategoryOrder } from './overview.js';

const router = Router();
const RANGES = [30, 90, 180, 365];
const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COHORT_WEEKS = 8;
const ECONOMY_DAYS = 28;
const ECONOMY_WEEKS = 4;
// The weekly bonus tiers' amounts (backend/services/weekly-bonus.js WEEKLY_BONUS_TIERS).
const BONUS_AMOUNTS = { gold: 30, silver: 20, bronze: 10 };

const dayNumber = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86_400_000;
// SQL: the epoch milliseconds (created_at, bought_at) at which a day starts in a time zone.
const dayStartMs = (dayParam, tzParam) => `extract(epoch FROM (${dayParam}::date::timestamp AT TIME ZONE ${tzParam})) * 1000`;

/**
 * Pre-computes each habit's daily expectation and the days it can be due (from its first day to
 * the end of its week, lib/habit-week.js) so period sums are cheap. `current`: not ended by `today`.
 */
export function prepareHabits(habits, timeZone, today) {
  return habits.map((habit) => {
    const firstDay = habitFirstDay(habit, timeZone);
    const activeUntil = activeUntilOf(habit);
    return {
      ...habit,
      perDay: expectedPerWeek(habit.meta) / 7,
      firstDay: firstDay ? dayNumber(firstDay) : null,
      lastDay: activeUntil ? dayNumber(activeUntil) : null,
      current: !hasHabitEnded(habit, today),
    };
  });
}

export function expectedBetween(prepared, fromKey, toKey) {
  const from = dayNumber(fromKey);
  const to = dayNumber(toKey);
  let total = 0;
  for (const habit of prepared) {
    const start = habit.firstDay !== null && habit.firstDay > from ? habit.firstDay : from;
    const end = habit.lastDay !== null && habit.lastDay < to ? habit.lastDay : to;
    if (start > end) continue;
    total += habit.perDay * (end - start + 1);
  }
  return total;
}

function countBy(items, keyOf, order) {
  const counts = new Map(order.map((key) => [key, 0]));
  for (const item of items) {
    const key = keyOf(item);
    if (key === null || key === undefined) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => ({ label, count }));
}

/**
 * The token economy for faculty and administrators, students only and aggregates only: the last 28
 * days' flow by kind (issued without refunds, spent without undone check-ins), the balances of the
 * students active in those days (over 1,000 banked hints that spending options are too weak), the
 * weekly bonus claims and Weekly Drops of the last 4 weeks, the other sinks, the student-days over
 * the check-in cap, and the rewards on sale. Tables a newer app backend adds are only read once they
 * exist (queryIfTable). The balances are withheld below the anonymity threshold `k`.
 */
export async function computeEconomy(tz, today, k) {
  const start = addDays(today, -(ECONOMY_DAYS - 1));
  const thisWeek = mondayOf(today);
  // A bonus is claimed for the week before, so its weeks end last week; this week's drop is on sale now.
  const bonusWeeks = Array.from({ length: ECONOMY_WEEKS }, (_, index) => addDays(thisWeek, -7 * (ECONOMY_WEEKS - index)));
  const dropWeeks = Array.from({ length: ECONOMY_WEEKS }, (_, index) => addDays(thisWeek, -7 * (ECONOMY_WEEKS - 1 - index)));
  const { paidPerDay, cappedFrom } = config.checkIns;
  const capStart = cappedFrom > start ? cappedFrom : start;

  const [flow, balances, bonuses, drops, facts, rewards, gifts] = await Promise.all([
    query(
      `SELECT ${tokenKindSql('t')} AS kind,
              COALESCE(sum(t.amount) FILTER (WHERE t.amount > 0), 0)::int AS earned,
              COALESCE(-sum(t.amount) FILTER (WHERE t.amount < 0), 0)::int AS spent,
              count(*) FILTER (WHERE t.amount < 0)::int AS spends
         FROM token_transactions t JOIN users u ON u.id = t.user_id AND u.role = 'user'
        WHERE t.created_at >= ${dayStartMs('$1', '$2')}
        GROUP BY 1`,
      [start, tz],
    ),
    query(
      `WITH events AS (${activityEventsSql('$1', '$2')}),
            active AS (SELECT DISTINCT e.user_id FROM events e JOIN users u ON u.id = e.user_id AND u.role = 'user' AND u.status = 'active'),
            balances AS (
              SELECT GREATEST(COALESCE(sum(t.amount), 0), 0) AS balance
                FROM active a LEFT JOIN token_transactions t ON t.user_id = a.user_id
               GROUP BY a.user_id)
       SELECT count(*)::int AS students,
              COALESCE(round(percentile_cont(0.5) WITHIN GROUP (ORDER BY balance)), 0)::int AS median,
              COALESCE(round(percentile_cont(0.9) WITHIN GROUP (ORDER BY balance)), 0)::int AS p90,
              count(*) FILTER (WHERE balance > 1000)::int AS over1000
         FROM balances`,
      [start, tz],
    ),
    // The bonus row of a week is `<user id>:token:week:<week start>`.
    query(
      `SELECT substring(t.id from position(':token:week:' in t.id) + 12) AS "weekStart", count(*)::int AS claims,
              count(*) FILTER (WHERE t.amount = $2)::int AS gold,
              count(*) FILTER (WHERE t.amount = $3)::int AS silver,
              count(*) FILTER (WHERE t.amount = $4)::int AS bronze
         FROM token_transactions t JOIN users u ON u.id = t.user_id AND u.role = 'user'
        WHERE t.id LIKE '%:token:week:%' AND substring(t.id from position(':token:week:' in t.id) + 12) = ANY($1::text[])
        GROUP BY 1`,
      [bonusWeeks, BONUS_AMOUNTS.gold, BONUS_AMOUNTS.silver, BONUS_AMOUNTS.bronze],
    ),
    query(
      `SELECT date_trunc('week', to_timestamp(b.bought_at / 1000.0) AT TIME ZONE $2)::date AS "weekStart", count(*)::int AS bought
         FROM buddy_items b JOIN users u ON u.id = b.user_id AND u.role = 'user'
        WHERE b.item_id LIKE 'drop-%' AND b.bought_at >= ${dayStartMs('$1', '$2')}
        GROUP BY 1`,
      [dropWeeks[0], tz],
    ),
    query(
      `SELECT
         (SELECT count(DISTINCT rr.user_id)::int FROM reward_redemptions rr JOIN users u ON u.id = rr.user_id AND u.role = 'user'
           WHERE rr.reward_id = $1) AS "showcaseOwners",
         (SELECT count(*)::int FROM streak_freeze_days f JOIN users u ON u.id = f.user_id AND u.role = 'user'
           WHERE f.freeze_date >= $2::date) AS "freezesUsed",
         (SELECT count(*)::int FROM (
            SELECT 1 FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
             WHERE hc.completed_date >= $3::date
             GROUP BY hc.user_id, hc.completed_date HAVING count(*) > $4) capped) AS "cappedDays",
         (SELECT count(*)::int FROM rewards WHERE NOT active) AS "retiredRewards",
         (SELECT COALESCE(sum(t.amount), 0)::int FROM token_transactions t JOIN users u ON u.id = t.user_id AND u.role = 'user'
           WHERE t.id LIKE '%:token:refund:%' AND t.id NOT LIKE '%:token:refund:coach:%') AS "refundedTokens"`,
      [SHOWCASE_REWARD_ID, start, capStart, paidPerDay],
    ),
    // Rewards on sale only: retired ones are no longer sold and were refunded.
    query(
      `SELECT r.name, count(rr.id)::int AS redemptions, r.token_cost AS "tokenCost"
         FROM rewards r
         LEFT JOIN reward_redemptions rr ON rr.reward_id = r.id AND EXISTS (SELECT 1 FROM users u WHERE u.id = rr.user_id AND u.role = 'user')
        WHERE r.active
        GROUP BY r.id, r.name, r.token_cost ORDER BY r.token_cost`,
    ),
    queryIfTable(
      'buddy_gifts',
      `SELECT count(*)::int AS n FROM buddy_gifts g JOIN users u ON u.id = g.sender_id AND u.role = 'user'
        WHERE g.created_at >= ${dayStartMs('$1', '$2')}`,
      [start, tz],
      [{ n: 0 }],
    ),
  ]);

  const byKind28 = byKindOrder(flow.rows.map(({ kind, earned, spent }) => ({ kind, earned, spent })));
  const totals = flowTotals(byKind28);
  const bonusByWeek = new Map(bonuses.rows.map((row) => [row.weekStart, row]));
  const dropsByWeek = new Map(drops.rows.map((row) => [row.weekStart, row.bought]));
  const fact = facts.rows[0];
  return {
    since: start,
    checkInCap: { perDay: paidPerDay, from: cappedFrom },
    issued28: totals.issued,
    refunds28: totals.refunds,
    spent28: totals.spent,
    undone28: totals.undone,
    byKind28,
    balances: withholdSmallBalances(balances.rows[0], k),
    weeklyBonus: bonusWeeks.map((weekStart) => ({ claims: 0, gold: 0, silver: 0, bronze: 0, ...bonusByWeek.get(weekStart), weekStart })),
    drops: dropWeeks.map((weekStart) => ({ weekStart, bought: dropsByWeek.get(weekStart) ?? 0 })),
    showcaseOwners: fact.showcaseOwners,
    gifts28: gifts.rows[0].n,
    freezes: { bought28: flow.rows.find((row) => row.kind === 'freeze')?.spends ?? 0, used28: fact.freezesUsed },
    cappedDays28: fact.cappedDays,
    rewards: rewards.rows,
    retired: { count: fact.retiredRewards, refundedTokens: fact.refundedTokens },
  };
}

export async function computeAnalytics(range) {
  const { anonymityThreshold: k } = await getSettings();
  const tz = config.timeZone;
  const today = todayInZone(tz);
  const start = addDays(today, -(range - 1));
  const firstWeek = mondayOf(start);
  const cohortStart = addDays(mondayOf(today), -7 * (COHORT_WEEKS - 1));
  const eventsSince = cohortStart < start ? cohortStart : start;

  const [students, habitRows, perUser, perWeek, perDow, perCategory, weeklyActive, activeCount, goals, economy, achievements, categories] = await Promise.all([
    query(`SELECT id, gender, region, date_of_birth AS "dateOfBirth", created_at AS "createdAt" FROM users WHERE role = 'user'`),
    query(
      `SELECT h.id, h.user_id AS "userId", h.meta, h.category, h.streak, h.start_date, h.active_until,
              h.reminder_enabled AS "reminderEnabled", h.reminder_time AS "reminderTime"
         FROM habits h JOIN users u ON u.id = h.user_id AND u.role = 'user'`,
    ),
    query(
      `SELECT hc.user_id AS "userId", count(*)::int AS n
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date GROUP BY 1`,
      [start],
    ),
    query(
      `SELECT date_trunc('week', hc.completed_date)::date AS week, count(*)::int AS n
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date GROUP BY 1`,
      [start],
    ),
    query(
      `SELECT extract(isodow FROM hc.completed_date)::int AS dow, count(*)::int AS n
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date GROUP BY 1`,
      [start],
    ),
    query(
      `SELECT h.category, count(*)::int AS completions
         FROM habit_completions hc
         JOIN habits h ON h.id = hc.user_id || ':habit:' || hc.habit_id
         JOIN users u ON u.id = hc.user_id AND u.role = 'user'
        WHERE hc.completed_date >= $1::date GROUP BY 1`,
      [start],
    ),
    query(
      `WITH events AS (${activityEventsSql('$1', '$2')})
       SELECT e.user_id AS "userId", date_trunc('week', e.day)::date AS week
         FROM events e JOIN users u ON u.id = e.user_id AND u.role = 'user'
        GROUP BY 1, 2`,
      [eventsSince, tz],
    ),
    query(
      `WITH events AS (${activityEventsSql('$1', '$2')})
       SELECT count(DISTINCT e.user_id)::int AS n FROM events e JOIN users u ON u.id = e.user_id AND u.role = 'user'`,
      [start, tz],
    ),
    query(
      `SELECT g.category, count(*)::int AS goals, COALESCE(round(avg(g.progress)), 0)::int AS "avgProgress",
              count(DISTINCT g.user_id)::int AS students
         FROM goals g JOIN users u ON u.id = g.user_id AND u.role = 'user' GROUP BY 1 ORDER BY 2 DESC`,
    ),
    computeEconomy(tz, today, k),
    query(
      `SELECT a.name, count(ua.user_id)::int AS students
         FROM achievements a
         LEFT JOIN user_achievements ua ON ua.achievement_id = a.id AND EXISTS (SELECT 1 FROM users u WHERE u.id = ua.user_id AND u.role = 'user')
        GROUP BY a.id, a.name ORDER BY a.id`,
    ),
    loadCategoryOrder(),
  ]);

  // Stored streaks are only as fresh as each student's last sync; use live ones.
  const liveStreaks = await loadLiveStreaks(tz);
  for (const habit of habitRows.rows) habit.streak = liveStreaks.get(habit.id) ?? 0;
  // Every habit is history for the completion rates (each up to its week's end); the habit counts,
  // reminders, frequencies and current streaks are about the habits students track now.
  const prepared = prepareHabits(habitRows.rows, tz, today);
  const current = prepared.filter((habit) => habit.current);
  const completionsByUser = new Map(perUser.rows.map((row) => [row.userId, row.n]));
  const totalCompletions = perUser.rows.reduce((sum, row) => sum + row.n, 0);
  const totalExpected = expectedBetween(prepared, start, today);
  const weeksInRange = range / 7;

  // Activity -------------------------------------------------------------------
  const activeWeeksByUser = new Map();
  for (const row of weeklyActive.rows) {
    if (!activeWeeksByUser.has(row.userId)) activeWeeksByUser.set(row.userId, new Set());
    activeWeeksByUser.get(row.userId).add(row.week);
  }
  const activeInRange = activeCount.rows[0].n;

  // Weekly trend: impact over time ------------------------------------------------
  const completionsByWeek = new Map(perWeek.rows.map((row) => [row.week, row.n]));
  const activeByWeek = new Map();
  for (const row of weeklyActive.rows) activeByWeek.set(row.week, (activeByWeek.get(row.week) ?? 0) + 1);
  const weeklyTrend = [];
  for (let week = firstWeek; week <= today; week = addDays(week, 7)) {
    const from = week < start ? start : week;
    const to = addDays(week, 6) > today ? today : addDays(week, 6);
    const completions = completionsByWeek.get(week) ?? 0;
    const active = activeByWeek.get(week) ?? 0;
    weeklyTrend.push({
      week,
      activeStudents: active,
      completions,
      checkInsPerActiveStudent: active ? completions / active : 0,
      completionRate: ratio(completions, expectedBetween(prepared, from, to)),
      partial: week < start || addDays(week, 6) > today,
    });
  }

  // Habit behaviour -----------------------------------------------------------------
  // The category card is about the period: its habits and students are the ones due in it (current
  // habits, and habits whose week ended in it), while the average streak is over current habits.
  const inPeriod = prepared.filter((habit) => habit.current || expectedBetween([habit], start, today) > 0);
  const inCategory = (habits, row) => habits.filter((habit) => (habit.category || 'Uncategorized').toLowerCase() === row.category.toLowerCase());
  const categoryRows = buildCategoryRows(categories, inPeriod, perCategory.rows).map((row) => {
    const habits = inCategory(inPeriod, row);
    const streaks = inCategory(current, row).map((habit) => Number(habit.streak) || 0);
    return {
      ...row,
      students: new Set(habits.map((habit) => habit.userId)).size,
      completionRate: ratio(row.completions, expectedBetween(habits, start, today)),
      avgStreak: streaks.length ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0,
    };
  });

  const dowCounts = new Map(perDow.rows.map((row) => [row.dow, row.n]));
  const dayOfWeek = WEEKDAY_LABELS.map((label, index) => ({ label, completions: dowCounts.get(index + 1) ?? 0 }));

  const withReminders = current.filter((habit) => habit.reminderEnabled);
  const reminders = {
    habitsWithReminders: withReminders.length,
    adoption: current.length ? withReminders.length / current.length : null,
    byPeriod: countBy(withReminders, (habit) => reminderPeriod(habit.reminderTime), REMINDER_PERIOD_ORDER),
  };

  // Demographics with k-anonymity -----------------------------------------------------
  const habitsByUser = new Map();
  for (const habit of prepared) {
    if (!habitsByUser.has(habit.userId)) habitsByUser.set(habit.userId, []);
    habitsByUser.get(habit.userId).push(habit);
  }
  const studentFacts = students.rows.map((student) => {
    const own = habitsByUser.get(student.id) ?? [];
    return {
      gender: student.gender?.trim() || 'Not specified',
      region: student.region?.trim() || 'Not specified',
      age: ageBracket(student.dateOfBirth),
      habits: own.filter((habit) => habit.current).length,
      completions: completionsByUser.get(student.id) ?? 0,
      expected: expectedBetween(own, start, today),
    };
  });

  const breakdown = (dimension, order) => {
    const groups = new Map();
    for (const fact of studentFacts) {
      const label = fact[dimension];
      if (!groups.has(label)) groups.set(label, { label, students: 0, habits: 0, completions: 0, expected: 0 });
      const group = groups.get(label);
      group.students += 1;
      group.habits += fact.habits;
      group.completions += fact.completions;
      group.expected += fact.expected;
    }
    const sorted = [...groups.values()].sort((a, b) => (order ? order.indexOf(a.label) - order.indexOf(b.label) : b.students - a.students));
    const result = suppressSmallGroups(sorted, k, ['habits', 'completions', 'expected']);
    return {
      ...result,
      rows: result.rows.map((group) => ({
        label: group.label,
        students: group.students,
        combined: group.combined ?? 0,
        habitsPerStudent: group.habits / group.students,
        weeklyCheckInsPerStudent: group.completions / group.students / weeksInRange,
        completionRate: ratio(group.completions, group.expected),
      })),
    };
  };

  // Retention cohorts ------------------------------------------------------------------
  const cohortWeekOf = new Map(students.rows.map((student) => [student.id, mondayOf(todayInZone(tz, new Date(student.createdAt)))]));
  const cohorts = [];
  for (let cohortWeek = cohortStart; cohortWeek <= mondayOf(today); cohortWeek = addDays(cohortWeek, 7)) {
    const members = students.rows.filter((student) => cohortWeekOf.get(student.id) === cohortWeek);
    const weeksElapsed = Math.floor((dayNumber(mondayOf(today)) - dayNumber(cohortWeek)) / 7);
    const suppressed = members.length < k;
    const retention = [];
    for (let offset = 0; offset <= weeksElapsed && offset < COHORT_WEEKS; offset += 1) {
      const week = addDays(cohortWeek, offset * 7);
      const retained = members.filter((member) => activeWeeksByUser.get(member.id)?.has(week)).length;
      retention.push(suppressed || !members.length ? null : retained / members.length);
    }
    cohorts.push({ week: cohortWeek, size: suppressed ? null : members.length, suppressed: suppressed && members.length > 0, retention });
  }

  // Current streaks: ended habits keep their last day's streak, so they are left out here.
  const streaks = current.map((habit) => Number(habit.streak) || 0);
  const bestStreakByUser = new Map();
  for (const habit of current) bestStreakByUser.set(habit.userId, Math.max(bestStreakByUser.get(habit.userId) ?? 0, Number(habit.streak) || 0));
  const bestStreaks = [...bestStreakByUser.values()];

  return {
    meta: {
      range,
      start,
      end: today,
      timeZone: tz,
      anonymityThreshold: k,
      generatedAt: Date.now(),
    },
    summary: {
      students: students.rowCount,
      activeStudents: activeInRange,
      habits: current.length,
      completions: totalCompletions,
      completionRate: ratio(totalCompletions, totalExpected),
      weeklyCheckInsPerActiveStudent: activeInRange ? totalCompletions / activeInRange / weeksInRange : 0,
      avgBestStreak: bestStreaks.length ? bestStreaks.reduce((a, b) => a + b, 0) / bestStreaks.length : 0,
      avgHabitStreak: streaks.length ? streaks.reduce((a, b) => a + b, 0) / streaks.length : 0,
      reminderAdoption: reminders.adoption,
    },
    weeklyTrend,
    categories: categoryRows,
    frequencyMix: countBy(current, (habit) => habitFrequency(habit.meta), ['Daily', 'Weekly', 'Monthly', 'Custom']),
    streakDistribution: countBy(current, (habit) => streakBucket(habit.streak), STREAK_BUCKET_ORDER),
    dayOfWeek,
    reminders,
    demographics: {
      gender: breakdown('gender'),
      age: breakdown('age', AGE_BRACKET_ORDER),
      region: breakdown('region'),
    },
    cohorts,
    goals: goals.rows.filter((row) => row.students >= k).map(({ students: _students, ...row }) => row),
    economy,
    achievements: achievements.rows.map((row) => ({ name: row.name, share: students.rowCount ? row.students / students.rowCount : 0 })),
  };
}

const rangeSchema = z.looseObject({ range: z.coerce.number().refine((value) => RANGES.includes(value)).catch(90) });

router.get('/', requirePermission('analytics:view'), async (request, response) => {
  const { range } = validate(rangeSchema, request.query);
  response.json({ ok: true, ...(await computeAnalytics(range)) });
});

const pct = (value) => (value === null || value === undefined ? '' : (value * 100).toFixed(1));
const num = (value, digits = 2) => (value === null || value === undefined ? '' : Number(value).toFixed(digits));

const DATASETS = {
  weekly_trend: {
    title: 'Weekly engagement trend',
    rows: (data) => data.weeklyTrend,
    columns: [
      { key: 'week', label: 'Week starting' },
      { key: 'activeStudents', label: 'Active students' },
      { key: 'completions', label: 'Check-ins' },
      { key: 'checkInsPerActiveStudent', label: 'Check-ins per active student', format: num },
      { key: 'completionRate', label: 'Completion rate (%)', format: pct },
    ],
  },
  categories: {
    title: 'Habit category performance',
    rows: (data) => data.categories,
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'habits', label: 'Habits' },
      { key: 'students', label: 'Students' },
      { key: 'completions', label: 'Check-ins' },
      { key: 'completionRate', label: 'Completion rate (%)', format: pct },
      { key: 'avgStreak', label: 'Average streak (days)', format: num },
    ],
  },
  demographics: {
    title: 'Engagement by demographic group (k-anonymized)',
    rows: (data) => ['gender', 'age', 'region'].flatMap((dimension) => data.demographics[dimension].rows.map((row) => ({ dimension, ...row }))),
    columns: [
      { key: 'dimension', label: 'Dimension' },
      { key: 'label', label: 'Group' },
      { key: 'students', label: 'Students' },
      { key: 'habitsPerStudent', label: 'Habits per student', format: num },
      { key: 'weeklyCheckInsPerStudent', label: 'Weekly check-ins per student', format: num },
      { key: 'completionRate', label: 'Completion rate (%)', format: pct },
    ],
  },
  cohorts: {
    title: 'Weekly retention cohorts',
    rows: (data) => data.cohorts.map((cohort) => ({
      week: cohort.week,
      size: cohort.suppressed ? `<${data.meta.anonymityThreshold}` : cohort.size,
      ...Object.fromEntries(Array.from({ length: COHORT_WEEKS }, (_, index) => [`w${index}`, pct(cohort.retention[index])])),
    })),
    columns: [
      { key: 'week', label: 'Registration week' },
      { key: 'size', label: 'Cohort size' },
      ...Array.from({ length: COHORT_WEEKS }, (_, index) => ({ key: `w${index}`, label: `Week ${index} retained (%)` })),
    ],
  },
  habit_patterns: {
    title: 'Habit patterns',
    rows: (data) => [
      ...data.dayOfWeek.map((row) => ({ group: 'Check-ins by weekday', label: row.label, value: row.completions })),
      ...data.streakDistribution.map((row) => ({ group: 'Habits by current streak', label: row.label, value: row.count })),
      ...data.frequencyMix.map((row) => ({ group: 'Habits by frequency', label: row.label, value: row.count })),
      ...data.reminders.byPeriod.map((row) => ({ group: 'Reminders by time of day', label: row.label, value: row.count })),
    ],
    columns: [
      { key: 'group', label: 'Measure' },
      { key: 'label', label: 'Group' },
      { key: 'value', label: 'Count' },
    ],
  },
};

router.get('/export.csv', requirePermission('analytics:view'), async (request, response) => {
  const { range } = validate(rangeSchema, request.query);
  const datasetKey = Object.hasOwn(DATASETS, request.query.dataset) ? request.query.dataset : 'weekly_trend';
  const dataset = DATASETS[datasetKey];
  const data = await computeAnalytics(range);
  const rows = dataset.rows(data).map((row) => Object.fromEntries(dataset.columns.map((column) => [column.key, column.format ? column.format(row[column.key]) : row[column.key]])));
  const csv = toCsv(rows, dataset.columns);
  await audit(request, { action: 'analytics.exported', targetType: 'analytics', targetId: datasetKey, summary: `Exported "${dataset.title}" (${range} days)` });
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="habitai-${datasetKey}-${data.meta.end}.csv"`);
  response.send(`﻿${csv}`);
});

export default router;
