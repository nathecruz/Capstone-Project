import { config } from '../config/index.js';
import { query } from '../db/client.js';
import { predictionLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { habitPredictionSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';

export default function registerHabitRoutes(app) {
  // System-wide habit categories managed from the Admin Panel. Clients fall back to their built-in list when this is empty.
  app.get('/api/habit-categories', async (_request, response) => {
    try {
      const result = await query('SELECT id, label, icon, color, description FROM habit_categories WHERE is_active ORDER BY sort_order, label');
      response.json({ ok: true, categories: result.rows });
    } catch (error) {
      if (error?.code === '42P01') return response.json({ ok: true, categories: [] });
      throw error;
    }
  });

  // Proxies to the Python ML service, which holds the service key.
  app.post('/api/habit/predict', predictionLimiter, async (request, response) => {
    if (!(await requireAuth(request, response))) return;
    if (!config.ml.key) return response.status(503).json({ error: 'Live prediction service unavailable.' });
    const parsed = parse(habitPredictionSchema, request, response);
    if (!parsed) return;
    const habitName = parsed.habit_name || parsed.name || '';
    if (!habitName) return response.status(400).json({ error: 'habit_name is required.' });
    const payload = {
      habit_name: habitName,
      streak: parsed.streak ?? 0,
      completion_rate: parsed.completion_rate ?? 0,
      missed_days: parsed.missed_days ?? 0,
      last_7_days: parsed.last_7_days ?? [1, 1, 0, 1, 1, 0, 1],
      average_session_minutes: parsed.average_session_minutes,
      priority: parsed.priority || 'balanced',
      goal_type: parsed.goal_type || 'health',
    };
    try {
      const result = await fetch(`${config.ml.url.replace(/\/$/, '')}/api/predict/habit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ML-Service-Key': config.ml.key },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(config.ml.timeoutMs),
      });
      if (!result.ok) throw new Error('ML service returned a non-OK response.');
      response.json(await result.json());
    } catch {
      response.status(503).json({ error: 'Live prediction service unavailable.' });
    }
  });
}
