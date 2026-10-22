// The Tokens screen (GET /api/wallet/summary): every way to earn tokens with today's progress,
// everything to spend them on with what is affordable now, this week's flow, the pace and the next
// goal. Every number comes from the functions that pay and sell, and the earn rows and the AI help
// assistant's facts (economyGuide) are built from the same constants, so none of them can drift
// from what the server actually pays. It only reads: nothing is paid, bought or stored here.
import { runAll } from '../db/run-all.js';
import { periodResetsAt } from '../lib/http.js';
import { accountStreakRun } from './account-streak.js';
import { BUDDY_ITEMS, BUDDY_STAGES, BUDDY_TREATS, buddyStageIndex, DROP_COST, getBuddy } from './buddy.js';
import { GIFTS_PER_DAY, giftsSentOn } from './buddy-gifts.js';
import { CHALLENGE_REWARDS, DAILY_CHALLENGE_COUNT, getDailyChallenges } from './daily-challenges.js';
import { DAILY_CLAIM_REWARDS, getDailyClaim } from './daily-claims.js';
import { isHabitActiveOn, weekEndKey } from './habit-week.js';
import { getMysteryBox, MYSTERY_MAX, MYSTERY_REWARDS } from './mystery-box.js';
import { getWeeklyQuests, loadHabits, QUEST_REWARDS, weekStartOf } from './quests.js';
import { getRewards, REAL_REWARDS } from './rewards.js';
import { getStreakFreezeStatus, STREAK_FREEZE_COST, STREAK_FREEZE_MAX } from './streak-freeze.js';
import { habitSchedule, isScheduledDay } from './streaks.js';
import { COACH_TOKEN_COST, PAID_CHECK_INS_PER_DAY, paidCheckIns, STREAK_MILESTONE_BONUS, tokenBalance, tokenKind, TOKENS_PER_CHECK_IN } from './wallet.js';
import { getWeeklyBonus, WEEKLY_BONUS_TIERS } from './weekly-bonus.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// The pace is the tokens earned over this many days, a day on average.
const PACE_DAYS = 7;

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const lowest = (values) => Math.min(...values);
const highest = (values) => Math.max(...values);
const range = (values) => `${lowest(values)} to ${highest(values)}`;
const plusRange = (values) => `+${lowest(values)} to +${highest(values)}`;
/** '2, 3 and 4' ('60%, 75% or 90%' with `last` 'or'). */
const listOf = (values, last = 'and') => (values.length > 1 ? `${values.slice(0, -1).join(', ')} ${last} ${values.at(-1)}` : String(values[0] ?? ''));
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const stageIndexOf = (id) => BUDDY_STAGES.findIndex((stage) => stage.id === id);
const byCost = (a, b) => a.cost - b.cost;

const CHALLENGE_AMOUNTS = Object.values(CHALLENGE_REWARDS);
const QUEST_AMOUNTS = Object.values(QUEST_REWARDS);
const MYSTERY_AMOUNTS = MYSTERY_REWARDS.map(([amount]) => amount);
const MILESTONES = Object.keys(STREAK_MILESTONE_BONUS).map(Number).sort((a, b) => a - b);
const MILESTONE_AMOUNTS = MILESTONES.map((days) => STREAK_MILESTONE_BONUS[days]);
const TREAT_COST = lowest(BUDDY_TREATS.map((treat) => treat.cost));

