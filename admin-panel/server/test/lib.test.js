import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPoolConfig, queryIfTable } from '../src/db.js';
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
  withholdSmallBalances,
} from '../src/lib/metrics.js';
import { generatePassword, passwordProblem } from '../src/lib/passwords.js';
import { hasPermission, permissionsFor } from '../src/lib/permissions.js';
import { recipientVariables, renderTemplate, unknownPlaceholders } from '../src/lib/templates.js';
import { FLAG_LIMITS, flowTotals, TOKEN_KINDS, tokenFlags, tokenKind, tokenKindSql } from '../src/lib/token-kinds.js';
import { availableUsername, usernameBase } from '../src/lib/usernames.js';
import { buildCategoryRows } from '../src/routes/overview.js';
import { buddyItemName, historyCursor, readHistoryCursor } from '../src/routes/users.js';

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

test('token balances of fewer active students than the threshold are withheld', () => {
  const two = { students: 2, median: 640, p90: 1180, over1000: 1 };
  assert.deepEqual(withholdSmallBalances(two, 3), { students: 2, median: null, p90: null, over1000: null, withheld: true }, "two students' balances could be told apart");
  assert.deepEqual(withholdSmallBalances({ ...two, students: 3 }, 3), { ...two, students: 3, withheld: false });
  assert.deepEqual(withholdSmallBalances({ students: 0, median: 0, p90: 0, over1000: 0 }, 3), { students: 0, median: 0, p90: 0, over1000: 0, withheld: false }, 'nothing to hide without students');
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

test('usernames come from the email and avoid taken ones', async () => {
  assert.equal(usernameBase('maria.santos+admin'), 'maria.santosadmin');
  assert.equal(usernameBase('juan-dela_cruz'), 'juan-dela_cruz');
  assert.equal(usernameBase('a'.repeat(40)), 'a'.repeat(24));
  assert.equal(usernameBase('+++'), 'admin');

  const taken = new Set(['maria']);
  const run = async (_sql, [name]) => ({ rowCount: taken.has(name.toLowerCase()) ? 1 : 0 });
  assert.equal(await availableUsername(run, 'jose'), 'jose');
  assert.match(await availableUsername(run, 'Maria'), /^Maria\d{2}$/);
});

test('token kinds follow the ledger id, then the label of older spends', () => {
  const id = (part) => `user-1:token:${part}`;
  const byId = [
    ['check-in:habit-1:2026-10-20', 'check-in'],
    ['undo:habit-1:2026-10-20', 'undo'],
    ['challenge:2026-10-20', 'challenge'],
    ['daily:2026-10-20:steps', 'challenge'],
    ['quest:2026-10-19:three-days', 'quest'],
    ['daily-claim:2026-10-20', 'daily-claim'],
    ['mystery:2026-10-20', 'mystery'],
    ['streak:account:2026-09-01:7', 'streak'],
    ['week:2026-10-12', 'weekly-bonus'],
    ['refund:redemption-1', 'refund'],
    ['refund:coach:3f2a', 'refund'],
    ['spend:reward:3f2a', 'reward'],
    ['spend:buddy-item:3f2a', 'buddy-item'],
    ['spend:buddy-treat:3f2a', 'buddy-treat'],
    ['spend:gift:3f2a', 'gift'],
    ['spend:freeze:3f2a', 'freeze'],
    ['spend:coach:3f2a', 'coach'],
  ];
  for (const [part, kind] of byId) assert.equal(tokenKind(id(part), 'Redeemed Grace Day'), kind, part);

  // Spends from before ids named their kind are plain UUIDs ('Buddy treat:' is not 'Buddy:').
  const legacy = '8f1c0e1e-6a52-4c1a-9d1e-0c1f3b7a2d10';
  assert.equal(tokenKind(legacy, 'Redeemed Grace Day'), 'reward');
  assert.equal(tokenKind(legacy, 'Buddy treat: Cookie'), 'buddy-treat');
  assert.equal(tokenKind(legacy, 'Buddy: Cap'), 'buddy-item');
  assert.equal(tokenKind(legacy, 'Streak freeze'), 'freeze');
  assert.equal(tokenKind(legacy, 'AI Coach'), 'coach');
  assert.equal(tokenKind(legacy, 'AI Coach answer'), 'other', 'labels other than the old ones are not guessed');
  assert.equal(tokenKind(legacy, 'Completed Read'), 'other');
  assert.equal(tokenKind(id('something-new:1'), ''), 'other');
  assert.equal(tokenKind(null, null), 'other');
});

test('the kind CASE names every kind and reads the columns of its alias', () => {
  const sql = tokenKindSql('t');
  // Gifts came with ids that name their kind, so 'gift' has no legacy label: a spend row is its <kind>.
  assert.match(sql, /THEN split_part\(substring\(t\.id from position\(':token:spend:' in t\.id\) \+ 13\), ':', 1\)/);
  for (const kind of TOKEN_KINDS.filter((name) => name !== 'gift' && name !== 'other')) assert.match(sql, new RegExp(`THEN '${kind}'`), kind);
  assert.match(sql, /ELSE 'other' END$/);
  assert.ok(sql.indexOf(':token:daily-claim:') < sql.indexOf(':token:daily:'), "'daily-claim' is checked before 'daily'");
  assert.ok(sql.indexOf("'Buddy treat:%'") < sql.indexOf("'Buddy:%'"));
  assert.equal(sql.replace(/\bt\.(id|label)\b/g, '').match(/\b(id|label)\b/), null, 'every column has the alias');
});

test('the token flow keeps refunds and undone check-ins apart', () => {
  const totals = flowTotals([
    { kind: 'check-in', earned: 300, spent: 0 },
    { kind: 'weekly-bonus', earned: 30, spent: 0 },
    { kind: 'refund', earned: 620, spent: 0 },
    { kind: 'reward', earned: 0, spent: 200 },
    { kind: 'coach', earned: 0, spent: 10 },
    { kind: 'undo', earned: 0, spent: 5 },
  ]);
  assert.deepEqual(totals, { issued: 330, refunds: 620, spent: 210, undone: 5 });
});

test('token flags start above 150 tokens, 6 check-ins and 12 habits, and at 15 gifts', () => {
  assert.deepEqual(FLAG_LIMITS, { dayTokens: 150, dayCheckIns: 6, weekHabits: 12, giftsSent: 15 });
  assert.deepEqual(tokenFlags({
    tokenDays: [{ day: '2026-10-20', count: 150 }],
    checkInDays: [{ day: '2026-10-20', count: 6 }],
    habitWeeks: [{ weekStart: '2026-10-19', count: 12 }],
    giftsSent: 14,
  }), []);
  assert.deepEqual(tokenFlags(), []);

  const flags = tokenFlags({
    tokenDays: [{ day: '2026-10-19', count: 151 }, { day: '2026-10-20', count: 210 }, { day: '2026-10-21', count: 90 }],
    checkInDays: [{ day: '2026-10-21', count: 7 }],
    habitWeeks: [{ weekStart: '2026-10-12', count: 13 }],
    giftsSent: 15,
  });
  assert.deepEqual(flags.map((flag) => flag.type), ['big-day', 'capped-day', 'many-habits', 'many-gifts']);
  assert.equal(flags[0].detail, 'Earned 210 tokens on Oct 20 (2 days over 150)');
  assert.equal(flags[1].detail, '7 check-ins on Oct 21');
  assert.equal(flags[2].detail, '13 habits started in the week of Oct 12');
  assert.equal(flags[3].detail, '15 treat gifts sent');
  assert.equal(tokenFlags({ tokenDays: [{ day: '2026-10-20', count: 5000 }] })[0].detail, 'Earned 5,000 tokens on Oct 20');
});

test('a table the app backend has not added yet reads as zeros', async () => {
  const asked = [];
  const missing = { query: async (text, values) => { asked.push([text, values]); return { rows: [{ present: false }] }; } };
  const result = await queryIfTable('buddy_gifts', 'SELECT count(*)::int AS n FROM buddy_gifts', [], [{ sent: 0, received: 0 }], missing);
  assert.deepEqual(result.rows, [{ sent: 0, received: 0 }]);
  assert.deepEqual(asked, [['SELECT to_regclass($1) IS NOT NULL AS present', ['buddy_gifts']]], 'the guarded query never runs');

  const present = { query: async (text) => ({ rows: text.includes('to_regclass') ? [{ present: true }] : [{ n: 4 }] }) };
  assert.deepEqual((await queryIfTable('buddy_gifts', 'SELECT count(*)::int AS n FROM buddy_gifts', [], [{ n: 0 }], present)).rows, [{ n: 4 }]);
});

test('a ledger page cursor names its last row, and nothing else reads as one', () => {
  const row = { createdAt: 1792566000000, id: 'user-1:token:check-in:habit-1790708001257-1:2026-10-20' };
  assert.deepEqual(readHistoryCursor(historyCursor(row)), row);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  for (const cursor of ['', 'junk', encode([1.5, 'x']), encode(['1', 'x']), encode([1, '']), encode({ createdAt: 1, id: 'x' })]) {
    assert.equal(readHistoryCursor(cursor), null, cursor);
  }
});

test('Habi items are named by the spend that bought them, else by their id', () => {
  assert.equal(buddyItemName('bedroom', 'Buddy: Cozy room'), 'Cozy room');
  assert.equal(buddyItemName('drop-umbrella', 'Buddy: Umbrella (weekly drop)'), 'Umbrella');
  assert.equal(buddyItemName('sun-hat', null), 'Sun hat');
  assert.equal(buddyItemName('drop-mini-tree', 'Buddy treat: Cookie'), 'Mini tree');
});
