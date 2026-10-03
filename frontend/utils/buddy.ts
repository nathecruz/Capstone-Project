// Habit Buddy: the mascot grows with check-ins (stages match backend/services/buddy.js) and its
// mood follows today's habits, so it reacts to what the student does.
import type { Habit } from '@/hooks/app-state/types';
import { todayAgenda } from '@/utils/engagement';
import { isHabitMissedYesterday } from '@/utils/habit-visibility';

export type BuddyItem = { id: string; slot: 'head' | 'hand'; name: string; emoji: string; cost: number; stage: string };
export type BuddyStage = { id: string; name: string; min: number };
export type Buddy = { name: string; head: string; hand: string; owned: string[]; checkIns: number; items: BuddyItem[]; stages: BuddyStage[] };

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
export function buddyMood(habits: Habit[], name: string, now = new Date()): { mood: BuddyMood; line: string; energy: number } {
  const agenda = todayAgenda(habits, now);
  const total = agenda.scheduled.length;
  const done = agenda.done.length;
  const energy = total ? done / total : 0;
  if (!habits.length) return { mood: 'sleepy', line: `Add a habit and ${name} will grow with you.`, energy };
  if (total && done === total) return { mood: 'ecstatic', line: 'We did everything today! I feel amazing.', energy };
  if (done > 0) return { mood: 'happy', line: `Yum, thanks! ${total - done} more and I'm full of energy.`, energy };
  if (habits.some((habit) => isHabitMissedYesterday(habit, now))) return { mood: 'sad', line: 'We missed one yesterday... let\'s bounce back today.', energy };
  if (now.getHours() < 11) return { mood: 'sleepy', line: 'Good morning! A check-in will wake me up.', energy };
  if (!total) return { mood: 'happy', line: 'Rest day! Nothing is due today.', energy };
  return { mood: 'hungry', line: 'I\'m hungry for a check-in!', energy };
}

/** Things the buddy says when it is tapped. */
export const PET_LINES = ['Hehe, that tickles!', 'You\'re doing great!', 'One small step at a time.', 'I believe in you!', 'Let\'s keep the streak going!', 'High five! ✋'];
