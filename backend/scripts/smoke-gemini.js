import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDirectory = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
dotenv.config({ path: path.join(backendDirectory, '.env'), override: true });

if (!process.env.GEMINI_API_KEY) {
  console.error('Gemini smoke test failed: GEMINI_API_KEY is not configured.');
  process.exit(1);
}

const { generateGeminiText, geminiModel } = await import('../services/gemini.js');

try {
  const result = await generateGeminiText('Reply with exactly: HabitMind AI smoke test passed.', { maxOutputTokens: 24 });
  if (!result) throw new Error('The model returned an empty response.');
  console.log(`Gemini smoke test passed using ${geminiModel}.`);
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? ` (HTTP ${error.status})` : '';
  console.error(`Gemini smoke test failed${status}. Check the key, model name, and provider access.`);
  process.exit(1);
}
