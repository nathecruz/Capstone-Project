import assert from 'node:assert/strict';
import test from 'node:test';
import { buildClassPulse, classSummaryPrompt, classSummarySchema, mlRisk, riskSummary, ruleRisk, studentSignal } from '../src/lib/class-pulse.js';

// Friday Oct 2, 2026, 9 PM in Manila.
const now = new Date('2026-10-02T13:00:00.000Z');
const timeZone = 'Asia/Manila';
const at = (date, hour) => Date.parse(`${date}T${String(hour).padStart(2, '0')}:00:00+08:00`);
const habit = (userId, name, category, extra = {}) => ({ id: `${userId}:habit:${name}`, userId, category, meta: 'Daily • Anytime', frequency: 'Daily', start_date: '2026-09-26', reminder_days: [], ...extra });
const done = (userId, name, date, hour = 19) => ({ userId, habitId: `${userId}:habit:${name}`, date, completedAt: at(date, hour) });
const lastWeek = ['2026-09-26', '2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02'];

function classOf() {
  const students = ['ana', 'ben', 'cy', 'dee'].map((id) => ({ id }));
  const habits = [habit('ana', 'walk', 'Health'), habit('ben', 'walk', 'Health'), habit('cy', 'read', 'Mind'), habit('ben', 'code', 'Career', { start_date: '2026-09-30' })];
  const completions = [
    ...lastWeek.map((date) => done('ana', 'walk', date)), // every day
    ...['2026-09-26', '2026-09-28', '2026-09-30', '2026-10-02'].map((date) => done('ben', 'walk', date, 7)),
    done('cy', 'read', '2026-09-26', 21),
  ];
  return buildClassPulse({ students, habits, completions, timeZone, k: 2, now });
}

test('class numbers come from scheduled days and check-ins only', () => {
  const pulse = classOf();
  assert.equal(pulse.today, '2026-10-02');
  assert.deepEqual(pulse.kpis, { students: 4, studentsWithHabits: 3, activeThisWeek: 3, checkInsToday: 2, studentsCheckedInToday: 2, consistency: 12 / 22, habits: 4 });
  assert.equal(pulse.trend.length, 14);
  assert.equal(pulse.trend.at(-1).day, '2026-10-01', 'the trend ends yesterday: today is still in progress');
  assert.equal(pulse.trend.at(-1).rate, 1 / 4, 'Thursday: only Ana of 4 scheduled habits');
  assert.equal(pulse.weekdays.find((row) => row.weekday === 'Sat').rate, 3 / 3);
});

test('small categories are folded together and the hardest comes first', () => {
  const pulse = classOf();
  assert.deepEqual(pulse.categories.map((row) => row.category), ['Other (small groups)', 'Health']);
  const other = pulse.categories[0];
  assert.equal(other.students, 2, 'Mind (Cy) and Career (Ben) each have one student');
  assert.equal(other.completed, 1);
  assert.ok(pulse.categories.every((row) => !('studentIds' in row)), 'no student ids leave the module');
});

test('the busiest check-in window and per-student facts', () => {
  const pulse = classOf();
  assert.deepEqual(pulse.peakHours, { from: '7 PM', to: '10 PM', share: 8 / 12 }, 'Ana at 7 PM and Cy at 9 PM');
  const [ana, ben, cy, dee] = pulse.studentFacts;
  assert.deepEqual(ana.last7Days, [1, 1, 1, 1, 1, 1, 1]);
  assert.equal(ana.streak, 7);
  assert.equal(ruleRisk(ana), 'low');
  assert.equal(ruleRisk(ben), 'medium', '4 of 9 scheduled in the last week');
  assert.equal(ruleRisk(cy), 'high');
  assert.equal(ruleRisk(dee), 'notStarted');
  assert.deepEqual(studentSignal(ben), { habit_name: 'All habits', streak: 1, completion_rate: 0.444, missed_days: 5, last_7_days: [1, 0, 1, 0, 1, 0, 1], priority: 'balanced', goal_type: 'general' });
});

