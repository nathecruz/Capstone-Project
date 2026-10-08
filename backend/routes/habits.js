import { config } from '../config/index.js';
import { query } from '../db/client.js';
import { predictionLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { habitPredictionSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { forecastFor } from '../services/forecast-rules.js';

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

  // Proxies to the Python ML service, which holds the service key. While it is asleep (or not
  // configured) the same activity-based rules answer here, labelled as a fallback.
  app.post('/api/habit/predict', predictionLimiter, async (request, response) => {
    if (!(await requireAuth(request, response))) return;
    const parsed = parse(habitPredictionSchema, request, response);
    if (!parsed) return;
    const habitName = parsed.habit_name || parsed.name || '';
    if (!habitName) return response.status(400).json({ error: 'habit_name is required.' });
    const lowerHabitName = habitName.toLowerCase();
    const isBadHabit = /(smoke|smoking|vape|nicotine|cigarette|skip workout|skip exercise|sleep late|stay up late|doomscroll|scroll all night|binge watch|video games all day|skip meals|junk food|procrastinate|skip assignments|skip class|delay study)/i.test(lowerHabitName);
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
    const { prediction } = await forecastFor(payload, config.ml);
    response.json({
      ...prediction,
      is_bad_habit: isBadHabit,
      bad_habit_reason: isBadHabit ? 'This habit looks like a bad habit because it reflects unhealthy or avoidant routines.' : undefined,
    });
  });
}
