import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPoolConfig } from '../src/db.js';
import { toCsv } from '../src/lib/http.js';
import {
  addDays,
  ageBracket,
  dateRange,
  expectedCheckIns,
  expectedPerWeek,
  habitCreatedAt,
  habitFrequency,
  ratio,
  reminderPeriod,
  streakBucket,
  suppressSmallGroups,
  todayInZone,
} from '../src/lib/metrics.js';
import { generatePassword, passwordProblem } from '../src/lib/passwords.js';
import { hasPermission, permissionsFor } from '../src/lib/permissions.js';
import { recipientVariables, renderTemplate, unknownPlaceholders } from '../src/lib/templates.js';
import { buildCategoryRows } from '../src/routes/overview.js';

test('date helpers work in local calendar days', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.deepEqual(dateRange('2026-09-28', '2026-09-30'), ['2026-09-28', '2026-09-29', '2026-09-30']);
  // 2026-09-30 17:00 UTC is already Oct 1 in Manila.
  assert.equal(todayInZone('Asia/Manila', new Date('2026-09-30T17:00:00Z')), '2026-10-01');
});

test('parses habit frequency from the app meta string', () => {
  assert.equal(habitFrequency('Daily • 07:00 AM'), 'Daily');
  assert.equal(habitFrequency('Weekly • Anytime'), 'Weekly');
  assert.equal(habitFrequency('Weekdays only • 08:00 PM • Mon, Tue, Wed, Thu, Fri'), 'Custom');
  assert.equal(expectedPerWeek('Daily • 07:00 AM'), 7);
  assert.equal(expectedPerWeek('Weekly • Anytime'), 1);
  assert.equal(expectedPerWeek('Twice a week • Anytime • Tue, Fri'), 2);
  assert.equal(expectedPerWeek('Selected days • 06:00 AM • Mon, Wed, Fri'), 3);
  assert.equal(expectedPerWeek('Weekdays only • Anytime • '), 5);
});

test('expected check-ins only count days since the habit was created', () => {
  const created = Date.parse('2026-09-29T01:00:00Z');
  assert.equal(habitCreatedAt(`user-1:habit:habit-${created}-1`), created);
  const habit = { id: `habit-${created}-1`, meta: 'Daily • 07:00 AM' };
  assert.equal(expectedCheckIns(habit, '2026-09-01', '2026-09-30', 'Asia/Manila'), 2);
  assert.equal(expectedCheckIns({ id: 'legacy', meta: 'Daily' }, '2026-09-01', '2026-09-30', 'Asia/Manila'), 30);
  assert.equal(expectedCheckIns(habit, '2026-09-01', '2026-09-20', 'Asia/Manila'), 0);
  assert.equal(ratio(3, 2), 1);
  assert.equal(ratio(1, 0), null);
});

test('buckets ages, reminder times and streaks', () => {
  const now = new Date('2026-09-30T00:00:00');
  assert.equal(ageBracket('April 15, 2003', now), '21–23');
  assert.equal(ageBracket('January 1, 1995', now), '27 and above');
  assert.equal(ageBracket('', now), 'Not specified');
  assert.equal(reminderPeriod('07:00 AM'), 'Morning (5 AM–12 PM)');
  assert.equal(reminderPeriod('12:30 PM'), 'Afternoon (12–5 PM)');
  assert.equal(reminderPeriod('02:58 AM'), 'Night (9 PM–5 AM)');
  assert.equal(reminderPeriod('nonsense'), null);
  assert.equal(streakBucket(0), 'No streak');
  assert.equal(streakBucket(7), '1–2 weeks');
  assert.equal(streakBucket(45), '30+ days');
});

test('k-anonymity merges or withholds small groups', () => {
  const groups = [
    { label: 'Female', students: 10, completions: 40 },
    { label: 'Male', students: 2, completions: 5 },
    { label: 'Non-binary', students: 2, completions: 3 },
  ];
  const merged = suppressSmallGroups(groups, 3, ['completions']);
  assert.deepEqual(merged.rows.map((row) => [row.label, row.students, row.completions]), [['Female', 10, 40], ['Other groups (combined)', 4, 8]]);
  assert.equal(merged.suppressedGroups, 2);

  const withheld = suppressSmallGroups([{ label: 'A', students: 5 }, { label: 'B', students: 1 }], 3, []);
  assert.deepEqual(withheld.rows.map((row) => row.label), ['A']);
  assert.equal(withheld.withheldStudents, 1);
});

test('category rows keep a stable color slot per managed category', () => {
  const managed = [{ label: 'Health' }, { label: 'Mind' }, { label: 'Productivity' }];
  const rows = buildCategoryRows(managed, [{ category: 'Productivity' }, { category: 'health' }, { category: 'Legacy' }], [{ category: 'Productivity', completions: 4 }]);
  assert.deepEqual(rows.map((row) => [row.category, row.slot, row.habits, row.completions]), [
    ['Health', 0, 1, 0],
    ['Productivity', 2, 1, 4],
    ['Legacy', 3, 1, 0],
  ]);
});

test('renders notification placeholders per recipient', () => {
  const variables = recipientVariables({ fullName: 'Juan Dela Cruz', username: 'juan', habitCount: 3, bestStreak: 5 }, 'HabitAI');
  assert.equal(renderTemplate('Hi {{first_name}}, {{ habit_count }} habits on {{app_name}}', variables), 'Hi Juan, 3 habits on HabitAI');
  assert.equal(renderTemplate('Keep {{unknown}}', variables), 'Keep {{unknown}}');
  assert.deepEqual(unknownPlaceholders('{{first_name}} {{bogus}} {{BOGUS}}'), ['bogus']);
  assert.equal(recipientVariables({ fullName: '', username: '' }, 'HabitAI').first_name, 'there');
});

test('password policy and generator', () => {
  assert.match(passwordProblem('short'), /at least 8/);
  assert.match(passwordProblem('alllowercase1!'), /uppercase/);
  assert.match(passwordProblem('Juan#2026x', { fullName: 'Juan Dela Cruz' }), /must not contain/);
  assert.equal(passwordProblem('Tr0ub4dor&3x'), null);
  for (let index = 0; index < 20; index += 1) assert.equal(passwordProblem(generatePassword()), null);
});

test('role permissions', () => {
  assert.equal(hasPermission('admin', 'users:manage'), true);
  assert.equal(hasPermission('faculty', 'analytics:view'), true);
  assert.equal(hasPermission('faculty', 'users:view'), false);
  assert.deepEqual(permissionsFor('user'), []);
});

test('CSV export escapes quotes and neutralises formulas', () => {
  const csv = toCsv([{ a: 'He said "hi"', b: '=SUM(A1)' }], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]);
  assert.equal(csv, 'A,B\r\n"He said ""hi""",\'=SUM(A1)');
});

test('Neon connection strings keep TLS verification and channel binding', () => {
  const config = buildPoolConfig('postgresql://u:p@ep-x-pooler.aws.neon.tech/db?sslmode=require&channel_binding=require');
  assert.deepEqual(config.ssl, { rejectUnauthorized: true });
  assert.equal(config.enableChannelBinding, true);
  assert.equal(new URL(config.connectionString).searchParams.has('sslmode'), false);
  assert.equal(buildPoolConfig('postgresql://u:p@localhost/db').ssl, false);
});
