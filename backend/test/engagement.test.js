import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDDY_DROPS, BUDDY_ITEMS, BUDDY_STAGES, BUDDY_TREATS, buddyStageIndex, dropForWeek, isBuddyDrop, weeksUntilDrop } from '../services/buddy.js';
import { MYSTERY_REWARDS, pickMysteryReward } from '../services/mystery-box.js';
import { weekStartOf, weeklyQuests } from '../services/quests.js';
import { daysToFreeze, STREAK_FREEZE_COST, STREAK_FREEZE_MAX } from '../services/streak-freeze.js';
import { CHECK_IN_CAP_FROM, countedDaySql, countedOnDay, crossedStreakMilestones, PAID_CHECK_INS_PER_DAY, STREAK_MILESTONE_BONUS } from '../services/wallet.js';
import { computeStreak } from '../services/streaks.js';
import { doneActionSecret, getWebPushDoneUrl, localDateIn, makeDoneToken, readDoneToken } from '../services/web-push-actions.js';
import { dailyChallenges, minuteOfDay, ROTATING_CHALLENGES } from '../services/daily-challenges.js';

const daily = (id) => ({ id, frequency: 'Daily', startDate: '2026-09-01', reminderDays: [], meta: 'Daily • Anytime' });
const done = (entries) => new Map(Object.entries(entries).map(([date, ids]) => [date, new Set(ids)]));

test('from the cap date a day counts at most 6 check-ins toward points; earlier days count them all', () => {
  assert.deepEqual([PAID_CHECK_INS_PER_DAY, CHECK_IN_CAP_FROM], [6, '2026-10-26'], 'the Monday after the release, so no week is split');
  assert.equal(countedOnDay('2026-10-26', 8), 6);
  assert.equal(countedOnDay('2026-11-03', 8), 6);
  assert.equal(countedOnDay('2026-10-25', 8), 8, 'points already shown are never taken away');
  assert.equal(countedOnDay('2026-10-27', 4), 4);
  // The SQL the points, the leaderboard and Habi's growth share says the same.
  assert.equal(countedDaySql('d', 'n'), "CASE WHEN d >= '2026-10-26'::date THEN LEAST(n, 6) ELSE n END");
});

test('weekly quests count the Monday-to-Sunday week up to today', () => {
  assert.equal(weekStartOf('2026-10-03'), '2026-09-28');
  assert.equal(weekStartOf('2026-10-04'), '2026-09-28', 'Sunday ends the week');
  assert.equal(weekStartOf('2026-09-28'), '2026-09-28');

  // Saturday, October 3: three daily habits.
  const habits = ['a', 'b', 'c'].map(daily);
  const week = done({
    '2026-09-28': ['a', 'b', 'c'], '2026-09-29': ['a', 'b', 'c'], '2026-09-30': ['a'], '2026-10-01': ['a', 'b'], '2026-10-03': ['a'],
    '2026-09-27': ['a', 'b', 'c'], // last week: not counted
  });
  const quests = Object.fromEntries(weeklyQuests(habits, week, '2026-10-03').map((quest) => [quest.id, quest]));
  assert.deepEqual(quests['check-ins'], { id: 'check-ins', title: 'Check in 12 times', icon: 'checkmark-done', target: 12, progress: 10, reward: 15, weekStart: '2026-09-28', complete: false });
  assert.deepEqual({ progress: quests['perfect-days'].progress, complete: quests['perfect-days'].complete, reward: quests['perfect-days'].reward }, { progress: 2, complete: true, reward: 20 });
  // The third quest rotates by week, the same for everyone.
  const third = Object.values(quests).find((quest) => !['check-ins', 'perfect-days'].includes(quest.id));
  const expected = { 'challenge-days': [2, false], 'active-days': [5, true], 'every-habit': [3, true] }[third.id];
  assert.deepEqual([third.progress, third.complete], expected);
  assert.notEqual(weeklyQuests(habits, week, '2026-10-05').at(-1).id, third.id, 'next week has another one');
});

test('quest targets fit the number of habits', () => {
  assert.deepEqual(weeklyQuests([], new Map(), '2026-10-03'), []);
  assert.equal(weeklyQuests([daily('a')], new Map(), '2026-10-03')[0].target, 5);
  assert.equal(weeklyQuests([daily('a'), daily('b')], new Map(), '2026-10-03')[0].target, 8);
  const weekly = { ...daily('w'), frequency: 'Weekly', reminderDays: ['Mon'] };
  // A Monday-only habit done on Monday makes that day perfect; other days have nothing due.
  const perfect = weeklyQuests([weekly], done({ '2026-09-28': ['w'] }), '2026-10-03').find((quest) => quest.id === 'perfect-days');
  assert.equal(perfect.progress, 1);
});

