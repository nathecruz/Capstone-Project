import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { aiLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { assistantSchema, goalGenerationSchema, goalPlanSchema, habitAnalysisRequestSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { buildHabitContext, dateKeyInZone, shiftDay } from '../services/ai-context.js';
import {
  GOAL_PLANNER_SYSTEM,
  buildUserPrompt,
  forAudience,
  cleanAnswer,
  goalPlanJsonSchema,
  goalPlannerPrompt,
  normalizeGoalPlan,
  systemPromptFor,
} from '../services/ai-prompts.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { HABIT_ANALYSIS_SYSTEM, habitAnalysisJsonSchema, habitAnalysisPrompt, habitAnalysisSchema, habitStats, mlSignal, mlSummary } from '../services/habit-analysis.js';
import { generateAiText, isAiConfigured } from '../services/groq.js';
import { computeStreak, habitFromRow } from '../services/streaks.js';
import { getFrozenDays } from '../services/streak-freeze.js';
import { COACH_TOKEN_COST, getWallet, spendTokens, tokenBalance } from '../services/wallet.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';

/** The student's habits, last 4 weeks of check-ins and goals, read from the database. */
export async function loadAiContext(userId, timeZone = DEFAULT_TIME_ZONE) {
  const today = dateKeyInZone(new Date(), timeZone);
  const [habits, completions, goals] = await Promise.all([
    query('SELECT id, label, category, meta, frequency, start_date, reminder_days, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime" FROM habits WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
    query('SELECT habit_id AS "habitId", completed_date::text AS date FROM habit_completions WHERE user_id=$1', [userId]),
    query('SELECT title, category, progress, status, details_json AS details FROM goals WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 5', [userId]),
  ]);
  const frozenDays = await getFrozenDays({ query }, userId);
  const datesByHabit = new Map();
  for (const completion of completions.rows) {
    if (!datesByHabit.has(completion.habitId)) datesByHabit.set(completion.habitId, []);
    datesByHabit.get(completion.habitId).push(completion.date);
  }
  const recentStart = shiftDay(today, -27);
  return buildHabitContext({
    // The stored streak is only as fresh as the last sync; compute it from check-ins instead.
    habits: habits.rows.map((row) => {
      const id = String(row.id).replace(`${userId}:habit:`, '');
      return { ...row, id, streak: computeStreak(habitFromRow(row), datesByHabit.get(id) || [], today, frozenDays) };
    }),
    completions: completions.rows.filter((completion) => completion.date >= recentStart),
    goals: goals.rows,
    timeZone,
  });
}

/** The ML service's forecast for one habit, or null when it is not configured or not reachable. */
async function mlForecast(signal) {
  if (!config.ml.key) return null;
  try {
    const result = await fetch(`${config.ml.url.replace(/\/$/, '')}/api/predict/habit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ML-Service-Key': config.ml.key },
      body: JSON.stringify(signal),
      // A sleeping ML service takes up to a minute; the analysis should not wait that long.
      signal: AbortSignal.timeout(Math.min(config.ml.timeoutMs, 20_000)),
    });
    return result.ok ? mlSummary(await result.json()) : null;
  } catch {
    return null;
  }
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
    if (!isAiConfigured()) return response.status(503).json({ ok: false, error: 'The AI service is not configured on the server.' });

    // The coach costs tokens: check the balance first, charge only after a real answer.
    if (mode === 'coach' && (await tokenBalance({ query }, session.userId)) < COACH_TOKEN_COST) {
      return response.status(402).json({ ok: false, error: `You need ${COACH_TOKEN_COST} tokens to ask the AI Coach. Complete habits to earn more.` });
    }

    try {
      const context = mode === 'support'
        ? { app: 'HabitAI' } // no personal data is needed to explain the app
        : await loadAiContext(session.userId, input.timeZone || DEFAULT_TIME_ZONE);
      const text = await generateAiText(buildUserPrompt({ question: input.question, context }), {
        system: systemPromptFor(mode, session.role),
        maxOutputTokens: 400,
        temperature: 0.6,
      });
      const answer = cleanAnswer(text);
      if (!answer) return response.status(502).json({ ok: false, error: 'The AI service returned an empty response.' });
      if (mode !== 'coach') return response.json({ ok: true, answer, mode });

      const wallet = await withTransaction(async (db) => {
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
        await spendTokens(db, session.userId, COACH_TOKEN_COST, 'AI Coach');
        await refreshSnapshot(session.userId, db);
        return getWallet(db, session.userId);
      });
      response.json({ ok: true, answer, mode, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory });
    } catch (error) {
      logAiError(mode, error);
      response.status(502).json({ ok: false, error: 'The AI service is temporarily unavailable.' });
    }
  });

  // One habit, analysed: check-in facts from the database, the ML forecast and the AI's advice.
  app.post('/api/insights/habit-analysis', aiLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(habitAnalysisRequestSchema, request, response);
    if (!input) return;
    const timeZone = input.timeZone || DEFAULT_TIME_ZONE;
    const [habitResult, completionResult] = await Promise.all([
      query('SELECT label, category, meta, frequency, start_date, reminder_days, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime" FROM habits WHERE user_id=$1 AND id=$2', [session.userId, `${session.userId}:habit:${input.habitId}`]),
      query('SELECT completed_date::text AS date, completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1 AND habit_id=$2', [session.userId, input.habitId]),
    ]);
    const row = habitResult.rows[0];
    if (!row) return response.status(404).json({ ok: false, error: 'Habit not found.' });
    const habit = { ...habitFromRow(row), label: row.label, category: row.category, reminderEnabled: row.reminderEnabled, reminderTime: row.reminderTime };
    const stats = habitStats({ habit, completions: completionResult.rows, timeZone });
    const ml = await mlForecast(mlSignal(stats));

    let ai = null;
    if (isAiConfigured()) {
      try {
        for (let attempt = 0; attempt < 2 && !ai; attempt += 1) {
          const text = await generateAiText(habitAnalysisPrompt(stats, ml), { system: forAudience(HABIT_ANALYSIS_SYSTEM, session.role), schema: habitAnalysisJsonSchema, maxOutputTokens: 700, temperature: 0.5 });
          try {
            const parsed = habitAnalysisSchema.safeParse(JSON.parse(text));
            if (parsed.success) ai = parsed.data;
          } catch {
            // Not JSON: try once more.
          }
        }
      } catch (error) {
        logAiError('habit analysis', error);
      }
    }

    response.json({
      ok: true,
      habitId: input.habitId,
      stats: {
        completionRate: stats.completionRate,
        scheduledDays: stats.scheduledDays,
        completedDays: stats.completedDays,
        missedDays: stats.missedDays,
        streak: stats.streak,
        strongestWeekday: stats.strongestWeekday,
        weakestWeekday: stats.weakestWeekday,
        usualCheckInTime: stats.usualCheckInTime,
        last7Days: stats.last7Days,
      },
      ml,
      ai,
    });
  });

  app.post('/api/goals/generate', aiLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    if (!isAiConfigured()) return response.status(503).json({ ok: false, error: 'The AI service is not configured on the server.' });
    const input = parse(goalGenerationSchema, request, response);
    if (!input) return;
    const timeline = input.timeline || '30-60 days';
    const prompt = goalPlannerPrompt({ goal: input.goal, focusTarget: input.focusTarget || '4 habits', timeline });

    try {
      // JSON mode plus the schema makes invalid plans rare; one retry covers the rest.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await generateAiText(prompt, { system: forAudience(GOAL_PLANNER_SYSTEM, session.role), schema: goalPlanJsonSchema, maxOutputTokens: 1200, temperature: 0.7 });
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
