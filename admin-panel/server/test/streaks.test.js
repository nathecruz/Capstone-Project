import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DATABASE_URL ||= 'postgresql://user:password@localhost:5432/unused';
const { computeStreak, habitSchedule } = await import('../src/lib/streaks.js');

test('admin streaks are computed from check-ins and the habit schedule', () => {
  const today = '2026-09-30'; // Wednesday
  const daily = { meta: 'Daily • 07:00 AM', frequency: 'Daily', start_date: '2026-09-01', reminder_days: [] };
  assert.equal(computeStreak(daily, ['2026-09-28', '2026-09-29', '2026-09-30'], today), 3);
  assert.equal(computeStreak(daily, ['2026-09-28', '2026-09-29'], today), 2, 'an unfinished today does not break it');
  assert.equal(computeStreak(daily, ['2026-09-20', '2026-09-21'], today), 0, 'stopped using the app: no streak');

  const legacyCustom = { meta: 'Custom • 08:00 AM • Mon, Wed', frequency: '', start_date: '', reminder_days: [] };
  assert.deepEqual(habitSchedule(legacyCustom), { type: 'weekly', days: ['Mon', 'Wed'], startDate: null });
  assert.equal(computeStreak(legacyCustom, ['2026-09-23', '2026-09-28', '2026-09-30'], today), 3);
  assert.equal(computeStreak({ frequency: 'Monthly', start_date: '2026-08-30', meta: '' }, ['2026-08-30', '2026-09-30'], today), 2);
});
