// Weekly quests: three missions each Monday-to-Sunday week, paid in tokens by the server with the
// same rules (backend/services/quests.js), so the card and the tokens agree.
import type { Habit } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { isHabitScheduledOn } from '@/utils/streaks';

export type Quest = { id: string; title: string; icon: string; target: number; progress: number; reward: number; weekStart: string; complete: boolean };

function shift(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** The Monday of `dateKey`'s week. */
export function weekStartOf(dateKey: string) {
  const weekday = new Date(`${dateKey}T00:00:00Z`).getUTCDay();
  return shift(dateKey, -((weekday + 6) % 7));
}

const weekNumber = (weekStart: string) => Math.floor((Date.parse(`${weekStart}T00:00:00Z`) / 86_400_000 - 4) / 7);

/** This week's quests and their progress up to today. */
export function weeklyQuests(habits: Habit[], now = new Date()): Quest[] {
  if (!habits.length) return [];
  const today = getLocalDateKey(now);
  const weekStart = weekStartOf(today);
  let checkIns = 0;
  let perfectDays = 0;
  let challengeDays = 0;
  let activeDays = 0;
  const habitsDone = new Set<string>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = shift(weekStart, offset);
    if (day > today) break;
    const doneHabits = habits.filter((habit) => habit.completionDates.includes(day));
    checkIns += doneHabits.length;
    if (doneHabits.length) activeDays += 1;
    for (const habit of doneHabits) habitsDone.add(habit.id);
    const due = habits.filter((habit) => (!habit.startDate || habit.startDate <= day) && isHabitScheduledOn(habit, day));
    const dueDone = due.filter((habit) => habit.completionDates.includes(day)).length;
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

/** Days left in the week, today included ("3 days left"). */
export function daysLeftInWeek(now = new Date()) {
  return 7 - ((now.getDay() + 6) % 7);
}
