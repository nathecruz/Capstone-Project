// Weekly quests: three missions each Monday-to-Sunday week, paid in tokens by the server when
// they are complete and taken back if an undo drops them below the target. The app shows the
// same rules (frontend/utils/quests.ts), so the card and the tokens agree.
import { habitFromRow, habitSchedule, isScheduledDay } from './streaks.js';

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Monday of `dateKey`'s week. */
export function weekStartOf(dateKey) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shiftDay(dateKey, -((weekday + 6) % 7));
}

/** Weeks since the Monday of 1970-01-05, to rotate the third quest. */
function weekNumber(weekStart) {
  return Math.floor((Date.parse(`${weekStart}T00:00:00Z`) / 86_400_000 - 4) / 7);
}

/**
 * The week's quests and their progress up to `today`.
 * `habits`: [{ id, frequency, startDate, reminderDays, meta }]; `doneByDate`: Map(date -> Set(habit id)).
 */
export function weeklyQuests(habits, doneByDate, today) {
  if (!habits.length) return [];
  const weekStart = weekStartOf(today);
  let checkIns = 0;
  let perfectDays = 0;
  let challengeDays = 0;
  let activeDays = 0;
  const habitsDone = new Set();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = shiftDay(weekStart, offset);
    if (day > today) break;
    const done = doneByDate.get(day) ?? new Set();
    const doneHabits = habits.filter((habit) => done.has(habit.id));
    checkIns += doneHabits.length;
    if (doneHabits.length) activeDays += 1;
    for (const habit of doneHabits) habitsDone.add(habit.id);
    const due = habits.filter((habit) => (!habit.startDate || habit.startDate <= day) && isScheduledDay(habitSchedule(habit), day));
    const dueDone = due.filter((habit) => done.has(habit.id)).length;
    if (due.length && dueDone === due.length) perfectDays += 1;
    if (due.length && dueDone >= Math.min(3, due.length)) challengeDays += 1;
  }
  const checkInTarget = habits.length >= 3 ? 12 : habits.length === 2 ? 8 : 5;
  const rotating = [
    { id: 'challenge-days', title: 'Finish the daily challenge on 3 days', icon: 'trophy', target: 3, progress: challengeDays },
    { id: 'active-days', title: 'Check in on 5 different days', icon: 'calendar', target: 5, progress: activeDays },
    { id: 'every-habit', title: 'Check in on every habit at least once', icon: 'grid', target: habits.length, progress: habitsDone.size },
  ][((weekNumber(weekStart) % 3) + 3) % 3];
  return [
    { id: 'check-ins', title: `Check in ${checkInTarget} times`, icon: 'checkmark-done', target: checkInTarget, progress: checkIns, reward: 15 },
    { id: 'perfect-days', title: 'Have 2 perfect days', icon: 'sparkles', target: 2, progress: perfectDays, reward: 20 },
    { ...rotating, reward: 15 },
  ].map((quest) => ({ ...quest, weekStart, progress: Math.min(quest.progress, quest.target), complete: quest.progress >= quest.target }));
}

const questTokenId = (userId, weekStart, questId) => `${userId}:token:quest:${weekStart}:${questId}`;

/** Pays (or takes back) the week's quest bonuses after a check-in on `date`. Call inside the check-in transaction. */
export async function syncWeeklyQuests(db, userId, date, now = Date.now()) {
  const rows = (await db.query('SELECT id, meta, frequency, start_date, reminder_days FROM habits WHERE user_id=$1', [userId])).rows;
  const habits = rows.map((row) => ({ ...habitFromRow(row), id: String(row.id).replace(`${userId}:habit:`, '') }));
  const weekStart = weekStartOf(date);
  const completions = await db.query(
    'SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1 AND completed_date >= $2::date AND completed_date <= $3::date',
    [userId, weekStart, date],
  );
  const doneByDate = new Map();
  for (const row of completions.rows) {
    if (!doneByDate.has(row.date)) doneByDate.set(row.date, new Set());
    doneByDate.get(row.date).add(String(row.habitId));
  }
  const quests = weeklyQuests(habits, doneByDate, date);
  for (const quest of quests) {
    const id = questTokenId(userId, weekStart, quest.id);
    if (quest.complete) {
      // Listed just above the check-in (and the daily challenge) that completed it.
      await db.query(
        'INSERT INTO token_transactions(id,user_id,amount,label,transaction_date,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING',
        [id, userId, quest.reward, `Weekly quest: ${quest.title}`, new Date(now).toISOString(), now + 2],
      );
    } else {
      await db.query('DELETE FROM token_transactions WHERE id=$1', [id]);
    }
  }
  return quests;
}
