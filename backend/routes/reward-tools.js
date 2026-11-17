// The Rewards Shop's made rewards (services/reward-tools.js). Redeeming one charges its tokens under
// the account lock, then makes it: the AI writes a plan, a quiz or a report, or the account's
// check-ins make a certificate. When it cannot be made, the tokens come back. What was made is kept
// in the account's My Rewards (reward_items) until it is deleted; a certificate's public page shows
// only while it is kept.
import crypto from 'node:crypto';
import path from 'node:path';
import multer from 'multer';
import { query, withTransaction } from '../db/client.js';
import { certificateLimiter, essayCheckLimiter, quizSourceLimiter, walletLimiter } from '../http/rate-limits.js';
import { parse } from '../lib/http.js';
import { essayCheckSchema, quizLinkSchema, rewardUseSchema } from '../schemas.js';
import { requireAuth } from '../services/accounts.js';
import { dateKeyInZone } from '../services/ai-context.js';
import { forAudience, forLanguage } from '../services/ai-prompts.js';
import { refreshSnapshot } from '../services/app-state-store.js';
import { generateAiText, isAiConfigured, transcribeAudio } from '../services/groq.js';
import {
  DOCUMENT_BYTES,
  RECORDING_BYTES,
  SourceError,
  SOURCE_WORDS,
  clipWords,
  fileKind,
  isRecordingKind,
  readLink,
  textFromDocument,
  wordsOf,
} from '../services/quiz-sources.js';
import {
  AI_MADE_REWARDS,
  ESSAY_CHECK_SYSTEM,
  MAX_DUE_DAYS,
  PRACTICE_QUIZ_SYSTEM,
  STUDY_PLANNER_SYSTEM,
  WEEKLY_REPORT_SYSTEM,
  certificateCode,
  certificateHtml,
  certificateNotFoundHtml,
  certificateStats,
  essayCheckJsonSchema,
  essayCheckPrompt,
  planDays,
  practiceQuizJsonSchema,
  practiceQuizPrompt,
  quizRequest,
  readEssayCheck,
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
// A file for a quiz is read in memory, never written to disk; a recording may be the biggest.
const quizFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: RECORDING_BYTES, files: 1, fields: 2, parts: 4 } }).single('file');
const MIN_SOURCE_WORDS = 20;
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

/**
 * Asks the AI twice at most for JSON its reader accepts; null when it gives none. Both tries end
 * within `budgetMs`, before the app stops waiting (75 s): a second try needs 15 s left.
 */
