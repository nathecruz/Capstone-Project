import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { generateAiText, getAiModel, isAiConfigured, verifyAi } from '../services/groq.js';

const saved = {};
let keyNumber = 0;
let calls;

// The chosen model is cached per key, so every test gets its own key.
const nextKey = () => `gsk_test${String(++keyNumber).padStart(48, '0')}`;

/** Fake Groq API: `models` answers GET /models (a list of ids or { status }), `chat` answers completions in order. */
function mockGroq({ models = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'whisper-large-v3'], chat = [] } = {}) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url, init, body: init?.body ? JSON.parse(init.body) : undefined };
    calls.push(call);
    const reply = url.endsWith('/models')
      ? (Array.isArray(models) ? { body: { object: 'list', data: models.map((id) => ({ id, object: 'model', active: true })) } } : models)
      : chat.shift();
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  };
}

const answer = (content) => ({ body: { choices: [{ message: { role: 'assistant', content } }] } });
const chatCalls = () => calls.filter((call) => call.url.endsWith('/chat/completions'));

beforeEach(() => {
  for (const key of ['GROQ_API_KEY', 'GROQ_MODEL']) saved[key] = process.env[key];
  saved.fetch = globalThis.fetch;
  process.env.GROQ_API_KEY = nextKey();
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
  mockGroq();
  assert.equal(await generateAiText('Hello'), null);
  assert.equal(calls.length, 0);
});

test('sends the system prompt separately, returns the trimmed answer and looks the model up once', async () => {
  mockGroq({ chat: [answer('  Drink water after every class.  '), answer('Again.')] });
  const text = await generateAiText('What should I focus on?', { system: 'You are the HabitAI coach.', maxOutputTokens: 400, temperature: 0.6 });
  assert.equal(text, 'Drink water after every class.');
  const [call] = chatCalls();
  assert.equal(call.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(call.init.headers.Authorization, `Bearer ${process.env.GROQ_API_KEY}`);
  assert.equal(call.body.model, 'llama-3.3-70b-versatile');
  assert.deepEqual(call.body.messages, [
    { role: 'system', content: 'You are the HabitAI coach.' },
    { role: 'user', content: 'What should I focus on?' },
  ]);
  assert.equal(call.body.max_completion_tokens, 400);
  assert.equal(call.body.temperature, 0.6);
  assert.equal(call.body.response_format, undefined);
  assert.equal(call.body.reasoning_effort, undefined);

  await generateAiText('And now?');
  assert.equal(calls.filter((entry) => entry.url.endsWith('/models')).length, 1);
});

test('a schema turns on JSON mode and is given to the model', async () => {
  process.env.GROQ_MODEL = 'llama-3.1-8b-instant';
  mockGroq({ chat: [answer('{"category":"Health"}')] });
  const schema = { type: 'object', properties: { category: { type: 'string' } }, required: ['category'] };
  assert.equal(await generateAiText('Plan my goal', { system: 'You plan goals.', schema }), '{"category":"Health"}');
  const { body } = chatCalls()[0];
  assert.equal(getAiModel(), 'llama-3.1-8b-instant');
  assert.equal(body.model, 'llama-3.1-8b-instant');
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.match(body.messages[0].content, /^You plan goals\.\n\nReply with one JSON object that matches this JSON Schema:/);
  assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
});

test('uses an available fallback when GROQ_MODEL is not available to the key', async () => {
  mockGroq({ models: ['whisper-large-v3', 'meta-llama/llama-prompt-guard-2-86m', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'], chat: [answer('Fallback answer.')] });
  assert.equal(await generateAiText('Hi', { maxOutputTokens: 400 }), 'Fallback answer.');
  const { body } = chatCalls()[0];
  assert.equal(body.model, 'openai/gpt-oss-20b');
  // Reasoning models get low effort, no reasoning text and room for their thinking tokens.
  assert.equal(body.reasoning_effort, 'low');
  assert.equal(body.include_reasoning, false);
  assert.equal(body.max_completion_tokens, 1424);
});

test('falls back to GROQ_MODEL when the model list cannot be read', async () => {
  mockGroq({ models: { status: 500, body: { error: { message: 'Internal error' } } }, chat: [answer('Still works.')] });
  assert.equal(await generateAiText('Hi'), 'Still works.');
  assert.equal(chatCalls()[0].body.model, 'llama-3.3-70b-versatile');
});

test('retries a rate-limited request once, but not a rejected key', async () => {
  mockGroq({ chat: [{ status: 429, body: { error: { message: 'Rate limit reached' } } }, answer('Second try worked.')] });
  assert.equal(await generateAiText('Hi'), 'Second try worked.');
  assert.equal(chatCalls().length, 2);

  process.env.GROQ_API_KEY = nextKey();
  mockGroq({ chat: [{ status: 401, body: { error: { message: 'Invalid API Key', code: 'invalid_api_key' } } }] });
  await assert.rejects(generateAiText('Hi'), (error) => error.status === 401 && error.code === 'invalid_api_key');
  assert.equal(chatCalls().length, 1);
});

test('switches model when the chosen one disappears', async () => {
  mockGroq({ chat: [answer('First.')] });
  assert.equal(await generateAiText('Hi'), 'First.');

  mockGroq({ models: ['llama-3.1-8b-instant'], chat: [{ status: 404, body: { error: { message: 'model not found', code: 'model_not_found' } } }, answer('From the new model.')] });
  assert.equal(await generateAiText('Hi'), 'From the new model.');
  assert.deepEqual(chatCalls().map((call) => call.body.model), ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']);
});

test('the start-up check reports the model in use, a fallback, a bad key and a key without models', async () => {
  const lines = [];
  const log = { info: (line) => lines.push(line), warn: (line) => lines.push(line), error: (line) => lines.push(line) };
  const keys = [];

  mockGroq();
  keys.push(process.env.GROQ_API_KEY);
  assert.equal(await verifyAi(log), true);
  assert.equal(calls[0].url, 'https://api.groq.com/openai/v1/models');
  assert.equal(calls[0].init.method, 'GET');

  process.env.GROQ_API_KEY = nextKey();
  keys.push(process.env.GROQ_API_KEY);
  mockGroq({ models: ['openai/gpt-oss-120b', 'whisper-large-v3'], chat: [answer('ok')] });
  assert.equal(await verifyAi(log), true);
  await generateAiText('Hi');
  assert.equal(chatCalls()[0].body.model, 'openai/gpt-oss-120b', 'the start-up choice is reused');
  assert.equal(calls.filter((call) => call.url.endsWith('/models')).length, 1);

  mockGroq({ models: { status: 401, body: { error: { message: 'Invalid API Key' } } } });
  assert.equal(await verifyAi(log), false);
  mockGroq({ models: ['whisper-large-v3'] });
  assert.equal(await verifyAi(log), false);

  process.env.GROQ_API_KEY = '';
  assert.equal(await verifyAi(log), false);
  assert.deepEqual(lines, [
    '[ai] Groq API key verified; using llama-3.3-70b-versatile.',
    '[ai] Groq API key verified, but llama-3.3-70b-versatile is not available to it; using openai/gpt-oss-120b instead. Available: openai/gpt-oss-120b.',
    '[ai] Groq check failed (the API key was rejected). Check GROQ_API_KEY in the Render dashboard.',
    '[ai] The Groq API key works, but no chat model is available to it. Check the model permissions of the Groq project.',
    '[ai] GROQ_API_KEY is not set: the AI Coach, assistants and goal planner are disabled.',
  ]);
  assert.ok(lines.every((line) => keys.every((key) => !line.includes(key))), 'keys are never logged');
});
