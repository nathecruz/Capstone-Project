// The AI Practice Quiz: checking each kind of answer (utils/quiz.ts), the quiz maker (a file, a link
// or text, the kinds and number of questions, then the quiz) and the player (one question at a
// time, a topic filter, the score with a retry of the missed ones, the AI's essay check, faculty's
// answer key, the material to read again, and where the student left off).
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import PracticeQuizScreen from '@/app/practice-quiz';
import QuizMakerScreen from '@/app/quiz-maker';
import { gradeAnswer, matchesAnswer, matchingOrder, normalizeAnswer, plannedQuestions, quizScore } from '@/utils/quiz';
import { checkEssay, deleteRewardItem, findRewardItem, readQuizSource, redeemMadeReward, rememberRewardItem, type PracticeQuiz, type RewardItem } from '@/utils/rewards-client';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
const mockDialog = jest.fn();
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => mockDialog }));
let mockContext: Record<string, unknown>;
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => mockContext }));
jest.mock('@/hooks/use-rewards', () => ({ useRewards: () => ({ rewards: [{ id: 'practice-quiz', cost: 15 }] }) }));
jest.mock('@/utils/rewards-client', () => ({
  readQuizSource: jest.fn(),
  redeemMadeReward: jest.fn(),
  rememberRewardItem: jest.fn(),
  findRewardItem: jest.fn(),
  forgetRewardItem: jest.fn(),
  deleteRewardItem: jest.fn(async () => true),
  checkEssay: jest.fn(),
}));

const settle = () => act(async () => { await new Promise<void>((resolve) => setImmediate(() => resolve())); });
const blank = { choices: [], answerIndex: -1, explanation: '' };
const quiz: PracticeQuiz = {
  title: 'Cell division',
  topic: '',
  source: { kind: 'file', name: 'Biology reviewer.pdf', text: 'Cells divide by mitosis. DNA carries genes.' },
  topics: ['Mitosis', 'Genes'],
  types: ['multiple-choice', 'true-false', 'fill-blank', 'identification', 'matching', 'essay'],
  questions: [
    { type: 'multiple-choice', topic: 'Mitosis', question: 'What makes two cells from one?', choices: ['Mitosis', 'Osmosis', 'Diffusion', 'Respiration'], answerIndex: 0, explanation: 'Mitosis divides a cell in two.' },
    { type: 'true-false', topic: 'Mitosis', question: 'Mitosis makes two cells.', choices: ['True', 'False'], answerIndex: 0, explanation: 'It makes two daughter cells.' },
    { ...blank, type: 'fill-blank', topic: 'Mitosis', question: 'Cells divide by _____.', answers: ['mitosis'] },
    { ...blank, type: 'identification', topic: 'Genes', question: 'The molecule that carries genes.', answers: ['DNA', 'deoxyribonucleic acid'] },
    { ...blank, type: 'matching', topic: 'Genes', question: 'Match each part with its job.', pairs: [{ left: 'Nucleus', right: 'Holds DNA' }, { left: 'Ribosome', right: 'Makes proteins' }, { left: 'Mitochondrion', right: 'Releases energy' }] },
    { ...blank, type: 'essay', topic: 'Genes', question: 'Explain why cells divide.', keyPoints: ['Growth', 'Repair'], sampleAnswer: 'Cells divide to grow and to repair tissue.' },
  ],
};
const item: RewardItem = { id: 'quiz-1', rewardId: 'practice-quiz', title: 'Cell division', createdAt: 0, output: quiz };

beforeEach(async () => {
  jest.clearAllMocks();
  mockParams = { id: 'quiz-1' };
  mockContext = { tokens: 120, applyWallet: jest.fn(), isFaculty: false };
  jest.mocked(findRewardItem).mockResolvedValue(item);
  await jest.requireMock<{ clear: () => Promise<void> }>('@react-native-async-storage/async-storage').clear();
});

