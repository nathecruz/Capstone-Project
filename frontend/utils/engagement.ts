// Pure helpers for the features that keep students coming back: the Today agenda, levels,
// streak milestones, streaks at risk, the daily challenge, the weekly recap and focus sessions.
import type { Habit } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { computeStreak, isHabitScheduledOn } from '@/utils/streaks';

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'anytime';

export const TIME_OF_DAY: Record<TimeOfDay, { label: string; icon: string }> = {
  morning: { label: 'Morning', icon: 'sunny-outline' },
  afternoon: { label: 'Afternoon', icon: 'partly-sunny-outline' },
  evening: { label: 'Evening', icon: 'moon-outline' },
  anytime: { label: 'Anytime', icon: 'time-outline' },
};
const ORDER: TimeOfDay[] = ['morning', 'afternoon', 'evening', 'anytime'];

/** "07:30 PM" or "19:30" as minutes after midnight, or null. */
export function minutesOfDay(value: string): number | null {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(value);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

/** The time a habit is planned for: its reminder time when it shows in the habit's details. */
export function plannedMinutes(habit: Pick<Habit, 'meta'>): number | null {
  const [, when = ''] = habit.meta.split(' • ');
  return /anytime/i.test(when) ? null : minutesOfDay(when);
}

const KEYWORDS: [TimeOfDay, RegExp][] = [
  ['morning', /\b(morning|breakfast|wake|sunrise)\b/i],
  ['afternoon', /\b(afternoon|lunch|noon|after class)\b/i],
  ['evening', /\b(evening|night|sleep|bed|bedtime|dinner|journal|before \d{1,2} ?pm)\b/i],
];

/** Morning, afternoon, evening from the reminder time, else from words in the name, else anytime. */
export function timeOfDayFor(habit: Pick<Habit, 'meta' | 'label'>): TimeOfDay {
  const minutes = plannedMinutes(habit);
  if (minutes !== null) return minutes < 12 * 60 ? 'morning' : minutes < 18 * 60 ? 'afternoon' : 'evening';
  return KEYWORDS.find(([, pattern]) => pattern.test(habit.label))?.[0] ?? 'anytime';
}

const scheduledOn = (habit: Habit, dateKey: string) => (!habit.startDate || habit.startDate <= dateKey) && isHabitScheduledOn(habit, dateKey);

/** Today's habits: the ones still to do grouped by time of day, the next one up, and the done ones. */
export function todayAgenda(habits: Habit[], now = new Date()) {
  const today = getLocalDateKey(now);
  const scheduled = habits.filter((habit) => scheduledOn(habit, today));
  const done = scheduled.filter((habit) => habit.completionDates.includes(today));
  const open = scheduled.filter((habit) => !habit.completionDates.includes(today));
  const sections = ORDER
    .map((key) => ({ key, ...TIME_OF_DAY[key], habits: open.filter((habit) => timeOfDayFor(habit) === key) }))
    .filter((section) => section.habits.length > 0);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  // Next up: the planned habit closest to now (overdue ones first), else the first one left.
  const planned = open
    .map((habit) => ({ habit, minutes: plannedMinutes(habit) }))
    .filter((item): item is { habit: Habit; minutes: number } => item.minutes !== null)
    .sort((a, b) => Math.abs(a.minutes - nowMinutes) - Math.abs(b.minutes - nowMinutes));
  const currentPart: TimeOfDay = nowMinutes < 12 * 60 ? 'morning' : nowMinutes < 18 * 60 ? 'afternoon' : 'evening';
  const nextUp = planned[0]?.habit ?? open.find((habit) => timeOfDayFor(habit) === currentPart) ?? open[0] ?? null;
  return { scheduled, done, open, sections, nextUp, notToday: habits.length - scheduled.length };
}

export const POINTS_PER_LEVEL = 100;

/** Level and progress to the next one (each check-in is 20 points, each level 100). */
export function levelProgress(points: number) {
  const safe = Math.max(0, Math.floor(points));
  const level = Math.floor(safe / POINTS_PER_LEVEL) + 1;
  const xp = safe % POINTS_PER_LEVEL;
  return { level, xp, toNext: POINTS_PER_LEVEL - xp, share: xp / POINTS_PER_LEVEL };
}

export const STREAK_MILESTONES = [3, 7, 14, 21, 30, 50, 75, 100, 150, 200, 365];

/** The milestone a streak just reached (going from `before` to `after`), or null. */
export function streakMilestone(before: number, after: number) {
  return STREAK_MILESTONES.filter((days) => before < days && after >= days).at(-1) ?? null;
}

/** In the evening, habits due today that are not done yet and would break a running streak. */
export function habitsAtRisk(habits: Habit[], now = new Date(), fromHour = 18) {
  if (now.getHours() < fromHour) return [];
  const today = getLocalDateKey(now);
  return habits.filter((habit) => scheduledOn(habit, today) && !habit.completionDates.includes(today) && computeStreak(habit, habit.completionDates, today) > 0);
}

export const DAILY_CHALLENGE_BONUS = 10;

/**
 * Today's challenge: complete up to 3 of the habits scheduled today. The server pays the bonus
 * with the same rule (backend/services/wallet.js), so the card and the tokens agree.
 */
export function dailyChallenge(habits: Habit[], now = new Date()) {
  const { scheduled, done } = todayAgenda(habits, now);
  const target = Math.min(3, scheduled.length);
  return { target, done: Math.min(done.length, target), complete: target > 0 && done.length >= target, bonus: DAILY_CHALLENGE_BONUS };
}

function shift(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return getLocalDateKey(date);
}

function weekStats(habits: Habit[], monday: string) {
  const days = Array.from({ length: 7 }, (_, index) => shift(monday, index));
  let scheduled = 0;
  let done = 0;
  const perDay = days.map((day) => {
    const due = habits.filter((habit) => scheduledOn(habit, day));
    const completed = due.filter((habit) => habit.completionDates.includes(day)).length;
    scheduled += due.length;
    done += completed;
    return { day, completed };
  });
  const best = perDay.reduce((top, day) => (day.completed > top.completed ? day : top), perDay[0]);
  return { start: monday, end: days[6], scheduled, done, rate: scheduled ? done / scheduled : null, bestDay: best.completed ? best.day : null };
}

/** Last week (Monday to Sunday) compared with the week before, for the Monday recap. */
export function weeklyRecap(habits: Habit[], now = new Date()) {
  const today = getLocalDateKey(now);
  const thisMonday = shift(today, -((now.getDay() + 6) % 7));
  const lastWeek = weekStats(habits, shift(thisMonday, -7));
  const weekBefore = weekStats(habits, shift(thisMonday, -14));
  const change = lastWeek.rate !== null && weekBefore.rate !== null ? lastWeek.rate - weekBefore.rate : null;
  return { weekKey: thisMonday, lastWeek, weekBefore, change, bestStreak: Math.max(0, ...habits.map((habit) => habit.streak)) };
}

/** Minutes for a focus session: from the habit's name ("Read for 20 minutes", "1 hour"), else 25. */
export function focusMinutesFor(label: string) {
  const hours = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b/i.exec(label);
  if (hours) return Math.min(180, Math.max(1, Math.round(Number(hours[1]) * 60)));
  const minutes = /(\d+)\s*(?:minutes?|mins?)\b/i.exec(label);
  if (minutes) return Math.min(180, Math.max(1, Number(minutes[1])));
  return 25;
}
