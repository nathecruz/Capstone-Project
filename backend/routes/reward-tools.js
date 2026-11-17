// The Rewards Shop's made rewards (services/reward-tools.js). Redeeming one charges its tokens under
// the account lock, then makes it: the AI writes a plan, a quiz or a report, or the account's
// check-ins make a certificate. When it cannot be made, the tokens come back. What was made is kept
// in the account's My Rewards (reward_items) until it is deleted; a certificate's public page shows
// only while it is kept.
import crypto from 'node:crypto';
import { query, withTransaction } from '../db/client.js';
import { certificateLimiter, walletLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { rewardUseSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { dateKeyInZone } from '../services/ai-context.js';
import { forAudience, forLanguage } from '../services/ai-prompts.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { generateAiText, isAiConfigured } from '../services/groq.js';
import {
  AI_MADE_REWARDS,
  MAX_DUE_DAYS,
  PRACTICE_QUIZ_SYSTEM,
  STUDY_PLANNER_SYSTEM,
  WEEKLY_REPORT_SYSTEM,
  certificateCode,
  certificateHtml,
  certificateNotFoundHtml,
  certificateStats,
  planDays,
  practiceQuizJsonSchema,
  practiceQuizPrompt,
  readPracticeQuiz,
  readStudyPlan,
  readWeeklyReport,
  shiftDate,
  studyPlannerJsonSchema,
  studyPlannerPrompt,
  weeklyReportJsonSchema,
  weeklyReportPrompt,
} from '../services/reward-tools.js';
import { MADE_REWARDS } from '../services/rewards.js';
import { getWallet, refundSpend, spendTokens } from '../services/wallet.js';
import { loadAiContext, loadSavedState } from './ai.js';

const DEFAULT_TIME_ZONE = 'Asia/Manila';
/** How many made rewards My Rewards lists, newest first. */
const ITEMS_LISTED = 40;

function logError(feature, error) {
  console.error(`[rewards] ${feature} failed: ${error?.status ?? error?.name ?? ''} ${String(error?.message ?? error).slice(0, 200)}`.trim());
}

/** Where a certificate's public page is: on this API, as the app reaches it. */
function certificateUrl(request, code) {
  const base = (process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '') || `${request.protocol}://${request.get('host')}`;
  return `${base}/certificates/${code}`;
}

/** A made reward as the app gets it. */
function itemView(request, row) {
  return {
    id: row.id,
    rewardId: row.rewardId,
    title: row.title,
    createdAt: Number(row.createdAt),
    output: row.output,
    ...(row.code ? { code: row.code, url: certificateUrl(request, row.code) } : {}),
  };
}

/** Asks the AI twice at most for JSON its reader accepts; null when it gives none. */
async function writeWithAi(prompt, { system, schema, maxOutputTokens, read }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = read(await generateAiText(prompt, { system, schema, maxOutputTokens, temperature: 0.4 }));
    if (result) return result;
  }
  return null;
}

/**
 * Makes the reward. Returns { output, title } once made, { refused } when the AI says the input
 * cannot be used (a quiz topic that is not one), or null when it could not be made.
 */
async function makeReward(rewardId, input, { session, today, timeZone }) {
  const saved = await loadSavedState(session.userId).catch(() => ({ language: null, reminderTimes: new Map() }));
  const instructions = (system) => forLanguage(forAudience(system, session.role), saved.language);
  if (rewardId === 'study-planner') {
    const plan = await writeWithAi(studyPlannerPrompt({ ...input, today }), {
      system: instructions(STUDY_PLANNER_SYSTEM),
      schema: studyPlannerJsonSchema(planDays(today, input.dueDate).length),
      maxOutputTokens: 1400,
      read: (text) => readStudyPlan(text, { ...input, today }),
    });
    return plan && { output: plan, title: plan.title };
  }
  if (rewardId === 'practice-quiz') {
    const quiz = await writeWithAi(practiceQuizPrompt(input.topic), {
      system: instructions(PRACTICE_QUIZ_SYSTEM),
      schema: practiceQuizJsonSchema,
      maxOutputTokens: 1600,
      read: (text) => readPracticeQuiz(text, input.topic),
    });
    if (quiz?.valid === false) return { refused: quiz.reason };
    return quiz && { output: quiz.quiz, title: quiz.quiz.title };
  }
  if (rewardId === 'weekly-report') {
    const context = await loadAiContext(session.userId, timeZone, saved);
    const report = await writeWithAi(weeklyReportPrompt(context), {
      system: instructions(WEEKLY_REPORT_SYSTEM),
      schema: weeklyReportJsonSchema,
      maxOutputTokens: 1000,
      read: (text) => readWeeklyReport(text, today),
    });
    return report && { output: report, title: `Week ending ${today}` };
  }
  // The certificate: the record, the streak on the day it is issued, and its code.
  const [stats, context] = await Promise.all([certificateStats({ query }, session.userId), loadAiContext(session.userId, timeZone, saved)]);
  return { output: { ...stats, streak: context.summary.accountStreakDays, issuedOn: today }, title: `Certificate of Achievement · ${today}`, code: certificateCode() };
}

export default function registerRewardToolRoutes(app) {
  // Redeems a made reward: charged first, made, then kept in My Rewards; given back when it cannot be made.
  app.post('/api/rewards/use', walletLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(rewardUseSchema, request, response);
    if (!input) return;
    const { rewardId, timeZone: requestedZone, ...details } = input;
    const reward = (await query('SELECT id, name, token_cost AS "cost" FROM rewards WHERE id=$1 AND active', [rewardId])).rows[0];
    if (!reward || !MADE_REWARDS.has(reward.id)) return response.status(400).json({ ok: false, message: 'This reward is not available.' });
    const cost = Number(reward.cost);
    const timeZone = requestedZone || DEFAULT_TIME_ZONE;
    const today = dateKeyInZone(new Date(), timeZone);

    // Nothing is charged for what cannot be made.
    if (AI_MADE_REWARDS.includes(reward.id) && !isAiConfigured()) return response.status(503).json({ ok: false, message: 'The AI service is not configured on the server.' });
    if (reward.id === 'study-planner' && (details.dueDate < today || details.dueDate > shiftDate(today, MAX_DUE_DAYS))) {
      return response.status(400).json({ ok: false, message: `Choose a due date from today to ${MAX_DUE_DAYS} days from now.` });
    }
    if (reward.id === 'certificate' && !(await certificateStats({ query }, session.userId)).checkIns) {
      return response.status(409).json({ ok: false, message: 'A certificate shows your check-ins: check in a habit first.' });
    }

    const charge = await withTransaction(async (db) => {
      await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
      return spendTokens(db, session.userId, cost, `Redeemed ${reward.name}`, { kind: 'reward' });
    });
    if (!charge.ok) return response.status(402).json({ ok: false, message: `${reward.name} costs ${cost} tokens and you have ${Math.max(0, charge.balance)}. Check in your habits to earn more.` });

    let made = null;
    try {
      made = await makeReward(reward.id, details, { session, today, timeZone });
    } catch (error) {
      logError(reward.id, error);
    }

    if (!made?.output) {
      const wallet = await withTransaction(async (db) => {
        await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [session.userId]);
        await refundSpend(db, session.userId, charge.id, cost, `Refund: ${reward.name} could not be made`);
        await refreshSnapshot(session.userId, db);
        return getWallet(db, session.userId);
      });
      const message = made?.refused
        ? `${made.refused} Your ${cost} tokens were returned.`
        : `${reward.name} is unavailable right now. Your ${cost} tokens were returned.`;
      return response.status(made?.refused ? 422 : 502).json({ ok: false, message, refunded: true, tokens: wallet.tokens, tokenHistory: wallet.tokenHistory });
    }

    const row = { id: crypto.randomUUID(), rewardId: reward.id, title: made.title, output: made.output, code: made.code ?? null, createdAt: Date.now() };
    const wallet = await withTransaction(async (db) => {
      await db.query(
        'INSERT INTO reward_items(id,user_id,reward_id,title,input_json,output_json,code,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [row.id, session.userId, row.rewardId, row.title, details, row.output, row.code, row.createdAt],
      );
      await refreshSnapshot(session.userId, db);
      return getWallet(db, session.userId);
    });
    response.json({ ok: true, item: itemView(request, row), tokens: wallet.tokens, tokenHistory: wallet.tokenHistory });
  });

  // My Rewards: what the account's made rewards produced, newest first.
  app.get('/api/rewards/items', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const rows = await query(
      `SELECT id, reward_id AS "rewardId", title, output_json AS output, code, created_at AS "createdAt"
         FROM reward_items WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [session.userId, ITEMS_LISTED],
    );
    response.json({ ok: true, items: rows.rows.map((row) => itemView(request, row)) });
  });

  // Deletes a made reward; a deleted certificate's page no longer opens.
  app.delete('/api/rewards/items/:id', async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const deleted = await query('DELETE FROM reward_items WHERE id=$1 AND user_id=$2', [String(request.params.id).slice(0, 80), session.userId]);
    if (!deleted.rowCount) return response.status(404).json({ ok: false, message: 'Not found.' });
    response.json({ ok: true });
  });

  // A certificate's public page: anyone with its link can open it, to check it or print it.
  app.get('/certificates/:code', certificateLimiter, async (request, response) => {
    const code = String(request.params.code ?? '').toUpperCase();
    const row = /^[A-Z0-9]{10}$/.test(code)
      ? (await query("SELECT code, output_json AS output FROM reward_items WHERE code=$1 AND reward_id='certificate'", [code])).rows[0]
      : null;
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Robots-Tag', 'noindex, nofollow');
    response.status(row ? 200 : 404).type('html').send(row ? certificateHtml(row) : certificateNotFoundHtml());
  });
}
