import { loadEnvironment } from '../config/env.js';

loadEnvironment();

const { generateAiText, getAiModel, isAiConfigured } = await import('../services/groq.js');

if (!isAiConfigured()) {
  console.error('AI smoke test failed: set a real GROQ_API_KEY (from console.groq.com) in backend/.env or the root .env.');
  process.exit(1);
}

try {
  const result = await generateAiText('Reply with exactly: HabitAI smoke test passed.', { maxOutputTokens: 24 });
  if (!result) throw new Error('The model returned an empty response.');
  console.log(`AI smoke test passed using Groq ${getAiModel()}.`);
} catch (error) {
  const status = error && typeof error === 'object' && 'status' in error ? ` (HTTP ${error.status})` : '';
  console.error(`AI smoke test failed${status}. Check the key, model name, and provider access.`);
  process.exit(1);
}
