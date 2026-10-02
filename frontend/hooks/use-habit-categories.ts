import { useEffect, useState } from 'react';
import { getHabitCategories, type HabitCategory } from '@/authentication';
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';

/** The Admin Panel's habit categories, or the built-in ones until (or if) they load. */
export function useHabitCategories() {
  const [categories, setCategories] = useState<HabitCategory[]>(DEFAULT_HABIT_CATEGORIES);
  useEffect(() => {
    let active = true;
    void getHabitCategories().then((managed) => {
      if (active && managed?.length) setCategories(managed);
    });
    return () => {
      active = false;
    };
  }, []);
  return categories;
}
