/**
 * Runs `tasks` (functions returning promises) side by side when `db` is the pool wrapper,
 * but one after another on a checked-out transaction client: a client runs one query at a
 * time, and pg is removing support for queueing queries on a busy client (pg@9).
 */
export async function runAll(db, tasks) {
  if (typeof db?.release !== 'function') return Promise.all(tasks.map((task) => task()));
  const results = [];
  for (const task of tasks) results.push(await task());
  return results;
}
