// The weekly consistency bonus: the rate, the tiers and this week's progress, as the server pays them.
// Dates: Monday October 12 to Sunday October 18, 2026 is "last week"; October 19 starts "this week".
import assert from 'node:assert/strict';
import test from 'node:test';
import { periodResetsAt } from '../lib/http.js';
import { bonusTier, closedDue, WEEKLY_BONUS_TIERS, weeklyBonus, weeklyConsistency, weekSoFar } from '../services/weekly-bonus.js';

const LAST_WEEK = '2026-10-12';
const daily = (id, startDate = LAST_WEEK, activeUntil = '2026-10-18', extra = {}) => ({ id, frequency: 'Daily', startDate, activeUntil, reminderDays: [], meta: 'Daily • Anytime', ...extra });
const thisWeek = (id, extra) => daily(id, '2026-10-19', '2026-10-25', extra);
const days = (from, to) => {
  const list = [];
  for (let day = from; day <= to; day = new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10)) list.push(day);
  return list;
};
const done = (entries) => new Map(Object.entries(entries).map(([date, ids]) => [date, new Set(ids)]));
/** `count` check-ins of daily habits over last week, day by day (so on at least 3 days). */
const firstCheckIns = (habits, count) => {
  const map = new Map();
  for (const day of days(LAST_WEEK, '2026-10-18')) {
    for (const habit of habits) {
      if (count <= 0) return map;
      if (!map.has(day)) map.set(day, new Set());
      map.get(day).add(habit.id);
      count -= 1;
    }
  }
  return map;
};
const lastWeekOf = (habits, doneByDate, dueMark) => weeklyConsistency({ habits, doneByDate, weekStart: LAST_WEEK, lastDay: '2026-10-18', dueMark });
const dailyHabits = (count) => Array.from({ length: count }, (_, index) => daily(`h${index}`));

test('the tiers start at 60%, 75% and 90%, and the percent is rounded down', () => {
  assert.deepEqual(WEEKLY_BONUS_TIERS, [{ percent: 60, amount: 10, label: 'Steady week' }, { percent: 75, amount: 20, label: 'Strong week' }, { percent: 90, amount: 30, label: 'Consistent week' }]);
  // [habits, check-ins done, percent, amount]
  for (const [habits, count, percent, amount] of [[7, 29, 59, null], [5, 21, 60, 10], [5, 26, 74, 10], [4, 21, 75, 20], [4, 25, 89, 20], [10, 63, 90, 30], [3, 21, 100, 30]]) {
    const list = dailyHabits(habits);
    const week = lastWeekOf(list, firstCheckIns(list, count));
    assert.deepEqual([week.scheduled, week.done, week.percent, week.tier?.amount ?? null], [habits * 7, count, percent, amount], `${count}/${habits * 7}`);
    assert.equal(week.eligible, amount !== null);
  }
  assert.equal(lastWeekOf(dailyHabits(7), firstCheckIns(dailyHabits(7), 29)).reason, 'low-rate');
  assert.deepEqual([59, 60, 74, 75, 89, 90, 100].map((percent) => bonusTier(percent)?.amount ?? null), [null, 10, 10, 20, 20, 30, 30]);
});

test('a week needs 7 scheduled check-ins and check-ins on 3 days', () => {
  // A Mon/Wed/Fri habit, all done: 100%, but only 3 scheduled.
  const mwf = daily('mwf', LAST_WEEK, '2026-10-18', { frequency: 'Custom', reminderDays: ['Mon', 'Wed', 'Fri'], meta: 'Custom • Mon, Wed, Fri' });
  const few = lastWeekOf([mwf], done({ '2026-10-12': ['mwf'], '2026-10-14': ['mwf'], '2026-10-16': ['mwf'] }));
  assert.deepEqual([few.scheduled, few.percent, few.eligible, few.reason, few.tier], [3, 100, false, 'few-scheduled', null]);
  // Started Tuesday: 6 scheduled, still too few.
  assert.equal(lastWeekOf([daily('tue', '2026-10-13')], firstCheckIns([daily('tue', '2026-10-13')], 6)).reason, 'few-scheduled');
  // Four habits due only on Monday and Tuesday, all done: 8 of 8, but on 2 days.
  const twoDays = ['a', 'b', 'c', 'd'].map((id) => daily(id, LAST_WEEK, '2026-10-18', { frequency: 'Custom', reminderDays: ['Mon', 'Tue'] }));
  const week = lastWeekOf(twoDays, done({ '2026-10-12': ['a', 'b', 'c', 'd'], '2026-10-13': ['a', 'b', 'c', 'd'] }));
  assert.deepEqual([week.scheduled, week.done, week.percent, week.activeDays, week.reason], [8, 8, 100, 2, 'few-days']);
  // A check-in on a day the habit is not due counts for neither.
  const offDay = lastWeekOf(twoDays, done({ '2026-10-12': ['a'], '2026-10-14': ['a'], '2026-10-15': ['a'] }));
  assert.deepEqual([offDay.done, offDay.activeDays], [1, 1]);
});

