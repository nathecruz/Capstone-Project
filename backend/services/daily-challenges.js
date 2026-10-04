// Daily challenges: three a day. "Finish N habits" every day, plus two that rotate from a pool
// (check in before 10 AM, twice before noon, bounce back after a miss, keep every streak alive,
// have a perfect day), picked so that each one makes sense for the student's habits that day.
// The server works them out from the check-ins and pays them in tokens; the app shows its answer.
import { getFrozenDays } from './streak-freeze.js';
import { computeStreak, habitFromRow, habitSchedule, isScheduledDay } from './streaks.js';
import { DAILY_CHALLENGE_BONUS } from './wallet.js';

/** The pool the two daily extras come from, in rotation order. */
export const ROTATING_CHALLENGES = ['early-bird', 'comeback', 'streak-keeper', 'two-by-noon', 'perfect-day'];

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const dayNumber = (dateKey) => Math.floor(Date.parse(`${dateKey}T00:00:00Z`) / 86_400_000);
const dueOn = (habit, dateKey) => (!habit.startDate || habit.startDate <= dateKey) && isScheduledDay(habitSchedule(habit), dateKey);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

/**
 * Today's challenges and their progress.
 * - habits: [{ id, label, frequency, startDate, reminderDays, meta }]
 * - doneToday: Map(habit id -> minute of the day it was checked in, in the student's time zone)
 * - doneYesterday: Set(habit id)
 * - streaksBefore: Map(habit id -> streak up to yesterday)
 */
export function dailyChallenges({ habits, doneToday, doneYesterday, streaksBefore, today }) {
  const due = habits.filter((habit) => dueOn(habit, today));
  if (!due.length) return [];
  const yesterday = shiftDay(today, -1);
  const minutes = due.filter((habit) => doneToday.has(habit.id)).map((habit) => doneToday.get(habit.id));
  const dueDone = minutes.length;
  const finishTarget = Math.min(3, due.length);
  const missed = due.filter((habit) => dueOn(habit, yesterday) && !doneYesterday.has(habit.id));
  const keepers = due.filter((habit) => (streaksBefore.get(habit.id) ?? 0) >= 2);

  const pool = {
    'early-bird': () => ({ title: 'Check in before 10 AM', icon: 'sunny', target: 1, progress: minutes.some((minute) => minute < 600) ? 1 : 0, reward: 5 }),
    'two-by-noon': () => (due.length >= 2 ? { title: 'Check in twice before noon', icon: 'time', target: 2, progress: minutes.filter((minute) => minute < 720).length, reward: 6 } : null),
    comeback: () => (missed.length ? {
      title: missed.length === 1 ? `Bounce back: do ${missed[0].label} today` : 'Bounce back: do a habit you missed yesterday',
      icon: 'refresh',
      target: 1,
      progress: missed.some((habit) => doneToday.has(habit.id)) ? 1 : 0,
      reward: 8,
    } : null),
    'streak-keeper': () => (keepers.length ? {
      title: keepers.length === 1 ? `Keep your ${streaksBefore.get(keepers[0].id)}-day ${keepers[0].label} streak` : `Keep all ${keepers.length} streaks alive`,
      icon: 'flame',
      target: keepers.length,
      progress: keepers.filter((habit) => doneToday.has(habit.id)).length,
      reward: 8,
    } : null),
    // With 3 habits or fewer, finishing 3 already is a perfect day.
    'perfect-day': () => (due.length > 3 ? { title: `Have a perfect day: all ${due.length} habits`, icon: 'sparkles', target: due.length, progress: dueDone, reward: 15 } : null),
  };

  const start = dayNumber(today) % ROTATING_CHALLENGES.length;
  const extras = [];
  for (let offset = 0; offset < ROTATING_CHALLENGES.length && extras.length < 2; offset += 1) {
    const id = ROTATING_CHALLENGES[(start + offset) % ROTATING_CHALLENGES.length];
    const challenge = pool[id]();
    if (challenge) extras.push({ id, ...challenge });
  }
  return [
    { id: 'finish', title: `Finish ${plural(finishTarget, 'habit')} today`, icon: 'trophy', target: finishTarget, progress: dueDone, reward: DAILY_CHALLENGE_BONUS },
    ...extras,
  ].map((challenge) => ({ ...challenge, date: today, progress: Math.min(challenge.progress, challenge.target), complete: challenge.progress >= challenge.target }));
}

/** The minute of the day (0 to 1439) of `time` in `timeZone`. */
export function minuteOfDay(time, timeZone = 'UTC') {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(time));
    const value = (type) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return value('hour') * 60 + value('minute');
  } catch {
    return new Date(time).getUTCHours() * 60 + new Date(time).getUTCMinutes();
  }
}

/** Works out the student's challenges for `date` from the database. */
export async function getDailyChallenges(db, userId, date, timeZone = 'UTC') {
  const rows = (await db.query('SELECT id, label, meta, frequency, start_date, reminder_days FROM habits WHERE user_id=$1', [userId])).rows;
  const habits = rows.map((row) => ({ ...habitFromRow(row), id: String(row.id).replace(`${userId}:habit:`, ''), label: row.label }));
  const yesterday = shiftDay(date, -1);
  const [completions, frozenDays] = await Promise.all([
    db.query(
      `SELECT habit_id AS "habitId", completed_date::text AS date, completed_at AS "completedAt" FROM habit_completions
        WHERE user_id=$1 AND completed_date >= $2::date - 400 AND completed_date <= $2::date`,
      [userId, date],
    ),
    getFrozenDays(db, userId),
  ]);
  const doneToday = new Map();
  const doneYesterday = new Set();
  const datesByHabit = new Map();
  for (const row of completions.rows) {
    const habitId = String(row.habitId);
    if (row.date === date) doneToday.set(habitId, minuteOfDay(Number(row.completedAt), timeZone));
    if (row.date === yesterday) doneYesterday.add(habitId);
    if (row.date < date) datesByHabit.set(habitId, [...(datesByHabit.get(habitId) ?? []), row.date]);
  }
  const streaksBefore = new Map(habits.map((habit) => [habit.id, computeStreak(habit, datesByHabit.get(habit.id) ?? [], yesterday, frozenDays)]));
  return dailyChallenges({ habits, doneToday, doneYesterday, streaksBefore, today: date });
}

// "Finish N habits" keeps the id and label it had before there were three challenges.
const tokenId = (userId, date, id) => (id === 'finish' ? `${userId}:token:challenge:${date}` : `${userId}:token:daily:${date}:${id}`);

/** Pays (or takes back) today's challenge bonuses after a check-in. Call inside the check-in transaction. */
export async function syncDailyChallenges(db, userId, date, timeZone = 'UTC', now = Date.now()) {
  const challenges = await getDailyChallenges(db, userId, date, timeZone);
  const paid = new Set(challenges.filter((challenge) => challenge.complete).map((challenge) => challenge.id));
  for (const id of ['finish', ...ROTATING_CHALLENGES]) {
    const challenge = challenges.find((entry) => entry.id === id);
    if (challenge && paid.has(id)) {
      // Listed just above the check-in that completed it.
      await db.query(
        'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [tokenId(userId, date, id), userId, challenge.reward, id === 'finish' ? 'Daily challenge' : `Daily challenge: ${challenge.title}`, new Date(now).toISOString(), now + 1],
      );
    } else {
      await db.query('DELETE FROM token_transactions WHERE id=$1', [tokenId(userId, date, id)]);
    }
  }
  return challenges;
}
