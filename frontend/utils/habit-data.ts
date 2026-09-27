const habitFrequencies = ['Daily', 'Weekly', 'Monthly', 'Custom'] as const;
const habitCategories = ['Health', 'Mind', 'Productivity', 'Lifestyle', 'Academics', 'Study', 'Finance', 'Creativity', 'Other', 'Others'] as const;

type HabitFields = {
  category: string;
  frequency?: string;
  icon?: string;
  meta?: string;
};

function isFrequency(value: string | undefined): value is typeof habitFrequencies[number] {
  return habitFrequencies.some((frequency) => frequency === value);
}

function inferCategoryFromIcon(icon: string | undefined) {
  if (icon === 'heart-outline' || icon === 'heart') return 'Health';
  if (icon === 'bulb-outline' || icon === 'bulb') return 'Mind';
  if (icon === 'locate-outline' || icon === 'locate') return 'Productivity';
  if (icon === 'leaf-outline' || icon === 'leaf' || icon === 'water') return 'Lifestyle';
  if (icon === 'school-outline' || icon === 'school') return 'Academics';
  if (icon === 'wallet') return 'Finance';
  if (icon === 'brush') return 'Creativity';
  return 'Other';
}

export function normalizeHabitFields<T extends HabitFields>(habit: T) {
  const legacyFrequency = isFrequency(habit.category) ? habit.category : undefined;
  const metaFrequency = habit.meta?.split(' • ')[0].trim();
  const frequency = isFrequency(habit.frequency)
    ? habit.frequency
    : legacyFrequency ?? (isFrequency(metaFrequency) ? metaFrequency : 'Daily');
  const category = habitCategories.some((categoryOption) => categoryOption === habit.category)
    ? habit.category
    : inferCategoryFromIcon(habit.icon);

  return { ...habit, category, frequency };
}

export function filterHabitsByStatus<T extends { done: boolean }>(habits: T[], mode: 'all' | 'active' | 'done') {
  if (mode === 'active') return habits.filter((habit) => !habit.done);
  if (mode === 'done') return habits.filter((habit) => habit.done);
  return habits;
}