// The Tokens screen (services/token-guide.js): the earn and spend rows come from the constants the
// server pays and sells with, and the statuses, "can still earn", the pace and the next goal follow
// the balance and today's progress.
import assert from 'node:assert/strict';
import test from 'node:test';
import { BUDDY_ITEMS, BUDDY_TREATS, DROP_COST, DROP_QUESTS_NEEDED, dropForWeek } from '../services/buddy.js';
import { GIFTS_PER_DAY } from '../services/buddy-gifts.js';
import { CHALLENGE_REWARDS } from '../services/daily-challenges.js';
import { DAILY_CLAIM_REWARDS } from '../services/daily-claims.js';
import { MYSTERY_MAX, MYSTERY_MIN, MYSTERY_REWARDS } from '../services/mystery-box.js';
import { QUEST_REWARDS } from '../services/quests.js';
import { REAL_REWARDS } from '../services/rewards.js';
import { STREAK_FREEZE_COST, STREAK_FREEZE_MAX } from '../services/streak-freeze.js';
import { canStillEarnToday, EARN_ROWS, economyGuide, nextGoal, pacePerDay, spendRows, streakGoal, tokenFlow } from '../services/token-guide.js';
import { COACH_TOKEN_COST, PAID_CHECK_INS_PER_DAY, STREAK_MILESTONE_BONUS, TOKENS_PER_CHECK_IN } from '../services/wallet.js';
import { WEEKLY_BONUS_TIERS } from '../services/weekly-bonus.js';

const DAY_MS = 86_400_000;
const NOW = Date.parse('2026-10-28T04:00:00Z');
const user = 'u1';
const DROP = dropForWeek('2026-10-26');
// The catalog as getRewards returns it: by cost, all of them kept once bought.
const REWARDS = Object.entries(REAL_REWARDS).map(([id, reward]) => ({ id, name: reward.name, cost: reward.cost, description: reward.description, permanent: true })).sort((a, b) => a.cost - b.cost);
const BABY_ITEMS = BUDDY_ITEMS.filter((item) => item.stage === 'baby').map((item) => item.id);

/** getBuddy's answer: counted check-ins, the items bought and this week's drop with its quests. */
const buddyAt = ({ checkIns = 0, owned = [], questsDone = 0 } = {}) => ({
  checkIns,
  owned,
  items: BUDDY_ITEMS,
  drop: { item: DROP, weekStart: '2026-10-26', weekEnd: '2026-11-01', questsDone, questsNeeded: DROP_QUESTS_NEEDED, unlocked: questsDone >= DROP_QUESTS_NEEDED, owned: owned.includes(DROP.id) },
});
const freezesHeld = (available) => ({ available, max: STREAK_FREEZE_MAX, cost: STREAK_FREEZE_COST, frozenDays: [] });
const rowsFor = ({ balance, owned = [], freezes = freezesHeld(0), buddy = buddyAt(), giftsSentToday = 0 }) => spendRows({ balance, rewards: REWARDS, owned, freezes, buddy, giftsSentToday });
const rowOf = (input, id) => rowsFor(input).find((row) => row.id === id);
const statusOf = (row) => [row.status, row.short ?? null];

test('the earn rows are the constants the server pays with', () => {
  const amounts = (values) => `+${Math.min(...values)} to +${Math.max(...values)}`;
  assert.deepEqual(EARN_ROWS.map((row) => [row.id, row.amount]), [
    ['check-in', `+${TOKENS_PER_CHECK_IN}`],
    ['daily-claim', amounts(DAILY_CLAIM_REWARDS)],
    ['challenge', amounts(Object.values(CHALLENGE_REWARDS))],
    ['mystery', amounts(MYSTERY_REWARDS.map(([amount]) => amount))],
    ['quest', amounts(Object.values(QUEST_REWARDS))],
    ['weekly-bonus', WEEKLY_BONUS_TIERS.map((tier) => `+${tier.amount}`).join(' / ')],
    ['streak', amounts(Object.values(STREAK_MILESTONE_BONUS))],
  ]);
  assert.equal(EARN_ROWS[0].detail, `Up to ${PAID_CHECK_INS_PER_DAY} paid check-ins a day`);
  assert.deepEqual([MYSTERY_MIN, MYSTERY_MAX], [3, 20]);
  // With today's constants, exactly the rows of the plan.
  assert.deepEqual(EARN_ROWS, [
    { id: 'check-in', title: 'Check in a habit', amount: '+5', detail: 'Up to 6 paid check-ins a day' },
    { id: 'daily-claim', title: 'Daily reward', amount: '+2 to +15', detail: 'Open HabitAI every day: 2, 3, 4, 5, 6, 8 and 15 over 7 days in a row' },
    { id: 'challenge', title: 'Daily challenges', amount: '+5 to +15', detail: '3 a day, paid when you finish them' },
    { id: 'mystery', title: 'Mystery box', amount: '+3 to +20', detail: 'Once a day after your first check-in' },
    { id: 'quest', title: 'Weekly quests', amount: '+15 to +20', detail: '3 a week, new every Monday' },
    { id: 'weekly-bonus', title: 'Weekly consistency bonus', amount: '+10 / +20 / +30', detail: "Do 60%, 75% or 90% of last week's check-ins, claim on Monday" },
    { id: 'streak', title: 'Streak milestones', amount: '+15 to +500', detail: '7, 14, 30, 50, 100, 200 and 365 days in a row' },
  ]);
});

