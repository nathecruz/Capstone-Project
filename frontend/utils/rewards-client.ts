// The Rewards Shop's made rewards (backend/routes/reward-tools.js): an AI plan, quiz or report, or a
// certificate, made when it is redeemed and kept in My Rewards. The server charges the tokens and
// gives them back when it cannot make the reward, so the balance shown is always the server's.
import { ApiRequestError, apiRequest, getAuthenticatedHeaders } from '@/authentication/authService';

export type PlanDay = { date: string; task: string; minutes: number };
export type StudyPlan = { title: string; summary: string; task: string; dueDate: string; minutesPerDay: number; days: PlanDay[]; tips: string[] };
/** The kinds of question a practice quiz mixes (backend/services/reward-tools.js QUIZ_TYPES). */
export type QuizType = 'multiple-choice' | 'true-false' | 'fill-blank' | 'identification' | 'matching' | 'essay';
/**
 * One question. Every question has choices and answerIndex (empty and -1 when its type uses neither);
 * a quiz from before the quiz maker has multiple-choice questions without a type.
 */
export type QuizQuestion = {
  type?: QuizType;
  topic?: string;
  question: string;
  choices: string[];
  answerIndex: number;
  explanation: string;
  /** fill-blank and identification: the accepted answers, the main one first. */
  answers?: string[];
  /** matching: each left goes with its right. */
  pairs?: { left: string; right: string }[];
  /** essay: what a good answer covers, and a model answer. */
  keyPoints?: string[];
  sampleAnswer?: string;
};
/** What a quiz is made from: text typed in the app, or what a file, a link or a recording was read as. */
export type QuizSourceKind = 'text' | 'file' | 'link' | 'recording';
export type QuizSource = { kind: QuizSourceKind; name: string; text: string };
export type PracticeQuiz = { title: string; topic: string; source?: QuizSource; topics?: string[]; types?: QuizType[]; questions: QuizQuestion[] };
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
  | { rewardId: 'practice-quiz'; topic?: string; source?: QuizSource; types?: QuizType[]; count?: 10 | 20 | 30 }
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

/** A file or a recording picked on the phone (by its uri) or in a browser (the File itself). */
export type PickedFile = { uri: string; name: string; mimeType?: string | null; file?: File };
/** What the server read: the text (at most about 1,500 words) for the student to check before the quiz is made. */
export type ReadSource = QuizSource & { words: number; truncated: boolean };
export type ReadSourceResult = { ok: true; source: ReadSource } | { ok: false; message: string };

// A recording is turned into text by the AI, which can take a while.
const READ_TIMEOUT_MS = 120_000;

/** Reads a file or recording (uploaded) or a link (opened by the server) into text for a quiz. Free. */
export async function readQuizSource(input: { kind: 'file'; file: PickedFile } | { kind: 'link'; url: string }): Promise<ReadSourceResult> {
  try {
    const headers = await getAuthenticatedHeaders();
    let init: RequestInit;
    if (input.kind === 'link') {
      init = { method: 'POST', headers, body: JSON.stringify({ url: input.url.trim() }) };
    } else {
      const form = new FormData();
      // A browser's FormData takes the File itself; the phone app sends the file by its uri.
      if (input.file.file) form.append('file', input.file.file, input.file.name);
      else form.append('file', { uri: input.file.uri, name: input.file.name, type: input.file.mimeType || 'application/octet-stream' } as unknown as Blob);
      // apiRequest leaves the Content-Type to FormData (it carries the boundary between the parts).
      init = { method: 'POST', headers, body: form };
    }
    const result = await apiRequest<{ source?: ReadSource }>('/api/rewards/quiz-source', { ...init, timeoutMs: READ_TIMEOUT_MS });
    if (!result.source?.text) return { ok: false, message: 'Nothing could be read. Try another one, or paste the text.' };
    return { ok: true, source: result.source };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const payload = error.payload as { message?: unknown };
      return { ok: false, message: typeof payload?.message === 'string' && payload.message ? payload.message : error.message };
    }
    return { ok: false, message: 'Could not reach HabitAI. Check your connection and try again.' };
  }
}

export type EssayCheck = { verdict: 'strong' | 'partial' | 'weak'; covered: number[]; feedback: string };

/** The AI's check of an essay answer against the question's key points (free). */
export async function checkEssay(itemId: string, index: number, answer: string): Promise<({ ok: true } & EssayCheck) | { ok: false; message: string }> {
  try {
    const result = await apiRequest<EssayCheck>(`/api/rewards/items/${encodeURIComponent(itemId)}/essay-check`, {
      method: 'POST',
      headers: await getAuthenticatedHeaders(),
      body: JSON.stringify({ index, answer }),
      timeoutMs: 45_000,
    });
    return { ok: true, verdict: result.verdict, covered: Array.isArray(result.covered) ? result.covered : [], feedback: result.feedback };
  } catch (error) {
    const payload = error instanceof ApiRequestError ? (error.payload as { message?: unknown }) : null;
    return { ok: false, message: typeof payload?.message === 'string' && payload.message ? payload.message : 'The AI could not check this answer right now. Compare it with the key points.' };
  }
}

// The quiz player opens a quiz by its id: the one just made or tapped in My Rewards is kept here, so
// it opens at once without loading My Rewards again.
const remembered = new Map<string, RewardItem>();

export function rememberRewardItem(item: RewardItem) {
  remembered.set(item.id, item);
}

/** A quiz by its id: the one kept here, else My Rewards' copy from the server (null when it is gone). */
export async function findRewardItem(id: string): Promise<RewardItem | null> {
  const kept = remembered.get(id);
  if (kept) return kept;
  const items = await getRewardItems();
  const found = items?.find((item) => item.id === id) ?? null;
  if (found) remembered.set(found.id, found);
  return found;
}

export function forgetRewardItem(id: string) {
  remembered.delete(id);
}
