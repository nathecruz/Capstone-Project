// The rules every saved habit follows, kept on the server (PUT /api/app-state) so no app version
// can get around them. HabitAI's habits are about two areas, Health and Academics (the scope the
// capstone panel set): a new habit is filed under one of them. Every new habit also says how its
// check-in is proven (services/check-in-proof.js), and a habit that has a proof keeps one. Habits
// whose week has ended keep what they had; they are history.
import { hasHabitEnded } from './habit-week.js';

export const FOCUS_CATEGORIES = ['Health', 'Academics'];
// The proofs a check-in can need (the app's frontend/utils/habit-templates.ts has the same limits).
export const TIMER_MINUTES = { min: 5, max: 180, default: 20 };
export const STEP_TARGET = { min: 500, max: 30000, default: 2000 };

// Words that make a habit about schoolwork or teaching; anything else counts as Health.
const ACADEMIC_WORDS = /\b(stud(y|ying|ies)|review(er|ing)?|read(ing)?|books?|homework|assignments?|class(es)?|lessons?|lectures?|exams?|quiz(zes)?|notes?|research|essays?|writ(e|ing)|math|science|thesis|projects?|modules?|problems?|languages?|vocabulary|lab|reports?|grad(e|ing)|teach(ing)?|consultations?|articles?|syllabus|recitation|learn(ing)?)\b/i;

/** The focus category with this label (any case), or null. */
export function focusCategory(label) {
  const key = String(label ?? '').trim().toLowerCase();
  return FOCUS_CATEGORIES.find((category) => category.toLowerCase() === key) ?? null;
}

/** The focus category a habit belongs to: its own when it is one, else Academics for schoolwork and Health for the rest. */
export function focusCategoryFor(habit) {
  return focusCategory(habit?.category) ?? (ACADEMIC_WORDS.test(String(habit?.label ?? habit?.name ?? '')) ? 'Academics' : 'Health');
}

const clamp = (value, { min, max }) => Math.min(max, Math.max(min, Math.round(value)));

/** A habit's proof within the limits ({ type: 'timer', minutes } | { type: 'steps', steps } | { type: 'photo' }), or null when it has none. */
export function habitProof(habit) {
  const proof = habit?.proof;
  if (!proof || typeof proof !== 'object') return null;
  if (proof.type === 'timer' && Number.isFinite(Number(proof.minutes))) return { type: 'timer', minutes: clamp(Number(proof.minutes), TIMER_MINUTES) };
  if (proof.type === 'steps' && Number.isFinite(Number(proof.steps))) return { type: 'steps', steps: clamp(Number(proof.steps), STEP_TARGET) };
  if (proof.type === 'photo') return { type: 'photo' };
  return null;
}

// Habits done for a stretch of time, timed with the Focus timer when the name gives no minutes.
const TIMED_WORDS = /\b(stud(y|ying)|read(ing)?|review|practi[cs]e|meditat\w*|exercis\w*|workout|work out|stretch\w*|yoga|run|jog\w*|focus|journal\w*|writ(e|ing)|research|lesson|prepare|pray\w*|breath\w*|gym|train\w*)\b/i;

/**
 * The proof a habit with this name most likely needs (the app suggests the same): steps for
 * walking, the Focus timer for a stretch of time, a photo for the rest.
 */
export function suggestedProof(label) {
  const text = String(label ?? '').toLowerCase();
  if (/\b(walk\w*|steps?)\b/.test(text)) {
    const count = Number(/(\d[\d,]*)\s*(k\b|steps?)/.exec(text)?.[1]?.replace(/,/g, ''));
    const thousands = /\d\s*k\b/.test(text) ? 1000 : 1;
    return { type: 'steps', steps: Number.isFinite(count) && count > 0 ? clamp(count * thousands, STEP_TARGET) : STEP_TARGET.default };
  }
  const duration = /(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b/.exec(text);
  if (duration) return { type: 'timer', minutes: clamp(Number(duration[1]) * (duration[2].startsWith('h') ? 60 : 1), TIMER_MINUTES) };
  if (TIMED_WORDS.test(text)) return { type: 'timer', minutes: TIMER_MINUTES.default };
  return { type: 'photo' };
}

/** The focus categories among these labels, in their order; both when none is one. */
export function focusCategories(labels) {
  const found = [...new Set((Array.isArray(labels) ? labels : []).map(focusCategory).filter(Boolean))];
  return found.length ? found : [...FOCUS_CATEGORIES];
}

const sameProof = (left, right) => JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

/**
 * The state to save with the habit rules applied for the account's `today`. A habit that is new
 * (not in `current`, the stored state) and still running is filed under its focus category and gets
 * a proof: the one sent, within the limits, or the one its name suggests (older app versions send
 * none). A stored habit with a proof keeps one: a valid new one replaces it, a missing or broken one
 * does not remove it. Habits whose week has ended are left as they are.
 */
export function withHabitRules(state, current, today) {
  if (!Array.isArray(state?.habits)) return state;
  const stored = new Map((Array.isArray(current?.habits) ? current.habits : []).filter((habit) => habit?.id).map((habit) => [habit.id, habit]));
  let changed = false;
  const habits = state.habits.map((habit) => {
    if (!habit || typeof habit !== 'object') return habit;
    const previous = stored.get(habit.id);
    if (previous ? hasHabitEnded(previous, today) : hasHabitEnded(habit, today)) return habit;
    const category = previous ? habit.category : focusCategoryFor(habit);
    const proof = previous ? habitProof(habit) ?? habitProof(previous) : habitProof(habit) ?? suggestedProof(habit.label ?? habit.name);
    if (category === habit.category && sameProof(proof, habit.proof)) return habit;
    changed = true;
    const next = { ...habit, category };
    if (proof) next.proof = proof;
    else delete next.proof;
    return next;
  });
  return changed ? { ...state, habits } : state;
}
