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
    throw Object.assign(new Error(detail?.error?.message || `Groq request failed with HTTP ${response.status}.`), { status: response.status, code: detail?.error?.code });
  }
  return response.json();
}

/** Picks GROQ_MODEL when the key may use it, otherwise the first available fallback. */
async function chooseModel(apiKey) {
  const configured = getAiModel();
  const list = await groqRequest(apiKey, '/models', { timeoutMs: 15000 });
  const available = (list?.data ?? []).filter((model) => model?.active !== false).map((model) => model.id).filter(isChatModel);
  const model = [configured, ...FALLBACK_MODELS].find((id) => available.includes(id)) ?? available[0] ?? null;
  return { configured, model, available };
}

let cachedChoice = null;

/** The model to call. Looked up once per key; a failed lookup falls back to GROQ_MODEL and is retried later. */
async function resolveModel(apiKey) {
  const configured = getAiModel();
  if (cachedChoice?.apiKey !== apiKey || cachedChoice?.configured !== configured) {
    const promise = chooseModel(apiKey).then((choice) => choice.model ?? configured).catch(() => {
      if (cachedChoice?.promise === promise) cachedChoice = null;
      return configured;
    });
    cachedChoice = { apiKey, configured, promise };
  }
  return cachedChoice.promise;
}

/**
 * Calls Groq and returns the response text, or null when no API key is configured.
 * `system` goes into the system message so user-supplied text can never replace it;
 * `schema` (JSON Schema) turns on JSON mode and is given to the model as the required shape
 * (callers still validate the result). Transient failures are retried once, and a model that
 * disappeared (404) is swapped for an available one.
 */
export async function generateAiText(prompt, {
  json = false,
  schema,
  system,
  maxOutputTokens = 700,
  temperature,
  timeoutMs = Math.max(5000, Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || 20000),
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

  const model = await resolveModel(apiKey);
  let result;
  try {
    result = await groqRequest(apiKey, '/chat/completions', { body: bodyFor(model), timeoutMs });
  } catch (error) {
    if (error?.status === 404) {
      cachedChoice = null;
      const replacement = await resolveModel(apiKey);
      if (replacement === model) throw error;
      result = await groqRequest(apiKey, '/chat/completions', { body: bodyFor(replacement), timeoutMs });
    } else {
      if (!isTransient(error)) throw error;
      await wait(800);
      result = await groqRequest(apiKey, '/chat/completions', { body: bodyFor(model), timeoutMs });
    }
  }
  const content = result?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.replace(/<think>[\s\S]*?<\/think>/g, '').trim() : '';
}

/** Logs whether the Groq key works and which model will answer, without generating anything. */
export async function verifyAi(log = console) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    log.warn('[ai] GROQ_API_KEY is not set: the AI Coach, assistants and goal planner are disabled.');
    return false;
  }
  try {
    const { configured, model, available } = await chooseModel(apiKey);
    cachedChoice = { apiKey, configured, promise: Promise.resolve(model ?? configured) };
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
