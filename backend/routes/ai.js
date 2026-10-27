import { config } from '../config/index.js';
import { query, withTransaction } from '../db/client.js';
import { aiLimiter, habitAdviceLimiter, predictionLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { assistantSchema, goalGenerationSchema, goalPlanSchema, habitAnalysisRequestSchema, habitClassificationSchema } from '../schemas.js';
import { accountStreak } from '../services/account-streak.js';
import { requireAuth } from '../services/accounts.js';
import { buildHabitContext, dateKeyInZone, shiftDay } from '../services/ai-context.js';
import {
  BAD_HABIT_SYSTEM,
  DEFAULT_HABIT_CATEGORIES,
  GOAL_PLANNER_SYSTEM,
  assistantContext,
  badHabitJsonSchema,
  badHabitPrompt,
  buildUserPrompt,
  forAudience,
  cleanAnswer,
  goalPlanJsonSchemaFor,
  goalPlannerPrompt,
  normalizeGoalPlan,
  plannedHabitCount,
  systemPromptFor,
} from '../services/ai-prompts.js';
import { adviceKey, habitAdviceCache } from '../services/advice-cache.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { forecastFor } from '../services/forecast-rules.js';
import { HABIT_ANALYSIS_SYSTEM, habitAnalysisJsonSchema, habitAnalysisPrompt, habitAnalysisSchema, habitStats, mlSignal, mlSummary } from '../services/habit-analysis.js';
import { generateAiText, isAiConfigured } from '../services/groq.js';
import { loadPlannerCategories, loadPlannerHistory } from '../services/planner-history.js';
import { computeStreak, habitFromRow } from '../services/streaks.js';
import { getFrozenDays } from '../services/streak-freeze.js';
import { COACH_TOKEN_COST, getWallet, refundCoachAnswer, spendTokens } from '../services/wallet.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';

/**
 * The student's habits (each with its last active day, `activeUntil`: habits last one week), last
 * 4 weeks of check-ins and goals, read from the database.
 */
export async function loadAiContext(userId, timeZone = DEFAULT_TIME_ZONE) {
  const today = dateKeyInZone(new Date(), timeZone);
  const [habits, completions, goals] = await Promise.all([
    query('SELECT id, label, category, meta, frequency, start_date, reminder_days, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime", active_until AS "activeUntil" FROM habits WHERE user_id=$1 ORDER BY sort_order, id', [userId]),
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
  const habitRows = habits.rows.map((row) => ({ row, id: String(row.id).replace(`${userId}:habit:`, '') }));
  return buildHabitContext({
    // The stored streak is only as fresh as the last sync; compute it from check-ins instead.
    habits: habitRows.map(({ row, id }) => ({ ...row, id, streak: computeStreak(habitFromRow(row), datesByHabit.get(id) || [], today, frozenDays) })),
    completions: completions.rows.filter((completion) => completion.date >= recentStart),
    goals: goals.rows,
    timeZone,
    // The account streak needs every check-in, not only the last 4 weeks' (services/account-streak.js).
    accountStreakDays: accountStreak(habitRows.map(({ row, id }) => ({ ...habitFromRow(row), completionDates: datesByHabit.get(id) || [] })), today, frozenDays),
    frozenDays,
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

/**
 * What the coach knows beyond the assistant: the planner's history of the last 4 weeks, with
 * forecasts (all of them wait at most PLANNER_FORECAST_CAP_MS). Without it the coach still answers.
 */
function coachHistory(userId, timeZone) {
  return loadPlannerHistory({ query }, userId, timeZone, { ml: config.ml }).catch((error) => {
    logAiError('coach history', error);
    return null;
  });
}

/** Charges an AI Coach answer under the account lock, so two questions at once cannot both use the same tokens. */
function chargeCoach(userId) {
  return withTransaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    return spendTokens(db, userId, COACH_TOKEN_COST, 'AI Coach answer', { kind: 'coach' });
  });
}

/** After an answer (or its refund), the new balance on every device: a fresh snapshot and the wallet. */
function coachWallet(userId, refundOf = null) {
  return withTransaction(async (db) => {
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
    if (refundOf) await refundCoachAnswer(db, userId, refundOf);
    await refreshSnapshot(userId, db);
    return getWallet(db, userId);
  });
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

    // The coach costs tokens: charged before the AI is asked, and given back when no answer comes.
    const charge = mode === 'coach' ? await chargeCoach(session.userId) : null;
    if (charge && !charge.ok) {
      return response.status(402).json({ ok: false, error: `You need ${COACH_TOKEN_COST} tokens to ask the AI Coach. Complete habits to earn more.` });
    }

    let answer = '';
    let failed = false;
    try {
      const timeZone = input.timeZone || DEFAULT_TIME_ZONE;
      const [context, history] = mode === 'support'
        ? [{ app: 'HabitAI' }, null] // no personal data is needed to explain the app
        : await Promise.all([loadAiContext(session.userId, timeZone), mode === 'coach' ? coachHistory(session.userId, timeZone) : null]);
      const text = await generateAiText(buildUserPrompt({ question: input.question, context: assistantContext(mode, context, history) }), {
        system: systemPromptFor(mode, session.role),
        maxOutputTokens: 800,
        temperature: 0.6,
      });
      answer = cleanAnswer(text);
    } catch (error) {
      logAiError(mode, error);
      failed = true;
    }

    if (charge && !answer) {
      const wallet = await coachWallet(session.userId, charge.id);
      return response.status(502).json({ ok: false, error: 'The AI service is temporarily unavailable.', refunded: true, tokens: wallet.tokens });
    }
    if (failed) return response.status(502).json({ ok: false, error: 'The AI service is temporarily unavailable.' });
    if (!answer) return response.status(502).json({ ok: false, error: 'The AI service returned an empty response.' });
    if (!charge) return response.json({ ok: true, answer, mode });

    const wallet = await coachWallet(session.userId);
    response.json({ ok: true, answer, mode, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory });
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
      query('SELECT label, category, meta, frequency, start_date, active_until, reminder_days, reminder_enabled AS "reminderEnabled", reminder_time AS "reminderTime" FROM habits WHERE user_id=$1 AND id=$2', [session.userId, `${session.userId}:habit:${input.habitId}`]),
      query('SELECT completed_date::text AS date, completed_at AS "completedAt" FROM habit_completions WHERE user_id=$1 AND habit_id=$2', [session.userId, input.habitId]),
    ]);
    const row = habitResult.rows[0];
    if (!row) return response.status(404).json({ ok: false, error: 'Habit not found.' });
    // habitFromRow carries activeUntil: an ended habit's facts stop at its last day.
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

  // Plans a goal and this week's habits from the student's history (the habits of the last 4 weeks,
  // how they went, the ML forecasts and the account streak), so the app can add them in one step.
  app.post('/api/goals/generate', aiLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    if (!isAiConfigured()) return response.status(503).json({ ok: false, error: 'The AI service is not configured on the server.' });
    const input = parse(goalGenerationSchema, request, response);
    if (!input) return;
    const timeline = input.timeline || '30-60 days';
    const focusTarget = input.focusTarget || '4 habits';
    const timeZone = input.timeZone || DEFAULT_TIME_ZONE;
    const habitCount = plannedHabitCount(focusTarget);
    // Without the history (it could not be read) the plan comes from the goal text alone.
    const [history, categories] = await Promise.all([
      loadPlannerHistory({ query }, session.userId, timeZone, { ml: config.ml }).catch((error) => {
        logAiError('goal planner history', error);
        return null;
      }),
      loadPlannerCategories({ query }).catch((error) => {
        logAiError('goal planner categories', error);
        return [...DEFAULT_HABIT_CATEGORIES];
      }),
    ]);
    const prompt = goalPlannerPrompt({ goal: input.goal, focusTarget, timeline, habitCount, history });
    const schema = goalPlanJsonSchemaFor({ habitCount, categories });
    const normalizeOptions = { timeline, timeZone, habitCount, categories, currentHabitNames: history?.currentHabitNames ?? [] };

    try {
      // JSON mode plus the schema makes invalid plans rare; one retry covers the rest. A plan whose
      // habits were all unusable is retried too, and is only sent (with habitSuggestions) when the
      // retry fails.
      let planWithoutHabits = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const text = await generateAiText(prompt, { system: forAudience(GOAL_PLANNER_SYSTEM, session.role), schema, maxOutputTokens: 1800, temperature: 0.7 });
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
        const plan = goalPlanSchema.safeParse(normalizeGoalPlan(raw, normalizeOptions));
        if (plan.success && plan.data.habits?.length) return response.json({ ok: true, plan: plan.data });
        if (plan.success) planWithoutHabits = plan.data;
      }
      if (planWithoutHabits) return response.json({ ok: true, plan: planWithoutHabits });
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
      const text = await generateAiText(badHabitPrompt(input.name, { category: input.category, categories: input.categories }), { system: BAD_HABIT_SYSTEM, schema: badHabitJsonSchema, maxOutputTokens: 200, temperature: 0 });
      let raw;
      try {
        raw = JSON.parse(text);
      } catch {
        return response.status(502).json({ ok: false, error: 'The AI returned an invalid classification. Please try again.' });
      }
      const reason = typeof raw?.reason === 'string' ? raw.reason.trim().slice(0, 300) : '';
      const isHabit = raw?.isHabit !== false;
      const suggestedCategory = typeof raw?.suggestedCategory === 'string' ? raw.suggestedCategory.trim().slice(0, 60) : '';
      // Only judge the category for a genuine, non-bad habit; a clear mismatch needs an explicit false.
      const categoryFits = !isHabit || raw?.isBadHabit === true || !input.category || raw?.categoryFits !== false;
      response.json({ ok: true, isHabit, isBadHabit: isHabit && raw?.isBadHabit === true, categoryFits, suggestedCategory, reason });
    } catch (error) {
      logAiError('habit classification', error);
      response.status(502).json({ ok: false, error: 'The AI classifier is temporarily unavailable.' });
    }
  });
}
