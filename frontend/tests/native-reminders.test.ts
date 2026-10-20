import { planReminders } from '@/hooks/app-state/native-reminders';
import type { Habit } from '@/hooks/app-state/types';

jest.mock('@/authentication/authService', () => ({ getApiBaseUrl: jest.fn(), getAuthenticatedHeaders: jest.fn(), getWebPushVapidPublicKey: jest.fn(), saveWebPushSubscription: jest.fn(), sendTestWebPush: jest.fn() }));

function habit(overrides: Partial<Habit> = {}): Habit {
  return {
    id: 'gym', startDate: '2026-09-01', label: 'Gym', meta: 'Daily • 08:00 AM', category: 'Health', frequency: 'Daily', icon: 'barbell-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates: [], reminderEnabled: true, reminderTime: '08:00 AM', reminderTimes: ['08:00 AM'], ...overrides,
  };
}

// October 2026; the 19th is a Monday.
const at = (day: number, hour: number, minute = 0, month = 9) => new Date(2026, month, day, hour, minute);
const plan = (habits: Habit[], now: Date, limit = 200) => planReminders(habits, now, { ringInterval: 20, limit });
const dates = (habits: Habit[], now: Date, limit?: number) => plan(habits, now, limit).map((reminder) => reminder.date);

describe('reminders planned on the phone', () => {
  it('plans each reminder of the next two weeks, so they keep coming while the app is not opened', () => {
    const reminders = plan([habit()], at(19, 6));
    expect(reminders.map((reminder) => reminder.date)).toEqual(Array.from({ length: 14 }, (_, day) => at(19 + day, 8)));
    expect(reminders[0]).toMatchObject({
      identifier: 'habitai-reminder:gym:2026-10-19:08:00', title: 'Gym reminder', body: 'A small step today keeps your streak moving.',
      soundEnabled: true, data: { habitId: 'gym', snoozeCount: 0 },
    });
  });

  it('starts tomorrow once the time has passed today or the habit is done', () => {
    expect(dates([habit()], at(19, 9))[0]).toEqual(at(20, 8));
    expect(dates([habit({ completionDates: ['2026-10-19'] })], at(19, 6))[0]).toEqual(at(20, 8));
    // Only a passed time moves: a later one today is still ahead.
    expect(dates([habit({ reminderTimes: ['08:00 AM', '06:00 PM'] })], at(19, 9)).slice(0, 2)).toEqual([at(19, 18), at(20, 8)]);
  });

  it('plans only on the habit\'s days, from its start date', () => {
    const custom = habit({ frequency: 'Custom', meta: 'Custom • 08:00 AM • Mon, Wed, Fri', reminderDays: ['Mon', 'Wed', 'Fri'] });
    expect(dates([custom], at(19, 6))).toEqual([at(19, 8), at(21, 8), at(23, 8), at(26, 8), at(28, 8), at(30, 8)]);
    expect(dates([habit({ startDate: '2026-10-30' })], at(19, 6))).toEqual([at(30, 8), at(31, 8), at(1, 8, 0, 10)]);
  });

  it('plans a monthly habit\'s next day, even more than two weeks away', () => {
    const monthly = (startDate: string) => habit({ frequency: 'Monthly', startDate, meta: 'Monthly • 09:00 AM', reminderTime: '09:00 AM', reminderTimes: ['09:00 AM'] });
    expect(dates([monthly('2026-09-15')], at(19, 6))).toEqual([at(15, 9, 0, 10)]);
    expect(dates([monthly('2026-09-15')], at(15, 8))).toEqual([at(15, 9)]);
    // On the 31st: the last day of a shorter month.
    expect(dates([monthly('2026-08-31')], at(31, 10))).toEqual([at(30, 9, 0, 10)]);
  });

  it('keeps the soonest reminders within the limit, and still the next one of every reminder time', () => {
    const rent = habit({ id: 'rent', label: 'Rent', frequency: 'Monthly', startDate: '2026-09-15', meta: 'Monthly • 09:00 AM', reminderTime: '09:00 AM', reminderTimes: ['09:00 AM'] });
    expect(dates([habit(), rent], at(19, 6), 5)).toEqual([at(19, 8), at(20, 8), at(21, 8), at(22, 8), at(15, 9, 0, 10)]);
  });

  it('plans nothing for a habit without reminders, and a silent one without sound', () => {
    expect(plan([habit({ reminderEnabled: false })], at(19, 6))).toEqual([]);
    expect(plan([habit({ reminderTimes: [], reminderTime: '' })], at(19, 6))).toEqual([]);
    expect(plan([habit({ reminderSoundEnabled: false })], at(19, 6)).every((reminder) => !reminder.soundEnabled)).toBe(true);
  });

  it('offers Snooze only where a snooze comes back before the habit is missed', () => {
    const reminders = plan([habit({ reminderTimes: ['11:00 AM', '11:30 AM'] })], at(19, 6));
    // 11:00 + 20 minutes is before the 11:30 deadline; a snooze of the 11:30 reminder is after it.
    expect(reminders.filter((reminder) => reminder.date.getMinutes() === 0).every((reminder) => reminder.snooze)).toBe(true);
    expect(reminders.filter((reminder) => reminder.date.getMinutes() === 30).some((reminder) => reminder.snooze)).toBe(false);
  });

  it('gives a smart habit today\'s message, and its early nudge when at risk, on every day', () => {
    // No check-ins in the last week: at risk, so a nudge 30 minutes early.
    const smart = habit({ smartReminderEnabled: true });
    const reminders = plan([smart], at(19, 6));
    expect(reminders).toHaveLength(28);
    expect(reminders.slice(0, 2).map((reminder) => reminder.date)).toEqual([at(19, 7, 30), at(19, 8)]);
    expect(reminders.every((reminder) => reminder.title === 'Smart reminder: Gym' && reminder.body === reminders[0].body)).toBe(true);
    expect(reminders[0].data).toMatchObject({ habitId: 'gym', type: 'smart-reminder', riskLevel: 'high', snoozeCount: 0 });

    // The ML model's estimate, when there is one: its risk and suggestion.
    const predictions = { gym: { dropout_risk: 0.1, completion_probability: 0.9, recommended_action: 'Pack your gym bag tonight.' } };
    const withModel = planReminders([smart], at(19, 6), { ringInterval: 20, limit: 200, predictions });
    expect(withModel).toHaveLength(14);
    expect(withModel.every((reminder) => reminder.body === 'Pack your gym bag tonight.' && reminder.data.riskLevel === 'low')).toBe(true);
  });

  it('tells a reminder planned again from one that changed', () => {
    const [first] = plan([habit()], at(19, 6));
    expect(plan([habit()], at(19, 7))[0]).toEqual(first);
    for (const changed of [habit({ label: 'Run' }), habit({ reminderSoundEnabled: false }), habit({ smartReminderEnabled: true })]) {
      const reminder = plan([changed], at(19, 6)).find((item) => item.identifier === first.identifier);
      expect(reminder?.data.plan).not.toBe(first.data.plan);
    }
    // Snooze depends on the ring interval.
    const longRing = planReminders([habit({ reminderTimes: ['08:00 AM', '08:30 AM'] })], at(19, 6), { ringInterval: 40, limit: 200 });
    const shortRing = planReminders([habit({ reminderTimes: ['08:00 AM', '08:30 AM'] })], at(19, 6), { ringInterval: 20, limit: 200 });
    expect(longRing[0].data.plan).not.toBe(shortRing[0].data.plan);
  });
});
