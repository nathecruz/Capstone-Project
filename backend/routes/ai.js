import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { aiLimiter, habitAdviceLimiter, predictionLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { assistantSchema, goalGenerationSchema, goalPlanSchema, habitAnalysisRequestSchema, habitClassificationSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { buildHabitContext, dateKeyInZone, shiftDay } from '../services/ai-context.js';
import {
  BAD_HABIT_SYSTEM,
  GOAL_PLANNER_SYSTEM,
  badHabitJsonSchema,
  badHabitPrompt,
  buildUserPrompt,
  forAudience,
  cleanAnswer,
  goalPlanJsonSchema,
  goalPlannerPrompt,
  normalizeGoalPlan,
  systemPromptFor,
} from '../services/ai-prompts.js';
import { adviceKey, habitAdviceCache } from '../services/advice-cache.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { forecastFor } from '../services/forecast-rules.js';
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

/**
 * The forecast for one habit: from the ML service when it answers in time, otherwise the same
 * activity-based rules computed here (status 'estimate'), so there is always one to show.
 */
async function mlForecast(signal) {
  const { prediction, source } = await forecastFor(signal, config.ml);
  return { ml: mlSummary(prediction), status: source === 'ml' ? 'ready' : 'estimate' };
}

/** Runs the soft AI-advice limiter for this request; true when the student is over it. */
function overAdviceLimit(request, response) {
  return new Promise((resolve, reject) => {
    habitAdviceLimiter(request, response, (error) => (error ? reject(error) : resolve(Boolean(request.aiLimited))));
  });
}

function logAiError(feature, error) {
  console.error(`[ai] ${feature} failed: ${error?.status ?? error?.name ?? ''} ${String(error?.message ?? error).slice(0, 200)}`.trim());
}

/** The AI's advice for one habit (two tries for valid JSON), or null when it cannot give any. */
async function writeHabitAdvice(stats, ml, role) {
  try {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const text = await generateAiText(habitAnalysisPrompt(stats, ml), { system: forAudience(HABIT_ANALYSIS_SYSTEM, role), schema: habitAnalysisJsonSchema, maxOutputTokens: 700, temperature: 0.5 });
      try {
        const parsed = habitAnalysisSchema.safeParse(JSON.parse(text));
        if (parsed.success) return parsed.data;
      } catch {
        // Not JSON: try once more.
      }
    }
  } catch (error) {
    logAiError('habit analysis', error);
  }
  return null;
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
  // The forecast and check-in facts are cheap and always answered; only new AI advice is limited.
  app.post('/api/insights/habit-analysis', predictionLimiter, async (request, response) => {
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
    const { ml, status: mlStatus } = await mlForecast(mlSignal(stats));

    // The same habit, facts and forecast on the same day get the advice already written.
    const cacheKey = adviceKey(session.userId, input.habitId, { day: dateKeyInZone(new Date(), timeZone), role: session.role, stats, ml });
    // aiStatus: 'ready', 'limited' (over the AI limit for now), 'unavailable' (the AI failed) or 'off' (not configured).
    let ai = habitAdviceCache.get(cacheKey);
    let aiStatus = ai ? 'ready' : 'off';
    if (!ai && isAiConfigured()) {
      if (await overAdviceLimit(request, response)) {
        aiStatus = 'limited';
      } else {
        ai = await writeHabitAdvice(stats, ml, session.role);
        aiStatus = ai ? 'ready' : 'unavailable';
        if (ai) habitAdviceCache.set(cacheKey, ai);
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
      mlStatus,
      ai,
      aiStatus,
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
        // An impossible, fantastical or nonsensical goal gets no plan, just a short reason.
        if (raw?.isAchievable === false) {
          const feedback = (typeof raw.feedback === 'string' && raw.feedback.trim()) || 'That does not look like a goal we can plan for. Try a real, achievable goal.';
          return response.status(422).json({ ok: false, code: 'UNACHIEVABLE_GOAL', error: feedback.slice(0, 300), message: feedback.slice(0, 300) });
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

  // Classifies a habit the student is about to add as healthy or a bad habit (harmful to daily
  // life or productivity). The app falls back to its own keyword check when this is unavailable.
  app.post('/api/habit/classify', predictionLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    if (!isAiConfigured()) return response.status(503).json({ ok: false, error: 'The AI service is not configured on the server.' });
    const input = parse(habitClassificationSchema, request, response);
    if (!input) return;

    try {
      const text = await generateAiText(badHabitPrompt(input.name), { system: BAD_HABIT_SYSTEM, schema: badHabitJsonSchema, maxOutputTokens: 200, temperature: 0 });
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        return response.status(502).json({ ok: false, error: 'The AI returned an invalid classification. Please try again.' });
      }
      const reason = typeof raw?.reason === 'string' ? raw.reason.trim().slice(0, 300) : '';
      const isHabit = raw?.isHabit !== false;
      response.json({ ok: true, isHabit, isBadHabit: isHabit && raw?.isBadHabit === true, reason });
    } catch (error) {
      logAiError('habit classification', error);
      response.status(502).json({ ok: false, error: 'The AI classifier is temporarily unavailable.' });
    }
  });
}