test('risk counts prefer the ML dropout risk and fall back to the rule', () => {
  const pulse = classOf();
  assert.equal(mlRisk(0.7), 'high');
  assert.equal(mlRisk(0.4), 'medium');
  assert.equal(mlRisk(0.1), 'low');
  assert.deepEqual(riskSummary(pulse.studentFacts), { high: 1, medium: 1, low: 1, new: 0, notStarted: 1, fromModel: 0 });
  // The model says Ben is fine; Cy has no forecast and keeps the rule's answer.
  assert.deepEqual(riskSummary(pulse.studentFacts, new Map([[0, 0.05], [1, 0.1]])), { high: 1, medium: 0, low: 2, new: 0, notStarted: 1, fromModel: 2 });
});

test('the AI gets only class numbers and its answer is validated', () => {
  const pulse = classOf();
  const prompt = classSummaryPrompt(pulse, riskSummary(pulse.studentFacts));
  assert.match(prompt, /"classConsistency":"55%"/);
  assert.ok(!/ana|ben|"cy"|dee/i.test(prompt), 'no student identifiers in the prompt');
  const parsed = classSummaryPrompt && classSummarySchema.parse({ summary: 'Steady week.', suggestions: ['One', 'Two', 'Three', 'Four'] });
  assert.deepEqual(parsed.suggestions, ['One', 'Two', 'Three']);
  assert.equal(classSummarySchema.safeParse({ summary: 'Only a summary' }).success, false);
});

test('habits that ended with their week are history: due only until their last day', () => {
  // Wednesday Oct 21, 2026, 9 PM in Manila. Weeks run Monday to Sunday.
  const wednesday = new Date('2026-10-21T13:00:00.000Z');
  const week = (from, to) => ({ start_date: from, active_until: to });
  const students = ['ana', 'ben', 'cy', 'dee'].map((id) => ({ id }));
  const habits = [
    habit('ana', 'walk', 'Health', week('2026-10-12', '2026-10-18')),
    habit('ana', 'run', 'Health', week('2026-10-19', '2026-10-25')),
    habit('ben', 'read', 'Mind', week('2026-10-05', '2026-10-11')), // stopped after that week
    habit('cy', 'journal', 'Mind', week('2026-08-31', '2026-09-06')), // ended before the 28-day window
  ];
  const days = (from, count) => Array.from({ length: count }, (_, index) => new Date(Date.parse(`${from}T00:00:00Z`) + index * 86_400_000).toISOString().slice(0, 10));
  const completions = [
    ...days('2026-10-12', 7).map((date) => done('ana', 'walk', date)),
    ...days('2026-10-19', 2).map((date) => done('ana', 'run', date)),
    ...days('2026-10-05', 6).map((date) => done('ben', 'read', date)),
  ];
  const pulse = buildClassPulse({ students, habits, completions, timeZone, k: 1, now: wednesday });

  assert.deepEqual(pulse.kpis, { students: 4, studentsWithHabits: 1, activeThisWeek: 1, checkInsToday: 0, studentsCheckedInToday: 0, consistency: 15 / 16, habits: 1 },
    'ended habits are not tracked now, and they are not due after their week');
  assert.deepEqual(pulse.trend.find((row) => row.day === '2026-10-19'), { day: '2026-10-19', rate: 1, completed: 1, scheduled: 1 }, 'Monday: only this week\'s habit was due');
  const mind = pulse.categories.find((row) => row.category === 'Mind');
  assert.deepEqual([mind.students, mind.scheduled, mind.completed], [1, 7, 6], 'a habit that ended before the window is left out');

  const [ana, ben, cy, dee] = pulse.studentFacts;
  assert.equal(ana.streak, 7, 'last week\'s habit keeps the streak of its last day');
  assert.equal(ben.streak, 0, 'a habit that ended over a week ago gives no streak');
  assert.equal(ruleRisk(ana), 'low');
  assert.equal(ruleRisk(ben), 'high', 'nothing due this week and no new habits: stopped tracking');
  assert.equal(ruleRisk(cy), 'high');
  assert.equal(ruleRisk(dee), 'notStarted');
  assert.equal(ruleRisk({ ...ben, currentHabits: 1 }), 'new', 'a habit that starts later is too new to judge');
  assert.match(classSummaryPrompt(pulse, riskSummary(pulse.studentFacts)), /Habits last one week/);
});
