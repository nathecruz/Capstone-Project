import type { HabitCategory } from '@/authentication';

/** Built-in categories, used until (or if) the Admin Panel's managed list loads from the backend. */
export const DEFAULT_HABIT_CATEGORIES: HabitCategory[] = [
  { label: 'Health', icon: 'heart-outline', color: '#E58D8D' }, { label: 'Mind', icon: 'bulb-outline', color: '#7A6AED' },
  { label: 'Productivity', icon: 'locate-outline', color: '#4BA3FF' }, { label: 'Lifestyle', icon: 'leaf-outline', color: '#57B991' },
  { label: 'Academics', icon: 'school-outline', color: '#57B991' }, { label: 'Bad Habit', icon: 'warning-outline', color: '#E8595A' },
  { label: 'Other', icon: 'ellipsis-horizontal', color: '#57B991' },
];
