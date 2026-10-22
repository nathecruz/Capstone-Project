// The Tokens screen's numbers as the server counts them: the wallet summary for the device's today
// (every way to earn with today's progress, everything to buy) and the token history, page by page.
// Shared by the Tokens screen and Home's Tokens tile. Loaded again when the live pulse says the
// wallet, rewards, buddy, claims, freezes or state changed (reloadWallet); cleared when the account
// changes.
import { useEffect, useSyncExternalStore } from 'react';
import { getWalletHistory, getWalletSummary, type WalletHistory, type WalletHistoryFilter, type WalletHistoryItem, type WalletSummary } from '@/authentication/authService';
import { subscribeToAuthChanges } from '@/authentication/session';

/** Rows per history page (the server allows 1-50). */
export const HISTORY_PAGE = 30;

type History = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  filter: WalletHistoryFilter;
  items: WalletHistoryItem[];
  nextCursor: string | null;
  totals: WalletHistory['totals'] | null;
  loadingMore: boolean;
};
type State = { status: 'idle' | 'loading' | 'ready' | 'error'; date: string; summary: WalletSummary | null; error: string; history: History };

const EMPTY_HISTORY: History = { status: 'idle', filter: 'all', items: [], nextCursor: null, totals: null, loadingMore: false };
const EMPTY: State = { status: 'idle', date: '', summary: null, error: '', history: EMPTY_HISTORY };
let state = EMPTY;
// As in use-weekly-bonus: the day being loaded, whether a change came in meanwhile, the latest
// summary and first-page loads (older answers are dropped) and the account's version.
let loadingDate = '';
let loadAgain = false;
let latestLoad = 0;
let latestHistoryLoad = 0;
let account = 0;
// The screens showing the history: only these are kept current by the live pulse (the next one to
// open loads its first page anyway).
let historyViewers = 0;
const listeners = new Set<() => void>();

function update(changes: Partial<State>) {
  state = { ...state, ...changes };
  listeners.forEach((listener) => listener());
}

const updateHistory = (changes: Partial<History>) => update({ history: { ...state.history, ...changes } });

subscribeToAuthChanges(() => {
  account += 1;
  loadingDate = '';
  loadAgain = false;
  update(EMPTY);
});

async function fetchSummary(date: string) {
  const asked = account;
  latestLoad += 1;
  const load = latestLoad;
  loadingDate = date;
  loadAgain = false;
  if (state.date !== date || !state.summary) update({ status: 'loading', date, summary: null, error: '' });
  let result = await getWalletSummary(date);
  // The phone's day is not the account's (its time zone moved west after the day started). The
  // summary only reads, so it shows the account's own day.
  if (!result.ok && result.code === 'DAY_CLOSED' && result.today && result.timeZone && result.today !== date) result = await getWalletSummary(result.today, result.timeZone);
  // Dropped when the account changed or another day was asked for meanwhile.
  if (asked !== account || load !== latestLoad) return;
  loadingDate = '';
  if (result.ok) update({ status: 'ready', date, summary: result, error: '' });
  // A failed reload keeps the numbers on show.
  else if (!state.summary) update({ status: 'error', error: result.message });
  if (loadAgain) void fetchSummary(date);
}

/** Older first: the server orders the history by createdAt, then id, newest first. */
const isOlder = (item: WalletHistoryItem, than: WalletHistoryItem) => Number(item.createdAt) < Number(than.createdAt) || (Number(item.createdAt) === Number(than.createdAt) && item.id < than.id);

/** A new first page; the older rows Load more already brought stay after it, with their cursor. */
export function withFirstPage(page: Pick<WalletHistory, 'items' | 'nextCursor'>, known: Pick<History, 'items' | 'nextCursor'>) {
  const last = page.items.at(-1);
  if (!last || !page.nextCursor || known.items.length <= page.items.length) return { items: page.items, nextCursor: page.nextCursor };
  const older = known.items.filter((item) => isOlder(item, last));
  return older.length ? { items: [...page.items, ...older], nextCursor: known.nextCursor } : { items: page.items, nextCursor: page.nextCursor };
}

/** The first page of `filter`; with `keep`, a reload of the list on show that keeps what was loaded. */
async function fetchFirstPage(filter: WalletHistoryFilter, keep: boolean) {
  const asked = account;
  latestHistoryLoad += 1;
  const load = latestHistoryLoad;
  if (!keep || state.history.filter !== filter || state.history.status === 'idle') update({ history: { ...EMPTY_HISTORY, status: 'loading', filter } });
  const result = await getWalletHistory({ filter, limit: HISTORY_PAGE });
  if (asked !== account || load !== latestHistoryLoad) return;
  if (!result.ok) {
    if (state.history.status === 'loading') updateHistory({ status: 'error' });
    return;
  }
  updateHistory({ status: 'ready', totals: result.totals, ...withFirstPage(result, state.history) });
}

/** Loads the summary for `date` (the device's today), unless it is being loaded already. */
export async function loadWallet(date: string) {
  if (loadingDate !== date) await fetchSummary(date);
}

/** Shows the history of `filter` from its newest row. */
export async function loadWalletHistory(filter: WalletHistoryFilter = 'all') {
  await fetchFirstPage(filter, false);
}

/** The next page of the history on show (nothing while one is on its way, or at the end). */
export async function loadMoreWalletHistory() {
  const { filter, nextCursor, loadingMore } = state.history;
  if (!nextCursor || loadingMore) return;
  const asked = account;
  updateHistory({ loadingMore: true });
  const result = await getWalletHistory({ filter, before: nextCursor, limit: HISTORY_PAGE });
  if (asked !== account) return;
  // Dropped when another filter was picked or the list was replaced meanwhile.
  if (!result.ok || state.history.filter !== filter || state.history.nextCursor !== nextCursor) {
    updateHistory({ loadingMore: false });
    return;
  }
  const known = new Set(state.history.items.map((item) => item.id));
  updateHistory({ items: [...state.history.items, ...result.items.filter((item) => !known.has(item.id))], nextCursor: result.nextCursor, totals: result.totals, loadingMore: false });
}

/** After the live pulse saw a change: loads again what a screen loaded (the summary, and the history while one shows it). */
export function reloadWallet() {
  if (state.date) {
    if (loadingDate === state.date) loadAgain = true;
    else void fetchSummary(state.date);
  }
  if (historyViewers > 0 && state.history.status !== 'idle') void fetchFirstPage(state.history.filter, true);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * The wallet summary for `date` (the device's today; null until the server answered), loaded when
 * a screen showing it opens and when the day changes. With load false (faculty) nothing is asked.
 */
export function useWallet(date: string, load = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (load) void loadWallet(date);
  }, [date, load]);
  const current = snapshot.date === date;
  return { summary: current ? snapshot.summary : null, status: current ? snapshot.status : 'idle', error: current ? snapshot.error : '' };
}

/**
 * The token history, loaded from its newest row of every kind when a screen showing it opens (the
 * rows of an earlier visit stay on show meanwhile).
 */
export function useWalletHistory(load = true) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    if (!load) return;
    historyViewers += 1;
    void fetchFirstPage('all', true);
    return () => {
      historyViewers -= 1;
    };
  }, [load]);
  return snapshot.history;
}
