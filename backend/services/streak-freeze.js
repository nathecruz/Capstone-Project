// Streak Freeze: bought with tokens (up to two held) and used automatically for missed days, so
// one bad day does not wipe out a long account streak (services/account-streak.js). A frozen day
// neither counts toward nor breaks a streak (also a habit's own, services/streaks.js). Used
// freezes are in streak_freeze_days, held ones in user_streak_freezes.
import { isHabitActiveOn } from './habit-week.js';
import { habitFromRow, habitSchedule, isScheduledDay } from './streaks.js';
import { spendTokens } from './wallet.js';

export const STREAK_FREEZE_COST = 30;
export const STREAK_FREEZE_MAX = 2;

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/**
 * The days to freeze before `today`: the days, counting back from yesterday, that broke a running
 * account streak (some habit was active and scheduled, and nothing was checked in). Days with
 * nothing due and days already frozen neither count nor break it, so they are passed over; the
 * first day with a check-in is where the streak runs on. All of the days are frozen or none, so a
 * freeze is never spent on a streak it cannot save. `habits`: [{ id, frequency, startDate,
 * activeUntil, reminderDays, meta }] (also past weeks'); `doneByHabit`: Map(id -> Set(date));
 * `frozen`: Set of days already frozen.
 */
export function daysToFreeze(habits, doneByHabit, frozen, today, available) {
  if (available <= 0) return [];
  const checkedIn = new Set([...doneByHabit.values()].flatMap((dates) => [...dates]));
  const firstCheckIn = [...checkedIn].reduce((first, day) => (!first || day < first ? day : first), null);
  if (!firstCheckIn) return [];
  const schedules = habits.map((habit) => ({ habit, schedule: habitSchedule(habit) }));
  const misses = [];
  for (let day = shiftDay(today, -1); day >= firstCheckIn; day = shiftDay(day, -1)) {
    if (checkedIn.has(day)) return misses;
    if (frozen.has(day) || !schedules.some(({ habit, schedule }) => isHabitActiveOn(habit, day) && isScheduledDay(schedule, day))) continue;
    misses.push(day);
    if (misses.length > available) return [];
  }
  // No check-in before the misses: there is no streak to save.
  return [];
}

export async function getFrozenDays(db, userId) {
  const result = await db.query('SELECT freeze_date::text AS date FROM streak_freeze_days WHERE user_id=$1 ORDER BY freeze_date', [userId]);
  return result.rows.map((row) => row.date);
}

/** Freezes held, the price, and the days already covered. */
export async function getStreakFreezeStatus(db, userId) {
  const [held, frozenDays] = await Promise.all([
    db.query('SELECT available FROM user_streak_freezes WHERE user_id=$1', [userId]),
    getFrozenDays(db, userId),
  ]);
  return { available: Number(held.rows[0]?.available ?? 0), max: STREAK_FREEZE_MAX, cost: STREAK_FREEZE_COST, frozenDays };
}

/** Uses held freezes for the missed days before `today`; returns the days frozen. Call inside a transaction that locked the user row. */
export async function applyStreakFreezes(db, userId, today, now = Date.now()) {
  const held = await db.query('SELECT available FROM user_streak_freezes WHERE user_id=$1', [userId]);
  const available = Number(held.rows[0]?.available ?? 0);
  if (available <= 0) return [];
  const [rows, completions, frozenDays] = await Promise.all([
    db.query('SELECT id, meta, frequency, start_date, active_until, reminder_days FROM habits WHERE user_id=$1', [userId]),
    db.query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1', [userId]),
    getFrozenDays(db, userId),
  ]);
  const habits = rows.rows.map((row) => ({ ...habitFromRow(row), id: String(row.id).replace(`${userId}:habit:`, '') }));
  const doneByHabit = new Map();
  for (const row of completions.rows) {
    if (!doneByHabit.has(row.habitId)) doneByHabit.set(row.habitId, new Set());
    doneByHabit.get(row.habitId).add(row.date);
  }
  const days = daysToFreeze(habits, doneByHabit, new Set(frozenDays), today, available);
  for (const day of days) {
    await db.query('INSERT INTO streak_freeze_days(user_id,freeze_date,used_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [userId, day, now]);
  }
  if (days.length) await db.query('UPDATE user_streak_freezes SET available=available-$2, updated_at=$3 WHERE user_id=$1', [userId, days.length, now]);
  return days;
}

/** Buys one freeze with tokens. Returns { status, message } on refusal. Call inside a transaction that locked the user row. */
export async function buyStreakFreeze(db, userId, now = Date.now()) {
  await db.query('INSERT INTO user_streak_freezes(user_id,available,updated_at) VALUES($1,0,$2) ON CONFLICT DO NOTHING', [userId, now]);
  const held = Number((await db.query('SELECT available FROM user_streak_freezes WHERE user_id=$1', [userId])).rows[0].available);
  if (held >= STREAK_FREEZE_MAX) return { status: 409, message: `You already hold ${STREAK_FREEZE_MAX} streak freezes, the most you can keep.` };
  const spent = await spendTokens(db, userId, STREAK_FREEZE_COST, 'Streak freeze', now);
  if (!spent.ok) return { status: 402, message: `You need ${STREAK_FREEZE_COST - spent.balance} more tokens for a streak freeze.` };
  await db.query('UPDATE user_streak_freezes SET available=available+1, updated_at=$2 WHERE user_id=$1', [userId, now]);
  return null;
}
