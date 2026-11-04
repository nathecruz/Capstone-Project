// One client for every AI feature. The backend builds the student's habit context
// from the database, so screens only send the question (and the device time zone).
import { ApiRequestError, apiRequest, getAuthenticatedHeaders } from '@/authentication/authService';
import type { ChatAnswer, ChatTurn } from '@/components/ai-chat';
import type { HabitProof, PlannedHabit } from '@/hooks/app-state/types';
import { normalizedProof } from '@/utils/habit-templates';
import { readPlannedHabits } from '@/utils/planned-habits';

export type AiMode = 'assistant' | 'coach' | 'support';

/** `refunded`: the AI Coach was charged, then the AI failed, so the server returned the tokens (balance `tokens`). */
export type AiFailure = { ok: false; status: number; message: string; refunded?: boolean; tokens?: number };
export type AiAnswer = { ok: true; answer: string; tokens?: number; tokenHistory?: object[] } | AiFailure;

const AI_TIMEOUT_MS = 70000;

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

function toFailure(error: unknown): AiFailure {
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return { ok: false, status: 401, message: 'Please sign in again to use AI features.' };
    if (error.status === 503) return { ok: false, status: 503, message: 'AI features are not available right now.' };
    if (error.status === 429 || error.status === 402) return { ok: false, status: error.status, message: error.message };
    // The AI Coach was charged and the AI then failed: the server returned the tokens.
    const refund = error.status === 502 && error.payload.refunded === true
      ? { refunded: true, tokens: typeof error.payload.tokens === 'number' ? error.payload.tokens : undefined }
      : {};
    return { ok: false, status: error.status, message: 'The AI service is temporarily unavailable. Please try again.', ...refund };
  }
  return { ok: false, status: 0, message: 'Could not reach the AI service. Check your connection and try again.' };
}

/** An answer from the server's AI; `history` is the chat so far (components/ai-chat.tsx chatHistory), for a follow-up. */
export async function askAi(mode: AiMode, question: string, history: ChatTurn[] = []): Promise<AiAnswer> {
  try {
    const result = await apiRequest<{ answer?: string; tokens?: number; tokenHistory?: object[] }>('/api/insights/assistant', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ mode, question: question.trim().slice(0, 500) || undefined, ...(history.length ? { history } : {}), timeZone: deviceTimeZone() }),
      timeoutMs: AI_TIMEOUT_MS,
    });
    return result.answer ? { ok: true, answer: result.answer, tokens: result.tokens, tokenHistory: result.tokenHistory } : { ok: false, status: 502, message: 'The AI returned an empty answer. Please try again.' };
  } catch (error) {
    return toFailure(error);
  }
}

/** Tokens one AI Coach answer costs. */
export const COACH_COST = 10;

/**
 * One AI Coach answer, as the chat shows it. The server charges the tokens before it asks the AI
 * and returns them when the AI fails, so the balance shown is always the server's.
 */
export async function askCoach(question: string, wallet: { tokens: number; applyWallet: (wallet: { tokens?: number; tokenHistory?: object[] }) => void }, history: ChatTurn[] = []): Promise<ChatAnswer> {
  if (wallet.tokens < COACH_COST) {
    return { ok: false, tone: 'warning', message: `A Coach answer costs ${COACH_COST} tokens and you have ${wallet.tokens}. Check in your habits or claim your daily reward to earn more.` };
  }
  const result = await askAi('coach', question, history);
  if (result.ok) {
    wallet.applyWallet(result);
    return { ok: true, answer: result.answer, note: `${COACH_COST} tokens used` };
  }
  if (result.refunded) {
    wallet.applyWallet({ tokens: result.tokens });
    return { ok: false, message: `The AI Coach is unavailable right now. Your ${COACH_COST} tokens were returned.` };
  }
  // 402: the server's own reason. 0: no answer reached the phone (the connection dropped or timed
  // out), and the server may still have charged and answered, so the tokens are not promised back.
  if (result.status === 0 || result.status === 402) return { ok: false, message: result.message };
  return { ok: false, message: `${result.message} Your tokens were not spent.` };
}

/**
 * A habit read from the student's own description ("Describe your habit" on the Add tab), for the
 * form to fill in: Weekly and Custom come with their days, reminder times as "07:00 PM".
 */
export type DescribedHabit = { label: string; category: string; frequency: 'Daily' | 'Weekly' | 'Custom'; days: string[]; reminderTimes: string[]; proof: HabitProof; start: 'today' | 'tomorrow' };

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const REMINDER_TIME = /^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/;

function readProof(value: unknown): HabitProof | null {
  const proof = value && typeof value === 'object' ? value as { type?: unknown; minutes?: unknown; steps?: unknown } : null;
  if (proof?.type === 'timer' && typeof proof.minutes === 'number' && Number.isFinite(proof.minutes)) return normalizedProof({ type: 'timer', minutes: proof.minutes });
  if (proof?.type === 'steps' && typeof proof.steps === 'number' && Number.isFinite(proof.steps)) return normalizedProof({ type: 'steps', steps: proof.steps });
  return proof?.type === 'photo' ? { type: 'photo' } : null;
}

