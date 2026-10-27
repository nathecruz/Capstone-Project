// The account day (services/account-day.js): a time zone change can never reopen a day that
// already started. Wednesday Oct 21, 2026, 02:00 UTC is 10:00 in Manila, still Tuesday Oct 20 in
// Pago Pago (UTC-11) and 16:00 in Kiritimati (UTC+14).
import assert from 'node:assert/strict';
import test from 'node:test';
import { decideAccountDay } from '../services/account-day.js';
import { isOpenCheckInDate } from '../services/completion-date.js';

const at = (iso) => new Date(iso);

test('the first time zone is stored with no floor', () => {
  const decision = decideAccountDay({ storedZone: '', floor: null, date: '2026-10-21', requestedZone: 'Asia/Manila', now: at('2026-10-21T02:00:00Z') });
  assert.deepEqual(decision, { ok: true, today: '2026-10-21', timeZone: 'Asia/Manila', store: { timeZone: 'Asia/Manila', floor: null } });
  const same = decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-21', requestedZone: 'Asia/Manila', now: at('2026-10-21T02:00:00Z') });
  assert.equal(same.store, null, 'the same zone again stores nothing');
});

test('a western time zone cannot reopen a day that already started', () => {
  const now = at('2026-10-21T02:00:00Z');
  assert.equal(isOpenCheckInDate('2026-10-20', 'Pacific/Pago_Pago', now), true, 'the old check accepted it');
  const decision = decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-20', requestedZone: 'Pacific/Pago_Pago', now });
  assert.equal(decision.ok, false);
  assert.deepEqual([decision.today, decision.timeZone, decision.store], ['2026-10-21', 'Asia/Manila', null], 'the account is still on its Manila day');
  // Any other date sent with that zone is told the same day, not Pago Pago's (which is refused too).
  const stale = decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-19', requestedZone: 'Pacific/Pago_Pago', now });
  assert.deepEqual([stale.ok, stale.today, stale.timeZone], [false, '2026-10-21', 'Asia/Manila']);
  // A new zone whose today is open reports that day.
  const east = decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-19', requestedZone: 'Pacific/Kiritimati', now });
  assert.deepEqual([east.ok, east.today, east.timeZone], [false, '2026-10-21', 'Pacific/Kiritimati']);
});

test('moving east is accepted and raises the floor; switching back west waits for the next local day', () => {
  // 12:00 UTC: 20:00 Oct 21 in Manila, 02:00 Oct 22 in Kiritimati.
  const east = decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-22', requestedZone: 'Pacific/Kiritimati', now: at('2026-10-21T12:00:00Z') });
  assert.deepEqual(east, { ok: true, today: '2026-10-22', timeZone: 'Pacific/Kiritimati', store: { timeZone: 'Pacific/Kiritimati', floor: '2026-10-21' } });

  const back = decideAccountDay({ storedZone: 'Pacific/Kiritimati', floor: '2026-10-21', date: '2026-10-21', requestedZone: 'Asia/Manila', now: at('2026-10-21T13:00:00Z') });
  assert.equal(back.ok, false, 'Oct 22 already started in Kiritimati, so Manila\'s Oct 21 stays closed');
  assert.deepEqual([back.today, back.timeZone], ['2026-10-22', 'Pacific/Kiritimati']);

  // 00:30 UTC Oct 22: 08:30 Oct 22 in Manila.
  const nextDay = decideAccountDay({ storedZone: 'Pacific/Kiritimati', floor: '2026-10-21', date: '2026-10-22', requestedZone: 'Asia/Manila', now: at('2026-10-22T00:30:00Z') });
  assert.deepEqual(nextDay, { ok: true, today: '2026-10-22', timeZone: 'Asia/Manila', store: { timeZone: 'Asia/Manila', floor: '2026-10-22' } });
});

test('a missing zone uses the stored one; an invalid one falls back to Manila', () => {
  const now = at('2026-10-21T02:00:00Z');
  const stored = decideAccountDay({ storedZone: 'Pacific/Pago_Pago', floor: null, date: '2026-10-20', now });
  assert.deepEqual(stored, { ok: true, today: '2026-10-20', timeZone: 'Pacific/Pago_Pago', store: null });
  const invalid = decideAccountDay({ storedZone: '', floor: null, date: '2026-10-21', requestedZone: 'Mars/Olympus', now });
  assert.deepEqual(invalid, { ok: true, today: '2026-10-21', timeZone: 'Asia/Manila', store: null }, 'only a real zone the app sent is stored');
  const unknownStored = decideAccountDay({ storedZone: 'Mars/Olympus', floor: null, date: '2026-10-21', now });
  assert.equal(unknownStored.timeZone, 'Asia/Manila');
});

test('only today counts, and the floor never lets an earlier day back in', () => {
  const now = at('2026-10-21T02:00:00Z');
  assert.equal(decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-20', requestedZone: 'Asia/Manila', now }).ok, false, 'yesterday is closed');
  assert.equal(decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-10-22', requestedZone: 'Asia/Manila', now }).ok, false, 'tomorrow is not open yet');
  assert.equal(decideAccountDay({ storedZone: 'Asia/Manila', floor: null, date: '2026-02-30', now }).ok, false);
  // A floor from an earlier trip east is kept when the zone changes again.
  const kept = decideAccountDay({ storedZone: 'UTC', floor: '2026-10-21', date: '2026-10-21', requestedZone: 'Asia/Manila', now });
  assert.deepEqual(kept.store, { timeZone: 'Asia/Manila', floor: '2026-10-21' });
});
