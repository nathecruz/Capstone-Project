import { GoogleGenAI } from '@google/genai';
import { isTemplateValue } from '../config/env.js';

// Read lazily so environment files loaded after import still apply.
export const getGeminiModel = () => process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

// Each AI feature can use its own key (separate quotas); GEMINI_API_KEY is the shared fallback.
const keyByProfile = {
  goals: 'GEMINI_API_KEY_GOALS',
  coach: 'GEMINI_API_KEY_COACH',
  assistant: 'GEMINI_API_KEY_ASSISTANT',
  support: 'GEMINI_API_KEY_ASSISTANT',
};

function usableKey(value) {
  const key = value?.trim();
  // Real Google AI Studio keys are ~39 characters; anything shorter is a leftover template value.
  return key && !isTemplateValue(key) && key.length >= 30 ? key : null;
}

const getGeminiApiKey = (profile = 'default') => usableKey(process.env[keyByProfile[profile]]) || usableKey(process.env.GEMINI_API_KEY);

export const isGeminiConfigured = (profile = 'default') => Boolean(getGeminiApiKey(profile));

const clients = new Map();
function clientFor(apiKey) {
  if (!clients.has(apiKey)) clients.set(apiKey, new GoogleGenAI({ apiKey }));
  return clients.get(apiKey);
}

function isTransient(error) {
  const status = Number(error?.status ?? error?.code ?? 0);
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || status === 429 || status >= 500;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Calls Gemini and returns the response text, or null when no API key is configured.
 * `system` goes into the system instruction so user-supplied text can never replace it;
 * `schema` (JSON Schema) turns on structured JSON output. Transient failures are retried once.
 */
export async function generateGeminiText(prompt, {
  json = false,
  schema,
  system,
  maxOutputTokens = 700,
  temperature,
  profile = 'default',
  timeoutMs = Math.max(5000, Number(process.env.EXTERNAL_REQUEST_TIMEOUT_MS) || 20000),
} = {}) {
  const apiKey = getGeminiApiKey(profile);
  if (!apiKey) return null;

  const model = getGeminiModel();
  const request = () => clientFor(apiKey).models.generateContent({
    model,
    contents: prompt,
    config: {
      maxOutputTokens,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(system ? { systemInstruction: system } : {}),
      // Gemini 2.5 "thinking" tokens count against maxOutputTokens; short app replies do not need them.
      ...(/2\.5/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      ...(json || schema ? { responseMimeType: 'application/json' } : {}),
      ...(schema ? { responseJsonSchema: schema } : {}),
      abortSignal: AbortSignal.timeout(timeoutMs),
    },
  });

  let response;
  try {
    response = await request();
  } catch (error) {
    if (!isTransient(error)) throw error;
    await wait(800);
    response = await request();
  }

  const candidateText = (response?.candidates ?? [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === 'string' && !part.thought ? part.text : ''))
    .join('')
    .trim();

  return candidateText || response?.text?.trim() || '';
}