test('the spend rows are the prices the server sells at, each with where it opens', () => {
  const rows = rowsFor({ balance: 0 });
  assert.deepEqual(rows.map((row) => [row.id, row.cost, row.from, row.target]), [
    ['streak-freeze', STREAK_FREEZE_COST, false, 'freeze'],
    ['buddy-shop', Math.min(...BUDDY_ITEMS.map((item) => item.cost)), true, 'buddy'],
    ['weekly-drop', DROP_COST, false, 'buddy'],
    ...REWARDS.map((reward) => [reward.id, REAL_REWARDS[reward.id].cost, false, `reward:${reward.id}`]),
    ['treat-gift', Math.min(...BUDDY_TREATS.map((treat) => treat.cost)), true, 'gift'],
    ['coach', COACH_TOKEN_COST, false, 'coach'],
  ]);
  assert.deepEqual(rows.filter((row) => row.target.startsWith('reward:')).map((row) => [row.id, row.cost]), [['profile-frames', 180], ['premium-theme', 200], ['custom-title', 250], ['buddy-showcase', 300]]);
  assert.deepEqual([rows[0].held, rows[0].max, rows[0].cost, rows.at(-1).cost, DROP_COST], [0, 2, 30, 10, 150]);
});

test('a spend row is owned, ready, short by what is missing, locked or full', () => {
  // Token Rewards: owned once bought, else ready or short against the raw balance.
  const rewards = rowsFor({ balance: 200, owned: ['premium-theme'] }).filter((row) => row.target.startsWith('reward:'));
  assert.deepEqual(rewards.map((row) => [row.id, ...statusOf(row)]), [['profile-frames', 'ready', null], ['premium-theme', 'owned', null], ['custom-title', 'short', 50], ['buddy-showcase', 'short', 100]]);

  // Streak Freeze: full at 2 held, whatever the balance.
  assert.deepEqual(statusOf(rowOf({ balance: 500, freezes: freezesHeld(2) }, 'streak-freeze')), ['full', null]);
  assert.deepEqual(statusOf(rowOf({ balance: 29, freezes: freezesHeld(1) }, 'streak-freeze')), ['short', 1]);
  const freeze = rowOf({ balance: 30, freezes: freezesHeld(1) }, 'streak-freeze');
  assert.deepEqual([...statusOf(freeze), freeze.held, freeze.max, freeze.detail], ['ready', null, 1, 2, 'Covers a missed day · 1/2 held']);

  // Habi's shop: the items Habi's stage unlocked, then the next stage, then everything.
  assert.deepEqual([...statusOf(rowOf({ balance: 39 }, 'buddy-shop')), rowOf({ balance: 39 }, 'buddy-shop').detail], ['short', 1, `${BABY_ITEMS.length} items to save for`]);
  const shop = rowOf({ balance: 50 }, 'buddy-shop');
  assert.deepEqual([...statusOf(shop), shop.cost, shop.detail], ['ready', null, 40, '5 items you can buy now'], 'cap 40, cookie 45, sun hat, books and scarf 50');
  const between = rowOf({ balance: 500, buddy: buddyAt({ checkIns: 3, owned: BABY_ITEMS }) }, 'buddy-shop');
  assert.deepEqual([between.status, between.cost, between.detail], ['locked', 90, 'Next stage Kid in 7 check-ins']);
  assert.equal(rowOf({ balance: 500, buddy: buddyAt({ checkIns: 9, owned: BABY_ITEMS }) }, 'buddy-shop').detail, 'Next stage Kid in 1 check-in');
  assert.equal(rowOf({ balance: 0, buddy: buddyAt({ checkIns: 400, owned: BUDDY_ITEMS.map((item) => item.id) }) }, 'buddy-shop').status, 'owned');

  // The Weekly Drop: locked until 2 of 3 quests (and the Kid stage), owned once collected.
  const name = `${DROP.emoji} ${DROP.name}`;
  const locked = rowOf({ balance: 500, buddy: buddyAt({ checkIns: 20, questsDone: 1 }) }, 'weekly-drop');
  assert.deepEqual([locked.status, locked.detail], ['locked', `${name} · finish 2 of 3 quests (1/2)`]);
  const baby = rowOf({ balance: 500, buddy: buddyAt({ checkIns: 5, questsDone: 2 }) }, 'weekly-drop');
  assert.deepEqual([baby.status, baby.detail], ['locked', `${name} · Habi reaches Kid at 10 check-ins`]);
  assert.deepEqual(statusOf(rowOf({ balance: 149, buddy: buddyAt({ checkIns: 10, questsDone: 3 }) }, 'weekly-drop')), ['short', 1]);
  assert.deepEqual(statusOf(rowOf({ balance: 150, buddy: buddyAt({ checkIns: 10, questsDone: 2 }) }, 'weekly-drop')), ['ready', null]);
  assert.equal(rowOf({ balance: 0, buddy: buddyAt({ checkIns: 10, questsDone: 3, owned: [DROP.id] }) }, 'weekly-drop').status, 'owned');

  // Treats for classmates: full after 3 today.
  assert.deepEqual([...statusOf(rowOf({ balance: 100, giftsSentToday: GIFTS_PER_DAY }, 'treat-gift')), rowOf({ balance: 100, giftsSentToday: 3 }, 'treat-gift').detail], ['full', null, '3 sent today · more tomorrow']);
  const gift = rowOf({ balance: 15, giftsSentToday: 2 }, 'treat-gift');
  assert.deepEqual([...statusOf(gift), gift.detail], ['ready', null, '1 of 3 left today']);
  assert.deepEqual(statusOf(rowOf({ balance: 14 }, 'treat-gift')), ['short', 1]);

  // The AI Coach: how many answers the balance pays for.
  assert.deepEqual([...statusOf(rowOf({ balance: 25 }, 'coach')), rowOf({ balance: 25 }, 'coach').detail], ['ready', null, 'Enough for 2 answers']);
  assert.equal(rowOf({ balance: 10 }, 'coach').detail, 'Enough for 1 answer');
  // Below zero (an undo after a spend), the debt is paid back first.
  assert.deepEqual([...statusOf(rowOf({ balance: -20 }, 'coach')), rowOf({ balance: -20 }, 'coach').detail], ['short', 30, 'Enough for 0 answers']);

  const statuses = new Set(['owned', 'ready', 'short', 'locked', 'full']);
  for (const balance of [-20, 0, 45, 1000]) assert.ok(rowsFor({ balance }).every((row) => statuses.has(row.status) && (row.status === 'short') === (row.short > 0)), String(balance));
});

