// Taking an AI Practice Quiz (app/practice-quiz.tsx): the kinds of question, checking an answer of
// each kind (a typed answer is forgiven a small typo), matching sets, the score, and where the
// student left off (kept on this device until the quiz is finished or deleted).
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { QuizQuestion, QuizType } from '@/utils/rewards-client';

export const QUIZ_TYPE_OPTIONS: { type: QuizType; label: string; hint: string }[] = [
  { type: 'multiple-choice', label: 'Multiple Choice', hint: 'Pick one of four' },
  { type: 'true-false', label: 'True or False', hint: 'Decide if it is true' },
  { type: 'fill-blank', label: 'Fill in the Blank', hint: 'Type the missing word' },
  { type: 'identification', label: 'Identification', hint: 'Name the term' },
  { type: 'matching', label: 'Matching Type', hint: 'Pair each item' },
  { type: 'essay', label: 'Essay', hint: 'Explain in your own words' },
];

export const TYPE_LABEL = Object.fromEntries(QUIZ_TYPE_OPTIONS.map((option) => [option.type, option.label])) as Record<QuizType, string>;

/** A question's kind: a quiz from before the quiz maker has multiple-choice questions without one. */
export const typeOf = (question: QuizQuestion): QuizType => question.type ?? 'multiple-choice';

/** A typed answer as it is compared: lower case, no accents or punctuation, single spaces, no leading article. */
export function normalizeAnswer(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/^(the|a|an|ang|mga) /, '');
}

/** How many letters must change to turn one text into the other (stops early past `limit`). */
function editDistance(left: string, right: string, limit: number) {
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    const current = [row];
    for (let column = 1; column <= right.length; column += 1) {
      current[column] = Math.min(previous[column] + 1, current[column - 1] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
    }
    if (Math.min(...current) > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length];
}

/** Whether a typed answer is one of the accepted ones: exactly, or with a small typo in a longer one. */
export function matchesAnswer(given: string, answers: string[]) {
  const typed = normalizeAnswer(given);
  if (!typed) return false;
  return answers.some((answer) => {
    const expected = normalizeAnswer(answer);
    if (typed === expected) return true;
    const allowed = expected.length >= 10 ? 2 : expected.length >= 5 ? 1 : 0;
    return allowed > 0 && editDistance(typed, expected, allowed) <= allowed;
  });
}

/** What the student gave: a choice (multiple choice, true or false), a text, matches (left index to pair index) or an essay. */
export type QuizAnswer = { choice?: number; text?: string; matches?: Record<number, number>; essay?: string };
/**
 * How an answer was judged. A matching set can be partly right (`pairs`: each left right or not), an
 * essay too (the AI's `feedback` and the key points it `covered`; `self` when the student judged it).
 */
export type QuizResult = { status: 'correct' | 'partial' | 'wrong'; pairs?: boolean[]; feedback?: string; covered?: number[]; self?: boolean };

/** Whether an answer is complete enough to check. */
export function isAnswered(question: QuizQuestion, answer: QuizAnswer | undefined) {
  if (!answer) return false;
  switch (typeOf(question)) {
    case 'multiple-choice':
    case 'true-false':
      return answer.choice !== undefined;
    case 'fill-blank':
    case 'identification':
      return Boolean(answer.text?.trim());
    case 'matching':
      return (question.pairs ?? []).every((_, index) => answer.matches?.[index] !== undefined);
    case 'essay':
      return (answer.essay?.trim().length ?? 0) >= 10;
    default:
      return false;
  }
}

/** Checks an answer of any kind but an essay (the AI checks those, app/practice-quiz.tsx). */
export function gradeAnswer(question: QuizQuestion, answer: QuizAnswer): QuizResult {
  switch (typeOf(question)) {
    case 'multiple-choice':
    case 'true-false':
      return { status: answer.choice === question.answerIndex ? 'correct' : 'wrong' };
    case 'fill-blank':
    case 'identification':
      return { status: matchesAnswer(answer.text ?? '', question.answers ?? []) ? 'correct' : 'wrong' };
    case 'matching': {
      const pairs = (question.pairs ?? []).map((_, index) => answer.matches?.[index] === index);
      const right = pairs.filter(Boolean).length;
      return { status: right === pairs.length ? 'correct' : right ? 'partial' : 'wrong', pairs };
    }
    default:
      return { status: 'wrong' };
  }
}

/** The order a matching set's right-hand items are shown in: shuffled the same way every time, never in answer order. */
export function matchingOrder(question: QuizQuestion, seed: number): number[] {
  const count = question.pairs?.length ?? 0;
  const order = Array.from({ length: count }, (_, index) => index);
  let state = (seed + 1) * 7919;
  for (let index = count - 1; index > 0; index -= 1) {
    state = (state * 9301 + 49297) % 233280;
    const swap = Math.floor((state / 233280) * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  if (count > 1 && order.every((value, index) => value === index)) order.push(order.shift() as number);
  return order;
}

/** The score: a right answer counts 1, a partly right one (an essay, a matching set) half. */
export function quizScore(results: QuizResult[]) {
  const correct = results.filter((result) => result.status === 'correct').length;
  const partial = results.filter((result) => result.status === 'partial').length;
  return { correct, partial, wrong: results.length - correct - partial, points: correct + partial / 2 };
}

/** Where a student left off in a quiz: the answers, how each was judged, and the question shown. */
export type QuizProgress = { answers: Record<number, QuizAnswer>; results: Record<number, QuizResult>; current: number };

const progressKey = (itemId: string) => `habitai:quiz-progress:${itemId}`;

export async function loadQuizProgress(itemId: string): Promise<QuizProgress | null> {
  try {
    const saved = JSON.parse((await AsyncStorage.getItem(progressKey(itemId))) ?? 'null') as Partial<QuizProgress> | null;
    if (!saved || typeof saved !== 'object') return null;
    return {
      answers: saved.answers && typeof saved.answers === 'object' ? saved.answers : {},
      results: saved.results && typeof saved.results === 'object' ? saved.results : {},
      current: Number.isInteger(saved.current) ? Number(saved.current) : 0,
    };
  } catch {
    return null;
  }
}

export async function saveQuizProgress(itemId: string, progress: QuizProgress) {
  try {
    await AsyncStorage.setItem(progressKey(itemId), JSON.stringify(progress));
  } catch {
    // Only this device's place in the quiz is lost.
  }
}

export async function clearQuizProgress(itemId: string) {
  try {
    await AsyncStorage.removeItem(progressKey(itemId));
  } catch {
    // Nothing kept to clear.
  }
}

// An essay or a matching set takes long to answer: a quiz has at most this many of each (as the server plans it).
const TYPE_LIMITS: Partial<Record<QuizType, number>> = { essay: 5, matching: 5 };

/** How many questions a quiz of these kinds will have (backend/services/reward-tools.js quizPlan). */
export function plannedQuestions(types: QuizType[], count: number) {
  const limited = types.reduce((sum, type) => sum + (TYPE_LIMITS[type] ?? count), 0);
  return Math.min(count, limited);
}
