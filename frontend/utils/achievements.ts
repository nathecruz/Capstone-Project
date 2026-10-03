// Badges and milestones from the whole check-in history, so a badge stays once it is earned and
// shows how close the next one is. (They used to look only at today, so most never unlocked and
// earned ones disappeared the next day.)
import type { Goal, Habit } from '@/hooks/app-state/types';
import { levelProgress, timeOfDayFor } from '@/utils/engagement';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { isHabitScheduledOn } from '@/utils/streaks';

const MAX_DAYS = 400;

function shift(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return getLocalDateKey(new Date(year, month - 1, day + days));
}

const scheduledOn = (habit: Habit, day: string) => (!habit.startDate || habit.startDate <= day) && isHabitScheduledOn(habit, day);

/** The first day any habit could count, at most MAX_DAYS back. */
function firstDay(habits: Habit[], today: string) {
  const starts = habits.flatMap((habit) => [habit.startDate, ...habit.completionDates].filter(Boolean)).sort();
  const limit = shift(today, -MAX_DAYS);
  return starts[0] && starts[0] > limit ? starts[0] : limit;
}

/** Longest run of scheduled days done in a row; unscheduled days are skipped, an unfinished today does not break it. */
export function longestStreak(habit: Habit, today: string) {
  const done = new Set(habit.completionDates);
  if (!done.size) return 0;
  let best = 0;
  let run = 0;
  for (let day = firstDay([habit], today); day <= today; day = shift(day, 1)) {
    if (!isHabitScheduledOn(habit, day)) continue;
    if (done.has(day)) {
      run += 1;
      best = Math.max(best, run);
    } else if (day !== today) {
      run = 0;
    }
  }
  return best;
}

/** Habits due and done on a day. Today only counts what is done so far, so an unfinished today does not lower a rate. */
function dayTotals(habits: Habit[], day: string, today = '') {
  const due = habits.filter((habit) => scheduledOn(habit, day));
  const done = due.filter((habit) => habit.completionDates.includes(day)).length;
  return { due: day === today ? done : due.length, done };
}

/** Days (up to today) when every habit due that day was done. */
export function perfectDayCount(habits: Habit[], today: string) {
  let count = 0;
  for (let day = firstDay(habits, today); day <= today; day = shift(day, 1)) {
    const { due, done } = dayTotals(habits, day);
    if (due > 0 && done === due) count += 1;
  }
  return count;
}

/** Monday-to-Sunday weeks so far: completion rate (weeks with at least 3 check-ins due) and whether it was perfect. */
function weeks(habits: Habit[], today: string) {
  const [year, month, day] = today.split('-').map(Number);
  const weekday = (new Date(year, month - 1, day).getDay() + 6) % 7;
  const results: { rate: number; perfect: boolean }[] = [];
  const start = shift(firstDay(habits, today), -6);
  for (let monday = shift(today, -weekday); monday >= start; monday = shift(monday, -7)) {
    let due = 0;
    let done = 0;
    let allDone = true;
    for (let offset = 0; offset < 7; offset += 1) {
      const date = shift(monday, offset);
      if (date > today) break;
      const totals = dayTotals(habits, date, today);
      due += totals.due;
      done += totals.done;
      if (dayTotals(habits, date).due > totals.done) allDone = false;
    }
    // A week is perfect once it is over (or it is Sunday and everything is done).
    const finished = shift(monday, 6) <= today;
    if (due >= 3) results.push({ rate: done / due, perfect: finished && allDone });
  }
  return results;
}

const checkIns = (habits: Habit[], matches: (habit: Habit) => boolean) => habits.filter(matches).reduce((sum, habit) => sum + habit.completionDates.length, 0);
const FOCUS_CATEGORIES = new Set(['Mind', 'Academics', 'Productivity', 'Study']);

export type BadgeProgress = {
  id: string;
  title: string;
  /** What it takes (shown while locked). */
  goal: string;
  /** A short cheer (shown once earned). */
  flavor: string;
  icon: string;
  color: string;
  background: string;
  current: number;
  target: number;
  unit: string;
  earned: boolean;
  share: number;
};

