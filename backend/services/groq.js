import { isTemplateValue } from '../config/env.js';

// Groq serves open models through an OpenAI-compatible API, so plain fetch is enough.
const GROQ_API_URL = 'https://api.groq.com/openai/v1';

// Used in this order when GROQ_MODEL is not available to the key (retired, or blocked in the
// Groq project's settings).
const FALLBACK_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'];
// Speech, text-to-speech and safety models cannot answer chat prompts.
const isChatModel = (id) => typeof id === 'string' && !/whisper|tts|orpheus|playai|guard/i.test(id);
// gpt-oss models think before answering; those tokens count against max_completion_tokens.
const isReasoningModel = (id) => /gpt-oss/i.test(id);

// Read lazily so environment files loaded after import still apply.
export const getAiModel = () => process.env.GROQ_MODEL?.trim() || 'llama-3.3-70b-versatile';

function getGroqApiKey() {
  const key = process.env.GROQ_API_KEY?.trim();
  // Real Groq keys start with gsk_ and are about 56 characters; anything shorter is a leftover template value.
  return key && !isTemplateValue(key) && key.length >= 30 ? key : null;
}

export const isAiConfigured = () => Boolean(getGroqApiKey());

function isTransient(error) {
  const status = Number(error?.status ?? 0);
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || status === 429 || status >= 500;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function groqRequest(apiKey, path, { body, timeoutMs }) {
  const response = await fetch(`${GROQ_API_URL}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${apiKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    // How long a rate limit lasts, in seconds.
    const retryAfter = Number(response.headers.get('retry-after'));
    throw Object.assign(new Error(detail?.error?.message || `Groq request failed with HTTP ${response.status}.`), {
      status: response.status,
      code: detail?.error?.code,
      ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterSeconds: retryAfter } : {}),
    });
  }
  return response.json();
}

/**
 * Picks GROQ_MODEL when the key may use it, otherwise the first available fallback. `candidates`
 * are the models to try in turn: the chosen one, then the other FALLBACK_MODELS the key may use.
 */
async function chooseModel(apiKey) {
  const configured = getAiModel();
  const list = await groqRequest(apiKey, '/models', { timeoutMs: 15000 });
  const available = (list?.data ?? []).filter((model) => model?.active !== false).map((model) => model.id).filter(isChatModel);
  const model = [configured, ...FALLBACK_MODELS].find((id) => available.includes(id)) ?? available[0] ?? null;
  const candidates = model ? [model, ...FALLBACK_MODELS.filter((id) => id !== model && available.includes(id))] : [];
  return { configured, model, available, candidates };
}

let cachedChoice = null;

/** The models to try, best first. Looked up once per key; a failed lookup tries GROQ_MODEL alone and is retried later. */
async function resolveCandidates(apiKey) {
  const configured = getAiModel();
  if (cachedChoice?.apiKey !== apiKey || cachedChoice?.configured !== configured) {
    const promise = chooseModel(apiKey).then((choice) => (choice.candidates.length ? choice.candidates : [configured])).catch(() => {
      if (cachedChoice?.promise === promise) cachedChoice = null;
      return [configured];
    });
    cachedChoice = { apiKey, configured, promise };
  }
  return cachedChoice.promise;
}

// Groq limits each model on its own: requests and tokens a minute and a day. A model that answers
// 429 rests until its Retry-After (a minute without one, 15 minutes at most) while the next
// candidate answers, so a busy day (a class taking the survey) spreads over the models instead of
// failing. Rests are kept per key, in memory.
const RATE_LIMIT_REST_MS = 60_000;
const MAX_REST_MS = 15 * 60_000;
// A request tries at most this many models, and starts no new try after its time budget.
const MAX_MODELS_PER_REQUEST = 3;
const restingUntil = new Map();
const restKey = (apiKey, model) => `${apiKey.slice(-12)}:${model}`;

function restModel(apiKey, model, error, now = Date.now()) {
  const seconds = Number(error?.retryAfterSeconds);
  const until = now + Math.min(MAX_REST_MS, Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : RATE_LIMIT_REST_MS);
  if ((restingUntil.get(restKey(apiKey, model)) ?? 0) <= now) {
    console.warn(`[ai] ${model} is rate-limited by Groq for about ${Math.round((until - now) / 1000)} s; the next model answers meanwhile.`);
  }
  restingUntil.set(restKey(apiKey, model), until);
}

/** The candidates in the order to try: those not resting, then the resting ones, the soonest free first. */
function inTurn(apiKey, candidates, now = Date.now()) {
  const rest = (model) => restingUntil.get(restKey(apiKey, model)) ?? 0;
  return [...candidates.filter((model) => rest(model) <= now), ...candidates.filter((model) => rest(model) > now).sort((left, right) => rest(left) - rest(right))];
}

/**
 * Calls Groq and returns the response text, or null when no API key is configured.
 * `system` goes into the system message so user-supplied text can never replace it;
 * `schema` (JSON Schema) turns on JSON mode and is given to the model as the required shape
 * (callers still validate the result). A server error or timeout gets one more try; a rate limit
 * (429) moves on to the next available model; a model that disappeared (404) is swapped for an
 * available one. No new try starts after `budgetMs`, so the app's wait (70 s) is never reached.
 */
export async function generateAiText(prompt, {
  json = false,
  schema,
  system,
  maxOutputTokens = 700,
  temperature,
  timeoutMs = Math.max(5000, Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || 20000),
  budgetMs = 40_000,
} = {}) {
  const apiKey = getGroqApiKey();
  if (!apiKey) return null;

  const wantsJson = json || Boolean(schema);
  // JSON mode needs the word "JSON" in the prompt; the schema tells the model the exact shape.
  const instructions = [
    system,
    schema ? `Reply with one JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}` : wantsJson ? 'Reply with one JSON object.' : '',
  ].filter(Boolean).join('\n\n');
  const bodyFor = (model) => ({
    model,
    messages: [...(instructions ? [{ role: 'system', content: instructions }] : []), { role: 'user', content: prompt }],
    max_completion_tokens: isReasoningModel(model) ? maxOutputTokens + 1024 : maxOutputTokens,
    ...(isReasoningModel(model) ? { reasoning_effort: 'low', include_reasoning: false } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
  });

  const deadline = Date.now() + budgetMs;
  const remaining = () => deadline - Date.now();
  let models = inTurn(apiKey, await resolveCandidates(apiKey));
  let refreshed = false;
  let triedAgain = false;
  let lastError = null;
  for (let index = 0; index < Math.min(models.length, MAX_MODELS_PER_REQUEST) && remaining() > 1000;) {
    const model = models[index];
    try {
      const result = await groqRequest(apiKey, '/chat/completions', { body: bodyFor(model), timeoutMs: Math.min(timeoutMs, remaining()) });
      const content = result?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
    } catch (error) {
      lastError = error;
      if (error?.status === 404 && !refreshed) {
        // The model is gone: read the list again and go on with the others.
        refreshed = true;
        cachedChoice = null;
        models = inTurn(apiKey, (await resolveCandidates(apiKey)).filter((id) => id !== model));
        index = 0;
        continue;
      }
      if (!isTransient(error)) throw error;
      if (error?.status === 429) restModel(apiKey, model, error);
      const lastModel = index + 1 >= Math.min(models.length, MAX_MODELS_PER_REQUEST);
      // One more try on the same model: after a server error or a timeout, or a rate limit with no other model left.
      if (!triedAgain && (error?.status !== 429 || lastModel)) {
        triedAgain = true;
        await wait(800);
        continue;
      }
      triedAgain = false;
      index += 1;
    }
  }
  throw lastError ?? Object.assign(new Error('The AI service did not answer in time.'), { name: 'TimeoutError' });
}

/** Logs whether the Groq key works and which model will answer, without generating anything. */
export async function verifyAi(log = console) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    log.warn('[ai] GROQ_API_KEY is not set: the AI Coach, assistants and goal planner are disabled.');
    return false;
  }
  try {
    const { configured, model, available, candidates } = await chooseModel(apiKey);
    cachedChoice = { apiKey, configured, promise: Promise.resolve(candidates.length ? candidates : [configured]) };
    if (!model) {
      log.error('[ai] The Groq API key works, but no chat model is available to it. Check the model permissions of the Groq project.');
      return false;
    }
    if (model === configured) log.info(`[ai] Groq API key verified; using ${model}.`);
    else log.warn(`[ai] Groq API key verified, but ${configured} is not available to it; using ${model} instead. Available: ${available.slice(0, 12).join(', ')}.`);
    return true;
  } catch (error) {
    const reason = error?.status === 401 ? 'the API key was rejected' : error?.status ?? error?.name ?? 'error';
    log.error(`[ai] Groq check failed (${reason}). Check GROQ_API_KEY in the Render dashboard.`);
    return false;
  }
}
