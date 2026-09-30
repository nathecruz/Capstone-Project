// One client for every AI feature. The backend builds the student's habit context
// from the database, so screens only send the question (and the device time zone).
import { ApiRequestError, apiRequest, getAuthenticatedHeaders } from '@/authentication/authService';

export type AiMode = 'assistant' | 'coach' | 'support';

export type AiFailure = { ok: false; status: number; message: string };
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
    return { ok: false, status: error.status, message: 'The AI service is temporarily unavailable. Please try again.' };
  }
  return { ok: false, status: 0, message: 'Could not reach the AI service. Check your connection and try again.' };
}

export async function askAi(mode: AiMode, question: string): Promise<AiAnswer> {
  try {
    const result = await apiRequest<{ answer?: string; tokens?: number; tokenHistory?: object[] }>('/api/insights/assistant', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ mode, question: question.trim().slice(0, 500) || undefined, timeZone: deviceTimeZone() }),
      timeoutMs: AI_TIMEOUT_MS,
    });
    return result.answer ? { ok: true, answer: result.answer, tokens: result.tokens, tokenHistory: result.tokenHistory } : { ok: false, status: 502, message: 'The AI returned an empty answer. Please try again.' };
  } catch (error) {
    return toFailure(error);
  }
}

export async function generateGoalPlan<Plan>(request: { goal: string; focusTarget: string; timeline: string }): Promise<{ ok: true; plan: Plan } | AiFailure> {
  try {
    const result = await apiRequest<{ plan?: Plan }>('/api/goals/generate', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ ...request, timeZone: deviceTimeZone() }),
      timeoutMs: AI_TIMEOUT_MS,
    });
    return result.plan ? { ok: true, plan: result.plan } : { ok: false, status: 502, message: 'The AI planner returned an empty plan. Please try again.' };
  } catch (error) {
    return toFailure(error);
  }
}