describe('checking answers', () => {
  it('forgives letter case, accents, articles and a small typo in a longer answer', () => {
    expect(normalizeAnswer('  The Mitósis! ')).toBe('mitosis');
    expect(matchesAnswer('mitosys', ['Mitosis'])).toBe(true);
    expect(matchesAnswer('deoxyribonucleic acd', ['DNA', 'deoxyribonucleic acid'])).toBe(true);
    expect(matchesAnswer('RNA', ['DNA'])).toBe(false);
    expect(matchesAnswer('   ', ['DNA'])).toBe(false);
  });

  it('checks each kind, with matching sets partly right, and scores partly right answers as half', () => {
    const [choice, , , , matching] = quiz.questions;
    expect(gradeAnswer(choice, { choice: 0 }).status).toBe('correct');
    expect(gradeAnswer(matching, { matches: { 0: 0, 1: 2, 2: 1 } })).toEqual({ status: 'partial', pairs: [true, false, false] });
    expect(gradeAnswer(matching, { matches: { 0: 0, 1: 1, 2: 2 } }).status).toBe('correct');
    // A legacy question (no type) is multiple choice.
    expect(gradeAnswer({ question: 'Q?', choices: ['A', 'B', 'C', 'D'], answerIndex: 2, explanation: '' }, { choice: 2 }).status).toBe('correct');
    expect(quizScore([{ status: 'correct' }, { status: 'partial' }, { status: 'wrong' }])).toEqual({ correct: 1, partial: 1, wrong: 1, points: 1.5 });
    const order = matchingOrder(matching, 4);
    expect([...order].sort()).toEqual([0, 1, 2]);
    expect(order).not.toEqual([0, 1, 2]);
    expect(matchingOrder(matching, 4)).toEqual(order);
    expect([plannedQuestions(['essay'], 10), plannedQuestions(['essay', 'matching'], 30), plannedQuestions(['multiple-choice', 'essay'], 30)]).toEqual([5, 10, 30]);
  });
});

describe('the quiz maker', () => {
  it('makes a quiz from typed notes, with the kinds and number of questions picked, then opens it', async () => {
    jest.mocked(redeemMadeReward).mockResolvedValueOnce({ ok: true, item, wallet: { tokens: 105 } });
    render(<QuizMakerScreen />);
    fireEvent.press(screen.getByLabelText('Text: Copy or type'));
    fireEvent.changeText(screen.getByLabelText('Notes or topic'), 'Cells divide by mitosis to grow and to repair tissue.');
    fireEvent.press(screen.getByLabelText('Essay: Explain in your own words'));
    expect(screen.getByText('Essay and Matching Type: up to 5 of each in a quiz.')).toBeTruthy();
    fireEvent.press(screen.getByText('20'));
    await act(async () => { fireEvent.press(screen.getByLabelText('Generate quiz for 15 tokens')); });
    expect(redeemMadeReward).toHaveBeenCalledWith({
      rewardId: 'practice-quiz',
      source: { kind: 'text', name: '', text: 'Cells divide by mitosis to grow and to repair tissue.' },
      types: ['multiple-choice', 'true-false', 'identification', 'essay'],
      count: 20,
    });
    expect(mockContext.applyWallet).toHaveBeenCalledWith({ tokens: 105 });
    expect(rememberRewardItem).toHaveBeenCalledWith(item);
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/practice-quiz', params: { id: 'quiz-1' } });
  });

  it('reads a file first, shows what it will be made from, and makes the quiz from it', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///Reviewer.pdf', name: 'Reviewer.pdf', mimeType: 'application/pdf', size: 2048, lastModified: 0 }] });
    jest.mocked(readQuizSource).mockResolvedValueOnce({ ok: true, source: { kind: 'file', name: 'Reviewer.pdf', text: 'Cells divide by mitosis.', words: 1320, truncated: false } });
    jest.mocked(redeemMadeReward).mockResolvedValueOnce({ ok: false, refunded: true, message: 'AI Practice Quiz is unavailable right now. Your 15 tokens were returned.', wallet: { tokens: 120 } });
    render(<QuizMakerScreen />);
    expect(screen.getByText('Limited to about 1,500 words')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('Choose file')); });
    expect(readQuizSource).toHaveBeenCalledWith({ kind: 'file', file: { uri: 'file:///Reviewer.pdf', name: 'Reviewer.pdf', mimeType: 'application/pdf', file: undefined } });
    expect(screen.getByText('Reviewer.pdf')).toBeTruthy();
    expect(screen.getByText('1,320 words')).toBeTruthy();
    fireEvent.press(screen.getByText('Preview text'));
    expect(screen.getByText('Cells divide by mitosis.')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByLabelText('Generate quiz for 15 tokens')); });
    expect(redeemMadeReward).toHaveBeenCalledWith(expect.objectContaining({ source: { kind: 'file', name: 'Reviewer.pdf', text: 'Cells divide by mitosis.' } }));
    // Not made: the tokens came back, and the form is there to try again.
    expect(screen.getByText('AI Practice Quiz is unavailable right now. Your 15 tokens were returned.')).toBeTruthy();
    expect(mockContext.applyWallet).toHaveBeenCalledWith({ tokens: 120 });
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('checks a link and a file before reading them, and says why one could not be read', async () => {
    jest.mocked(DocumentPicker.getDocumentAsync).mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///notes.txt', name: 'notes.txt', mimeType: 'text/plain', size: 10, lastModified: 0 }] });
    jest.mocked(readQuizSource).mockResolvedValueOnce({ ok: false, message: 'This video has no captions HabitAI can read. Paste its transcript as Text instead.' });
    render(<QuizMakerScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Choose file')); });
    expect(screen.getByText('Choose a PDF, DOCX or PPTX file.')).toBeTruthy();
    expect(readQuizSource).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Link: URL / YouTube'));
    fireEvent.changeText(screen.getByLabelText('Link'), 'youtube');
    fireEvent.press(screen.getByText('Read link'));
    expect(screen.getByText('Enter the full link, starting with https://')).toBeTruthy();
    fireEvent.changeText(screen.getByLabelText('Link'), 'https://youtu.be/dQw4w9WgXcQ');
    await act(async () => { fireEvent.press(screen.getByText('Read link')); });
    expect(readQuizSource).toHaveBeenCalledWith({ kind: 'link', url: 'https://youtu.be/dQw4w9WgXcQ' });
    expect(screen.getByText('This video has no captions HabitAI can read. Paste its transcript as Text instead.')).toBeTruthy();
  });

  it('says how many more tokens are needed', () => {
    mockContext.tokens = 5;
    render(<QuizMakerScreen />);
    fireEvent.press(screen.getByLabelText('Text: Copy or type'));
    fireEvent.changeText(screen.getByLabelText('Notes or topic'), 'Photosynthesis');
    expect(screen.getByLabelText('Generate quiz for 15 tokens').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getByText('You have 5 tokens: 10 more needed. Check in your habits to earn them.')).toBeTruthy();
  });
});

