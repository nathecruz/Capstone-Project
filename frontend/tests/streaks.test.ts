import { computeStreak } from '@/utils/streaks';

describe('computeStreak', () => {
  const today = '2026-09-30'; // Wednesday

  it('counts consecutive days and resets after a missed day', () => {
    const daily = { frequency: 'Daily', startDate: '2026-09-01' };
    expect(computeStreak(daily, ['2026-09-28', '2026-09-29', '2026-09-30'], today)).toBe(3);
    expect(computeStreak(daily, ['2026-09-28', '2026-09-29'], today)).toBe(2);
    expect(computeStreak(daily, ['2026-09-26', '2026-09-28'], today)).toBe(0);
    expect(computeStreak(daily, [], today)).toBe(0);
  });

  it('skips days the habit is not scheduled', () => {
    const monWedFri = { frequency: 'Custom', startDate: '2026-09-01', reminderDays: ['Mon', 'Wed', 'Fri'] };
    expect(computeStreak(monWedFri, ['2026-09-25', '2026-09-28', '2026-09-30'], today)).toBe(3);
    expect(computeStreak(monWedFri, ['2026-09-25', '2026-09-30'], today)).toBe(1);
    const legacyMeta = { frequency: 'Custom', meta: 'Selected days • 07:00 AM • Mon, Wed, Fri', startDate: '2026-09-01' };
    expect(computeStreak(legacyMeta, ['2026-09-28', '2026-09-30'], today)).toBe(2);
  });

  it('handles weekly and monthly habits', () => {
    expect(computeStreak({ frequency: 'Weekly', startDate: '2026-09-02' }, ['2026-09-16', '2026-09-23', '2026-09-30'], today)).toBe(3);
    expect(computeStreak({ frequency: 'Monthly', startDate: '2026-07-30' }, ['2026-08-30', '2026-09-30'], today)).toBe(2);
  });
});
