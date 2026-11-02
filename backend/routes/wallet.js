import { query } from '../db/client.js';
import { dayInputSchema, walletHistorySchema } from '../schemas.js';
import { dayClosedBody, resolveAccountDay } from '../services/account-day.js';
import { requireAuth } from '../services/accounts.js';
import { getWalletSummary } from '../services/token-guide.js';
import { getTokenHistory, readHistoryCursor } from '../services/wallet.js';

// The accounts with tokens: students and faculty (system admins cannot use the app at all).
const TOKEN_ROLES = new Set(['user', 'faculty']);

/** The signed-in student or faculty member, else null after a 401 or a 403. */
async function requireTokenAccount(request, response) {
  const session = await requireAuth(request, response);
  if (!session) return null;
  if (!TOKEN_ROLES.has(session.role)) {
    response.status(403).json({ ok: false, message: 'Tokens are for students and faculty.' });
    return null;
  }
  return session;
}

export default function registerWalletRoutes(app) {
  // The Tokens screen (services/token-guide.js) for ?date&timeZone, the account's today. It only
  // reads: it never stores a time zone and takes no amounts from the app. Faculty get it without
  // what only students can buy (treats for classmates, the Buddy Showcase).
  app.get('/api/wallet/summary', async (request, response) => {
    const session = await requireTokenAccount(request, response);
    if (!session) return;
    const input = dayInputSchema.safeParse({ date: request.query.date, ...(request.query.timeZone ? { timeZone: request.query.timeZone } : {}) });
    if (!input.success) return response.status(400).json({ ok: false, message: 'Send your today and time zone.' });
    const day = await resolveAccountDay({ query }, session.userId, input.data, { write: false });
    if (!day.ok) return response.status(409).json(dayClosedBody(day, 'That day is over. Your tokens follow your today.'));
    response.json({ ok: true, ...await getWalletSummary({ query }, session.userId, day, { faculty: session.role === 'faculty' }) });
  });

  // The whole token history, newest first, a page at a time (?filter&limit&before, before being the
  // last page's nextCursor), with totals over the whole ledger.
  app.get('/api/wallet/history', async (request, response) => {
    const session = await requireTokenAccount(request, response);
    if (!session) return;
    const input = walletHistorySchema.safeParse({ ...request.query });
    const before = input.success && input.data.before ? readHistoryCursor(input.data.before) : null;
    if (!input.success || (input.data.before && !before)) return response.status(400).json({ ok: false, message: 'Request contains invalid or unsupported fields.' });
    response.json({ ok: true, ...await getTokenHistory({ query }, session.userId, { filter: input.data.filter, limit: input.data.limit, before }) });
  });
}