test('the buddy grows with check-ins and the shop has a price and stage for everything', () => {
  assert.equal(new Set(BUDDY_ITEMS.map((item) => item.id)).size, BUDDY_ITEMS.length, 'item ids are unique');
  assert.ok(BUDDY_ITEMS.filter((item) => item.slot === 'room').length >= 4, 'rooms are on sale');
  assert.ok(BUDDY_ITEMS.filter((item) => item.slot === 'accessory').length >= 1, 'gear is on sale');
  assert.deepEqual([0, 9, 10, 49, 50, 149, 150, 399, 400, 5000].map(buddyStageIndex), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  assert.deepEqual(BUDDY_STAGES.map((stage) => stage.id), ['baby', 'kid', 'teen', 'champ', 'legend']);
  for (const item of BUDDY_ITEMS) {
    assert.ok(['head', 'hand', 'room', 'accessory'].includes(item.slot) && item.cost > 0 && BUDDY_STAGES.some((stage) => stage.id === item.stage), item.id);
  }
  assert.equal(new Set(BUDDY_TREATS.map((treat) => treat.id)).size, BUDDY_TREATS.length, 'treat ids are unique');
  for (const treat of BUDDY_TREATS) {
    assert.ok(treat.cost > 0 && Boolean(treat.emoji) && Boolean(treat.line), treat.id);
  }
});

test('the weekly drop: 12 items in turn, one a week, back every 12 weeks', () => {
  const mondays = Array.from({ length: 13 }, (_, week) => new Date(Date.parse('2026-10-19T00:00:00Z') + week * 7 * 86_400_000).toISOString().slice(0, 10));
  const drops = mondays.map(dropForWeek);
  assert.equal(new Set(drops.slice(0, 12).map((drop) => drop.id)).size, 12, '12 consecutive weeks show all 12 drops');
  assert.equal(drops[12], drops[0], 'week 13 repeats week 1');
  assert.equal(dropForWeek('2026-10-25'), dropForWeek('2026-10-19'), 'the same drop all week, Monday to Sunday');
  assert.notEqual(dropForWeek('2026-10-26'), dropForWeek('2026-10-19'));
  assert.deepEqual(mondays.slice(0, 12).map((monday) => weeksUntilDrop(drops[0], monday)), [0, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(BUDDY_DROPS.map((drop) => drop.id), ['drop-umbrella', 'drop-rice', 'drop-carabao', 'drop-mango', 'drop-salabat', 'drop-lantern', 'drop-sunflower', 'drop-parol', 'drop-fireworks', 'drop-mini-tree', 'drop-sports-medal', 'drop-ribbon']);
  for (const drop of BUDDY_DROPS) {
    assert.deepEqual([drop.cost, drop.stage, drop.drop, isBuddyDrop(drop.id)], [150, 'kid', true, true], drop.id);
    assert.ok(['head', 'hand', 'accessory'].includes(drop.slot) && Boolean(drop.emoji) && Boolean(drop.name), drop.id);
  }
  const shopIds = new Set(BUDDY_ITEMS.map((item) => item.id));
  assert.ok(BUDDY_DROPS.every((drop) => !shopIds.has(drop.id)), 'drop ids do not collide with shop items');
  assert.ok(!isBuddyDrop('cap'));
});

test('the Legend stage has four items, and the shop totals 6,975 tokens', () => {
  const legend = BUDDY_ITEMS.filter((item) => item.stage === 'legend');
  assert.deepEqual(legend.map(({ id, slot, cost }) => [id, slot, cost]).sort(), [['aurora', 'room', 500], ['diamond', 'accessory', 450], ['dragon', 'hand', 420], ['rainbow', 'head', 360]]);
  assert.equal(legend.reduce((sum, item) => sum + item.cost, 0), 1730);
  assert.equal(BUDDY_ITEMS.reduce((sum, item) => sum + item.cost, 0), 6975);
});

test('streak milestone bonuses rise with the milestone and fire only on the ones just crossed', () => {
  // The bonus table only grows, so a longer streak is always worth more.
  const milestones = Object.keys(STREAK_MILESTONE_BONUS).map(Number);
  assert.deepEqual(milestones, [...milestones].sort((a, b) => a - b), 'milestones are in order');
  for (let i = 1; i < milestones.length; i += 1) {
    assert.ok(STREAK_MILESTONE_BONUS[milestones[i]] > STREAK_MILESTONE_BONUS[milestones[i - 1]], 'each bonus is bigger');
  }
  // Only milestones in (before, after] are crossed.
  assert.deepEqual(crossedStreakMilestones(6, 7), [7]);
  assert.deepEqual(crossedStreakMilestones(7, 7), [], 'staying put crosses nothing');
  assert.deepEqual(crossedStreakMilestones(7, 30), [14, 30], 'a jump can cross several at once');
  assert.deepEqual(crossedStreakMilestones(0, 6), [], 'below the first milestone pays nothing');
  assert.deepEqual(crossedStreakMilestones(364, 365), [365]);
});

test('the mystery box gives small amounts often and 20 rarely', () => {
  const total = MYSTERY_REWARDS.reduce((sum, [, weight]) => sum + weight, 0);
  assert.equal(total, 100);
  assert.deepEqual([0, 39, 40, 69, 70, 87, 88, 96, 97, 99].map(pickMysteryReward), [3, 3, 5, 5, 8, 8, 12, 12, 20, 20]);
});

test('a frozen day neither counts toward nor breaks a streak', () => {
  const dates = ['2026-09-29', '2026-09-30', '2026-10-02'];
  assert.equal(computeStreak(daily('a'), dates, '2026-10-03'), 1, 'October 1 was missed');
  assert.equal(computeStreak(daily('a'), dates, '2026-10-03', ['2026-10-01']), 3, 'frozen: the three done days stay in a row');
  assert.equal(computeStreak(daily('a'), [...dates, '2026-10-01'], '2026-10-03', ['2026-10-01']), 4, 'a done day that was also frozen still counts');
});

test('freezes cover the days missed before today, all of them or none', () => {
  const habits = [daily('a'), daily('b')];
  const done = (entries) => new Map(Object.entries(entries).map(([id, dates]) => [id, new Set(dates)]));
  // The account streak ran from September 28 (habit a) and nothing was checked in yesterday (October 2).
  const missedYesterday = done({ a: ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01'] });
  assert.deepEqual(daysToFreeze(habits, missedYesterday, new Set(), '2026-10-03', 1), ['2026-10-02']);
  assert.deepEqual(daysToFreeze(habits, missedYesterday, new Set(), '2026-10-03', 0), []);
  // Two days missed: one freeze cannot save the streak (none is spent), two can.
  const missedTwo = done({ a: ['2026-09-28', '2026-09-29', '2026-09-30'] });
  assert.deepEqual(daysToFreeze(habits, missedTwo, new Set(), '2026-10-03', 1), []);
  assert.deepEqual(daysToFreeze(habits, missedTwo, new Set(), '2026-10-03', 2), ['2026-10-02', '2026-10-01']);
  assert.deepEqual(daysToFreeze(habits, missedTwo, new Set(['2026-10-01']), '2026-10-03', 1), ['2026-10-02'], 'a day already frozen is skipped');
  // Three days missed: more than two freezes could cover.
  assert.deepEqual(daysToFreeze(habits, done({ a: ['2026-09-28', '2026-09-29'] }), new Set(), '2026-10-03', 2), []);
  // Nothing missed, or no running streak: nothing to freeze.
  assert.deepEqual(daysToFreeze(habits, done({ a: ['2026-10-01', '2026-10-02'] }), new Set(), '2026-10-03', 2), []);
  assert.deepEqual(daysToFreeze([daily('new')], new Map(), new Set(), '2026-10-03', 2), []);
  assert.deepEqual([STREAK_FREEZE_COST, STREAK_FREEZE_MAX], [30, 2]);
});

test('the Done button on a reminder carries a signed, expiring token', () => {
  const environment = { WEB_PUSH_VAPID_PUBLIC_KEY: 'pub', WEB_PUSH_VAPID_PRIVATE_KEY: 'private', WEB_PUSH_VAPID_SUBJECT: 'mailto:a@b.c' };
  const secret = doneActionSecret(environment);
  assert.equal(doneActionSecret({}), null, 'off without Web Push');
  const now = Date.parse('2026-10-03T00:00:00.000Z');
  const token = makeDoneToken({ userId: 'u1', habitId: 'read', date: '2026-10-03', timeZone: 'Asia/Manila' }, secret, now);
  assert.deepEqual(readDoneToken(token, secret, now + 60_000), { userId: 'u1', habitId: 'read', date: '2026-10-03', timeZone: 'Asia/Manila' });
  assert.equal(readDoneToken(token, secret, now + 37 * 60 * 60 * 1000), null, 'expired');
  assert.equal(readDoneToken(token, doneActionSecret({ ...environment, WEB_PUSH_VAPID_PRIVATE_KEY: 'other' }), now), null, 'another key');
  const [payload, signature] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ u: 'someone-else', h: 'read', d: '2026-10-03', z: 'UTC', e: now + 1e9 })).toString('base64url');
  assert.equal(readDoneToken(`${forged}.${signature}`, secret, now), null, 'changed contents');
  assert.equal(readDoneToken(payload, secret, now), null);
  assert.equal(getWebPushDoneUrl({ WEB_PUSH_API_URL: 'https://api.example.com' }), 'https://api.example.com/api/web-push/done');
  assert.equal(getWebPushDoneUrl({ WEB_PUSH_API_URL: 'http://api.example.com' }), null, 'https only (except localhost)');
  assert.equal(localDateIn('Asia/Manila', new Date('2026-10-03T17:00:00.000Z')), '2026-10-04');
});

test('daily challenges: finish N every day, plus two extras that fit the student\'s habits', () => {
  const habit = (id, extra = {}) => ({ id, label: id, frequency: 'Daily', startDate: '2026-09-01', reminderDays: [], meta: 'Daily • Anytime', ...extra });
  const today = '2026-10-04';
  // Two habits, nothing missed, no streaks: only the time-of-day extras fit.
  const two = dailyChallenges({ habits: [habit('a'), habit('b')], doneToday: new Map([['a', 9 * 60], ['b', 11 * 60 + 40]]), doneYesterday: new Set(['a', 'b']), streaksBefore: new Map(), today });
  assert.equal(two[0].id, 'finish');
  assert.deepEqual(two[0], { id: 'finish', title: 'Finish 2 habits today', icon: 'trophy', target: 2, progress: 2, reward: 10, date: today, complete: true });
  assert.deepEqual(two.slice(1).map((challenge) => challenge.id).sort(), ['early-bird', 'two-by-noon']);
  assert.ok(two.every((challenge) => challenge.complete), 'checked in at 9:00 and 11:40');

  // Four habits, one missed yesterday, one on a 5-day streak: everything fits, the day picks two.
  const four = dailyChallenges({
    habits: ['a', 'b', 'c', 'd'].map((id) => habit(id)),
    doneToday: new Map([['b', 20 * 60]]),
    doneYesterday: new Set(['a', 'c', 'd']),
    streaksBefore: new Map([['a', 5]]),
    today,
  });
  const start = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000) % ROTATING_CHALLENGES.length;
  assert.deepEqual(four.map((challenge) => challenge.id), ['finish', ROTATING_CHALLENGES[start], ROTATING_CHALLENGES[(start + 1) % ROTATING_CHALLENGES.length]]);
  const all = Object.fromEntries(ROTATING_CHALLENGES.map((id) => [id, dailyChallenges({
    habits: ['a', 'b', 'c', 'd'].map((key) => habit(key)), doneToday: new Map([['b', 20 * 60]]), doneYesterday: new Set(['a', 'c', 'd']), streaksBefore: new Map([['a', 5]]),
    today: ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].find((day) => ROTATING_CHALLENGES[Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000) % ROTATING_CHALLENGES.length] === id),
  }).find((challenge) => challenge.id === id)]));
  assert.deepEqual([all.comeback.title, all.comeback.complete], ['Bounce back: do b today', true]);
  assert.deepEqual([all['streak-keeper'].title, all['streak-keeper'].complete], ['Keep your 5-day a streak', false]);
  assert.deepEqual([all['perfect-day'].target, all['perfect-day'].progress], [4, 1]);
  assert.equal(all['early-bird'].complete, false, 'checked in at 8 PM');

  // Nothing due today: no challenges.
  assert.deepEqual(dailyChallenges({ habits: [habit('a', { startDate: '2026-12-01' })], doneToday: new Map(), doneYesterday: new Set(), streaksBefore: new Map(), today }), []);
  // The time of a check-in in the student's own time zone.
  assert.equal(minuteOfDay(Date.UTC(2026, 9, 4, 1, 30), 'Asia/Manila'), 9 * 60 + 30);
});