/** The server's reading, checked: null when it has no name or proof. */
export function readDescribedHabit(value: unknown): DescribedHabit | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const label = typeof raw.label === 'string' ? raw.label.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  const proof = readProof(raw.proof);
  if (!label || !proof) return null;
  const listed = Array.isArray(raw.days) ? raw.days : [];
  const days = WEEK_DAYS.filter((day) => listed.includes(day));
  const frequency = (raw.frequency === 'Weekly' || raw.frequency === 'Custom') && days.length ? raw.frequency : 'Daily';
  return {
    label,
    category: typeof raw.category === 'string' ? raw.category : '',
    frequency,
    days: frequency === 'Daily' ? [] : days,
    reminderTimes: (Array.isArray(raw.reminderTimes) ? raw.reminderTimes : []).filter((time): time is string => typeof time === 'string' && REMINDER_TIME.test(time)).slice(0, 2),
    proof,
    start: raw.start === 'tomorrow' ? 'tomorrow' : 'today',
  };
}

/**
 * "Describe your habit": the server reads one sentence (with the AI, or its own rules without it)
 * into the habit form's fields. `source` says which one read it. A 422 is the server's reason the
 * text is not a habit.
 */
export async function parseHabit(text: string): Promise<{ ok: true; habit: DescribedHabit; source: 'ai' | 'rules' } | AiFailure> {
  try {
    const result = await apiRequest<{ habit?: unknown; source?: string }>('/api/habit/parse', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ text: text.trim().slice(0, 200) }),
      timeoutMs: 25000,
    });
    const habit = readDescribedHabit(result.habit);
    if (!habit) return { ok: false, status: 502, message: 'HabitAI could not read that description.' };
    return { ok: true, habit, source: result.source === 'ai' ? 'ai' : 'rules' };
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 422) {
      const payload = error.payload as { error?: unknown } | undefined;
      return { ok: false, status: 422, message: (typeof payload?.error === 'string' && payload.error) || 'That does not look like a habit. Try something like "Walk 3,000 steps every morning".' };
    }
    return toFailure(error);
  }
}

export async function classifyHabit(name: string, options: { category?: string; categories?: string[] } = {}): Promise<{ ok: true; isHabit: boolean; isBadHabit: boolean; categoryFits: boolean; suggestedCategory: string; reason: string } | AiFailure> {
  try {
    const result = await apiRequest<{ isHabit?: boolean; isBadHabit?: boolean; categoryFits?: boolean; suggestedCategory?: string; reason?: string }>('/api/habit/classify', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ name: name.trim().slice(0, 100), category: options.category, categories: options.categories?.slice(0, 20) }),
      timeoutMs: 5000,
    });
    const isHabit = result.isHabit !== false;
    return {
      ok: true,
      isHabit,
      isBadHabit: isHabit && result.isBadHabit === true,
      categoryFits: result.categoryFits !== false,
      suggestedCategory: typeof result.suggestedCategory === 'string' ? result.suggestedCategory : '',
      reason: typeof result.reason === 'string' ? result.reason : '',
    };
  } catch (error) {
    return toFailure(error);
  }
}

/**
 * A goal plan from the server. `habits` are this week's habits, planned from the student's
 * history (exactly the "Habits to focus on" count); missing when the AI gave none usable, or from
 * an older server, which only sends the `habitSuggestions` names. Screens store them on the goal
 * as `habitPlan`.
 */
export type GoalPlan<Plan> = Omit<Plan, 'habits'> & { habits?: PlannedHabit[] };

export async function generateGoalPlan<Plan>(request: { goal: string; focusTarget: string; timeline: string }): Promise<{ ok: true; plan: GoalPlan<Plan> } | (AiFailure & { unachievable?: boolean })> {
  try {
    // The server reads the student's habit history itself; only the goal text and choices go up.
    const result = await apiRequest<{ plan?: Plan & { habits?: unknown } }>('/api/goals/generate', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ ...request, timeZone: deviceTimeZone() }),
      timeoutMs: AI_TIMEOUT_MS,
    });
    if (!result.plan) return { ok: false, status: 502, message: 'The AI planner returned an empty plan. Please try again.' };
    const { habits, ...plan } = result.plan;
    const planned = readPlannedHabits(habits);
    return { ok: true, plan: { ...plan, ...(planned ? { habits: planned } : {}) } as GoalPlan<Plan> };
  } catch (error) {
    // An impossible or nonsensical goal: surface the AI's short reason instead of a generic error.
    if (error instanceof ApiRequestError && error.status === 422) {
      const payload = error.payload as { error?: string } | undefined;
      const message = (typeof payload?.error === 'string' && payload.error) || 'That does not look like a goal we can plan for. Try a real, achievable goal.';
      return { ok: false, status: 422, message, unachievable: true };
    }
    return toFailure(error);
  }
}