/** The ways to earn, as the Tokens screen lists them (the app adds today's progress to each row). */
export const EARN_ROWS = [
  { id: 'check-in', title: 'Check in a habit', amount: `+${TOKENS_PER_CHECK_IN}`, detail: `Up to ${PAID_CHECK_INS_PER_DAY} paid check-ins a day` },
  { id: 'daily-claim', title: 'Daily reward', amount: plusRange(DAILY_CLAIM_REWARDS), detail: `Open HabitAI every day: ${listOf(DAILY_CLAIM_REWARDS)} over ${DAILY_CLAIM_REWARDS.length} days in a row` },
  { id: 'challenge', title: 'Daily challenges', amount: plusRange(CHALLENGE_AMOUNTS), detail: `${DAILY_CHALLENGE_COUNT} a day, paid when you finish them` },
  { id: 'mystery', title: 'Mystery box', amount: plusRange(MYSTERY_AMOUNTS), detail: 'Once a day after your first check-in' },
  { id: 'quest', title: 'Weekly quests', amount: plusRange(QUEST_AMOUNTS), detail: `${QUEST_AMOUNTS.length} a week, new every Monday` },
  {
    id: 'weekly-bonus',
    title: 'Weekly consistency bonus',
    amount: WEEKLY_BONUS_TIERS.map((tier) => `+${tier.amount}`).join(' / '),
    detail: `Do ${listOf(WEEKLY_BONUS_TIERS.map((tier) => `${tier.percent}%`), 'or')} of last week's check-ins, claim on Monday`,
  },
  { id: 'streak', title: 'Streak milestones', amount: plusRange(MILESTONE_AMOUNTS), detail: `${listOf(MILESTONES)} days in a row` },
];

/** The token facts for the AI help assistant (services/ai-prompts.js APP_GUIDE), from the same constants. */
export function economyGuide() {
  const rewards = Object.values(REAL_REWARDS).map((reward) => `${reward.name} ${reward.cost}`).join(', ');
  return `- Tokens: each check-in gives ${TOKENS_PER_CHECK_IN} tokens (up to ${PAID_CHECK_INS_PER_DAY} paid check-ins a day); also the daily reward (${range(DAILY_CLAIM_REWARDS)}), daily challenges (${range(CHALLENGE_AMOUNTS)}), the mystery box (${range(MYSTERY_AMOUNTS)}, after the first check-in), weekly quests (${range(QUEST_AMOUNTS)}), the Monday consistency bonus (${listOf(WEEKLY_BONUS_TIERS.map((tier) => tier.amount), 'or')}) and streak milestones (${range(MILESTONE_AMOUNTS)}). `
    + `Spend them on ${rewards}, Habi shop items ${range(BUDDY_ITEMS.map((item) => item.cost))} and the weekly drop ${DROP_COST}, treats for classmates ${range(BUDDY_TREATS.map((treat) => treat.cost))}, Streak Freeze ${STREAK_FREEZE_COST} (hold up to ${STREAK_FREEZE_MAX}) and AI Coach answers ${COACH_TOKEN_COST} each. `
    + 'The Tokens screen (tap Tokens on Home) lists all of them.';
}

/** A price against the balance: 'ready' when it is covered, else 'short' by how many tokens. */
const priced = (cost, balance) => (balance >= cost ? { status: 'ready' } : { status: 'short', short: cost - balance });

/**
 * Habi's shop: the cheapest item not bought yet, 'ready' when one unlocked by Habi's stage is
 * affordable, 'locked' (with the next stage) when every unlocked one is bought, 'owned' when all are.
 */
function buddyShopRow(buddy, balance) {
  const row = { id: 'buddy-shop', title: "Habi's shop", from: true, target: 'buddy' };
  const stage = buddyStageIndex(buddy.checkIns);
  const unowned = buddy.items.filter((item) => !buddy.owned.includes(item.id));
  const unlocked = unowned.filter((item) => stageIndexOf(item.stage) <= stage);
  if (!unowned.length) return { ...row, cost: lowest(buddy.items.map((item) => item.cost)), status: 'owned', detail: `Habi has all ${buddy.items.length} items` };
  if (!unlocked.length) {
    // Every item of the stages reached is bought, so the next stage exists.
    const next = BUDDY_STAGES[stage + 1];
    return { ...row, cost: lowest(unowned.map((item) => item.cost)), status: 'locked', detail: `Next stage ${next.name} in ${plural(next.min - buddy.checkIns, 'check-in')}` };
  }
  const cost = lowest(unlocked.map((item) => item.cost));
  const affordable = unlocked.filter((item) => item.cost <= balance).length;
  return { ...row, cost, ...priced(cost, balance), detail: affordable ? `${plural(affordable, 'item')} you can buy now` : `${plural(unlocked.length, 'item')} to save for` };
}