async function writeWithAi(prompt, { system, schema, maxOutputTokens, read, budgetMs = 65_000, attemptMs = 40_000, timeoutMs }) {
  const deadline = Date.now() + budgetMs;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const remaining = deadline - Date.now();
    if (attempt > 0 && remaining < 15_000) break;
    const budget = Math.min(attemptMs, remaining);
    const result = read(await generateAiText(prompt, { system, schema, maxOutputTokens, temperature: 0.4, budgetMs: budget, ...(timeoutMs ? { timeoutMs: Math.min(timeoutMs, budget) } : {}) }));
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
    const request = quizRequest(input);
    // A long quiz takes a while to write: one try can use most of the time.
    const quiz = await writeWithAi(practiceQuizPrompt(request), {
      system: instructions(PRACTICE_QUIZ_SYSTEM),
      schema: practiceQuizJsonSchema(request.plan.total),
      maxOutputTokens: request.plan.total * 190 + 500,
      read: (text) => readPracticeQuiz(text, request),
      attemptMs: 55_000,
      timeoutMs: 55_000,
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
    if (reward.id === 'practice-quiz' && !details.topic && !details.source) {
      return response.status(400).json({ ok: false, message: 'Add a topic, notes, a file, a link or a recording first.' });
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

  // The quiz maker reads a file (PDF, DOCX, PPTX), a recording (MP3, MP4, M4A, WAV) or a link, and
  // answers with its text (at most SOURCE_WORDS words) for the student to check before the quiz is
  // made. Nothing is charged and nothing is kept: the file is read in memory.
  app.post('/api/rewards/quiz-source', quizSourceLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const answer = (kind, name, text) => response.json({ ok: true, source: { kind, name, ...clipWords(text, SOURCE_WORDS) } });
    try {
      if (!request.is('multipart/form-data')) {
        const input = parse(quizLinkSchema, request, response);
        if (!input) return;
        const page = await readLink(input.url);
        if (wordsOf(page.text) < MIN_SOURCE_WORDS) throw new SourceError('This page has too little text for a quiz. Try another page, or paste the text.');
        return answer('link', page.name, page.text);
      }

      const uploaded = await new Promise((resolve) => {
        quizFileUpload(request, response, (error) => resolve(error ? { error } : { file: request.file }));
      });
      if (uploaded.error?.code === 'LIMIT_FILE_SIZE') throw new SourceError('This file is over 25 MB. Choose a smaller one.', 413);
      if (uploaded.error || !uploaded.file) throw new SourceError(uploaded.error ? 'The file could not be uploaded. Try again.' : 'Choose a file first.', 400);
      const { file } = uploaded;
      const name = path.basename(String(file.originalname ?? '')).replace(/[\u0000-\u001f]/g, '').slice(0, 120) || 'File';
      const kind = fileKind(name, file.buffer);
      if (!kind) throw new SourceError('Choose a PDF, DOCX or PPTX file, or an MP3, MP4, M4A or WAV recording.', 400);

      if (isRecordingKind(kind)) {
        if (!isAiConfigured()) throw new SourceError('Recordings cannot be read right now. Paste the text instead.', 503);
        let text = '';
        try {
          text = (await transcribeAudio(file.buffer, { filename: name, mimeType: file.mimetype })) ?? '';
        } catch (error) {
          logError('transcription', error);
          throw new SourceError(error?.status === 413 ? 'This recording is too long for the AI. Try a shorter part of it.' : 'The recording could not be turned into text right now. Try again later, or paste the text.', 502);
        }
        if (wordsOf(text) < MIN_SOURCE_WORDS) throw new SourceError('Too few words could be heard in this recording for a quiz.');
        return answer('recording', name, text);
      }

      if (file.size > DOCUMENT_BYTES) throw new SourceError('Documents can be up to 10 MB. Choose a smaller file.', 413);
      const text = await textFromDocument(kind, file.buffer);
      if (text === null) throw new SourceError('This file could not be read. Try saving it again as PDF or DOCX.');
      if (wordsOf(text) < MIN_SOURCE_WORDS) {
        throw new SourceError(kind === 'pdf' ? 'This PDF has no text HabitAI can read (it may be scanned pages). Try another file, or paste the text.' : 'This file has too little text for a quiz.');
      }
      return answer('file', name, text);
    } catch (error) {
      if (error instanceof SourceError) return response.status(error.status).json({ ok: false, message: error.message });
      logError('quiz-source', error);
      return response.status(500).json({ ok: false, message: 'This could not be read right now. Try again, or paste the text.' });
    }
  });

  // The AI checks an essay answer of a practice quiz against its key points (free: the quiz was paid for).
  app.post('/api/rewards/items/:id/essay-check', essayCheckLimiter, async (request, response) => {
    const session = await requireAuth(request, response);
    if (!session) return;
    const input = parse(essayCheckSchema, request, response);
    if (!input) return;
    const row = (await query(
      "SELECT output_json AS output FROM reward_items WHERE id=$1 AND user_id=$2 AND reward_id='practice-quiz'",
      [String(request.params.id).slice(0, 80), session.userId],
    )).rows[0];
    const question = row?.output?.questions?.[input.index];
    if (question?.type !== 'essay' || !Array.isArray(question.keyPoints)) return response.status(404).json({ ok: false, message: 'Not found.' });
    if (!isAiConfigured()) return response.status(503).json({ ok: false, message: 'The AI check is not available right now. Compare your answer with the key points.' });
    const saved = await loadSavedState(session.userId).catch(() => ({ language: null }));
    let check = null;
    try {
      check = await writeWithAi(essayCheckPrompt({ ...question, answer: input.answer }), {
        system: forLanguage(ESSAY_CHECK_SYSTEM, saved.language),
        schema: essayCheckJsonSchema,
        maxOutputTokens: 400,
        read: (text) => readEssayCheck(text, question.keyPoints.length),
        budgetMs: 30_000,
        attemptMs: 20_000,
      });
    } catch (error) {
      logError('essay-check', error);
    }
    if (!check) return response.status(502).json({ ok: false, message: 'The AI could not check this answer right now. Compare it with the key points.' });
    response.json({ ok: true, ...check });
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
