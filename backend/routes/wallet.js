import { query } from '../db/client.js';
import { dayInputSchema, walletHistorySchema } from '../schemas.js';
import { dayClosedBody, resolveAccountDay } from '../services/account-day.js';
import { requireAuth } from '../services/accounts.js';
import { getWalletSummary } from '../services/token-guide.js';
import { getTokenHistory, readHistoryCursor } from '../services/wallet.js';

/** The signed-in student, else null after a 401 or a 403: faculty and admins have no Tokens screen. */
async function requireStudent(request, response) {
  const session = await requireAuth(request, response);
  if (!session) return null;
  if (session.role !== 'user') {
    response.status(403).json({ ok: false, message: 'Tokens are for students.' });
    return null;
  }
  return session;
}

export default function registerWalletRoutes(app) {
  // The Tokens screen (services/token-guide.js) for ?date&timeZone, the account's today. It only
  // reads: it never stores a time zone and takes no amounts from the app.
  app.get('/api/wallet/summary', async (request, response) => {
    const session = await requireStudent(request, response);
    if (!session) return;
    const input = dayInputSchema.safeParse({ date: request.query.date, ...(request.query.timeZone ? { timeZone: request.query.timeZone } : {}) });
    if (!input.success) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    const day = await resolveAccountDay({ query }, session.userId, input.data, { write: false });
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Your tokens follow your today.'));
    response.json({ ok: true, ...await getWalletSummary({ query }, session.userId, day) });
  });

  // The whole token history, newest first, a page at a time (?filter&limit&before, before being the
  // last page's nextCursor), with totals over the whole ledger.
  app.get('/api/wallet/history', async (request, response) => {
    const session = await requireStudent(request, response);
    if (!session) return;
    const input = walletHistorySchema.safeParse({ ...request.query });
    const before = input.success && input.data.before ? readHistoryCursor(input.data.before) : null;
    if (!input.success || (input.data.before && !before)) return response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.' });
    response.json({ ok: true, ...await getTokenHistory({ query }, session.userId, { filter: input.data.filter, limit: input.data.limit, before }) });
  });
}
