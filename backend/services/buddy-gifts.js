// Treat gifts: a student buys one of Habi's treats for a classmate's Habi, with one of five fixed
// cheers (there is no free text). Tokens only leave the sender and the classmate gets none, so
// tokens can never move between accounts. Classmates are found by their leaderboard id and named as
// the board names them (first name and last initial), never by full name or email. A gift is a
// buddy_gifts row and a 'gift' notification for the classmate; feeding your own Habi is feedTreat.
import crypto from 'node:crypto';
import { runAll } from '../db/run-all.js';
import { leaderboardNameOf } from '../lib/display.js';
import { BUDDY_TREATS, DEFAULT_BUDDY_NAME } from './buddy.js';
import { getDateKeyInTimeZone } from './completion-date.js';
import { spendTokens } from './wallet.js';

export const GIFT_MESSAGES = ['Keep going!', 'Proud of you!', 'Laban!', "Kaya mo 'yan!", 'Nice streak!'];
// At most 3 sent per account day, 1 to the same classmate in 7 days, and 10 received in 24 hours.
export const GIFTS_PER_DAY = 3;
export const GIFTS_RECEIVED_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const PAIR_WINDOW_MS = 7 * DAY_MS;

const refusal = (status, code, message) => ({ status, ...(code ? { code } : {}), message });
const withArticle = (word) => `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;

/**
 * Why one more gift would break a limit (a 429 refusal), else null. `sent` are the sender's gifts of
 * the last 7 days ({ recipientId, localDate, createdAt }), `received` the times (epoch ms) the
 * classmate got a gift in the last 24 hours, and `today` the sender's account day.
 */
export function giftLimitRefusal({ sent, received, today, recipientId, recipientName, now = Date.now() }) {
  if (sent.filter((gift) => gift.localDate === today).length >= GIFTS_PER_DAY) {
    return refusal(429, 'GIFT_DAILY_LIMIT', `You can send ${GIFTS_PER_DAY} treats a day. Try again tomorrow.`);
  }
  if (sent.some((gift) => gift.recipientId === recipientId && gift.createdAt > now - PAIR_WINDOW_MS)) {
    return refusal(429, 'GIFT_PAIR_LIMIT', `You already sent ${recipientName} a treat in the last 7 days.`);
  }
  if (received.filter((at) => at > now - DAY_MS).length >= GIFTS_RECEIVED_PER_DAY) {
    return refusal(429, 'RECIPIENT_FULL', `${recipientName} has received lots of treats today. Try again tomorrow.`);
  }
  return null;
}

/**
 * Locks the sender's users row and the classmate's (found by leaderboard id), in id order, so two
 * classmates sending each other a treat at once wait instead of deadlocking, and the classmate's
 * daily cap cannot be raced. Returns both accounts ({ sender, recipient }; recipient null if none).
 * They are read after the lock, in a query of their own: one that waited for the lock (an app-state
 * save turning treats off) would otherwise still see the preferences from before it waited.
 */
async function lockAccounts(db, senderId, publicId) {
  const found = (await db.query('SELECT id FROM users WHERE public_id=$1', [publicId])).rows[0];
  const ids = [...new Set([senderId, found?.id].filter(Boolean))];
  await db.query('SELECT id FROM users WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE', [ids]);
  const rows = (await db.query(
    `SELECT u.id, u.role, u.status, u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName", b.name AS "buddyName",
            (p.preferences_json->'showOnLeaderboard') IS DISTINCT FROM 'false'::jsonb AS listed,
            (p.preferences_json->'allowGifts') IS DISTINCT FROM 'false'::jsonb AS "acceptsGifts"
       FROM users u
       LEFT JOIN user_preferences p ON p.user_id=u.id
       LEFT JOIN user_buddy b ON b.user_id=u.id
      WHERE u.id = ANY($1::text[])`,
    [ids],
  )).rows;
  return { sender: rows.find((row) => row.id === senderId), recipient: found ? rows.find((row) => row.id === found.id) ?? null : null };
}

/**
 * Sends the treat `treatId` with the cheer `messageId` to the classmate whose leaderboard id is
 * `to`, on the sender's account day `today` (services/account-day.js). Returns { refused: { status,
 * code?, message } }, or { gift: { id, treatId, to, message }, sentToday }. Call inside a
 * transaction: it locks the users rows itself (lockAccounts).
 */
export async function sendBuddyGift(db, senderId, { to, treatId, messageId }, today, now = Date.now()) {
  const treat = BUDDY_TREATS.find((entry) => entry.id === treatId);
  if (!treat) return { refused: refusal(404, null, 'That treat is not in the shop.') };
  const { sender, recipient } = await lockAccounts(db, senderId, to);
  if (sender?.role !== 'user' || sender.status !== 'active') return { refused: refusal(403, null, 'Only students can send treats to classmates.') };
  if (recipient?.id === senderId) return { refused: refusal(400, 'SELF_GIFT', 'You cannot send a treat to yourself.') };
  if (!recipient || recipient.role !== 'user' || recipient.status !== 'active' || !recipient.listed) {
    return { refused: refusal(404, 'RECIPIENT_NOT_FOUND', 'That classmate is not on the leaderboard.') };
  }
  if (!recipient.acceptsGifts) return { refused: refusal(403, 'GIFTS_OFF', 'This classmate is not accepting treats.') };

  const recipientName = leaderboardNameOf(recipient);
  const [sent, received] = await runAll(db, [
    () => db.query('SELECT recipient_id AS "recipientId", local_date::text AS "localDate", created_at AS "createdAt" FROM buddy_gifts WHERE sender_id=$1 AND created_at > $2', [senderId, now - PAIR_WINDOW_MS]),
    () => db.query('SELECT created_at AS "createdAt" FROM buddy_gifts WHERE recipient_id=$1 AND created_at > $2', [recipient.id, now - DAY_MS]),
  ]);
  const sentGifts = sent.rows.map((gift) => ({ ...gift, createdAt: Number(gift.createdAt) }));
  const limited = giftLimitRefusal({ sent: sentGifts, received: received.rows.map((gift) => Number(gift.createdAt)), today, recipientId: recipient.id, recipientName, now });
  if (limited) return { refused: limited };

  const spent = await spendTokens(db, senderId, treat.cost, `Gift: ${treat.name} to ${recipientName}`, { kind: 'gift', now });
  if (!spent.ok) return { refused: refusal(402, null, `You need ${treat.cost - spent.balance} more tokens for the ${treat.name}.`) };
  const id = crypto.randomUUID();
  const message = GIFT_MESSAGES[messageId];
  await db.query(
    'INSERT INTO buddy_gifts(id,sender_id,recipient_id,treat_id,message_id,local_date,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)',
    [id, senderId, recipient.id, treat.id, messageId, today, now],
  );
  const buddyName = recipient.buddyName || DEFAULT_BUDDY_NAME;
  await db.query(
    "INSERT INTO notifications(id,user_id,type,title,body,created_at) VALUES($1,$2,'gift',$3,$4,$5)",
    [`${recipient.id}:notification:gift:${id}`, recipient.id, `${treat.emoji} A treat for ${buddyName}`, `${leaderboardNameOf(sender)} sent ${buddyName} ${withArticle(treat.name)}: ${message}`, now],
  );
  return { gift: { id, treatId: treat.id, to, message }, sentToday: sentGifts.filter((gift) => gift.localDate === today).length + 1 };
}

/** The treats this student sent on the account day `today` (at most GIFTS_PER_DAY). */
export async function giftsSentOn(db, senderId, today) {
  const result = await db.query('SELECT COUNT(*)::int AS count FROM buddy_gifts WHERE sender_id=$1 AND local_date=$2::date', [senderId, today]);
  return result.rows[0].count;
}

/** The classmates this student sent a treat to in the last 7 days (internal ids): no new one yet. */
export async function recentGiftRecipients(db, senderId, now = Date.now()) {
  const result = await db.query('SELECT DISTINCT recipient_id AS "recipientId" FROM buddy_gifts WHERE sender_id=$1 AND created_at > $2', [senderId, now - PAIR_WINDOW_MS]);
  return new Set(result.rows.map((row) => row.recipientId));
}

/**
 * The treats classmates sent this student on the account day `day` ({ today, timeZone }), newest
 * first and at most 10 ({ treatId, emoji, from, message }), how many they sent and received in all,
 * and the cheers to choose from.
 */
export async function getBuddyGifts(db, userId, { today, timeZone }, now = Date.now()) {
  const [recent, totals] = await runAll(db, [
    // Whatever the zone, every gift of today was sent in the last two days.
    () => db.query(
      `SELECT g.treat_id AS "treatId", g.message_id AS "messageId", g.created_at AS "createdAt", u.full_name AS "fullName", u.first_name AS "firstName", u.last_name AS "lastName"
         FROM buddy_gifts g JOIN users u ON u.id = g.sender_id
        WHERE g.recipient_id=$1 AND g.created_at > $2
        ORDER BY g.created_at DESC, g.id`,
      [userId, now - 2 * DAY_MS],
    ),
    () => db.query('SELECT (SELECT COUNT(*) FROM buddy_gifts WHERE sender_id=$1)::int AS sent, (SELECT COUNT(*) FROM buddy_gifts WHERE recipient_id=$1)::int AS received', [userId]),
  ]);
  const giftsToday = recent.rows
    .filter((gift) => getDateKeyInTimeZone(new Date(Number(gift.createdAt)), timeZone) === today)
    .slice(0, GIFTS_RECEIVED_PER_DAY)
    .map((gift) => ({
      treatId: gift.treatId,
      emoji: BUDDY_TREATS.find((treat) => treat.id === gift.treatId)?.emoji ?? '🎁',
      from: leaderboardNameOf(gift),
      message: GIFT_MESSAGES[gift.messageId] ?? '',
    }));
  return { giftsToday, giftsSent: totals.rows[0].sent, giftsReceived: totals.rows[0].received, giftMessages: GIFT_MESSAGES };
}
