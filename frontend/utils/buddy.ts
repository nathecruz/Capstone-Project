// Habit Buddy: the mascot grows with check-ins (stages match backend/services/buddy.js), its mood
// follows today's habits, it gives tips from the student's own check-ins, and it lives in a room.
import type { Habit } from '@/hooks/app-state/types';
import { isHabitLate, STREAK_MILESTONES, todayAgenda } from '@/utils/engagement';
import { getLocalDateKey, isHabitMissedYesterday } from '@/utils/habit-visibility';
import { isHabitScheduledOn } from '@/utils/streaks';

export type BuddySlot = 'head' | 'hand' | 'room';
export type BuddyItem = { id: string; slot: BuddySlot; name: string; emoji: string; cost: number; stage: string };
export type BuddyStage = { id: string; name: string; min: number };
export type Buddy = { name: string; head: string; hand: string; room?: string; owned: string[]; checkIns: number; items: BuddyItem[]; stages: BuddyStage[] };

/** How each room looks behind the buddy: its colour and two things in it. */
export const ROOM_LOOK: Record<string, { background: string; decor: [string, string] }> = {
  garden: { background: '#DDF3D2', decor: ['🌳', '🌼'] },
  library: { background: '#F3E6D4', decor: ['📚', '🕯️'] },
  beach: { background: '#FFEFC2', decor: ['🌴', '🐚'] },
  space: { background: '#2B2463', decor: ['🪐', '⭐'] },
  castle: { background: '#ECE4FF', decor: ['🏰', '🚩'] },
};

export const BUDDY_STAGES: BuddyStage[] = [
  { id: 'baby', name: 'Baby', min: 0 },
  { id: 'kid', name: 'Kid', min: 10 },
  { id: 'teen', name: 'Teen', min: 50 },
  { id: 'champ', name: 'Champ', min: 150 },
  { id: 'legend', name: 'Legend', min: 400 },
];

/** Stage reached with `checkIns`, and how far it is to the next one. */
export function buddyGrowth(checkIns: number, stages: BuddyStage[] = BUDDY_STAGES) {
  const index = stages.reduce((reached, stage, at) => (checkIns >= stage.min ? at : reached), 0);
  const stage = stages[index];
  const next = stages[index + 1] ?? null;
  const share = next ? (checkIns - stage.min) / (next.min - stage.min) : 1;
  return { stage, index, next, share: Math.max(0, Math.min(1, share)), toNext: next ? next.min - checkIns : 0 };
}

export type BuddyMood = 'ecstatic' | 'happy' | 'sleepy' | 'hungry' | 'sad';

export const MOOD_FACE: Record<BuddyMood, string> = { ecstatic: '🤩', happy: '😊', sleepy: '😴', hungry: '🍪', sad: '🥺' };

/** How the buddy feels about today, what it says, and its energy (share of today's habits done). */
export function buddyMood(habits: Habit[], name: string, now = new Date(), frozenDays: string[] = []): { mood: BuddyMood; line: string; energy: number } {
  const agenda = todayAgenda(habits, now);
  const total = agenda.scheduled.length;
  const done = agenda.done.length;
  const energy = total ? done / total : 0;
  if (!habits.length) return { mood: 'sleepy', line: `Add a habit and ${name} will grow with you.`, energy };
  if (total && done === total) return { mood: 'ecstatic', line: 'We did everything today! I feel amazing.', energy };
  if (done > 0) return { mood: 'happy', line: `Yum, thanks! ${total - done} more and I'm full of energy.`, energy };
  if (habits.some((habit) => isHabitMissedYesterday(habit, now))) {
    const yesterday = getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
    return frozenDays.includes(yesterday)
      ? { mood: 'happy', line: 'Phew! A streak freeze kept our streak safe yesterday.', energy }
      : { mood: 'sad', line: 'We missed one yesterday... let\'s bounce back today.', energy };
  }
  if (now.getHours() < 11) return { mood: 'sleepy', line: 'Good morning! A check-in will wake me up.', energy };
  if (!total) return { mood: 'happy', line: 'Rest day! Nothing is due today.', energy };
  return { mood: 'hungry', line: 'I\'m hungry for a check-in!', energy };
}

