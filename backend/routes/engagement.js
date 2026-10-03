import { query, withTransaction } from '../db/client.js';
import { parse } from '../lib/http.js';
import { buddyItemSchema, buddySaveSchema, mysteryBoxSchema, webPushDoneSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { buyBuddyItem, getBuddy, saveBuddy } from '../services/buddy.js';
import { setCheckIn } from '../services/check-ins.js';
import { isOpenCheckInDate } from '../services/completion-date.js';
import { openMysteryBox } from '../services/mystery-box.js';
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

  // The Done button on a reminder notification: authorised by the signed token it carries.
  app.post('/api/web-push/done', async (request, response) => {
    const input = parse(webPushDoneSchema, request, response);
    if (!input) return;
    const action = readDoneToken(input.token, doneActionSecret());
    if (!action) return response.status(410).json({ ok: false, message: 'This reminder has expired. Open HabitAI to check in.' });
    const account = (await query('SELECT status FROM users WHERE id=$1', [action.userId])).rows[0];
    if (!account || account.status === 'deactivated') return response.status(403).json({ ok: false, message: 'This account cannot check in.' });
    if (!isOpenCheckInDate(action.date, action.timeZone)) {
      return response.status(409).json({ ok: false, code: 'DAY_CLOSED', message: 'That day is over. A missed day stays missed.' });
    }
    const result = await withTransaction((connection) => setCheckIn(connection, { ...action, completed: true }));
    if (!result) return response.status(404).json({ ok: false, message: 'This habit no longer exists.' });
    response.json({ ok: true, label: result.label, tokens: result.serverState.tokens });
  });
}
