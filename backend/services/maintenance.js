// Daily housekeeping so the free Neon tier (0.5 GB) does not fill up with data nobody needs.
import { query } from '../db/client.js';
import { pruneAllSnapshots } from './app-state-store.js';
import { pruneExpiredCodes, pruneIssueAttachments } from './retention.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runMaintenance({ now = Date.now(), log = console.log } = {}) {
  const attachments = await pruneIssueAttachments({ query }, now);
  const snapshots = await pruneAllSnapshots();
  await pruneExpiredCodes({ query }, now);
  if (attachments) log(`[maintenance] cleared ${attachments} old issue-report attachments`);
  if (snapshots) log(`[maintenance] pruned ${snapshots} old app-state snapshots`);
}

/** Runs now and then once a day; the timer never keeps the process alive on shutdown. */
export function scheduleMaintenance({ log = console.log } = {}) {
  const run = () => runMaintenance({ log }).catch((error) => log(`[maintenance] skipped: ${error?.message || error}`));
  void run();
  return setInterval(run, DAY_MS).unref();
}
