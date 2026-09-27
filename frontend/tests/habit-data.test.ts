import { filterHabitsByStatus, normalizeHabitFields } from '@/utils/habit-data';

describe('normalizeHabitFields', () => {
  it('recovers category and frequency from legacy habits', () => {
    expect(normalizeHabitFields({
      category: 'Daily',
      icon: 'heart-outline',
      meta: 'Daily • 09:00 AM',
    })).toMatchObject({ category: 'Health', frequency: 'Daily' });
  });

  it('preserves explicit category and frequency for new habits', () => {
    expect(normalizeHabitFields({
      category: 'Academics',
      frequency: 'Weekly',
      icon: 'school-outline',
      meta: 'Weekly • 09:00 AM',
    })).toMatchObject({ category: 'Academics', frequency: 'Weekly' });
  });

  it('recovers legacy quick-add categories from their icons', () => {
    expect(normalizeHabitFields({ category: 'Daily', icon: 'wallet', meta: 'Daily • Anytime' }))
      .toMatchObject({ category: 'Finance', frequency: 'Daily' });
    expect(normalizeHabitFields({ category: 'Weekly', icon: 'water', meta: 'Weekly • Anytime' }))
      .toMatchObject({ category: 'Lifestyle', frequency: 'Weekly' });
  });
});

describe('filterHabitsByStatus', () => {
  const habits = [{ done: false }, { done: true }];

  it('keeps active and completed habits in All mode', () => {
    expect(filterHabitsByStatus(habits, 'all')).toEqual(habits);
  });

  it('filters active and completed habits only in their respective modes', () => {
    expect(filterHabitsByStatus(habits, 'active')).toEqual([{ done: false }]);
    expect(filterHabitsByStatus(habits, 'done')).toEqual([{ done: true }]);
  });
});