// The Rewards Shop's made rewards (backend/routes/reward-tools.js): an AI plan, quiz or report, or a
// certificate, made when it is redeemed and kept in My Rewards. The server charges the tokens and
// gives them back when it cannot make the reward, so the balance shown is always the server's.
import { ApiRequestError, apiRequest, getAuthenticatedHeaders } from '@/authentication/authService';

export type PlanDay = { date: string; task: string; minutes: number };
export type StudyPlan = { title: string; summary: string; task: string; dueDate: string; minutesPerDay: number; days: PlanDay[]; tips: string[] };
export type QuizQuestion = { question: string; choices: string[]; answerIndex: number; explanation: string };
export type PracticeQuiz = { title: string; topic: string; questions: QuizQuestion[] };
export type WeeklyReport = { headline: string; wins: string[]; watchOuts: string[]; plan: string[]; encouragement: string; weekEnding: string };
export type Certificate = { name: string; role: 'Student' | 'Faculty'; checkIns: number; activeDays: number; habits: number; health: number; academics: number; streak: number; since: string | null; issuedOn: string };

/** A made reward as My Rewards lists it. */
export type RewardItem =
  | { id: string; rewardId: 'study-planner'; title: string; createdAt: number; output: StudyPlan }
  | { id: string; rewardId: 'practice-quiz'; title: string; createdAt: number; output: PracticeQuiz }
  | { id: string; rewardId: 'weekly-report'; title: string; createdAt: number; output: WeeklyReport }
  | { id: string; rewardId: 'certificate'; title: string; createdAt: number; output: Certificate; code: string; url: string };

/** What a made reward is made from. */
export type RewardRequest =
  | { rewardId: 'study-planner'; task: string; dueDate: string; minutesPerDay: number }
  | { rewardId: 'practice-quiz'; topic: string }
  | { rewardId: 'weekly-report' }
  | { rewardId: 'certificate' };

type WalletUpdate = { tokens?: number; tokenHistory?: object[] };
/** `refunded`: the reward was charged, then could not be made, and the tokens came back (balance in `wallet`). */
export type MadeRewardResult = { ok: true; item: RewardItem; wallet: WalletUpdate } | { ok: false; message: string; refunded?: boolean; wallet?: WalletUpdate };

// The AI can take a while; the server stops trying before this.
const MAKE_TIMEOUT_MS = 75_000;

function deviceTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

export async function redeemMadeReward(request: RewardRequest): Promise<MadeRewardResult> {
  try {
    const result = await apiRequest<{ item: RewardItem; tokens?: number; tokenHistory?: object[] }>('/api/rewards/use', {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ ...request, timeZone: deviceTimeZone() }),
      timeoutMs: MAKE_TIMEOUT_MS,
    });
    return { ok: true, item: result.item, wallet: { tokens: result.tokens, tokenHistory: result.tokenHistory } };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const payload = error.payload as { message?: unknown; refunded?: unknown; tokens?: unknown; tokenHistory?: unknown };
      const message = typeof payload.message === 'string' && payload.message ? payload.message : error.message;
      if (payload.refunded === true) {
        return { ok: false, refunded: true, message, wallet: { tokens: typeof payload.tokens === 'number' ? payload.tokens : undefined, tokenHistory: Array.isArray(payload.tokenHistory) ? payload.tokenHistory : undefined } };
      }
      if (error.status === 503) return { ok: false, message: 'The AI rewards are not available right now. Your tokens were not spent.' };
      return { ok: false, message: error.status >= 500 ? 'The Rewards Shop is unavailable right now. Please try again.' : message };
    }
    // No answer reached the phone: the server may still have made it, so it is not called a failure of the tokens.
    return { ok: false, message: 'Could not reach HabitAI. Check your connection, then look in My Rewards before trying again.' };
  }
}

export async function getRewardItems(): Promise<RewardItem[] | null> {
  try {
    const result = await apiRequest<{ items?: RewardItem[] }>('/api/rewards/items', { headers: await getAuthenticatedHeaders() });
    return Array.isArray(result.items) ? result.items : [];
  } catch {
    return null;
  }
}

export async function deleteRewardItem(id: string): Promise<boolean> {
  try {
    await apiRequest<{ ok: boolean }>(`/api/rewards/items/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await getAuthenticatedHeaders() });
    return true;
  } catch {
    return false;
  }
}
