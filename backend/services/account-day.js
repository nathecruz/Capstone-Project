// The account day: the day a student's check-ins, claims and rewards count for. It follows the time
// zone the app sends, but a day that already started can never be reopened by switching the phone
// to a time zone further west: when the zone changes, the stored zone's today becomes the account's
// day floor, and no earlier day is accepted again. Switching east only borrows from tomorrow, so
// travellers keep working with no cooldown. Stored in users.time_zone and users.day_floor.
import { config, isTimeZone } from '../config/index.js';
import { getDateKeyInTimeZone } from './completion-date.js';

const isDateKey = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Whether `date` is the account's today, given the stored zone and floor and the zone the app sent.
 * The zone is the requested one when valid, else the stored one, else `fallbackZone`. When it
 * differs from a stored zone, the floor becomes at least the stored zone's today. Returns
 * { ok, today, timeZone, store }: on a refusal, today and timeZone are the day the account is on;
 * `store` ({ timeZone, floor }) is what an accepted request with a new zone saves (the first zone
 * is stored with no floor), else null.
 */
export function decideAccountDay({ storedZone, floor, date, requestedZone, now = new Date(), fallbackZone = config.appTimeZone }) {
  const stored = isTimeZone(storedZone) ? storedZone : null;
  const requested = isTimeZone(requestedZone) ? requestedZone : null;
  const timeZone = requested ?? stored ?? fallbackZone;
  const today = getDateKeyInTimeZone(now, timeZone);
  const storedFloor = isDateKey(floor) ? floor : null;
  // A zone change: the day that already started in the stored zone stays the earliest open day.
  const storedToday = stored && timeZone !== stored ? getDateKeyInTimeZone(now, stored) : null;
  const nextFloor = storedToday && (!storedFloor || storedToday > storedFloor) ? storedToday : storedFloor;
  const ok = date === today && (!nextFloor || date >= nextFloor);
  if (ok) return { ok, today, timeZone, store: requested && requested !== stored ? { timeZone: requested, floor: nextFloor } : null };
  // The new zone's today is before the floor, so that zone would be refused whatever the date: the
  // account is still on the stored zone's day.
  if (storedToday && today < nextFloor) return { ok, today: storedToday, timeZone: stored, store: null };
  return { ok, today, timeZone, store: null };
}

async function readAccountZone(db, userId) {
  const row = (await db.query('SELECT time_zone AS "timeZone", day_floor::text AS "floor" FROM users WHERE id=$1', [userId])).rows[0];
  return { timeZone: row?.timeZone ?? '', floor: row?.floor ?? null };
}

/**
 * Checks that `date` is the account's today (decideAccountDay) and, with `write`, saves a new time
 * zone the request brought. Returns { ok, today, timeZone }. The zone is only replaced if no other
 * request changed it meanwhile, and the floor never moves back.
 */
export async function resolveAccountDay(db, userId, { date, timeZone }, { write = true, now = new Date() } = {}) {
  let decision;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const stored = await readAccountZone(db, userId);
    decision = decideAccountDay({ storedZone: stored.timeZone, floor: stored.floor, date, requestedZone: timeZone, now });
    if (!write || !decision.store) break;
    const saved = await db.query(
      'UPDATE users SET time_zone=$2, day_floor=GREATEST(day_floor, $3::date) WHERE id=$1 AND time_zone=$4',
      [userId, decision.store.timeZone, decision.store.floor, stored.timeZone],
    );
    if (saved.rowCount) break;
    // Another request changed the zone meanwhile: decide again from what it saved.
  }
  return { ok: decision.ok, today: decision.today, timeZone: decision.timeZone };
}

/** The account's today with no date from the app: { today, timeZone, floor } in the stored zone (or the campus zone). */
export async function getAccountDay(db, userId, now = new Date()) {
  const stored = await readAccountZone(db, userId);
  const timeZone = isTimeZone(stored.timeZone) ? stored.timeZone : config.appTimeZone;
  return { today: getDateKeyInTimeZone(now, timeZone), timeZone, floor: stored.floor };
}

/** The 409 body for a day that is not the account's today; the app shows which day it is. */
export function dayClosedBody(day, message) {
  return { ok: false, code: 'DAY_CLOSED', message, today: day.today, timeZone: day.timeZone };
}
