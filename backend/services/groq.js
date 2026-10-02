import { isTemplateValue } from '../config/env.js';

// Groq serves open models through an OpenAI-compatible API, so plain fetch is enough.
const GROQ_API_URL = 'https://api.groq.com/openai/v1';

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

/**
 * Calls Groq and returns the response text, or null when no API key is configured.
 * `system` goes into the system message so user-supplied text can never replace it;
 * `schema` (JSON Schema) turns on JSON mode and is given to the model as the required shape
 * (callers still validate the result). Transient failures are retried once.
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
  const body = {
    model: getAiModel(),
    messages: [...(instructions ? [{ role: 'system', content: instructions }] : []), { role: 'user', content: prompt }],
    max_completion_tokens: maxOutputTokens,
    ...(temperature !== undefined ? { temperature } : {}),
    ...(wantsJson ? { response_format: { type: 'json_object' } } : {}),
  };

  let result;
  try {
    result = await groqRequest(apiKey, '/chat/completions', { body, timeoutMs });
  } catch (error) {
    if (!isTransient(error)) throw error;
    await wait(800);
    result = await groqRequest(apiKey, '/chat/completions', { body, timeoutMs });
  }
  const content = result?.choices?.[0]?.message?.content;
  return typeof content === 'string' ? content.trim() : '';
}

/** Logs whether the Groq key and model work, without generating anything. */
export async function verifyAi(log = console) {
  const apiKey = getGroqApiKey();
  if (!apiKey) {
    log.warn('[ai] GROQ_API_KEY is not set: the AI Coach, assistants and goal planner are disabled.');
    return false;
  }
  const model = getAiModel();
  try {
    await groqRequest(apiKey, `/models/${encodeURIComponent(model)}`, { timeoutMs: 15000 });
    log.info(`[ai] Groq API key verified; using ${model}.`);
    return true;
  } catch (error) {
    const reason = error?.status === 401 ? 'the API key was rejected' : error?.status === 404 ? `model ${model} is not available` : error?.status ?? error?.name ?? 'error';
    log.error(`[ai] Groq check failed (${reason}). Check GROQ_API_KEY and GROQ_MODEL in the Render dashboard.`);
    return false;
  }
}