test('what can still be earned today: the unclaimed reward, the paid check-ins left, open challenges and the closed box', () => {
  const challenges = [{ complete: true, reward: 10 }, { complete: false, reward: 8 }, { complete: false, reward: 6 }];
  // 4 (daily reward) + 5 x min(6 - 4 paid, 5 open habits) + 8 + 6 + 20 (the box's top prize).
  assert.equal(canStillEarnToday({ dailyClaim: { claimedToday: false, amount: 4 }, paidToday: 4, openHabits: 5, challenges, mysteryBox: { status: 'ready' } }), 48);
  assert.equal(canStillEarnToday({ dailyClaim: { claimedToday: false, amount: 4 }, paidToday: 1, openHabits: 2, challenges, mysteryBox: { status: 'locked' } }), 4 + 10 + 14 + 20, 'only the habits still open');
  assert.equal(canStillEarnToday({ dailyClaim: { claimedToday: true, amount: 4 }, paidToday: 7, openHabits: 3, challenges, mysteryBox: { status: 'opened' } }), 14, 'no paid check-ins left');
  assert.equal(canStillEarnToday({ dailyClaim: { claimedToday: true, amount: 15 }, paidToday: 0, openHabits: 0, challenges: [], mysteryBox: { status: 'opened' } }), 0);
});