test('habits started after Wednesday count from next week; mid-week starts and schedules count their due days', () => {
  const base = dailyHabits(3);
  const checkIns = firstCheckIns(base, 21);
  const thursday = daily('thu', '2026-10-15');
  for (const day of days('2026-10-15', '2026-10-18')) checkIns.get(day).add('thu');
  assert.deepEqual([lastWeekOf([...base, thursday], checkIns).scheduled, lastWeekOf([...base, thursday], checkIns).done], [21, 21], 'a habit started Thursday is left out, done or not');
  // Started on Wednesday: due Wednesday to Sunday.
  assert.equal(lastWeekOf([...base, daily('wed', '2026-10-14')], checkIns).scheduled, 26);
  // Weekly on Mon and Thu, Custom on Tue, Wed and Sat, Weekly with no days on its start day.
  const weekly = daily('weekly', LAST_WEEK, '2026-10-18', { frequency: 'Weekly', reminderDays: ['Mon', 'Thu'], meta: 'Weekly • Anytime' });
  const custom = daily('custom', LAST_WEEK, '2026-10-18', { frequency: 'Custom', reminderDays: [], meta: 'Custom • Tue, Wed, Sat' });
  const startDay = daily('start-day', '2026-10-13', '2026-10-18', { frequency: 'Weekly', reminderDays: [], meta: 'Weekly • Anytime' });
  const scheduled = lastWeekOf([weekly, custom, startDay], done({ '2026-10-15': ['weekly', 'custom'], '2026-10-17': ['custom'], '2026-10-13': ['start-day'] }));
  assert.deepEqual([scheduled.scheduled, scheduled.done, scheduled.activeDays], [6, 3, 3], 'Thursday counts for the weekly habit; Thursday is not a custom day');
  // Habits of other weeks never count: last week's are over this week, this week's had not started.
  assert.equal(weeklyConsistency({ habits: [...base, thisWeek('new')], doneByDate: new Map(), weekStart: '2026-10-19', lastDay: '2026-10-25' }).scheduled, 7);
  assert.equal(lastWeekOf([thisWeek('new')], new Map()).scheduled, 0);
});

test('a frozen day stays due: a freeze keeps the streak, not the rate', () => {
  const habits = dailyHabits(3);
  const checkIns = firstCheckIns(habits, 21);
  checkIns.delete('2026-10-18');
  // Sunday was covered by a streak freeze; the rate has no freezes to skip.
  const week = weeklyConsistency({ habits, doneByDate: checkIns, weekStart: LAST_WEEK, lastDay: '2026-10-18', frozenDays: ['2026-10-18'] });
  assert.deepEqual([week.scheduled, week.done, week.percent], [21, 18, 85]);
});

test('deleting a missed habit after its days passed cannot shrink last week', () => {
  const [walk, read, gym] = dailyHabits(3);
  const checkIns = firstCheckIns([walk, read], 14);
  assert.equal(lastWeekOf([walk, read, gym], checkIns).percent, 66);
  assert.equal(lastWeekOf([walk, read], checkIns).percent, 100, 'without the mark, deleting the gym habit would pay +30');
  // The mark is recorded from the habits as stored, before the save that deletes it.
  const [mark] = closedDue([walk, read, gym], '2026-10-19');
  assert.deepEqual(mark, { weekStart: LAST_WEEK, due: 21 });
  const week = lastWeekOf([walk, read], checkIns, mark.due);
  assert.deepEqual([week.scheduled, week.percent, week.tier.amount], [21, 66, 10]);
  // A larger due count today is used as is: the mark only stops it from shrinking.
  assert.equal(lastWeekOf([walk, read, gym, daily('four')], checkIns, mark.due).scheduled, 28);
});

test('the due marks count only the days already over', () => {
  const habits = [daily('old'), thisWeek('walk'), thisWeek('read')];
  // Wednesday: all of last week, and this Monday and Tuesday.
  assert.deepEqual(closedDue(habits, '2026-10-21'), [{ weekStart: LAST_WEEK, due: 7 }, { weekStart: '2026-10-19', due: 4 }]);
  // Monday: nothing of this week is over yet, so a habit added and removed today costs nothing.
  assert.deepEqual(closedDue(habits, '2026-10-19'), [{ weekStart: LAST_WEEK, due: 7 }]);
  assert.deepEqual(closedDue([thisWeek('walk')], '2026-10-19'), []);
});

