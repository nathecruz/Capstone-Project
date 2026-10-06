import assert from 'node:assert/strict';
import test from 'node:test';
import { createReminderClock } from '../services/web-push-clock.js';

const MINUTE = 60_000;
const START = Date.parse('2026-10-06T04:00:20.000Z');
const minute = (offset) => Math.floor(START / MINUTE) * MINUTE + offset * MINUTE;

/** Fake clock and timers: `advance` runs due timers in order and lets their promises settle. */
function fakeTime() {
  let now = START;
  let next = 0;
  const timers = new Map();
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  return {
    now: () => now,
    setTimer: (fn, ms) => {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimer: (id) => timers.delete(id),
    settle,
    async advance(ms) {
      const end = now + ms;
      await settle();
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
        await settle();
      }
      now = end;
    },
  };
}

function makeClock(time, plans, { failLoads = 0, failDispatch = () => false } = {}) {
  const calls = { loads: [], dispatches: [] };
  const clock = createReminderClock({
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    log: () => {},
    loadWakeTimes: async (at, userIds) => {
      calls.loads.push({ at, userIds });
      if (calls.loads.length <= failLoads) throw new Error('database asleep');
      const plan = new Map();
      for (const [userId, times] of Object.entries(plans)) {
        if (!userIds || userIds.includes(userId)) plan.set(userId, times);
      }
      return plan;
    },
    dispatch: async (options) => {
      const call = { at: time.now(), ...options };
      calls.dispatches.push(call);
      if (failDispatch(call, calls.dispatches.length)) throw new Error('push service down');
    },
  });
  return { clock, calls };
}

test('reminder clock catches up after a restart, then sends each reminder on its minute', async () => {
  const time = fakeTime();
  const { clock, calls } = makeClock(time, { anna: [minute(10)], ben: [minute(25)] });
  await clock.start();
  await time.settle();

  // Start: one full load, then everything missed while asleep (30 minutes back), for everyone.
  assert.deepEqual(calls.loads.map((load) => load.userIds), [null]);
  assert.equal(calls.dispatches.length, 1);
  assert.equal(calls.dispatches[0].userIds, null);
  assert.equal(calls.dispatches[0].lookbackMinutes, 30);

  // Anna's reminder goes out one second into its minute, only for her.
  await time.advance(minute(10) + 1_000 - time.now());
  assert.equal(calls.dispatches.length, 2);
  assert.deepEqual(calls.dispatches[1].userIds, ['anna']);
  assert.equal(calls.dispatches[1].at, minute(10) + 1_000);
  assert.equal(calls.dispatches[1].lookbackMinutes, 2);

  await time.advance(minute(25) + 1_000 - time.now());
  assert.deepEqual(calls.dispatches.map((dispatch) => dispatch.userIds), [null, ['anna'], ['ben']]);
  clock.stop();
});

test('reminder clock reloads only the changed student and sends a new reminder on its minute', async () => {
  const time = fakeTime();
  const plans = { anna: [minute(20)], ben: [minute(30)] };
  const { clock, calls } = makeClock(time, plans);
  await clock.start();
  await time.settle();

  // Ben adds a reminder for 3 minutes from now (the GitHub plan would not know it yet).
  plans.ben = [minute(3), minute(30)];
  clock.notifyChange('ben');
  clock.notifyChange('ben');
  await time.advance(5_000);
  assert.deepEqual(calls.loads.map((load) => load.userIds), [null, ['ben']]);

  await time.advance(minute(3) + 1_000 - time.now());
  assert.deepEqual(calls.dispatches.at(-1).userIds, ['ben']);
  assert.equal(calls.dispatches.at(-1).at, minute(3) + 1_000);

  // Anna turns her reminders off: her planned minute is dropped.
  delete plans.anna;
  clock.notifyChange('anna');
  await time.advance(minute(21) - time.now());
  assert.equal(calls.dispatches.some((dispatch) => dispatch.userIds?.includes('anna')), false);
  assert.deepEqual(clock.plan.users.anna, undefined);
  clock.stop();
});

test('reminder clock reloads every 30 minutes and retries a failed load a minute later', async () => {
  const time = fakeTime();
  const { clock, calls } = makeClock(time, { anna: [minute(45)] }, { failLoads: 1 });
  await clock.start();
  await time.settle();
  assert.equal(calls.loads.length, 1);

  // Not a busy loop: the next try is a minute later.
  await time.advance(59_000);
  assert.equal(calls.loads.length, 1);
  await time.advance(2_000);
  assert.equal(calls.loads.length, 2);

  await time.advance(30 * MINUTE);
  assert.equal(calls.loads.length, 3);
  assert.equal(calls.loads[2].userIds, null);
  clock.stop();
});

test('reminder clock retries a failed send for everyone, looking back to the missed minute', async () => {
  const time = fakeTime();
  let failed = false;
  // Anna's planned send fails once (the push service was down).
  const { clock, calls } = makeClock(time, { anna: [minute(5)] }, {
    failDispatch: (call) => {
      if (failed || !call.userIds?.includes('anna')) return false;
      failed = true;
      return true;
    },
  });
  await clock.start();
  await time.settle();

  await time.advance(minute(5) + 1_000 - time.now());
  assert.deepEqual(calls.dispatches.at(-1).userIds, ['anna']);
  await time.advance(MINUTE);
  const retry = calls.dispatches.at(-1);
  assert.equal(retry.userIds, null);
  assert.equal(retry.at, minute(5) + 1_000 + MINUTE);
  // Back past 04:05 to the last complete run at start-up.
  assert.equal(retry.lookbackMinutes >= 6, true);
  await time.advance(5 * MINUTE);
  assert.equal(calls.dispatches.length, 3);
  clock.stop();
});

test('reminder clock gives up retrying after three failed sends', async () => {
  const time = fakeTime();
  const { clock, calls } = makeClock(time, {}, { failDispatch: () => true });
  await clock.start();
  await time.advance(10 * MINUTE);
  assert.equal(calls.dispatches.length, 3);
  clock.stop();
});

test('a stopped reminder clock sets no more timers', async () => {
  const time = fakeTime();
  const { clock, calls } = makeClock(time, { anna: [minute(2)] });
  await clock.start();
  await time.settle();
  clock.stop();
  clock.notifyChange('anna');
  await time.advance(10 * MINUTE);
  assert.equal(calls.dispatches.length, 1);
  assert.equal(calls.loads.length, 1);
});
