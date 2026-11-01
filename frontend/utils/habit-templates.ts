// What a habit's check-in needs as proof, and habits made from the ready-made templates
// (constants/habit-templates.ts). The limits are the server's (backend/services/habit-rules.js).
import type { Ionicons } from '@expo/vector-icons';
import type { HabitCategory } from '@/authentication';
import { focusCategoryFor } from '@/constants/habit-categories';
import type { HabitTemplate } from '@/constants/habit-templates';
import type { HabitProof } from '@/hooks/app-state/types';
import type { NewHabit } from '@/utils/planned-habits';

export const TIMER_MINUTES = { min: 5, max: 180, default: 20 };
export const STEP_TARGET = { min: 500, max: 30000, default: 2000 };

const clamp = (value: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, Math.round(value)));

// Habits done for a stretch of time, timed with the Focus timer when the name gives no minutes.
const TIMED_WORDS = /\b(stud(y|ying)|read(ing)?|review|practi[cs]e|meditat\w*|exercis\w*|workout|work out|stretch\w*|yoga|run|jog\w*|focus|journal\w*|writ(e|ing)|research|lesson|prepare|pray\w*|breath\w*|gym|train\w*)\b/i;

/**
 * The proof a habit with this name most likely needs: steps for walking ("Walk 3,000 steps"), the
 * Focus timer for a stretch of time ("Read for 15 minutes", "Study 1 hour", or studying, reading,
 * exercising), a photo for the rest.
 */
export function suggestedProof(label: string): HabitProof {
  const text = label.toLowerCase();
  if (/\b(walk\w*|steps?)\b/.test(text)) {
    const count = Number(/(\d[\d,]*)\s*(k\b|steps?)/.exec(text)?.[1]?.replace(/,/g, ''));
    const thousands = /\d\s*k\b/.test(text) ? 1000 : 1;
    return { type: 'steps', steps: Number.isFinite(count) && count > 0 ? clamp(count * thousands, STEP_TARGET) : STEP_TARGET.default };
  }
  const duration = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/.exec(text);
  if (duration) {
    const value = Number(duration[1]) * (duration[2].startsWith('h') ? 60 : 1);
    return { type: 'timer', minutes: clamp(value, TIMER_MINUTES) };
  }
  if (TIMED_WORDS.test(text)) return { type: 'timer', minutes: TIMER_MINUTES.default };
  return { type: 'photo' };
}

/** The proof kept within the limits: whole minutes and steps. */
export function normalizedProof(proof: HabitProof): HabitProof {
  if (proof.type === 'timer') return { type: 'timer', minutes: clamp(proof.minutes, TIMER_MINUTES) };
  if (proof.type === 'steps') return { type: 'steps', steps: clamp(proof.steps, STEP_TARGET) };
  return { type: 'photo' };
}

/** "20-minute Focus timer", "2,000 steps" or "Photo", for the habit's card and the Add screen. */
export function proofText(proof: HabitProof | undefined) {
  if (!proof) return '';
  if (proof.type === 'timer') return `${proof.minutes}-minute Focus timer`;
  if (proof.type === 'steps') return `${proof.steps.toLocaleString('en-US')} steps`;
  return 'Photo';
}

export function proofIcon(proof: HabitProof | undefined): keyof typeof Ionicons.glyphMap {
  if (proof?.type === 'timer') return 'timer-outline';
  if (proof?.type === 'steps') return 'footsteps-outline';
  return 'camera-outline';
}

/**
 * The `addHabit` input for a template, built like the Add habit screen builds a habit: daily, a
 * reminder at the template's time with sound, today as start date, and the category's icon colour
 * from the managed list.
 */
export function habitFromTemplate(template: HabitTemplate, categories: HabitCategory[], today: string): NewHabit {
  const category = categories.find((item) => item.label === focusCategoryFor(template));
  return {
    startDate: today,
    label: template.label,
    meta: `Daily • ${template.reminderTime}`,
    category: template.category,
    frequency: 'Daily',
    icon: template.icon,
    color: category?.color || '#57B991',
    goal: 1,
    reminderEnabled: true,
    reminderTime: template.reminderTime,
    reminderTimes: [template.reminderTime],
    reminderDays: [],
    reminderSoundEnabled: true,
    smartReminderEnabled: false,
    isBadHabit: false,
    proof: template.proof,
  };
}
