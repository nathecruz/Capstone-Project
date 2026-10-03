import type { Habit } from '@/hooks/app-state/types';
import { dailyChallenge, focusMinutesFor, habitsAtRisk, levelProgress, streakMilestone, timeOfDayFor, todayAgenda, weeklyRecap } from '@/utils/engagement';

function habit(id: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

// Saturday Oct 3, 2026.
const at = (hour: number, minute = 0) => new Date(2026, 9, 3, hour, minute);

describe('time of day', () => {
  it('uses the reminder time shown in the details, else words in the name', () => {
    expect(timeOfDayFor(habit('a', { meta: 'Daily • 06:30 AM' }))).toBe('morning');
    expect(timeOfDayFor(habit('b', { meta: 'Daily • 01:00 PM' }))).toBe('afternoon');
    expect(timeOfDayFor(habit('c', { meta: 'Daily • 09:00 PM' }))).toBe('evening');
    expect(timeOfDayFor(habit('Morning walk'))).toBe('morning');
    expect(timeOfDayFor(habit('Sleep before 11 PM'))).toBe('evening');
    expect(timeOfDayFor(habit('I am reading'))).toBe('anytime');
  });
});

describe('todayAgenda', () => {
  it('groups what is left today, skips habits not due today and picks the next one up', () => {
    const habits = [
      habit('Morning walk', { meta: 'Daily • 06:00 AM' }),
      habit('Review notes', { meta: 'Daily • 07:00 PM' }),
      habit('Drink water', { completionDates: ['2026-10-03'] }),
      habit('Gym', { frequency: 'Weekly', reminderDays: ['Mon'] }),
      habit('Read'),
    ];
    const agenda = todayAgenda(habits, at(18, 30));
    expect(agenda.sections.map((section) => [section.key, section.habits.map((item) => item.id)])).toEqual([
      ['morning', ['Morning walk']], ['evening', ['Review notes']], ['anytime', ['Read']],
    ]);
    expect(agenda.done.map((item) => item.id)).toEqual(['Drink water']);
    expect(agenda.notToday).toBe(1);
    expect(agenda.nextUp?.id).toBe('Review notes');
  });
});

describe('levels, milestones and streaks at risk', () => {
  it('turns points into a level and progress to the next', () => {
    expect(levelProgress(0)).toEqual({ level: 1, xp: 0, toNext: 100, share: 0 });
    expect(levelProgress(260)).toEqual({ level: 3, xp: 60, toNext: 40, share: 0.6 });
  });

  it('finds the milestone a streak just reached', () => {
    expect(streakMilestone(6, 7)).toBe(7);
    expect(streakMilestone(7, 8)).toBeNull();
    expect(streakMilestone(2, 3)).toBe(3);
  });

  it('warns in the evening about running streaks that are not done today', () => {
    const habits = [
      habit('walk', { completionDates: ['2026-10-01', '2026-10-02'] }),
      habit('read', { completionDates: ['2026-10-02', '2026-10-03'] }),
      habit('new'),
    ];
    expect(habitsAtRisk(habits, at(15))).toEqual([]);
    expect(habitsAtRisk(habits, at(20)).map((item) => item.id)).toEqual(['walk']);
  });
});

describe('daily challenge and weekly recap', () => {
  it('asks for up to 3 of the habits due today', () => {
    const habits = [habit('a', { completionDates: ['2026-10-03'] }), habit('b'), habit('c'), habit('d'), habit('e', { frequency: 'Weekly', reminderDays: ['Mon'] })];
    expect(dailyChallenge(habits, at(9))).toEqual({ target: 3, done: 1, complete: false, bonus: 10 });
    expect(dailyChallenge([habit('a', { completionDates: ['2026-10-03'] })], at(9))).toEqual({ target: 1, done: 1, complete: true, bonus: 10 });
    expect(dailyChallenge([], at(9)).target).toBe(0);
  });

  it('sums last week and compares it with the week before', () => {
    const lastWeek = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
    const weekBefore = ['2026-09-14', '2026-09-15'];
    const recap = weeklyRecap([habit('walk', { completionDates: [...weekBefore, ...lastWeek] })], new Date(2026, 8, 28, 9));
    expect(recap.weekKey).toBe('2026-09-28');
    expect(recap.lastWeek).toMatchObject({ start: '2026-09-21', end: '2026-09-27', scheduled: 7, done: 4, bestDay: '2026-09-21' });
    expect(recap.weekBefore.done).toBe(2);
    expect(recap.change).toBeCloseTo(2 / 7);
  });
});

describe('focus sessions', () => {
  it('reads the length from the habit name', () => {
    expect(focusMinutesFor('Read for 20 minutes')).toBe(20);
    expect(focusMinutesFor('Write research for 30 min')).toBe(30);
    expect(focusMinutesFor('Study 1.5 hours')).toBe(90);
    expect(focusMinutesFor('Meditate')).toBe(25);
  });
});
