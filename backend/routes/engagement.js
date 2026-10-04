import { query, withTransaction } from '../db/client.js';
import { parse } from '../lib/http.js';
import { buddyItemSchema, buddySaveSchema, dayInputSchema, mysteryBoxSchema, streakFreezeSchema, webPushDoneSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { buyBuddyItem, getBuddy, saveBuddy } from '../services/buddy.js';
import { setCheckIn } from '../services/check-ins.js';
import { isOpenCheckInDate } from '../services/completion-date.js';
import { getDailyChallenges } from '../services/daily-challenges.js';
import { claimDaily, getDailyClaim } from '../services/daily-claims.js';
import { getLiveVersions } from '../services/live.js';
import { openMysteryBox } from '../services/mystery-box.js';
import { applyStreakFreezes, buyStreakFreeze, getStreakFreezeStatus } from '../services/streak-freeze.js';
import { getWallet } from '../services/wallet.js';
import { doneActionSecret, readDoneToken } from '../services/web-push-actions.js';

export default function registerEngagementRoutes(app) {
  // Habit Buddy: what it wears, what was bought, the shop and how many check-ins it has grown on.
  app.get('/api/buddy', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    response.json({ ok: true, buddy: await getBuddy({ query }, session.userId) });
  });

  app.post('/api/buddy/items', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddyItemSchema, request, response);
    if (!input) return;
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const refused = await buyBuddyItem(db, session.userId, input.itemId);
      if (refused) return { refused };
      return { buddy: await getBuddy(db, session.userId), wallet: await getWallet(db, session.userId) };
    });
    if (result.refused) return response.status(result.refused.status).json({ ok: false, message: result.refused.message });
    response.json({ ok: true, buddy: result.buddy, ...result.wallet });
  });

  app.put('/api/buddy', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(buddySaveSchema, request, response);
    if (!input) return;
    const refused = await saveBuddy({ query }, session.userId, input);
    if (refused) return response.status(refused.status).json({ ok: false, message: refused.message });
    response.json({ ok: true, buddy: await getBuddy({ query }, session.userId) });
  });

  // Live updates: a version for each kind of data, so an open tab fetches only what changed.
  app.get('/api/live', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const live = await getLiveVersions({ query }, session.userId);
    if (!live) return response.status(404).json({ ok: false, message: 'Account not found.' });
    response.json({ ok: true, ...live });
  });

  // Today's three challenges and their progress (paid by each check-in).
  app.get('/api/daily-challenges', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = dayInputSchema.safeParse({ date: request.query.date, ...(request.query.timeZone ? { timeZone: request.query.timeZone } : {}) });
    if (!input.success || !isOpenCheckInDate(input.data.date, input.data.timeZone)) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    response.json({ ok: true, challenges: await getDailyChallenges({ query }, session.userId, input.data.date, input.data.timeZone || 'UTC') });
  });

  // The daily claim calendar, and claiming today's reward (once a day).
  app.get('/api/daily-claim', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = dayInputSchema.safeParse({ date: request.query.date, ...(request.query.timeZone ? { timeZone: request.query.timeZone } : {}) });
    if (!input.success || !isOpenCheckInDate(input.data.date, input.data.timeZone)) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    response.json({ ok: true, ...await getDailyClaim({ query }, session.userId, input.data.date) });
  });

  app.post('/api/daily-claim', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(dayInputSchema, request, response);
    if (!input) return;
    if (!isOpenCheckInDate(input.date, input.timeZone)) {
      return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'That day is over. Claim today\'s reward instead.' });
    }
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const claim = await claimDaily(db, session.userId, input.date);
      return { ...claim, wallet: await getWallet(db, session.userId) };
    });
    const { wallet, ...claim } = result;
    response.json({ ok: true, ...claim, ...wallet });
  });

  // The daily mystery box, opened once after the day's first check-in.
  app.post('/api/mystery-box/open', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(mysteryBoxSchema, request, response);
    if (!input) return;
    if (!isOpenCheckInDate(input.date, input.timeZone)) {
      return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'That day is over. A new box waits after today\'s first check-in.' });
    }
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
    if (!isOpenCheckInDate(input.date, input.timeZone)) return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'Send the device\'s today.' });
    const result = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      const used = await applyStreakFreezes(db, session.userId, input.date);
      return { used, ...await getStreakFreezeStatus(db, session.userId) };
    });
    response.json({ ok: true, ...result });
  });

  app.post('/api/streak-freezes/buy', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(streakFreezeSchema, request, response);
    if (!input) return;
    if (!isOpenCheckInDate(input.date, input.timeZone)) return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'Send the device\'s today.' });
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
    if (!isOpenCheckInDate(action.date, action.timeZone)) {
      return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'That day is over. A missed day stays missed.' });
    }
    const result = await withTransaction((connection) => setCheckIn(connection, { ...action, completed: true }));
    if (!result) return response.status(404).json({ ok: false, message: 'This habit no longer exists.' });
    response.json({ ok: true, label: result.label, tokens: result.serverState.tokens });
  });
}
