// The balance of this week's habits between the two areas, Health and Academics (the panel asked for
// balanced habits): how many of each, and which one is missing when all are of one kind.
import { focusCategoryFor, type FocusCategory } from '@/constants/habit-categories';
import type { HabitTemplate } from '@/constants/habit-templates';
import type { Habit } from '@/hooks/app-state/types';

export type HabitBalance = { Health: number; Academics: number; missing: FocusCategory | null };

/** This week's habits (`currentHabits`) by area; a habit of an older category counts under the area its name fits. */
export function habitBalance(habits: Pick<Habit, 'label' | 'category'>[]): HabitBalance {
  const counts = { Health: 0, Academics: 0 };
  for (const habit of habits) counts[focusCategoryFor(habit)] += 1;
  const missing = counts.Health > 0 && counts.Academics === 0 ? 'Academics' : counts.Academics > 0 && counts.Health === 0 ? 'Health' : null;
  return { ...counts, missing };
}

/**
 * A ready-made habit to suggest: one of the missing area when the week is lopsided, never one the
 * student already has (same name). `pick` chooses among the candidates (random by default).
 */
export function suggestedTemplate(templates: HabitTemplate[], habits: Pick<Habit, 'label' | 'category'>[], pick = (count: number) => Math.floor(Math.random() * count)) {
  const taken = new Set(habits.map((habit) => habit.label.trim().toLowerCase()));
  const open = templates.filter((template) => !taken.has(template.label.toLowerCase()));
  const { missing } = habitBalance(habits);
  const candidates = missing ? open.filter((template) => template.category === missing) : open;
  const pool = candidates.length ? candidates : open;
  return pool.length ? pool[pick(pool.length)] : null;
}