type Measures = {
  bestStreak: number; morning: number; focus: number; bestWeek: number; habits: number;
  water: number; workout: number; reading: number; perfectWeeks: number; goals: number; perfectDays: number;
};

const BADGES: (Omit<BadgeProgress, 'current' | 'earned' | 'share'> & { measure: (m: Measures) => number })[] = [
  { id: 'streak-7', title: '7 Day Streak', goal: 'Keep one habit going 7 days', flavor: 'Keep going!', icon: 'flame', color: '#48A66A', background: '#E6F6EA', target: 7, unit: 'days', measure: (m) => m.bestStreak },
  { id: 'early-bird', title: 'Early Bird', goal: '10 morning check-ins', flavor: 'Morning master', icon: 'sunny', color: '#E7A72F', background: '#FFF4D9', target: 10, unit: 'check-ins', measure: (m) => m.morning },
  { id: 'focus-master', title: 'Focus Master', goal: '15 study, mind or work check-ins', flavor: 'Stay focused', icon: 'eye', color: '#4F82D8', background: '#E7F0FF', target: 15, unit: 'check-ins', measure: (m) => m.focus },
  { id: 'consistency-pro', title: 'Consistency Pro', goal: 'Reach 80% in one week', flavor: 'Built the habit', icon: 'ribbon', color: '#7A55D9', background: '#F0E9FF', target: 80, unit: '%', measure: (m) => m.bestWeek },
  { id: 'habit-hero', title: 'Habit Hero', goal: 'Track 5 habits', flavor: 'All rounder', icon: 'shield-checkmark', color: '#3D83D8', background: '#E5F2FF', target: 5, unit: 'habits', measure: (m) => m.habits },
  { id: 'legend', title: 'Strongest Legend', goal: 'A 30-day streak', flavor: 'Unstoppable', icon: 'trophy', color: '#E86842', background: '#FFE9E1', target: 30, unit: 'days', measure: (m) => m.bestStreak },
  { id: 'hydration', title: 'Hydration Hero', goal: '14 water check-ins', flavor: 'Water champion', icon: 'water', color: '#3B9ED8', background: '#E2F5FF', target: 14, unit: 'check-ins', measure: (m) => m.water },
  { id: 'workout', title: 'Workout Warrior', goal: '10 workout check-ins', flavor: 'Moving every day', icon: 'fitness', color: '#D85D70', background: '#FFE7EC', target: 10, unit: 'check-ins', measure: (m) => m.workout },
  { id: 'bookworm', title: 'Bookworm', goal: '10 reading check-ins', flavor: 'Reads every day', icon: 'book', color: '#9A6A3A', background: '#F6EBDD', target: 10, unit: 'check-ins', measure: (m) => m.reading },
  { id: 'perfect-week', title: 'Perfect Week', goal: 'Every habit done for a whole week', flavor: 'Seven for seven', icon: 'calendar', color: '#6C58CE', background: '#EEE9FF', target: 1, unit: 'week', measure: (m) => m.perfectWeeks },
  { id: 'goal-getter', title: 'Goal Getter', goal: 'Finish every step of a goal', flavor: 'Aimed higher', icon: 'locate', color: '#D48A28', background: '#FFF1D9', target: 1, unit: 'goal', measure: (m) => m.goals },
  { id: 'day-finisher', title: 'Day Finisher', goal: 'Finish all habits in a day 5 times', flavor: 'Nothing left behind', icon: 'rocket', color: '#4D8C75', background: '#E3F4ED', target: 5, unit: 'days', measure: (m) => m.perfectDays },
];

function measure(habits: Habit[], goals: Goal[], today: string): Measures {
  const weekly = weeks(habits, today);
  return {
    bestStreak: Math.max(0, ...habits.map((habit) => longestStreak(habit, today))),
    morning: checkIns(habits, (habit) => timeOfDayFor(habit) === 'morning'),
    focus: checkIns(habits, (habit) => FOCUS_CATEGORIES.has(habit.category)),
    bestWeek: Math.round(Math.max(0, ...weekly.map((week) => week.rate)) * 100),
    habits: habits.length,
    water: checkIns(habits, (habit) => /water|drink|hydrat/i.test(habit.label)),
    workout: checkIns(habits, (habit) => /exercise|workout|walk|run|jog|gym|stretch|yoga|sport|fitness|push.?up/i.test(habit.label)),
    reading: checkIns(habits, (habit) => /read|book/i.test(habit.label)),
    perfectWeeks: weekly.filter((week) => week.perfect).length,
    goals: goals.filter((goal) => Array.isArray(goal.completedSteps) && goal.completedSteps.length > 0 && goal.completedSteps.every(Boolean)).length,
    perfectDays: perfectDayCount(habits, today),
  };
}