test('the pace counts what was earned in the last 7 days, without refunds, a day on average', () => {
  const row = (amount, id, ago = DAY_MS) => ({ id: `${user}:token:${id}`, label: '', amount, createdAt: NOW - ago });
  const week = [1, 2, 3, 4, 5, 6].map((day) => row(5, `check-in:h:${day}`, day * DAY_MS));
  assert.equal(pacePerDay(week, NOW), 4, '30 / 7 = 4.3');
  assert.equal(pacePerDay([...week, row(2, 'daily-claim:x')], NOW), 5, '32 / 7 = 4.6');
  const ignored = [row(10, 'refund:coach:x'), row(-30, 'spend:freeze:x'), row(100, 'week:old', 8 * DAY_MS)];
  assert.equal(pacePerDay([...week, ...ignored], NOW), 4, 'refunds, spends and older rows do not count');
  assert.equal(pacePerDay([], NOW), 0);
});

test("the week's flow sums the rows since Monday by kind, so earned minus spent is what the balance moved", () => {
  const since = NOW - 2 * DAY_MS;
  const row = (amount, id, label = '', at = NOW - DAY_MS) => ({ id, label, amount, createdAt: at });
  const flow = tokenFlow([
    row(5, `${user}:token:check-in:h:2026-10-27`),
    row(10, `${user}:token:week:2026-10-19`),
    row(-30, `${user}:token:spend:freeze:a`),
    row(-10, `${user}:token:spend:coach:b`),
    row(10, `${user}:token:refund:coach:b`),
    row(-15, '7d3f1c2e-0000-4000-8000-000000000000', 'Buddy treat: Apple'),
    row(5, `${user}:token:check-in:h:2026-10-25`, '', since - 1),
  ], since);
  assert.deepEqual(flow, { earned: 25, spent: 55, bySource: { 'check-in': 5, 'weekly-bonus': 10, refund: 10 }, bySink: { freeze: 30, coach: 10, 'buddy-treat': 15 } });
});

test('the next goal is the cheapest reward not yet affordable, then the drop, then a Habi item, with the days at this pace', () => {
  const goal = (balance, { owned = [], buddy = buddyAt(), perDay = 30 } = {}) => nextGoal({ balance, rewards: REWARDS, owned, buddy, perDay });
  assert.deepEqual(goal(100), { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 80, days: 3 });
  assert.deepEqual(goal(190), { id: 'premium-theme', title: 'Premium Themes', cost: 200, short: 10, days: 1 }, 'Profile Frames is already affordable');
  const allRewards = REWARDS.map((reward) => reward.id);
  assert.deepEqual(goal(100, { owned: allRewards, perDay: 0 }), { id: DROP.id, title: `${DROP.name} (Weekly Drop)`, cost: DROP_COST, short: 50, days: null }, 'no pace: no days');
  assert.deepEqual(goal(30, { owned: allRewards, buddy: buddyAt({ owned: [DROP.id] }), perDay: 4 }), { id: 'cap', title: 'Cap', cost: 40, short: 10, days: 3 });
  assert.equal(goal(1000, { owned: allRewards }), null, 'everything left is affordable');
  assert.deepEqual(goal(-20, { perDay: 25 }), { id: 'profile-frames', title: 'Profile Frames', cost: 180, short: 200, days: 8 }, 'a debt is part of what is missing');
});

test('the streak shows the next milestone bonus and how many days are left', () => {
  assert.deepEqual(streakGoal(0), { days: 0, next: { days: 7, bonus: 15, daysLeft: 7 } });
  assert.deepEqual(streakGoal(7), { days: 7, next: { days: 14, bonus: 25, daysLeft: 7 } }, 'the 7-day bonus is already paid');
  assert.deepEqual(streakGoal(120), { days: 120, next: { days: 200, bonus: 300, daysLeft: 80 } });
  assert.deepEqual(streakGoal(365), { days: 365, next: null });
});

test('the AI help assistant gets the same token facts', () => {
  const guide = economyGuide();
  for (const reward of Object.values(REAL_REWARDS)) assert.ok(guide.includes(`${reward.name} ${reward.cost}`), reward.name);
  for (const text of [`gives ${TOKENS_PER_CHECK_IN} tokens (up to ${PAID_CHECK_INS_PER_DAY} paid`, `Streak Freeze ${STREAK_FREEZE_COST} (hold up to ${STREAK_FREEZE_MAX})`, `AI Coach answers ${COACH_TOKEN_COST} each`, `the weekly drop ${DROP_COST}`, 'Habi shop items 40 to 500', 'treats for classmates 15 to 50', 'the mystery box (3 to 20', 'the Monday consistency bonus (10, 20 or 30)', 'streak milestones (15 to 500)']) {
    assert.ok(guide.includes(text), text);
  }
});