test('this week so far: the next tier, the check-ins it needs over the whole week, and whether they are still open', () => {
  const habits = ['a', 'b', 'c'].map((id) => thisWeek(id));
  // Wednesday: 5 of the 9 due so far (55%); 60% of the week's 21 is 13, so 8 more, with 15 still open.
  const wednesday = weekSoFar({ habits, doneByDate: done({ '2026-10-19': ['a', 'b', 'c'], '2026-10-20': ['a', 'b'] }), today: '2026-10-21' });
  assert.deepEqual(wednesday, { weekStart: '2026-10-19', weekEnd: '2026-10-25', dueSoFar: 9, doneSoFar: 5, dueWeek: 21, percentSoFar: 55, next: { percent: 60, amount: 10, checkInsNeeded: 8, reachable: true } });
  // At 66% the next tier is 75%: 16 of 21.
  const strong = weekSoFar({ habits, doneByDate: done({ '2026-10-19': ['a', 'b', 'c'], '2026-10-20': ['a', 'b', 'c'] }), today: '2026-10-21' });
  assert.deepEqual([strong.percentSoFar, strong.next], [66, { percent: 75, amount: 20, checkInsNeeded: 10, reachable: true }]);
  // Friday after one check-in: 12 more needed, only 9 left.
  const late = weekSoFar({ habits, doneByDate: done({ '2026-10-19': ['a'] }), today: '2026-10-23' });
  assert.deepEqual([late.percentSoFar, late.next], [6, { percent: 60, amount: 10, checkInsNeeded: 12, reachable: false }]);
  // Above 90% there is no next tier.
  assert.equal(weekSoFar({ habits, doneByDate: done({ '2026-10-19': ['a', 'b', 'c'] }), today: '2026-10-19' }).next, null);
  // Enough check-ins open, but only on one more day: a week needs check-ins on 3 days.
  const sunday = ['s1', 's2', 's3', 's4', 's5', 's6'].map((id) => thisWeek(id, { frequency: 'Custom', reminderDays: ['Sun'] }));
  const oneDay = weekSoFar({ habits: [habits[0], ...sunday], doneByDate: done({ '2026-10-19': ['a'] }), today: '2026-10-25' });
  assert.deepEqual([oneDay.dueWeek, oneDay.percentSoFar, oneDay.next.checkInsNeeded, oneDay.next.reachable], [13, 7, 7, false]);
  // Too few due this week to earn anything.
  assert.equal(weekSoFar({ habits: [thisWeek('a', { frequency: 'Custom', reminderDays: ['Mon'] })], doneByDate: new Map(), today: '2026-10-19' }).next.reachable, false);
  // Two habits deleted on Wednesday: Monday and Tuesday stay due through the mark.
  const [kept] = habits;
  const [{ due: mark }] = closedDue(habits, '2026-10-21');
  assert.deepEqual([mark, weekSoFar({ habits: [kept], doneByDate: new Map(), today: '2026-10-21', dueMark: mark }).dueSoFar], [6, 6]);
});

test('the WeeklyBonus answer: last week, claimable until next Monday in the account zone', () => {
  const habits = dailyHabits(3);
  const doneByDate = firstCheckIns(habits, 19);
  const bonus = weeklyBonus({ habits, doneByDate, today: '2026-10-21', timeZone: 'Asia/Manila' });
  assert.deepEqual(bonus.lastWeek, {
    weekStart: LAST_WEEK, weekEnd: '2026-10-18', scheduled: 21, done: 19, percent: 90, activeDays: 7, eligible: true, reason: null,
    tier: { percent: 90, amount: 30, label: 'Consistent week' }, claimed: false, claimedAmount: null, claimable: true,
    lapsesAt: periodResetsAt({ end: '2026-10-25' }, 'Asia/Manila'),
  });
  assert.equal(bonus.lastWeek.lapsesAt, Date.parse('2026-10-25T16:00:00Z'), '00:00 Monday Oct 26 in Manila');
  assert.deepEqual(bonus.tiers, WEEKLY_BONUS_TIERS);
  assert.equal(bonus.thisWeek.weekStart, '2026-10-19');
  const claimed = weeklyBonus({ habits, doneByDate, today: '2026-10-21', timeZone: 'UTC', claimedAmount: 30 }).lastWeek;
  assert.deepEqual([claimed.claimed, claimed.claimedAmount, claimed.claimable, claimed.lapsesAt], [true, 30, false, Date.parse('2026-10-26T00:00:00Z')]);
  // The mark of each week applies to that week only.
  const marked = weeklyBonus({ habits, doneByDate, today: '2026-10-21', timeZone: 'UTC', marks: new Map([[LAST_WEEK, 30]]) });
  assert.deepEqual([marked.lastWeek.scheduled, marked.lastWeek.percent, marked.lastWeek.tier.amount, marked.thisWeek.dueSoFar], [30, 63, 10, 0]);
});