/** This week's drop (getBuddy's drop): locked until enough quests are done (and Habi's stage is reached), then on sale until it is collected. */
function weeklyDropRow({ drop, checkIns }, balance) {
  const { item, questsDone, questsNeeded, unlocked, owned } = drop;
  const name = `${item.emoji} ${item.name}`;
  const row = { id: 'weekly-drop', title: 'Weekly Drop', cost: item.cost, from: false, target: 'buddy' };
  if (owned) return { ...row, status: 'owned', detail: `${name} · collected this week` };
  if (!unlocked) return { ...row, status: 'locked', detail: `${name} · finish ${questsNeeded} of ${QUEST_AMOUNTS.length} quests (${questsDone}/${questsNeeded})` };
  const stage = BUDDY_STAGES[stageIndexOf(item.stage)];
  if (buddyStageIndex(checkIns) < stageIndexOf(item.stage)) return { ...row, status: 'locked', detail: `${name} · Habi reaches ${stage.name} at ${plural(stage.min, 'check-in')}` };
  return { ...row, ...priced(item.cost, balance), detail: `${name} · this week only` };
}

/**
 * Everything to spend tokens on, with its status against the raw `balance` ('owned', 'ready',
 * 'short' with `short`, 'locked' or 'full'). `rewards` and `owned` are getRewards', `freezes`
 * getStreakFreezeStatus', `buddy` getBuddy's with this week's drop, and `giftsSentToday` the treats
 * sent to classmates on the account day.
 */
export function spendRows({ balance, rewards, owned, freezes, buddy, giftsSentToday }) {
  const giftsLeft = Math.max(0, GIFTS_PER_DAY - giftsSentToday);
  const answers = Math.max(0, Math.floor(balance / COACH_TOKEN_COST));
  return [
    {
      id: 'streak-freeze',
      title: 'Streak Freeze',
      detail: `Covers a missed day · ${freezes.available}/${freezes.max} held`,
      cost: freezes.cost,
      from: false,
      ...(freezes.available >= freezes.max ? { status: 'full' } : priced(freezes.cost, balance)),
      held: freezes.available,
      max: freezes.max,
      target: 'freeze',
    },
    buddyShopRow(buddy, balance),
    ...(buddy.drop ? [weeklyDropRow(buddy, balance)] : []),
    ...rewards.map((reward) => ({
      id: reward.id,
      title: reward.name,
      detail: reward.description,
      cost: reward.cost,
      from: false,
      ...(reward.permanent && owned.includes(reward.id) ? { status: 'owned' } : priced(reward.cost, balance)),
      target: `reward:${reward.id}`,
    })),
    {
      id: 'treat-gift',
      title: 'Treats for classmates',
      detail: giftsLeft ? `${giftsLeft} of ${GIFTS_PER_DAY} left today` : `${GIFTS_PER_DAY} sent today · more tomorrow`,
      cost: TREAT_COST,
      from: true,
      ...(giftsLeft ? priced(TREAT_COST, balance) : { status: 'full' }),
      target: 'gift',
    },
    { id: 'coach', title: 'AI Coach', detail: `Enough for ${plural(answers, 'answer')}`, cost: COACH_TOKEN_COST, from: false, ...priced(COACH_TOKEN_COST, balance), target: 'coach' },
  ];
}

/**
 * The most that can still be earned today: the daily reward if it is not claimed, +5 for each habit
 * due today and not done (`openHabits`, up to the paid check-ins left), the challenges not finished
 * and, while the mystery box is not opened, its top prize.
 */