describe('the quiz player', () => {
  it('asks one question at a time, checks every kind, and ends with the score and a retry of the missed ones', async () => {
    jest.mocked(checkEssay).mockResolvedValueOnce({ ok: true, verdict: 'partial', covered: [1], feedback: 'You explained repair. Add growth.' });
    render(<PracticeQuizScreen />);
    await settle();
    expect(screen.getByText('Question 1 of 6')).toBeTruthy();
    expect(screen.getByText('Multiple Choice')).toBeTruthy();
    expect(screen.getByText('Check Answer').parent).toBeTruthy();

    fireEvent.press(screen.getByLabelText('B. Osmosis'));
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Not quite')).toBeTruthy();
    expect(screen.getByLabelText('A. Mitosis, correct answer')).toBeTruthy();
    expect(screen.getByText('Mitosis divides a cell in two.')).toBeTruthy();

    fireEvent.press(screen.getByText('Next question'));
    fireEvent.press(screen.getByLabelText('True'));
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Correct!')).toBeTruthy();

    fireEvent.press(screen.getByText('Next question'));
    fireEvent.changeText(screen.getByLabelText('Your answer'), 'mitosys');
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Correct!')).toBeTruthy();

    fireEvent.press(screen.getByText('Next question'));
    fireEvent.changeText(screen.getByLabelText('Your answer'), 'dna');
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Correct!')).toBeTruthy();

    fireEvent.press(screen.getByText('Next question'));
    expect(screen.getByText('Matching Type')).toBeTruthy();
    const match = (left: string, right: string) => {
      fireEvent.press(screen.getByLabelText(new RegExp(`^Match for ${left}:`)));
      fireEvent.press(screen.getByText(right));
    };
    match('Nucleus', 'Holds DNA');
    match('Ribosome', 'Releases energy');
    match('Mitochondrion', 'Makes proteins');
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Partly right')).toBeTruthy();

    fireEvent.press(screen.getByText('Next question'));
    fireEvent.changeText(screen.getByLabelText('Your essay answer'), 'Cells divide so the body can repair itself.');
    await act(async () => { fireEvent.press(screen.getByText('Check with AI')); });
    expect(checkEssay).toHaveBeenCalledWith('quiz-1', 5, 'Cells divide so the body can repair itself.');
    expect(screen.getByText('Partly there')).toBeTruthy();
    expect(screen.getByText('You explained repair. Add growth.')).toBeTruthy();

    fireEvent.press(screen.getByText('See results'));
    expect(screen.getByText('67%')).toBeTruthy();
    expect(screen.getByText('3 of 6 right · 2 partly right')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry the 3 I missed'));
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(screen.getByLabelText('B. Osmosis').props.accessibilityState).toMatchObject({ selected: false });
  });

  it('filters by topic, and shows the material it was made from', async () => {
    render(<PracticeQuizScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Topic: All topics'));
    fireEvent.press(screen.getByText('Genes'));
    expect(screen.getByText('Question 1 of 3')).toBeTruthy();
    expect(screen.getByText('Identification')).toBeTruthy();
    fireEvent.press(screen.getByText('Original content'));
    expect(screen.getByText('Biology reviewer.pdf')).toBeTruthy();
    expect(screen.getByText('Cells divide by mitosis. DNA carries genes.')).toBeTruthy();
  });

  it('lets the student judge an essay when the AI cannot check it', async () => {
    jest.mocked(checkEssay).mockResolvedValueOnce({ ok: false, message: 'The AI could not check this answer right now. Compare it with the key points.' });
    render(<PracticeQuizScreen />);
    await settle();
    fireEvent.press(screen.getByLabelText('Topic: All topics'));
    fireEvent.press(screen.getByText('Genes'));
    fireEvent.press(screen.getByLabelText('Next question'));
    fireEvent.press(screen.getByLabelText('Next question'));
    fireEvent.changeText(screen.getByLabelText('Your essay answer'), 'Cells divide to grow bigger and to heal.');
    await act(async () => { fireEvent.press(screen.getByText('Check with AI')); });
    expect(screen.getByText('The AI could not check this answer right now. Compare it with the key points. Then say how your answer did.')).toBeTruthy();
    expect(screen.getByText('Growth')).toBeTruthy();
    fireEvent.press(screen.getByText('Covered it'));
    expect(screen.getByText('See results')).toBeTruthy();
  });

  it('shows faculty the answer key, and keeps where the student left off', async () => {
    mockContext.isFaculty = true;
    const first = render(<PracticeQuizScreen />);
    await settle();
    expect(screen.getByLabelText('A. Mitosis, correct answer')).toBeTruthy();
    expect(screen.getByText('Next question')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Answer key'));
    fireEvent.press(screen.getByLabelText('C. Diffusion'));
    fireEvent.press(screen.getByText('Check Answer'));
    expect(screen.getByText('Not quite')).toBeTruthy();
    await settle();
    first.unmount();

    mockContext.isFaculty = false;
    render(<PracticeQuizScreen />);
    await settle();
    expect(screen.getByText('Not quite')).toBeTruthy();
    expect(screen.getByLabelText('C. Diffusion, your answer, wrong')).toBeTruthy();
  });

  it('deletes the quiz after asking', async () => {
    mockDialog.mockImplementation((_title: string, _body: string, buttons?: { text: string; onPress?: () => void }[]) => buttons?.find((button) => button.text === 'Delete')?.onPress?.());
    render(<PracticeQuizScreen />);
    await settle();
    await act(async () => { fireEvent.press(screen.getByLabelText('Delete this quiz')); });
    await settle();
    expect(deleteRewardItem).toHaveBeenCalledWith('quiz-1');
    expect(router.back).toHaveBeenCalled();
  });

  it('says when the quiz is gone', async () => {
    jest.mocked(findRewardItem).mockResolvedValueOnce(null);
    render(<PracticeQuizScreen />);
    await settle();
    expect(screen.getByText('This quiz is gone')).toBeTruthy();
  });
});
