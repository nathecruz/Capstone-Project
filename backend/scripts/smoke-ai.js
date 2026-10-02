import { loadEnvironment } from '../config/env.js';

loadEnvironment();

const { generateGeminiText, getGeminiModel, isGeminiConfigured } = await import('../services/gemini.js');

if (!isGeminiConfigured()) {
  console.error('Gemini smoke test failed: set a real GEMINI_API_KEY (from Google AI Studio) in backend/.env or the root .env.');
  process.exit(1);
}

try {
  const result = await generateGeminiText('Reply with exactly: HabitAI smoke test passed.', { maxOutputTokens: 24 });
  if (!result) throw new Error('The model returned an empty response.');
  console.log(`Gemini smoke test passed using ${getGeminiModel()}.`);
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? ` (HTTP ${error.status})` : '';
  console.error(`Gemini smoke test failed${status}. Check the key, model name, and provider access.`);
  process.exit(1);
}
