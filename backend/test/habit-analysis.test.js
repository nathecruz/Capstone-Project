import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpenCheckInDate } from '../services/completion-date.js';
import { habitAnalysisPrompt, habitAnalysisSchema, habitStats, mlSignal, mlSummary } from '../services/habit-analysis.js';

test('check-ins are open for today only, in the student time zone', () => {
  const now = new Date('2026-10-02T20:00:00.000Z'); // Oct 3, 04:00 in Manila
  assert.equal(isOpenCheckInDate('2026-10-03', 'Asia/Manila', now), true);
  assert.equal(isOpenCheckInDate('2026-10-02', 'Asia/Manila', now), false, 'yesterday is closed');
  assert.equal(isOpenCheckInDate('2026-10-04', 'Asia/Manila', now), false, 'tomorrow is not open yet');
  assert.equal(isOpenCheckInDate('2026-10-02', 'UTC', now), true);
  assert.equal(isOpenCheckInDate('2026-02-30', 'UTC', now), false);
  assert.equal(isOpenCheckInDate('2026-10-02', 'Invalid/Zone', now), false);
});

const at = (date, hour) => ({ date, completedAt: Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`) });

test('habit facts count scheduled days, misses, weekdays and the usual check-in time', () => {
  // Mon/Wed/Fri habit started on Monday Sept 14; "now" is Friday Oct 2, 9 PM in Manila.
  const habit = { label: 'Gym', category: 'Health', frequency: 'Weekly', reminderDays: ['Mon', 'Wed', 'Fri'], startDate: '2026-09-14', reminderEnabled: true, reminderTime: '06:00 PM' };
  const completions = [
    at('2026-09-14', 18), at('2026-09-16', 18), at('2026-09-21', 19), at('2026-09-23', 18),
    at('2026-09-28', 18), at('2026-09-30', 7), at('2026-10-02', 18),
  ];
  const stats = habitStats({ habit, completions, now: new Date('2026-10-02T13:00:00.000Z'), timeZone: 'Asia/Manila' });
  assert.equal(stats.scheduledDays, 9, 'Mon/Wed/Fri from Sept 14 to Oct 2');
  assert.equal(stats.completedDays, 7);
  assert.equal(stats.missedDays, 2, 'the two Fridays before today');
  assert.equal(Math.round(stats.completionRate * 100), 78);
  assert.equal(stats.streak, 3, 'Oct 2, Sept 30 and Sept 28; Friday Sept 25 was missed');
  assert.deepEqual(stats.last7Days, [0, 0, 1, 0, 1, 0, 1]);
  assert.equal(stats.strongestWeekday, 'Mon');
  assert.equal(stats.weakestWeekday, 'Fri');
  assert.equal(stats.usualCheckInTime, '6:00 PM');
  assert.equal(stats.reminder, '06:00 PM');
});

test('an unfinished today is not a miss, and a new habit has no weekday pattern yet', () => {
  const habit = { label: 'Read', category: 'Mind', frequency: 'Daily', startDate: '2026-10-01' };
  const stats = habitStats({ habit, completions: [at('2026-10-01', 21)], now: new Date('2026-10-02T03:00:00.000Z'), timeZone: 'Asia/Manila' });
  assert.equal(stats.scheduledDays, 1);
  assert.equal(stats.missedDays, 0);
  assert.equal(stats.doneToday, false);
  assert.equal(stats.strongestWeekday, null);
  assert.equal(stats.usualCheckInTime, null, 'needs at least three check-ins');
});

test('the ML input and output are mapped both ways', () => {
  const stats = { name: 'Gym', category: 'Health', streak: 5, completionRate: 0.7777, missedDays: 2, last7Days: [0, 0, 1, 0, 1, 0, 1] };
  assert.deepEqual(mlSignal(stats), { habit_name: 'Gym', streak: 5, completion_rate: 0.778, missed_days: 2, last_7_days: [0, 0, 1, 0, 1, 0, 1], priority: 'balanced', goal_type: 'health' });
  assert.deepEqual(mlSummary({ completion_probability: 0.8, dropout_risk: 0.1, recommended_action: 'Keep going', suggested_reminder_time: '06:00 PM', is_fallback: true }),
    { completionProbability: 0.8, dropoutRisk: 0.1, recommendedAction: 'Keep going', suggestedReminderTime: '06:00 PM', source: 'rules' });
  assert.equal(mlSummary({ error: 'down' }), null);
  assert.match(habitAnalysisPrompt({ ...stats, reminder: 'off' }, null), /"unavailable":true/);
});

test('the AI analysis is validated and trimmed', () => {
  const parsed = habitAnalysisSchema.parse({ headline: 'Strong start', bestTime: 'After class at 6 PM', steps: ['One', 'Two', 'Three', 'Four'], watchOut: 'x'.repeat(300) });
  assert.deepEqual(parsed.steps, ['One', 'Two', 'Three']);
  assert.equal(parsed.watchOut.length, 200);
  assert.equal(habitAnalysisSchema.safeParse({ headline: 'Only a headline' }).success, false);
});
