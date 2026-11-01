import type { HabitCategory } from '@/authentication';

/**
 * HabitAI's habits are about two areas, Health and Academics (the scope the capstone panel set; the
 * server keeps it in backend/services/habit-rules.js). Habits whose week has ended keep the category
 * they had: they are history.
 */
export const FOCUS_CATEGORIES = ['Health', 'Academics'] as const;
export type FocusCategory = (typeof FOCUS_CATEGORIES)[number];

/** The two categories, used until (or if) the Admin Panel's managed list loads from the backend. */
export const DEFAULT_HABIT_CATEGORIES: HabitCategory[] = [
  { label: 'Health', icon: 'heart-outline', color: '#E58D8D' },
  { label: 'Academics', icon: 'school-outline', color: '#57B991' },
];

// Words that make a habit about schoolwork or teaching; anything else counts as Health (the same as the server's).
const ACADEMIC_WORDS = /\b(stud(y|ying|ies)|review(er|ing)?|read(ing)?|books?|homework|assignments?|class(es)?|lessons?|lectures?|exams?|quiz(zes)?|notes?|research|essays?|writ(e|ing)|math|science|thesis|projects?|modules?|problems?|languages?|vocabulary|lab|reports?|grad(e|ing)|teach(ing)?|consultations?|articles?|syllabus|recitation|learn(ing)?)\b/i;

/** The focus category with this label (any case), or null. */
export function focusCategory(label: string | null | undefined): FocusCategory | null {
  const key = String(label ?? '').trim().toLowerCase();
  return FOCUS_CATEGORIES.find((category) => category.toLowerCase() === key) ?? null;
}

/** The focus category a habit belongs to: its own when it is one, else Academics for schoolwork and Health for the rest. */
export function focusCategoryFor(habit: { label?: string; category?: string }): FocusCategory {
  return focusCategory(habit.category) ?? (ACADEMIC_WORDS.test(habit.label ?? '') ? 'Academics' : 'Health');
}

/** The managed categories that are Health or Academics, in the managed order, each once; the defaults when neither is there. */
export function focusCategoryList(managed: HabitCategory[] | null | undefined): HabitCategory[] {
  const found = new Map<FocusCategory, HabitCategory>();
  for (const item of managed ?? []) {
    const label = focusCategory(item?.label);
    if (label && !found.has(label)) found.set(label, { ...item, label });
  }
  return found.size ? [...found.values()] : DEFAULT_HABIT_CATEGORIES;
}
