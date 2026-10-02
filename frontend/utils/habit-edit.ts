import type { HabitCategory } from '@/authentication';
import type { Habit } from '@/hooks/app-state/types';

export type HabitEdit = { label: string; category: string; frequency: string };
export type EditableHabitFields = Pick<Habit, 'label' | 'category' | 'icon' | 'color' | 'frequency' | 'meta'>;

export const HABIT_NAME_MAX_LENGTH = 60;
/** Schedules a habit can switch to when edited; a custom schedule needs its days, so it is set when adding. */
export const EDITABLE_FREQUENCIES = ['Daily', 'Weekly', 'Monthly'];

/**
 * The fields that change when a habit is edited. Check-ins and reminders stay as they are, so
 * fixing a typo or a category never costs the student their progress (a new schedule only
 * recounts the streak for that schedule). The icon and color follow a new category; `meta`
 * ("Daily • 07:00 AM") gets the new schedule name.
 */
export function editedHabitFields(habit: Habit, edit: HabitEdit, categories: HabitCategory[]): EditableHabitFields {
  const label = edit.label.trim().slice(0, HABIT_NAME_MAX_LENGTH) || habit.label;
  const categoryChanged = edit.category !== habit.category;
  const category = categories.find((item) => item.label === edit.category);
  let meta = habit.meta;
  if (edit.frequency !== habit.frequency) {
    // A custom schedule's meta is "<description> • <reminders> • <days>"; the others have no days.
    const [, reminders] = habit.meta.split(' • ');
    meta = `${edit.frequency} • ${reminders || 'Anytime'}`;
  }
  return {
    label,
    category: edit.category,
    icon: categoryChanged && category ? (category.icon as Habit['icon']) : habit.icon,
    color: categoryChanged && category ? category.color : habit.color,
    frequency: edit.frequency,
    meta,
  };
}
