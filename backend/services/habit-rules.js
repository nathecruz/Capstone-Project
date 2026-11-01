// The rules every saved habit follows, kept on the server (PUT /api/app-state) so no app version
// can get around them. HabitAI's habits are about two areas, Health and Academics (the scope the
// capstone panel set): a new habit is filed under one of them. Habits whose week has ended keep
// the category they had; they are history.
import { hasHabitEnded } from './habit-week.js';

export const FOCUS_CATEGORIES = ['Health', 'Academics'];

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

/** The focus categories among these labels, in their order; both when none is one. */
export function focusCategories(labels) {
  const found = [...new Set((Array.isArray(labels) ? labels : []).map(focusCategory).filter(Boolean))];
  return found.length ? found : [...FOCUS_CATEGORIES];
}

/**
 * The state to save with the habit rules applied for the account's `today`: a habit that is new
 * (not in `current`, the stored state) and still running is filed under its focus category.
 * Stored habits and habits whose week has ended are left as they are.
 */
export function withHabitRules(state, current, today) {
  if (!Array.isArray(state?.habits)) return state;
  const stored = new Set((Array.isArray(current?.habits) ? current.habits : []).map((habit) => habit?.id).filter(Boolean));
  let changed = false;
  const habits = state.habits.map((habit) => {
    if (!habit || typeof habit !== 'object' || stored.has(habit.id) || hasHabitEnded(habit, today)) return habit;
    const category = focusCategoryFor(habit);
    if (category === habit.category) return habit;
    changed = true;
    return { ...habit, category };
  });
  return changed ? { ...state, habits } : state;
}