export function canStillEarnToday({ dailyClaim, paidToday, openHabits, challenges, mysteryBox }) {
  const checkIns = TOKENS_PER_CHECK_IN * Math.min(Math.max(0, PAID_CHECK_INS_PER_DAY - paidToday), openHabits);
  const unfinished = challenges.filter((challenge) => !challenge.complete).reduce((sum, challenge) => sum + challenge.reward, 0);
  return (dailyClaim.claimedToday ? 0 : dailyClaim.amount) + checkIns + unfinished + (mysteryBox.status === 'opened' ? 0 : MYSTERY_MAX);
}

/** Tokens earned a day over the last 7 days (rounded): the positive rows since then, refunds left out. `rows`: [{ id, label, amount, createdAt }]. */
export function pacePerDay(rows, now = Date.now()) {
  const since = now - PACE_DAYS * DAY_MS;
  const earned = rows.filter((row) => row.createdAt >= since && row.amount > 0 && tokenKind(row.id, row.label) !== 'refund').reduce((sum, row) => sum + row.amount, 0);
  return Math.round(earned / PACE_DAYS);
}

/**
 * The ledger rows from `since` (epoch ms) on: earned (the positive rows) and spent (the negative
 * ones, as a positive number), and both by tokenKind (bySource, bySink), so earned - spent is what
 * the balance moved.
 */
export function tokenFlow(rows, since) {
  const flow = { earned: 0, spent: 0, bySource: {}, bySink: {} };
  for (const row of rows) {
    if (row.createdAt < since || !row.amount) continue;
    const kind = tokenKind(row.id, row.label);
    const [total, groups] = row.amount > 0 ? ['earned', 'bySource'] : ['spent', 'bySink'];
    flow[total] += Math.abs(row.amount);
    flow[groups][kind] = (flow[groups][kind] ?? 0) + Math.abs(row.amount);
  }
  return flow;
}

/**
 * What to save for next: the cheapest Token Reward not owned and not yet affordable, else this
 * week's drop, else the cheapest Habi item unlocked and not bought (each only while the balance is
 * short of it), with how many tokens are missing and about how many days that is at `perDay`.
 */
export function nextGoal({ balance, rewards, owned, buddy, perDay }) {
  const short = (entry) => entry.cost > balance;
  const reward = rewards.filter((entry) => !owned.includes(entry.id) && short(entry)).sort(byCost)[0];
  const drop = buddy.drop && !buddy.drop.owned && short(buddy.drop.item) ? buddy.drop.item : null;
  const stage = buddyStageIndex(buddy.checkIns);
  const item = buddy.items.filter((entry) => !buddy.owned.includes(entry.id) && stageIndexOf(entry.stage) <= stage && short(entry)).sort(byCost)[0];
  let goal = null;
  if (reward) goal = { id: reward.id, title: reward.name, cost: reward.cost };
  else if (drop) goal = { id: drop.id, title: `${drop.name} (Weekly Drop)`, cost: drop.cost };
  else if (item) goal = { id: item.id, title: item.name, cost: item.cost };
  if (!goal) return null;
  const missing = goal.cost - balance;
  return { ...goal, short: missing, days: perDay > 0 ? Math.ceil(missing / perDay) : null };
}

/** The account streak and its next milestone bonus ({ days, bonus, daysLeft }, or null after the last). */
export function streakGoal(days) {
  const milestone = MILESTONES.find((entry) => entry > days);
  return { days, next: milestone ? { days: milestone, bonus: STREAK_MILESTONE_BONUS[milestone], daysLeft: milestone - days } : null };
}

/** Done, total, paid and still open of a list of daily challenges or weekly quests. */
function progressOf(list) {
  const rewards = (entries) => entries.reduce((sum, entry) => sum + entry.reward, 0);
  const done = list.filter((entry) => entry.complete);
  return { done: done.length, total: list.length, earned: rewards(done), available: rewards(list.filter((entry) => !entry.complete)) };
}