/** Every badge with how far along it is; earned ones stay earned because they come from history. */
export function badgeProgress(habits: Habit[], goals: Goal[] = [], now = new Date()): BadgeProgress[] {
  const measures = measure(habits, goals, getLocalDateKey(now));
  return BADGES.map(({ measure: read, ...badge }) => {
    const current = read(measures);
    return { ...badge, current, earned: current >= badge.target, share: Math.min(1, current / badge.target) };
  });
}

/** The locked badge closest to being earned (null when all are earned). */
export function nextBadge(progress: BadgeProgress[]) {
  return progress
    .filter((badge) => !badge.earned)
    .sort((a, b) => b.share - a.share || a.target - a.current - (b.target - b.current))[0] ?? null;
}

/** "3 more check-ins", "20% more", for a locked badge. */
export function badgeRemaining(badge: BadgeProgress) {
  const left = Math.max(0, badge.target - badge.current);
  if (badge.unit === '%') return `${left}% more`;
  const unit = left === 1 ? badge.unit.replace(/s$/, '') : badge.unit;
  return `${left} more ${unit}`;
}

export type Milestone = { id: string; title: string; icon: string; color: string; unit: string; current: number; steps: number[]; next: number | null; reached: number[] };

/** Counted milestones: check-ins, best streak, level and perfect days, each with the next step. */
export function milestones(habits: Habit[], points: number, now = new Date()): Milestone[] {
  const today = getLocalDateKey(now);
  const rows = [
    { id: 'check-ins', title: 'Check-ins', icon: 'checkmark-done', color: '#5B42D8', unit: 'check-ins', current: habits.reduce((sum, habit) => sum + habit.completionDates.length, 0), steps: [10, 25, 50, 100, 250, 500] },
    { id: 'streak', title: 'Best streak', icon: 'flame', color: '#F08A3C', unit: 'days', current: Math.max(0, ...habits.map((habit) => longestStreak(habit, today))), steps: [3, 7, 14, 30, 50, 100] },
    { id: 'level', title: 'Level', icon: 'star', color: '#E7A72F', unit: 'level', current: levelProgress(points).level, steps: [2, 5, 10, 20, 50] },
    { id: 'perfect-days', title: 'Perfect days', icon: 'sparkles', color: '#3BAA74', unit: 'days', current: perfectDayCount(habits, today), steps: [1, 5, 10, 25, 50] },
  ];
  return rows.map((row) => ({ ...row, reached: row.steps.filter((step) => row.current >= step), next: row.steps.find((step) => row.current < step) ?? null }));
}

/** All-time numbers for the stats screens: total check-ins and completion rates over recent days. */
export function historyStats(habits: Habit[], now = new Date()) {
  const today = getLocalDateKey(now);
  const rate = (days: number) => {
    let due = 0;
    let done = 0;
    for (let back = 0; back < days; back += 1) {
      const totals = dayTotals(habits, shift(today, -back), today);
      due += totals.due;
      done += totals.done;
    }
    return due ? Math.round((done / due) * 100) : 0;
  };
  const [year, month, day] = today.split('-').map(Number);
  const daysThisWeek = ((new Date(year, month - 1, day).getDay() + 6) % 7) + 1;
  return {
    totalCheckIns: habits.reduce((sum, habit) => sum + habit.completionDates.length, 0),
    bestStreak: Math.max(0, ...habits.map((habit) => longestStreak(habit, today))),
    thisWeekRate: rate(daysThisWeek),
    last7Rate: rate(7),
    last30Rate: rate(30),
    perfectDays: perfectDayCount(habits, today),
  };
}
