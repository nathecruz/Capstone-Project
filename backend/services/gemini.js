import { GoogleGenAI } from '@google/genai';

export const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

const keyByProfile = {
  goals: 'GEMINI_API_KEY_GOALS',
  coach: 'GEMINI_API_KEY_COACH',
  assistant: 'GEMINI_API_KEY_ASSISTANT',
};

const getGeminiApiKey = (profile = 'default') => {
  const profileKey = keyByProfile[profile] ? process.env[keyByProfile[profile]]?.trim() : '';
  const apiKey = profileKey || process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith('replace-with-')) {
    return null;
  }

  return apiKey;
};

export const isGeminiConfigured = (profile = 'default') => Boolean(getGeminiApiKey(profile));

export async function generateGeminiText(prompt, { json = false, maxOutputTokens = 700, profile = 'default' } = {}) {
  const apiKey = getGeminiApiKey(profile);
  if (!apiKey) return null;

  const response = await new GoogleGenAI({ apiKey }).models.generateContent({
    model: geminiModel,
    contents: prompt,
    config: {
      maxOutputTokens,
      thinkingConfig: { thinkingBudget: 0 },
      ...(json ? { responseMimeType: 'application/json' } : {}),
    },
  });

  const candidateText = (response?.candidates ?? [])
    .flatMap((candidate) => candidate?.content?.parts ?? [])
    .map((part) => (typeof part?.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  return candidateText || response?.text?.trim() || '';
}
