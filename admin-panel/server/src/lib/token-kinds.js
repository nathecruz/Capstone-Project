// The token ledger (token_transactions, written only by the app backend) sorted by kind: what paid a
// row or what it was spent on. The rules are the app backend's tokenKind
// (backend/services/wallet.js), here once in SQL for the analytics and once in JS for single rows,
// so the three must stay in step. Ledger ids look like `${userId}:token:check-in:<habit>:<date>`,
// `...:token:spend:<kind>:<uuid>` and so on; spends made before ids named their kind are plain
// UUIDs, known by their label. The amount never changes the kind.
import { config } from '../config.js';

/** Kinds that pay tokens, in the order the panel lists them. */
export const EARN_KINDS = ['check-in', 'daily-claim', 'challenge', 'quest', 'mystery', 'streak', 'weekly-bonus', 'refund'];
/** Kinds tokens are spent on (`:token:spend:<kind>:`). */
export const SPEND_KINDS = ['reward', 'buddy-item', 'buddy-treat', 'gift', 'freeze', 'coach'];
/** Every kind: 'undo' is the -5 an undone check-in once wrote; 'other' is a row no rule knows. */
export const TOKEN_KINDS = [...EARN_KINDS, ...SPEND_KINDS, 'undo', 'other'];

/** The reward that shows a student's Habi on the leaderboard. */
export const SHOWCASE_REWARD_ID = 'buddy-showcase';

/** The kind of the ledger rows of table alias `alias`, as SQL (the CASE of backend tokenKind). */
export function tokenKindSql(alias) {
  const id = `${alias}.id`;
  const label = `${alias}.label`;
  return `CASE WHEN ${id} LIKE '%:token:check-in:%' THEN 'check-in'
    WHEN ${id} LIKE '%:token:undo:%' THEN 'undo'
    WHEN ${id} LIKE '%:token:daily-claim:%' THEN 'daily-claim'
    WHEN ${id} LIKE '%:token:challenge:%' OR ${id} LIKE '%:token:daily:%' THEN 'challenge'
    WHEN ${id} LIKE '%:token:quest:%' THEN 'quest'
    WHEN ${id} LIKE '%:token:mystery:%' THEN 'mystery'
    WHEN ${id} LIKE '%:token:streak:%' THEN 'streak'
    WHEN ${id} LIKE '%:token:week:%' THEN 'weekly-bonus'
    WHEN ${id} LIKE '%:token:refund:%' THEN 'refund'
    WHEN ${id} LIKE '%:token:spend:%' THEN split_part(substring(${id} from position(':token:spend:' in ${id}) + 13), ':', 1)
    WHEN ${label} LIKE 'Redeemed %' THEN 'reward'
    WHEN ${label} LIKE 'Buddy treat:%' THEN 'buddy-treat'
    WHEN ${label} LIKE 'Buddy:%' THEN 'buddy-item'
    WHEN ${label} = 'Streak freeze' THEN 'freeze'
    WHEN ${label} = 'AI Coach' THEN 'coach'
    ELSE 'other' END`;
}

// The part of an id after `:token:` and its kind, checked in this order (so 'daily-claim' before 'daily').
const ID_KINDS = [
  ['check-in', 'check-in'],
  ['undo', 'undo'],
  ['daily-claim', 'daily-claim'],
  ['challenge', 'challenge'],
  ['daily', 'challenge'],
  ['quest', 'quest'],
  ['mystery', 'mystery'],
  ['streak', 'streak'],
  ['week', 'weekly-bonus'],
  ['refund', 'refund'],
];
const SPEND_MARK = ':token:spend:';
// Spends from before their ids named the kind, by label ('Buddy treat:' before 'Buddy:').
const LEGACY_SPEND_LABELS = [
  [(label) => label.startsWith('Redeemed '), 'reward'],
  [(label) => label.startsWith('Buddy treat:'), 'buddy-treat'],
  [(label) => label.startsWith('Buddy:'), 'buddy-item'],
  [(label) => label === 'Streak freeze', 'freeze'],
  [(label) => label === 'AI Coach', 'coach'],
];

