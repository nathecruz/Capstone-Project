import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { generateAiText, getAiModel, isAiConfigured, verifyAi } from '../services/groq.js';

const FAKE_KEY = 'gsk_test0000000000000000000000000000000000000000000000';
const saved = {};
let calls;

function mockFetch(...responses) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = responses.shift();
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const answer = (content) => ({ body: { choices: [{ message: { role: 'assistant', content } }] } });

beforeEach(() => {
  for (const key of ['GROQ_API_KEY', 'GROQ_MODEL']) saved[key] = process.env[key];
  saved.fetch = globalThis.fetch;
  process.env.GROQ_API_KEY = FAKE_KEY;
  delete process.env.GROQ_MODEL;
});

afterEach(() => {
  for (const key of ['GROQ_API_KEY', 'GROQ_MODEL']) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  globalThis.fetch = saved.fetch;
});

test('AI is off without a real Groq key, and nothing is sent', async () => {
  for (const value of ['', 'your-groq-api-key', 'short']) {
    process.env.GROQ_API_KEY = value;
    assert.equal(isAiConfigured(), false, value);
  }
  mockFetch();
  assert.equal(await generateAiText('Hello'), null);
  assert.equal(calls.length, 0);
});

test('sends the system prompt separately and returns the trimmed answer', async () => {
  mockFetch(answer('  Drink water after every class.  '));
  const text = await generateAiText('What should I focus on?', { system: 'You are the HabitAI coach.', maxOutputTokens: 400, temperature: 0.6 });
  assert.equal(text, 'Drink water after every class.');
  const [call] = calls;
  assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, `Bearer ${FAKE_KEY}`);
  assert.equal(call.body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(call.body.messages, [
    { role: 'system', content: 'You are the HabitAI coach.' },
    { role: 'user', content: 'What should I focus on?' },
  ]);
  assert.equal(call.body.max_completion_tokens, 400);
  assert.equal(call.body.temperature, 0.6);
  assert.equal(call.body.response_format, undefined);
});

test('a schema turns on JSON mode and is given to the model', async () => {
  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
  mockFetch(answer('{"category":"Health"}'));
  const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
  assert.equal(await generateAiText('Plan my goal', { system: 'You plan goals.', schema }), '{"category":"Health"}');
  const { body } = calls[0];
  assert.equal(getAiModel(), 'llama-3.1-8b-instant');
  assert.equal(body.model, 'llama-3.1-8b-instant');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /^You plan goals\.\n\nReply with one JSON object that matches this JSON Schema:/);
  assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
});

test('retries a rate-limited request once, but not a rejected key', async () => {
  mockFetch({ status: 429, body: { error: { message: 'Rate limit reached' } } }, answer('Second try worked.'));
  assert.equal(await generateAiText('Hi'), 'Second try worked.');
  assert.equal(calls.length, 2);

  mockFetch({ status: 401, body: { error: { message: 'Invalid API Key', code: 'invalid_api_key' } } });
  await assert.rejects(generateAiText('Hi'), (error) => error.status === 401 && error.code === 'invalid_api_key');
  assert.equal(calls.length, 1);
});

test('the start-up check reports a working key, a bad key and a missing model', async () => {
  const lines = [];
  const log = { info: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };

  mockFetch({ body: { id: 'llama-3.3-70b-versatile' } });
  assert.equal(await verifyAi(log), true);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/models/llama-3.3-70b-versatile');
  assert.equal(calls[0].init.method, 'GET');

  mockFetch({ status: 401, body: { error: { message: 'Invalid API Key' } } });
  assert.equal(await verifyAi(log), false);
  mockFetch({ status: 404, body: { error: { message: 'model not found' } } });
  assert.equal(await verifyAi(log), false);

  process.env.GROQ_API_KEY = '';
  assert.equal(await verifyAi(log), false);
  assert.deepEqual(lines, [
    '[ai] Groq API key verified; using llama-3.3-70b-versatile.',
    '[ai] Groq check failed (the API key was rejected). Check GROQ_API_KEY and GROQ_MODEL in the Render dashboard.',
    '[ai] Groq check failed (model llama-3.3-70b-versatile is not available). Check GROQ_API_KEY and GROQ_MODEL in the Render dashboard.',
    '[ai] GROQ_API_KEY is not set: the AI Coach, assistants and goal planner are disabled.',
  ]);
  assert.ok(lines.every((line) => !line.includes(FAKE_KEY)), 'the key is never logged');
});