/** Things the buddy says when it is tapped. */
export const PET_LINES = ['Hehe, that tickles!', 'You\'re doing great!', 'One small step at a time.', 'I believe in you!', 'Let\'s keep the streak going!', 'High five! ✋'];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayKey = (now: Date, back: number) => getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
const dueOn = (habit: Habit, key: string) => (!habit.startDate || key >= habit.startDate) && isHabitScheduledOn(habit, key);

/** Share of the habit's scheduled days done in the `days` days before today (null if none were due). */
function recentRate(habit: Habit, now: Date, days = 7) {
  let due = 0;
  let done = 0;
  for (let back = 1; back <= days; back += 1) {
    const key = dayKey(now, back);
    if (!dueOn(habit, key)) continue;
    due += 1;
    if (habit.completionDates.includes(key)) done += 1;
  }
  return due ? done / due : null;
}

/**
 * What the buddy suggests, from the student's own check-ins (most useful first, up to three):
 * growing up soon, a streak milestone one check-in away, a late habit, pairing a weak habit with a
 * strong one (habit stacking), and the student's best day of the week.
 */
export function buddyTips(habits: Habit[], buddy: { checkIns: number; stages?: BuddyStage[] }, now = new Date()): string[] {
  const tips: string[] = [];
  const today = getLocalDateKey(now);
  const open = habits.filter((habit) => dueOn(habit, today) && !habit.completionDates.includes(today));
  const growth = buddyGrowth(buddy.checkIns, buddy.stages);
  if (growth.next && growth.toNext <= 5) tips.push(`Just ${growth.toNext} more check-in${growth.toNext === 1 ? '' : 's'} and I grow into a ${growth.next.name}!`);
  for (const habit of open) {
    const next = STREAK_MILESTONES.find((days) => days > habit.streak);
    if (habit.streak > 0 && next === habit.streak + 1) tips.push(`Do ${habit.label} today for a ${next}-day streak!`);
  }
  const late = open.find((habit) => isHabitLate(habit, now));
  if (late) tips.push(`${late.label} was due earlier. There is still time today!`);
  const rated = habits
    .map((habit) => ({ habit, rate: recentRate(habit, now) }))
    .filter((entry): entry is { habit: Habit; rate: number } => entry.rate !== null)
    .sort((left, right) => right.rate - left.rate);
  const strongest = rated[0];
  const weakest = rated[rated.length - 1];
  if (rated.length >= 2 && strongest.rate >= 0.7 && weakest.rate <= 0.5) {
    tips.push(`${weakest.habit.label} needs some love. Try it right after ${strongest.habit.label}, which you rarely skip.`);
  }
  const byWeekday = Array.from({ length: 7 }, () => 0);
  for (let back = 1; back <= 28; back += 1) {
    const key = dayKey(now, back);
    const weekday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getDay();
    byWeekday[weekday] += habits.filter((habit) => habit.completionDates.includes(key)).length;
  }
  const total = byWeekday.reduce((sum, count) => sum + count, 0);
  const best = byWeekday.indexOf(Math.max(...byWeekday));
  if (total >= 8) tips.push(`${WEEKDAYS[best]} is your best day.${best === now.getDay() ? " That's today, let's make it count!" : " Let's make today just as good!"}`);
  return tips.slice(0, 3);
}

/** The buddy's mood on each of the last 7 days (today last), from how many of that day's habits were done. */
export function buddyWeek(habits: Habit[], now = new Date(), frozenDays: string[] = []) {
  return Array.from({ length: 7 }, (_, index) => {
    const back = 6 - index;
    const key = dayKey(now, back);
    const due = habits.filter((habit) => dueOn(habit, key));
    const done = due.filter((habit) => habit.completionDates.includes(key)).length;
    const share = due.length ? done / due.length : 0;
    let mood: BuddyMood;
    if (!due.length || (frozenDays.includes(key) && done === 0)) mood = 'sleepy';
    else if (share === 1) mood = 'ecstatic';
    else if (share >= 0.5) mood = 'happy';
    else if (back === 0 || done > 0) mood = 'hungry';
    else mood = 'sad';
    const label = back === 0 ? 'Today' : WEEKDAYS[new Date(now.getFullYear(), now.getMonth(), now.getDate() - back).getDay()].slice(0, 3);
    return { key, label, mood, done, due: due.length };
  });
}
