import assert from 'node:assert/strict';
import test from 'node:test';
import { adviceKey, createAdviceCache } from '../services/advice-cache.js';
import { forecastFor, ML_FORECAST_WAIT_MS, ML_RETRY_AFTER_MS, rulesForecast } from '../services/forecast-rules.js';

const signal = (overrides = {}) => ({ habit_name: 'drink water', streak: 4, completion_rate: 0.75, missed_days: 2, last_7_days: [1, 1, 0, 1, 1, 0, 1], ...overrides });

test('the rules forecast matches the ML service fallback formula', () => {
  // 0.75 * 0.5 + 5/7 * 0.3 + 4/30 * 0.2
  const steady = rulesForecast(signal());
  assert.equal(steady.completion_probability, 0.616);
  assert.equal(steady.dropout_risk, 0.384);
  assert.equal(steady.suggested_reminder_time, '19:00');
  assert.equal(steady.recommended_action, 'Keep the routine small and repeatable to build momentum.');
  assert.equal(steady.prediction_source, 'fallback');
  assert.equal(steady.is_fallback, true);
  assert.equal(steady.confidence, 0);
  assert.match(steady.summary, /^Drink Water has a deterministic fallback forecast because the ML service is waking up\./);

  // 0.2 * 0.5 + 1/7 * 0.3
  const slipping = rulesForecast(signal({ habit_name: 'read for 20 minutes', streak: 0, completion_rate: 0.2, last_7_days: [0, 0, 1, 0, 0, 0, 0] }));
  assert.equal(slipping.completion_probability, 0.1429);
  assert.equal(slipping.dropout_risk, 0.8571);
  assert.equal(slipping.suggested_reminder_time, '07:30');
  assert.match(slipping.summary, /^Read For 20 Minutes /);

  const perfect = rulesForecast(signal({ streak: 45, completion_rate: 1, last_7_days: [1, 1, 1, 1, 1, 1, 1] }));
  assert.equal(perfect.completion_probability, 1);
  assert.equal(perfect.dropout_risk, 0);
  assert.equal(rulesForecast(signal({ last_7_days: [] })).completion_probability, 0.4017);
});

const answering = (calls) => async (url, options) => {
  calls.push({ url, options });
  return { ok: true, json: async () => ({ completion_probability: 0.9, prediction_source: 'model', is_fallback: false }) };
};
const timingOut = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }); };

test('a forecast comes from the ML service when it answers, otherwise from the rules', async () => {
  const ml = { url: 'http://ml.test/', key: 'key', timeoutMs: 60_000 };
  const calls = [];
  const fromMl = await forecastFor(signal(), { ...ml, state: { downUntil: 0 }, fetchImpl: answering(calls) });
  assert.equal(fromMl.source, 'ml');
  assert.equal(fromMl.prediction.completion_probability, 0.9);
  assert.equal(calls[0].url, 'http://ml.test/api/predict/habit');
  assert.equal(calls[0].options.headers['X-ML-Service-Key'], 'key');

  const asleep = await forecastFor(signal(), { ...ml, state: { downUntil: 0 }, fetchImpl: timingOut });
  assert.equal(asleep.source, 'rules');
  assert.equal(asleep.prediction.completion_probability, 0.616);

  const failing = await forecastFor(signal(), { ...ml, state: { downUntil: 0 }, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(failing.source, 'rules');

  let fetched = false;
  const off = await forecastFor(signal(), { ...ml, key: '', state: { downUntil: 0 }, fetchImpl: async () => { fetched = true; } });
  assert.equal(off.source, 'rules');
  assert.equal(fetched, false, 'without a service key the ML service is not called');
  assert.match(off.prediction.summary, /not configured/);
  assert.ok(ML_FORECAST_WAIT_MS <= 10_000, 'a sleeping service does not hold the forecast up for long');
});

test('while the ML service wakes up, forecasts do not wait on it again', async () => {
  let clock = 0;
  const state = { downUntil: 0 };
  const ml = { url: 'http://ml.test', key: 'key', timeoutMs: 60_000, state, now: () => clock };
  assert.equal((await forecastFor(signal(), { ...ml, fetchImpl: timingOut })).source, 'rules');

  const calls = [];
  clock += ML_RETRY_AFTER_MS - 1;
  assert.equal((await forecastFor(signal(), { ...ml, fetchImpl: answering(calls) })).source, 'rules');
  assert.equal(calls.length, 0, 'answered straight away without asking the waking service');

  clock += 1;
  assert.equal((await forecastFor(signal(), { ...ml, fetchImpl: answering(calls) })).source, 'ml', 'asks again after a minute');
  assert.equal(calls.length, 1);

  // A service that answers with an error is awake: the next forecast asks it again.
  await forecastFor(signal(), { ...ml, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal((await forecastFor(signal(), { ...ml, fetchImpl: answering(calls) })).source, 'ml');
});

test('AI advice is kept per habit while its facts stay the same', () => {
  let clock = 1_000;
  const cache = createAdviceCache({ ttlMs: 100, maxEntries: 2, now: () => clock });
  const facts = { day: '2026-10-05', stats: { completedDays: 3 } };
  const key = adviceKey('user-1', 'habit-1', facts);
  assert.equal(key, adviceKey('user-1', 'habit-1', { ...facts }));
  assert.notEqual(key, adviceKey('user-1', 'habit-1', { ...facts, stats: { completedDays: 4 } }), 'a new check-in asks again');
  assert.notEqual(key, adviceKey('user-1', 'habit-1', { ...facts, day: '2026-10-06' }), 'a new day asks again');
  assert.notEqual(key, adviceKey('user-2', 'habit-1', facts), 'advice is never shared between students');

  assert.equal(cache.get(key), null);
  cache.set(key, { headline: 'Going well' });
  assert.deepEqual(cache.get(key), { headline: 'Going well' });
  clock += 100;
  assert.equal(cache.get(key), null, 'advice expires');

  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);
  assert.equal(cache.size, 2);
  assert.equal(cache.get('a'), null, 'the oldest entry goes first when full');
  assert.equal(cache.get('c'), 3);
});

test('over the AI-advice limit a request is marked, not refused', async () => {
  const { default: express } = await import('express');
  const { habitAdviceLimiter } = await import('../http/rate-limits.js');
  const app = express();
  app.post('/advice', habitAdviceLimiter, (request, response) => response.json({ limited: Boolean(request.aiLimited) }));
  const server = app.listen(0);
  try {
    const { port } = server.address();
    const ask = (token) => fetch(`http://127.0.0.1:${port}/advice`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).then(async (response) => ({ status: response.status, ...(await response.json()) }));
    const answers = [];
    for (let index = 0; index < 31; index += 1) answers.push(await ask('student-a-session-token'));
    assert.ok(answers.every((answer) => answer.status === 200), 'never refused');
    assert.equal(answers.filter((answer) => answer.limited).length, 1, 'only the 31st in the window is over the limit');
    assert.equal(answers.at(-1).limited, true);
    assert.equal((await ask('student-b-session-token')).limited, false, 'each session has its own limit');
  } finally {
    server.close();
  }
});
