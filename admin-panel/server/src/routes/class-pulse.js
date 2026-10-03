// Class Pulse for faculty: anonymized class numbers, the ML service's dropout risk counted per
// bucket, and an AI summary with suggestions. No student is named or listed.
import { Router } from 'express';
import { config } from '../config.js';
import { query } from '../db.js';
import { audit } from '../lib/audit.js';
import {
  CLASS_SUMMARY_SYSTEM,
  WINDOW_DAYS,
  buildClassPulse,
  classSummaryJsonSchema,
  classSummaryPrompt,
  classSummarySchema,
  riskSummary,
  studentSignal,
} from '../lib/class-pulse.js';
import { generateAiText, isAiConfigured } from '../lib/groq.js';
import { HttpError } from '../lib/http.js';
import { addDays, todayInZone } from '../lib/metrics.js';
import { getSettings } from '../lib/settings.js';
import { requirePermission } from '../middleware/auth.js';

const router = Router();
const ML_STUDENT_LIMIT = 80;
const ML_CONCURRENCY = 6;
const PULSE_CACHE_MS = 5 * 60 * 1000;
const SUMMARY_CACHE_MS = 30 * 60 * 1000;
let cachedPulse = null;
let cachedSummary = null;

const mlUrl = () => process.env.ML_SERVICE_URL?.trim().replace(/\/$/, '') || '';
const mlKey = () => process.env.ML_SERVICE_API_KEY?.trim() || '';

async function predictRisk(signal, timeoutMs) {
  const response = await fetch(`${mlUrl()}/api/predict/habit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-ML-Service-Key': mlKey() },
    body: JSON.stringify(signal),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`ML service answered ${response.status}`);
  const result = await response.json();
  if (typeof result.dropout_risk !== 'number') throw new Error('ML service gave no dropout risk');
  return { risk: result.dropout_risk, fallback: Boolean(result.is_fallback || result.prediction_source === 'fallback') };
}

/** ML dropout risk for up to ML_STUDENT_LIMIT students with recent scheduled habits. */
async function mlRisks(studentFacts) {
  const risks = new Map();
  if (!mlUrl() || !mlKey()) return { risks, status: 'not-configured', fallback: false };
  const candidates = studentFacts.map((student, index) => ({ student, index })).filter(({ student }) => student.habits && student.scheduled7).slice(0, ML_STUDENT_LIMIT);
  if (!candidates.length) return { risks, status: 'no-data', fallback: false };
  let fallback = false;
  // The first call also wakes a sleeping ML service; if it fails, the rules are used for everyone.
  try {
    const first = await predictRisk(studentSignal(candidates[0].student), 20_000);
    risks.set(candidates[0].index, first.risk);
    fallback = first.fallback;
  } catch {
    return { risks, status: 'unavailable', fallback: false };
  }
  let next = 1;
  await Promise.all(Array.from({ length: ML_CONCURRENCY }, async () => {
    while (next < candidates.length) {
      const { student, index } = candidates[next++];
      try {
        const result = await predictRisk(studentSignal(student), 8_000);
        risks.set(index, result.risk);
        fallback ||= result.fallback;
      } catch {
        // This student is counted with the last-7-days rule instead.
      }
    }
  }));
  return { risks, status: 'ok', fallback };
}

async function computePulse() {
  const timeZone = config.timeZone;
  const start = addDays(todayInZone(timeZone), -(WINDOW_DAYS - 1));
  const activeStudent = "u.role = 'user' AND u.status <> 'deactivated'";
  const [{ anonymityThreshold: k }, students, habits, completions] = await Promise.all([
    getSettings(),
    query(`SELECT u.id FROM users u WHERE ${activeStudent}`),
    query(`SELECT h.id, h.user_id AS "userId", h.category, h.meta, h.frequency, h.start_date, h.reminder_days FROM habits h JOIN users u ON u.id = h.user_id WHERE ${activeStudent}`),
    query(
      `SELECT hc.user_id AS "userId", hc.user_id || ':habit:' || hc.habit_id AS "habitId", hc.completed_date::text AS date, hc.completed_at AS "completedAt"
         FROM habit_completions hc JOIN users u ON u.id = hc.user_id WHERE ${activeStudent} AND hc.completed_date >= $1::date`,
      [start],
    ),
  ]);
  const pulse = buildClassPulse({ students: students.rows, habits: habits.rows, completions: completions.rows, timeZone, k });
  const ml = await mlRisks(pulse.studentFacts);
  const { studentFacts, ...shared } = pulse;
  const counts = riskSummary(studentFacts, ml.risks);
  return {
    ...shared,
    anonymityThreshold: k,
    risk: { ...counts, source: counts.fromModel ? (ml.fallback ? 'ml-fallback' : 'ml') : 'rules', mlStatus: ml.status },
    aiAvailable: isAiConfigured(),
    generatedAt: Date.now(),
  };
}

async function currentPulse(refresh) {
  if (!refresh && cachedPulse && Date.now() - cachedPulse.generatedAt < PULSE_CACHE_MS) return cachedPulse;
  cachedPulse = await computePulse();
  return cachedPulse;
}

router.get('/', requirePermission('class:view'), async (request, response) => {
  response.json({ ok: true, pulse: await currentPulse(request.query.refresh === '1') });
});

router.post('/summary', requirePermission('class:view'), async (request, response) => {
  if (!isAiConfigured()) throw new HttpError(503, 'The AI summary is not configured for the Admin Panel (GROQ_API_KEY).');
  const refresh = request.query.refresh === '1';
  const pulse = await currentPulse(false);
  if (!refresh && cachedSummary && cachedSummary.pulseAt === pulse.generatedAt && Date.now() - cachedSummary.generatedAt < SUMMARY_CACHE_MS) {
    return response.json({ ok: true, ...cachedSummary.body });
  }
  let result = null;
  for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
    const text = await generateAiText(classSummaryPrompt(pulse, pulse.risk), { system: CLASS_SUMMARY_SYSTEM, schema: classSummaryJsonSchema, maxOutputTokens: 700, temperature: 0.5 });
    try {
      const parsed = classSummarySchema.safeParse(JSON.parse(text));
      if (parsed.success) result = parsed.data;
    } catch {
      // Not JSON: try once more.
    }
  }
  if (!result) throw new HttpError(502, 'The AI returned an unusable summary. Please try again.');
  const body = { summary: result.summary, suggestions: result.suggestions, generatedAt: Date.now() };
  cachedSummary = { pulseAt: pulse.generatedAt, generatedAt: body.generatedAt, body };
  await audit(request, { action: 'class_pulse.ai_summary', targetType: 'class_pulse', summary: 'Generated the AI class summary' });
  response.json({ ok: true, ...body });
});

export default router;