/**
 * The Tokens screen for the account day `day` ({ today, timeZone }, services/account-day.js): the
 * API's wallet summary without `ok`. The week is Monday to Sunday of `today`, from 00:00 Monday in
 * the account's zone.
 */
export async function getWalletSummary(db, userId, { today, timeZone }, now = Date.now()) {
  const weekStart = weekStartOf(today);
  const weekEnd = weekEndKey(today);
  const weekStartsAt = periodResetsAt({ end: shiftDay(weekStart, -1) }, timeZone);
  const [balance, ledger, paidToday, dailyClaim, challenges, quests, mysteryBox, habits, completions, rewards, buddy, freezes, bonus, giftsSentToday] = await runAll(db, [
    () => tokenBalance(db, userId),
    // The week's rows and the last 7 days' (for the pace).
    () => db.query('SELECT id, amount, label, created_at AS "createdAt" FROM token_transactions WHERE user_id=$1 AND created_at >= $2', [userId, Math.min(weekStartsAt, now - PACE_DAYS * DAY_MS)]),
    () => paidCheckIns(db, userId, today),
    () => getDailyClaim(db, userId, today),
    () => getDailyChallenges(db, userId, today, timeZone),
    () => getWeeklyQuests(db, userId, today),
    () => getMysteryBox(db, userId, today),
    () => loadHabits(db, userId),
    () => db.query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1', [userId]),
    () => getRewards(db, userId),
    () => getBuddy(db, userId, { today }),
    () => getStreakFreezeStatus(db, userId),
    () => getWeeklyBonus(db, userId, { today, timeZone }),
    () => giftsSentOn(db, userId, today),
  ]);
  const rows = ledger.rows.map((row) => ({ id: row.id, label: row.label, amount: Number(row.amount), createdAt: Number(row.createdAt) }));
  const datesByHabit = new Map();
  for (const row of completions.rows) {
    const habitId = String(row.habitId);
    if (!datesByHabit.has(habitId)) datesByHabit.set(habitId, []);
    datesByHabit.get(habitId).push(row.date);
  }
  const doneToday = (habit) => (datesByHabit.get(habit.id) ?? []).includes(today);
  const openHabits = habits.filter((habit) => isHabitActiveOn(habit, today) && isScheduledDay(habitSchedule(habit), today) && !doneToday(habit)).length;
  const streak = accountStreakRun(habits.map((habit) => ({ ...habit, completionDates: datesByHabit.get(habit.id) ?? [] })), today, freezes.frozenDays).streak;
  const spend = spendRows({ balance, rewards: rewards.rewards, owned: rewards.owned, freezes, buddy, giftsSentToday });
  const perDay = pacePerDay(rows, now);
  return {
    balance,
    tokens: Math.max(0, balance),
    affordable: spend.filter((row) => row.status === 'ready').length,
    today: {
      date: today,
      checkIns: { paid: paidToday, limit: PAID_CHECK_INS_PER_DAY, perCheckIn: TOKENS_PER_CHECK_IN, earned: paidToday * TOKENS_PER_CHECK_IN },
      // Tomorrow is the next day of the calendar when today is claimed.
      dailyClaim: { claimed: dailyClaim.claimedToday, day: dailyClaim.day, amount: dailyClaim.amount, tomorrowAmount: DAILY_CLAIM_REWARDS[dailyClaim.day % DAILY_CLAIM_REWARDS.length] },
      challenges: progressOf(challenges),
      mysteryBox,
      canStillEarn: canStillEarnToday({ dailyClaim, paidToday, openHabits, challenges, mysteryBox }),
    },
    week: { start: weekStart, end: weekEnd, resetsAt: periodResetsAt({ end: weekEnd }, timeZone), ...tokenFlow(rows, weekStartsAt), quests: progressOf(quests), bonus },
    streak: streakGoal(streak),
    earn: EARN_ROWS,
    spend,
    pace: { perDay },
    nextGoal: nextGoal({ balance, rewards: rewards.rewards, owned: rewards.owned, buddy, perDay }),
  };
}
