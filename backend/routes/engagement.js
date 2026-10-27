import { query, withTransaction } from '../db/client.js';
import { runAll } from '../db/run-all.js';
import { walletLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { buddyGiftSchema, buddyItemSchema, buddySaveSchema, buddyTreatSchema, dayInputSchema, mysteryBoxSchema, streakFreezeSchema, webPushDoneSchema } from '../schemas.js';
import { dayClosedBody, getAccountDay, resolveAccountDay } from '../services/account-day.js';
import { requireAuth } from '../services/accounts.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { getBuddyGifts, GIFTS_PER_DAY, sendBuddyGift } from '../services/buddy-gifts.js';
import { buyBuddyItem, feedTreat, getBuddy, isBuddyDrop, saveBuddy } from '../services/buddy.js';
import { setCheckIn } from '../services/check-ins.js';
import { getDailyChallenges } from '../services/daily-challenges.js';
import { claimDaily, getDailyClaim } from '../services/daily-claims.js';
import { getLiveVersions } from '../services/live.js';
import { openMysteryBox } from '../services/mystery-box.js';
import { applyStreakFreezes, buyStreakFreeze, getStreakFreezeStatus } from '../services/streak-freeze.js';
import { wakeMlService } from '../services/ml-wake.js';
import { getWallet } from '../services/wallet.js';
import { doneActionSecret, readDoneToken } from '../services/web-push-actions.js';
import { claimWeeklyBonus, getWeeklyBonus } from '../services/weekly-bonus.js';

/**
 * The account day of a GET with ?date&timeZone (services/account-day.js): { ok, today, timeZone },
 * where ok is false for another day, or null when the query has no valid date.
 */
async function queryDay(request, userId, options) {
  const input = dayInputSchema.safeParse({ date: request.query.date, ...(request.query.timeZone ? { timeZone: request.query.timeZone } : {}) });
  if (!input.success) return null;
  return resolveAccountDay({ query }, userId, input.data, options);
}

/**
 * The buddy as the app gets it: with `day` (the account's today, { today, timeZone }) this week's
 * drop, and the treats classmates sent on the account's today (`day`, else the stored zone's).
 */
async function buddyAnswer(db, userId, day) {
  const giftDay = day ?? await getAccountDay(db, userId);
  const [buddy, gifts] = await runAll(db, [
    () => getBuddy(db, userId, { today: day?.today ?? null }),
    () => getBuddyGifts(db, userId, giftDay),
  ]);
  return { ...buddy, ...gifts };
}

/** The buddy with this week's drop, for the account's own today (an answer to a change that sent no date). */
async function buddyOnAccountDay(db, userId) {
  return buddyAnswer(db, userId, await getAccountDay(db, userId));
}

export default function registerEngagementRoutes(app) {
  // Habit Buddy: what it wears, what was bought, the shop, how many check-ins it has grown on and
  // the treats classmates sent today. With ?date&timeZone (the account's today) it also has this
  // week's drop; a GET never stores a zone.
  app.get('/api/buddy', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const day = await queryDay(request, session.userId, { write: false });
    response.json({ ok: true, buddy: await buddyAnswer({ query }, session.userId, day?.ok ? day : null) });
  });

  // Buys a shop item or this week's drop. A drop needs the app's today: it is only sold in its week.
  app.post('/api/buddy/items', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddyItemSchema, request, response);
    if (!input) return;
    const { itemId, ...dayInput } = input;
    // Only a drop is sold by the day, so only a drop purchase can store a new time zone.
    const day = dayInput.date ? await resolveAccountDay({ query }, session.userId, dayInput, { write: isBuddyDrop(itemId) }) : null;
    if (isBuddyDrop(itemId)) {
      if (!day) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
      if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. This week\'s drop follows your today.'));
    }
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const refused = await buyBuddyItem(db, session.userId, itemId, { today: day?.ok ? day.today : null });
      if (refused) return { refused };
      const buddy = day?.ok ? await buddyAnswer(db, session.userId, day) : await buddyOnAccountDay(db, session.userId);
      return { buddy, wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) {
      const { status, code, message } = result.refused;
      return response.status(status).json({ ok: false, ...(code ? { code } : {}), message });
    }
    response.json({ ok: true, buddy: result.buddy, ...result.wallet });
  });

  app.put('/api/buddy', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddySaveSchema, request, response);
    if (!input) return;
    const refused = await saveBuddy({ query }, session.userId, input);
    if (refused) return response.status(refused.status).json({ ok: false, message: refused.message });
    response.json({ ok: true, buddy: await buddyOnAccountDay({ query }, session.userId) });
  });

  // Feeds a treat to the buddy: spends its tokens and returns the line it says.
  app.post('/api/buddy/treats', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddyTreatSchema, request, response);
    if (!input) return;
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const fed = await feedTreat(db, session.userId, input.treatId);
      if (fed.status) return { refused: fed };
      return { line: fed.line, buddy: await buddyOnAccountDay(db, session.userId), wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) return response.status(result.refused.status).json({ ok: false, message: result.refused.message });
    response.json({ ok: true, line: result.line, buddy: result.buddy, ...result.wallet });
  });

  // Sends a treat to a classmate's Habi (services/buddy-gifts.js): the sender pays, the classmate
  // gets the treat and a notification. Limited per account day, so it needs the app's today.
  app.post('/api/buddy/gifts', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddyGiftSchema, request, response);
    if (!input) return;
    const { to, treatId, messageId, ...dayInput } = input;
    const day = await resolveAccountDay({ query }, session.userId, dayInput);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Send treats on your today.'));
    // sendBuddyGift locks the sender's users row (and the classmate's) itself.
    const result = await withTransaction(async (db) => {
      const sent = await sendBuddyGift(db, session.userId, { to, treatId, messageId }, day.today);
      return sent.refused ? sent : { ...sent, wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) {
      const { status, code, message } = result.refused;
      return response.status(status).json({ ok: false, ...(code ? { code } : {}), message });
    }
    const { gift, sentToday, wallet } = result;
    response.json({ ok: true, gift, sentToday, leftToday: Math.max(0, GIFTS_PER_DAY - sentToday), tokens: wallet.tokens, tokenHistory: wallet.tokenHistory, points: wallet.points });
  });

  // Live updates: a version for each kind of data, so an open tab fetches only what changed.
  app.get('/api/live', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    // Someone is using the app: make sure the (sleeping) ML service is starting.
    wakeMlService();
    const live = await getLiveVersions({ query }, session.userId);
    if (!live) return response.status(404).json({ ok: false, message: 'Account not found.' });
    response.json({ ok: true, ...live });
  });

  // Today's three challenges and their progress (paid by each check-in).
  app.get('/api/daily-challenges', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const day = await queryDay(request, session.userId);
    if (!day?.ok) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    response.json({ ok: true, challenges: await getDailyChallenges({ query }, session.userId, day.today, day.timeZone) });
  });

  // The daily claim calendar, and claiming today's reward (once a day).
  app.get('/api/daily-claim', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const day = await queryDay(request, session.userId);
    if (!day?.ok) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    response.json({ ok: true, ...await getDailyClaim({ query }, session.userId, day.today) });
  });

  app.post('/api/daily-claim', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(dayInputSchema, request, response);
    if (!input) return;
    const day = await resolveAccountDay({ query }, session.userId, input);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Claim today\'s reward instead.'));
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const claim = await claimDaily(db, session.userId, input.date);
      return { ...claim, wallet: await getWallet(db, session.userId) };
    });
    const { wallet, ...claim } = result;
    response.json({ ok: true, ...claim, ...wallet });
  });

  // The weekly consistency bonus: last week's rate (claimable from Monday) and this week so far.
  app.get('/api/weekly-bonus', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const day = await queryDay(request, session.userId, { write: false });
    if (!day) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Your weekly bonus follows your today.'));
    response.json({ ok: true, ...await getWeeklyBonus({ query }, session.userId, day) });
  });

  // Claims last week's bonus, worked out again here from the habits and check-ins; paid once a week.
  app.post('/api/weekly-bonus/claim', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(dayInputSchema, request, response);
    if (!input) return;
    const day = await resolveAccountDay({ query }, session.userId, input);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Claim last week\'s bonus on your today.'));
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const claim = await claimWeeklyBonus(db, session.userId, day.today);
      if (claim.refused) return claim;
      const refreshed = await refreshSnapshot(session.userId, db);
      return { ...claim, updatedAt: refreshed?.updatedAt ?? null, wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) return response.status(409).json({ ok: false, code: 'BONUS_NOT_EARNED', message: result.refused });
    const { wallet, ...claim } = result;
    response.json({ ok: true, ...claim, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory, points: wallet.points });
  });

  // The daily mystery box, opened once after the day's first check-in.
  app.post('/api/mystery-box/open', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(mysteryBoxSchema, request, response);
    if (!input) return;
    const day = await resolveAccountDay({ query }, session.userId, input);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. A new box waits after today\'s first check-in.'));
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const opened = await openMysteryBox(db, session.userId, input.date);
      return opened.locked ? opened : { ...opened, wallet: await getWallet(db, session.userId) };
    });
    if (result.locked) return response.status(409).json({ ok: false, code: 'BOX_LOCKED', message: 'Check in a habit today to unlock the box.' });
    response.json({ ok: true, amount: result.amount, alreadyOpened: result.alreadyOpened, ...result.wallet });
  });

  // Streak Freeze: held freezes, buying one, and using them for days missed before today.
  app.get('/api/streak-freezes', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    response.json({ ok: true, ...await getStreakFreezeStatus({ query }, session.userId) });
  });

  // Runs when the app opens and after midnight with the user's today; a freeze bought after a
  // missed day can still save yesterday's streak.
  app.post('/api/streak-freezes/sync', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(streakFreezeSchema, request, response);
    if (!input) return;
    const day = await resolveAccountDay({ query }, session.userId, input);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'Send the device\'s today.'));
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const used = await applyStreakFreezes(db, session.userId, input.date);
      return { used, ...await getStreakFreezeStatus(db, session.userId) };
    });
    response.json({ ok: true, ...result });
  });

  app.post('/api/streak-freezes/buy', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(streakFreezeSchema, request, response);
    if (!input) return;
    const day = await resolveAccountDay({ query }, session.userId, input);
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'Send the device\'s today.'));
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const refused = await buyStreakFreeze(db, session.userId);
      if (refused) return { refused };
      const used = await applyStreakFreezes(db, session.userId, input.date);
      return { used, ...await getStreakFreezeStatus(db, session.userId), wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) return response.status(result.refused.status).json({ ok: false, message: result.refused.message });
    const { wallet, ...status } = result;
    response.json({ ok: true, ...status, ...wallet });
  });

  // The Done button on a reminder notification: authorised by the signed token it carries.
  app.post('/api/web-push/done', async (request, response) => {
    const input = parse(webPushDoneSchema, request, response);
    if (!input) return;
    const action = readDoneToken(input.token, doneActionSecret());
    if (!action) return response.status(410).json({ ok: false, message: 'This reminder has expired. Open HabitAI to check in.' });
    const account = (await query('SELECT status, role FROM users WHERE id=$1', [action.userId])).rows[0];
    if (!account || account.status === 'deactivated' || account.role === 'admin') return response.status(403).json({ ok: false, message: 'This account cannot check in.' });
    // A reminder never changes the account's time zone: only the app does.
    const day = await resolveAccountDay({ query }, action.userId, action, { write: false });
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. A missed day stays missed.'));
    const result = await withTransaction((connection) => setCheckIn(connection, { ...action, timeZone: day.timeZone, completed: true }));
    if (!result) return response.status(404).json({ ok: false, message: 'This habit no longer exists.' });
    if (result.pastDeadline) return response.status(409).json({ ok: false, code: 'PAST_DEADLINE', message: 'This habit passed its reminder time for today, so it is missed. It opens again on its next scheduled day.' });
    if (result.ended) return response.status(409).json({ ok: false, code: 'HABIT_ENDED', message: "This habit's week has ended. It stays in your history; add a new habit for this week." });
    response.json({ ok: true, label: result.label, tokens: result.serverState.tokens });
  });
}
