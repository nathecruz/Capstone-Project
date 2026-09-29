import { GoogleGenAI } from '@google/genai';

export const geminiModel = process.env.GEMINI_MODEL?.trim() || 'gemini-2.5-flash';

const createGeminiClient = () => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey.startsWith('replace-with-')) {
    return null;
  }

  return new GoogleGenAI({ apiKey });
};

export const gemini = createGeminiClient();

export async function generateGeminiText(prompt, { json = false, maxOutputTokens = 700 } = {}) {
  const geminiClient = createGeminiClient();
  if (!geminiClient) return null;

  const response = await geminiClient.models.generateContent({
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