/** The kind of one ledger row, the same as tokenKindSql gives in the database. */
export function tokenKind(id, label = '') {
  const text = String(id ?? '');
  const byId = ID_KINDS.find(([part]) => text.includes(`:token:${part}:`));
  if (byId) return byId[1];
  const spend = text.indexOf(SPEND_MARK);
  if (spend >= 0) return text.slice(spend + SPEND_MARK.length).split(':')[0];
  const name = String(label ?? '');
  return LEGACY_SPEND_LABELS.find(([matches]) => matches(name))?.[1] ?? 'other';
}

/** Orders per-kind rows ({ kind, ... }) as TOKEN_KINDS lists them; unknown kinds go last. */
export function byKindOrder(rows) {
  const rank = (kind) => (TOKEN_KINDS.includes(kind) ? TOKEN_KINDS.indexOf(kind) : TOKEN_KINDS.length);
  return [...rows].sort((a, b) => rank(a.kind) - rank(b.kind) || a.kind.localeCompare(b.kind));
}

/**
 * Totals of a period from its per-kind sums ([{ kind, earned, spent }], spent as a positive number):
 * tokens issued (positive rows that are not refunds), refunded, spent (negative rows that are not
 * undone check-ins) and undone. issued + refunds - spent - undone is the change in all balances.
 */
export function flowTotals(byKind) {
  const totals = { issued: 0, refunds: 0, spent: 0, undone: 0 };
  for (const row of byKind) {
    if (row.kind === 'refund') totals.refunds += row.earned;
    else totals.issued += row.earned;
    if (row.kind === 'undo') totals.undone += row.spent;
    else totals.spent += row.spent;
  }
  return totals;
}

// Token flags --------------------------------------------------------------------------------

/** Days the flags look back over (Manila days, today included). */
export const FLAG_WINDOW_DAYS = 14;
/**
 * Above these a student is flagged: tokens earned in a day (without KINDS_OUTSIDE_BIG_DAY), check-ins
 * in a day (the paid check-ins per day), habits starting in one week; and gifts sent from this many.
 */
export const FLAG_LIMITS = { dayTokens: 150, dayCheckIns: config.checkIns.paidPerDay, weekHabits: 12, giftsSent: 15 };
/** One-off payouts that make a big day without any farming. */
export const KINDS_OUTSIDE_BIG_DAY = ['streak', 'refund', 'weekly-bonus'];

const shortDay = (dateKey) => new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** The largest of `rows` ({ count }) over `limit` and how many are, or null when none is. */
function worstOver(rows, limit) {
  const over = rows.filter((row) => row.count > limit);
  if (!over.length) return null;
  return { worst: over.reduce((top, row) => (row.count > top.count ? row : top)), times: over.length };
}

const andMore = (times, unit) => (times > 1 ? ` (${times} ${unit})` : '');

/**
 * A student's token flags from their facts over the flag window: `tokenDays` [{ day, count }]
 * (tokens earned that day, without KINDS_OUTSIDE_BIG_DAY), `checkInDays` [{ day, count }],
 * `habitWeeks` [{ weekStart, count }] (habits starting that week) and `giftsSent`. Returns
 * [{ type, detail }] with 'big-day', 'capped-day', 'many-habits' and 'many-gifts', each at most
 * once, naming the biggest day or week.
 */
export function tokenFlags({ tokenDays = [], checkInDays = [], habitWeeks = [], giftsSent = 0 } = {}) {
  const flags = [];
  const bigDay = worstOver(tokenDays, FLAG_LIMITS.dayTokens);
  if (bigDay) flags.push({ type: 'big-day', detail: `Earned ${bigDay.worst.count} tokens on ${shortDay(bigDay.worst.day)}${andMore(bigDay.times, `days over ${FLAG_LIMITS.dayTokens}`)}` });
  const busyDay = worstOver(checkInDays, FLAG_LIMITS.dayCheckIns);
  if (busyDay) flags.push({ type: 'capped-day', detail: `${busyDay.worst.count} check-ins on ${shortDay(busyDay.worst.day)}${andMore(busyDay.times, `days over ${FLAG_LIMITS.dayCheckIns}`)}` });
  const habitWeek = worstOver(habitWeeks, FLAG_LIMITS.weekHabits);
  if (habitWeek) flags.push({ type: 'many-habits', detail: `${habitWeek.worst.count} habits started in the week of ${shortDay(habitWeek.worst.weekStart)}` });
  if (giftsSent >= FLAG_LIMITS.giftsSent) flags.push({ type: 'many-gifts', detail: `${giftsSent} treat gifts sent` });
  return flags;
}
