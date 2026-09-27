import { getVisibleHabitsForDate } from '@/utils/habit-visibility';

describe('getVisibleHabitsForDate', () => {
  it('hides habits that were missed today after their reminder time', () => {
    const now = new Date('2026-09-26T18:30:00');
    const habits = [
      { id: 'done', completionDates: ['2026-09-26'], startDate: '2026-09-01', reminderEnabled: true, reminderTime: '08:00' },
      { id: 'missed', completionDates: [], startDate: '2026-09-01', reminderEnabled: true, reminderTime: '08:00' },
    ];

    expect(getVisibleHabitsForDate(habits, now, now).map((habit) => habit.id)).toEqual(['done']);
  });

  it('keeps other dates visible even if the habit was not completed yet', () => {
    const now = new Date('2026-09-26T18:30:00');
    const habits = [
      { id: 'open', completionDates: [], startDate: '2026-09-01', reminderEnabled: true, reminderTime: '08:00' },
    ];

    expect(getVisibleHabitsForDate(habits, new Date('2026-09-25T12:00:00'), now).map((habit) => habit.id)).toEqual(['open']);
  });
});
