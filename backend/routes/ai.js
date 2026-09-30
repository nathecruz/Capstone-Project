import { query } from '../db/client.js';
import { aiLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { assistantSchema, goalGenerationSchema, goalPlanSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { buildHabitContext, dateKeyInZone } from '../services/ai-context.js';
import {
  GOAL_PLANNER_SYSTEM,
  buildUserPrompt,
  cleanAnswer,
  goalPlanJsonSchema,
  goalPlannerPrompt,
  normalizeGoalPlan,
  systemPromptFor,
} from '../services/ai-prompts.js';
import { generateGeminiText, isGeminiConfigured } from '../services/gemini.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';

/** The student's habits, last 4 weeks of check-ins and goals, read from the database. */
export async function loadAiContext(userId, timeZone = DEFAULT_TIME_ZONE) {
  const today = dateKeyInZone(new Date(), timeZone);
  const [habits, completions, goals] = await Promise.all([
    query('SELECT id, label, category, meta, streak, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime" FROM habits WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    query("SELECT habit_id AS \"habitId\", completed_date::text AS date FROM habit_completions WHERE user_id=$1 AND completed_date >= ($2::date - 27)", [userId, today]),
    query('SELECT title, category, progress, status, details_json AS details FROM goals WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 5', [userId]),
  ]);
  return buildHabitContext({
    habits: habits.rows.map((habit) => ({ ...habit, id: String(habit.id).replace(`${userId}:habit:`, '') })),
    completions: completions.rows,
    goals: goals.rows,
    timeZone,
  });
}

function logAiError(feature, error) {
  console.error(`[ai] ${feature} failed: ${error?.status ?? error?.name ?? ''} ${String(error?.message ?? error).slice(0, 200)}`.trim());
}

export default function registerAiRoutes(app) {
  app.post('/api/insights/assistant', aiLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(assistantSchema, request, response);
    if (!input) return;
    const mode = input.mode;
    if (!isGeminiConfigured(mode)) return response.status(503).json({ ok: false, error: 'Gemini AI service is not configured on the server.' });

    try {
      const context = mode === 'support'
        ? { app: 'HabitAI', studentFirstName: String(session.fullName || '').split(/\s+/)[0] }
        : await loadAiContext(session.userId, input.timeZone || DEFAULT_TIME_ZONE);
      const text = await generateGeminiText(buildUserPrompt({ question: input.question, context }), {
        system: systemPromptFor(mode),
        maxOutputTokens: 400,
        temperature: 0.6,
        profile: mode,
      });
      const answer = cleanAnswer(text);
      if (!answer) return response.status(502).json({ ok: false, error: 'The AI service returned an empty response.' });
      response.json({ ok: true, answer, mode });
    } catch (error) {
      logAiError(mode, error);
      response.status(502).json({ ok: false, error: 'The AI service is temporarily unavailable.' });
    }
  });

  app.post('/api/goals/generate', aiLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    if (!isGeminiConfigured('goals')) return response.status(503).json({ ok: false, error: 'Gemini AI service is not configured on the server.' });
    const input = parse(goalGenerationSchema, request, response);
    if (!input) return;
    const timeline = input.timeline || '30-60 days';
    const prompt = goalPlannerPrompt({ goal: input.goal, focusTarget: input.focusTarget || '4 habits', timeline });

    try {
      // Structured output makes invalid plans rare; one retry covers truncated responses.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await generateGeminiText(prompt, { system: GOAL_PLANNER_SYSTEM, schema: goalPlanJsonSchema, maxOutputTokens: 1200, temperature: 0.7, profile: 'goals' });
        let raw;
        try {
          raw = JSON.parse(text);
        } catch {
          continue;
        }
        const plan = goalPlanSchema.safeParse(normalizeGoalPlan(raw, { timeline, timeZone: input.timeZone || DEFAULT_TIME_ZONE }));
        if (plan.success) return response.json({ ok: true, plan: plan.data });
      }
      response.status(502).json({ ok: false, error: 'The AI goal planner returned an invalid plan. Please try again.' });
    } catch (error) {
      logAiError('goals', error);
      response.status(502).json({ ok: false, error: 'The AI goal planner is temporarily unavailable.' });
    }
  });
}
