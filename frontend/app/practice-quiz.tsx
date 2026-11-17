// Taking an AI Practice Quiz (made in app/quiz-maker.tsx, kept in My Rewards): one question at a
// time ("Question 3 of 20" and its kind), an answer for each kind, Check Answer and why, previous
// and next, a topic filter and the progress so far. At the end, the score, with a retry of the
// wrong ones. The material the quiz was made from can be read again. The AI checks an essay against
// its key points (the student judges it when the AI cannot). Faculty see the answer key, to use the
// quiz in class, and can hide it to take the quiz. Where the student left off is kept on the device.
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import {
  clearQuizProgress,
  gradeAnswer,
  isAnswered,
  loadQuizProgress,
  matchingOrder,
  quizScore,
  saveQuizProgress,
  TYPE_LABEL,
  typeOf,
  type QuizAnswer,
  type QuizResult,
} from '@/utils/quiz';
import { checkEssay, deleteRewardItem, findRewardItem, forgetRewardItem, type PracticeQuiz, type QuizQuestion } from '@/utils/rewards-client';

const LETTERS = ['A', 'B', 'C', 'D'];
const SOURCE_LABEL = { text: 'Your text', file: 'File', link: 'Link', recording: 'Recording' } as const;

// The screen's styles, handed to the answer parts below.
type Look = (typeof themedStyles)['light'];

/** The four choices (or True and False) as tiles: picked, then right or wrong once shown. */
function Choices({ question, answer, shown, locked, onPick, styles }: { question: QuizQuestion; answer?: QuizAnswer; shown: boolean; locked: boolean; onPick: (choice: number) => void; styles: Look }) {
  const themeColor = useThemeColor();
  const twoChoices = question.choices.length === 2;
  return (
    <View style={styles.choices}>
      {question.choices.map((text, choice) => {
        const picked = answer?.choice === choice;
        const right = shown && choice === question.answerIndex;
        const wrong = shown && picked && choice !== question.answerIndex;
        return (
          <Pressable
            key={`${choice}-${text}`}
            style={({ pressed }) => [styles.choice, twoChoices && styles.choiceWide, picked && styles.choicePicked, right && styles.choiceRight, wrong && styles.choiceWrong, pressed && !locked && styles.pressed]}
            onPress={() => onPick(choice)}
            disabled={locked}
            accessibilityRole="radio"
            accessibilityState={{ selected: picked, disabled: locked }}
            accessibilityLabel={`${twoChoices ? '' : `${LETTERS[choice]}. `}${text}${right ? ', correct answer' : wrong ? ', your answer, wrong' : ''}`}
          >
            {!twoChoices && <View style={[styles.letter, picked && styles.letterPicked, right && styles.letterRight, wrong && styles.letterWrong]}><Text style={[styles.letterText, (picked || right || wrong) && styles.letterTextOn]}>{LETTERS[choice]}</Text></View>}
            <Text style={[styles.choiceText, twoChoices && styles.choiceTextCenter]}>{text}</Text>
            {right ? <Ionicons name="checkmark-circle" size={18} color={themeColor('#2E8F5E')} /> : wrong ? <Ionicons name="close-circle" size={18} color={themeColor('#C2412F')} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A typed answer (fill in the blank, identification), then the accepted answers once shown. */
function Typed({ question, answer, result, shown, locked, onType, styles }: { question: QuizQuestion; answer?: QuizAnswer; result?: QuizResult; shown: boolean; locked: boolean; onType: (text: string) => void; styles: Look }) {
  const themeColor = useThemeColor();
  const answers = question.answers ?? [];
  return (
    <View style={styles.gap}>
      <TextInput
        value={answer?.text ?? ''}
        onChangeText={onType}
        editable={!locked}
        placeholder={typeOf(question) === 'fill-blank' ? 'Type the missing word or phrase' : 'Type your answer'}
        placeholderTextColor={themeColor('#A19AAA')}
        style={[styles.input, result?.status === 'correct' && styles.inputRight, result?.status === 'wrong' && styles.inputWrong, Platform.OS === 'web' && styles.webInput]}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Your answer"
      />
      {shown && (
        <Text style={styles.keyLine}>
          Answer: <Text style={styles.keyStrong}>{answers[0]}</Text>
          {answers.length > 1 ? ` (also: ${answers.slice(1).join(', ')})` : ''}
        </Text>
      )}
    </View>
  );
}

/** A matching set: each item on the left gets one of the shuffled items on the right. */
function Matching({ question, index, answer, result, shown, locked, onMatch, styles }: { question: QuizQuestion; index: number; answer?: QuizAnswer; result?: QuizResult; shown: boolean; locked: boolean; onMatch: (left: number, pair: number) => void; styles: Look }) {
  const themeColor = useThemeColor();
  const [open, setOpen] = useState<number | null>(null);
  const pairs = question.pairs ?? [];
  const order = useMemo(() => matchingOrder(question, index), [question, index]);
  return (
    <View style={styles.gap}>
      {pairs.map((pair, left) => {
        const chosen = answer?.matches?.[left];
        const right = shown && (result ? result.pairs?.[left] : false);
        const wrong = Boolean(result) && result?.pairs?.[left] === false;
        return (
          <View key={pair.left} style={styles.matchRow}>
            <Text style={styles.matchLeft}>{left + 1}. {pair.left}</Text>
            <Pressable
              style={({ pressed }) => [styles.matchSlot, chosen !== undefined && styles.matchChosen, right && styles.choiceRight, wrong && styles.choiceWrong, pressed && !locked && styles.pressed]}
              onPress={() => setOpen(open === left ? null : left)}
              disabled={locked}
              accessibilityRole="button"
              accessibilityLabel={`Match for ${pair.left}: ${chosen === undefined ? 'not chosen' : pairs[chosen].right}`}
            >
              <Text style={[styles.matchSlotText, chosen === undefined && styles.matchPlaceholder]} numberOfLines={3}>{chosen === undefined ? 'Choose a match' : pairs[chosen].right}</Text>
              {!locked && <Ionicons name={open === left ? 'chevron-up' : 'chevron-down'} size={16} color={themeColor('#7A7488')} />}
              {right ? <Ionicons name="checkmark-circle" size={18} color={themeColor('#2E8F5E')} /> : wrong ? <Ionicons name="close-circle" size={18} color={themeColor('#C2412F')} /> : null}
            </Pressable>
            {open === left && !locked && (
              <View style={styles.matchOptions}>
                {order.map((pairIndex) => {
                  const usedBy = Object.entries(answer?.matches ?? {}).find(([, value]) => value === pairIndex)?.[0];
                  return (
                    <Pressable
                      key={pairIndex}
                      style={({ pressed }) => [styles.matchOption, pressed && styles.pressed]}
                      onPress={() => {
                        onMatch(left, pairIndex);
                        setOpen(null);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.matchOptionText}>{pairs[pairIndex].right}</Text>
                      {usedBy !== undefined && Number(usedBy) !== left && <Text style={styles.matchUsed}>used for {Number(usedBy) + 1}</Text>}
                    </Pressable>
                  );
                })}
              </View>
            )}
            {shown && (wrong || (!result && !right)) && <Text style={styles.keyLine}>Match: <Text style={styles.keyStrong}>{pair.right}</Text></Text>}
          </View>
        );
      })}
    </View>
  );
}

/** An essay: written, then checked by the AI (or by the student) against the key points. */
function Essay({ question, answer, result, shown, locked, checkFailed, onWrite, onJudge, styles }: { question: QuizQuestion; answer?: QuizAnswer; result?: QuizResult; shown: boolean; locked: boolean; checkFailed: string; onWrite: (text: string) => void; onJudge: (status: QuizResult['status']) => void; styles: Look }) {
  const themeColor = useThemeColor();
  const keyPoints = question.keyPoints ?? [];
  const verdict = result && !result.self ? { correct: 'Strong answer', partial: 'Partly there', wrong: 'Needs more work' }[result.status] : null;
  return (
    <View style={styles.gap}>
      <TextInput
        value={answer?.essay ?? ''}
        onChangeText={onWrite}
        editable={!locked}
        multiline
        textAlignVertical="top"
        placeholder="Write your answer in a few sentences"
        placeholderTextColor={themeColor('#A19AAA')}
        style={[styles.input, styles.essayInput, Platform.OS === 'web' && styles.webInput]}
        accessibilityLabel="Your essay answer"
      />
      {verdict && (
        <View style={[styles.verdict, result?.status === 'correct' ? styles.verdictGood : result?.status === 'partial' ? styles.verdictMid : styles.verdictLow]}>
          <Text style={styles.verdictTitle}>{verdict}</Text>
          {result?.feedback ? <Text style={styles.verdictText}>{result.feedback}</Text> : null}
        </View>
      )}
      {checkFailed && !result ? <Text style={styles.note}>{checkFailed}</Text> : null}
      {(shown || (checkFailed && !result)) && (
        <View style={styles.keyBox}>
          <Text style={styles.keyTitle}>A good answer covers</Text>
          {keyPoints.map((point, index) => {
            const covered = result?.covered?.includes(index);
            return (
              <View key={point} style={styles.keyPoint}>
                <Ionicons name={covered ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={themeColor(covered ? '#2E8F5E' : '#9A94A4')} />
                <Text style={styles.keyPointText}>{point}</Text>
              </View>
            );
          })}
          {question.sampleAnswer ? <Text style={styles.sample}><Text style={styles.keyStrong}>Model answer: </Text>{question.sampleAnswer}</Text> : null}
        </View>
      )}
      {checkFailed && !result && (
        <View style={styles.judgeRow}>
          <Text style={styles.judgeLabel}>How did your answer do?</Text>
          {([['correct', 'Covered it'], ['partial', 'Partly'], ['wrong', 'Not yet']] as const).map(([status, label]) => (
            <Pressable key={status} style={({ pressed }) => [styles.judge, pressed && styles.pressed]} onPress={() => onJudge(status)} accessibilityRole="button">
              <Text style={styles.judgeText}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

export default function PracticeQuizScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { isFaculty } = useAppColorScheme();
  const params = useLocalSearchParams<{ id?: string }>();
  const id = String(params.id ?? '');
  const [quiz, setQuiz] = useState<PracticeQuiz | null | 'loading'>('loading');
  const [answers, setAnswers] = useState<Record<number, QuizAnswer>>({});
  const [results, setResults] = useState<Record<number, QuizResult>>({});
  const [position, setPosition] = useState(0);
  const [restored, setRestored] = useState(false);
  const [topic, setTopic] = useState('all');
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [tab, setTab] = useState<'quiz' | 'source'>('quiz');
  const [answerKey, setAnswerKey] = useState(isFaculty);
  const [retry, setRetry] = useState<number[] | null>(null);
  const [finished, setFinished] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkFailed, setCheckFailed] = useState<Record<number, string>>({});
  // Each question (and the score) starts at the top of the screen.
  const scroller = useRef<ScrollView>(null);
  const toTop = () => scroller.current?.scrollTo({ y: 0, animated: false });

  useEffect(() => {
    let active = true;
    void Promise.all([findRewardItem(id), loadQuizProgress(id)]).then(([item, progress]) => {
      if (!active) return;
      setQuiz(item?.rewardId === 'practice-quiz' ? item.output : null);
      if (progress) {
        setAnswers(progress.answers);
        setResults(progress.results);
        setPosition(progress.current);
      }
      setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [id]);

  // Where the student is, kept on this device (once what was kept before is back).
  useEffect(() => {
    if (restored) void saveQuizProgress(id, { answers, results, current: position });
  }, [answers, results, position, restored, id]);

  if (quiz === 'loading' || quiz === null) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        {quiz === 'loading' ? <ActivityIndicator color={themeColor('#5B42D8')} /> : (
          <>
            <Text style={styles.title}>This quiz is gone</Text>
            <Text style={styles.subtitle}>It may have been deleted. Make a new one in the Rewards Shop.</Text>
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => router.back()} accessibilityRole="button"><Text style={styles.primaryText}>Go back</Text></Pressable>
          </>
        )}
      </SafeAreaView>
    );
  }

  const topics = quiz.topics?.length ? quiz.topics : [];
  const shown = quiz.questions
    .map((question, index) => ({ question, index }))
    .filter((entry) => (topic === 'all' || entry.question.topic === topic) && (!retry || retry.includes(entry.index)));
  const at = Math.min(position, Math.max(0, shown.length - 1));
  const current = shown[at];
  const total = quiz.questions.length;
  const checkedCount = Object.keys(results).length;
  const kinds = [...new Set(quiz.questions.map(typeOf))];

  const update = (index: number, change: Partial<QuizAnswer>) => setAnswers((all) => ({ ...all, [index]: { ...all[index], ...change } }));
  const goTo = (next: number) => {
    setPosition(Math.max(0, Math.min(shown.length - 1, next)));
    setTopicsOpen(false);
    toTop();
  };

  const check = async () => {
    if (!current) return;
    const { question, index } = current;
    const answer = answers[index];
    if (!isAnswered(question, answer) || results[index]) return;
    if (typeOf(question) !== 'essay') {
      setResults((all) => ({ ...all, [index]: gradeAnswer(question, answer) }));
      return;
    }
    setChecking(true);
    const essay = await checkEssay(id, index, answer.essay ?? '');
    setChecking(false);
    if (!essay.ok) {
      setCheckFailed((all) => ({ ...all, [index]: `${essay.message} Then say how your answer did.` }));
      return;
    }
    setResults((all) => ({ ...all, [index]: { status: essay.verdict === 'strong' ? 'correct' : essay.verdict === 'partial' ? 'partial' : 'wrong', feedback: essay.feedback, covered: essay.covered } }));
  };

  const restart = (only: number[] | null) => {
    setAnswers((all) => (only ? Object.fromEntries(Object.entries(all).filter(([index]) => !only.includes(Number(index)))) : {}));
    setResults((all) => (only ? Object.fromEntries(Object.entries(all).filter(([index]) => !only.includes(Number(index)))) : {}));
    setCheckFailed({});
    setRetry(only);
    setTopic('all');
    setPosition(0);
    setFinished(false);
    toTop();
  };

  const remove = () => {
    showAlert('Delete this quiz?', 'It will be removed from My Rewards. This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteRewardItem(id).then((deleted) => {
            if (!deleted) {
              showAlert('Could not delete it', 'Try again in a moment.');
              return;
            }
            forgetRewardItem(id);
            void clearQuizProgress(id);
            router.back();
          });
        },
      },
    ]);
  };

  const header = (
    <View style={styles.header}>
      <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={24} color={themeColor('#352B88')} /></Pressable>
      <View style={styles.headerCopy}>
        <Text style={styles.eyebrow}>PRACTICE QUIZ · {total} QUESTIONS</Text>
        <Text style={styles.title} numberOfLines={2}>{quiz.title}</Text>
        <Text style={styles.subtitle} numberOfLines={2}>{kinds.map((kind) => TYPE_LABEL[kind]).join(' · ')}</Text>
      </View>
      <Pressable onPress={remove} style={styles.back} accessibilityRole="button" accessibilityLabel="Delete this quiz"><Ionicons name="trash-outline" size={20} color={themeColor('#C2412F')} /></Pressable>
    </View>
  );

  // The score, and every question to look at again.
  if (finished) {
    const graded = quiz.questions.map((_, index) => results[index] ?? { status: 'wrong' as const });
    const score = quizScore(graded);
    const wrong = graded.map((result, index) => (result.status === 'correct' ? -1 : index)).filter((index) => index >= 0);
    const percent = Math.round((score.points / total) * 100);
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView key="results" contentContainerStyle={styles.content}>
          {header}
          <View style={[styles.card, styles.resultCard]}>
            <Text style={styles.resultPercent}>{percent}%</Text>
            <Text style={styles.resultTitle}>{percent >= 80 ? 'Great work!' : percent >= 50 ? 'Good progress' : 'Keep practicing'}</Text>
            <Text style={styles.resultText}>
              {score.correct} of {total} right{score.partial ? ` · ${score.partial} partly right` : ''}{total - checkedCount > 0 ? ` · ${total - checkedCount} not answered` : ''}
            </Text>
          </View>
          <View style={styles.card}>
            {quiz.questions.map((question, index) => {
              const status = results[index]?.status;
              return (
                <Pressable
                  key={`${index}-${question.question}`}
                  style={({ pressed }) => [styles.reviewRow, pressed && styles.pressed]}
                  onPress={() => {
                    setRetry(null);
                    setTopic('all');
                    setPosition(index);
                    setFinished(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Question ${index + 1}, ${status === 'correct' ? 'right' : status === 'partial' ? 'partly right' : status ? 'wrong' : 'not answered'}. Open it`}
                >
                  <Ionicons name={status === 'correct' ? 'checkmark-circle' : status === 'partial' ? 'remove-circle' : status ? 'close-circle' : 'ellipse-outline'} size={20} color={themeColor(status === 'correct' ? '#2E8F5E' : status === 'partial' ? '#C98A0E' : status ? '#C2412F' : '#9A94A4')} />
                  <Text style={styles.reviewText} numberOfLines={2}>{index + 1}. {question.question}</Text>
                </Pressable>
              );
            })}
          </View>
          {wrong.length > 0 && (
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => restart(wrong)} accessibilityRole="button">
              <Ionicons name="refresh" size={18} color="#FFFFFF" />
              <Text style={styles.primaryText}>Retry the {wrong.length} I missed</Text>
            </Pressable>
          )}
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => restart(null)} accessibilityRole="button"><Text style={styles.secondaryText}>Retake the whole quiz</Text></Pressable>
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => router.replace('/quiz-maker')} accessibilityRole="button"><Text style={styles.secondaryText}>Make another quiz</Text></Pressable>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const answer = current ? answers[current.index] : undefined;
  const result = current ? results[current.index] : undefined;
  const reveal = Boolean(result) || answerKey;
  const locked = Boolean(result) || checking;
  const type = current ? typeOf(current.question) : 'multiple-choice';
  const last = at >= shown.length - 1;
  const primaryLabel = !result && !answerKey ? (checking ? 'Checking…' : type === 'essay' ? 'Check with AI' : 'Check Answer') : last ? 'See results' : 'Next question';
  const primaryDisabled = !result && !answerKey ? !current || !isAnswered(current.question, answer) || checking : false;
  const onPrimary = () => {
    if (!result && !answerKey) void check();
    else if (last) setFinished(true);
    else goTo(at + 1);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView key="quiz" ref={scroller} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {header}

        {quiz.source && (
          <View style={styles.tabs} accessibilityRole="tablist">
            {([['quiz', 'Quiz'], ['source', 'Original content']] as const).map(([key, label]) => (
              <Pressable key={key} style={[styles.tab, tab === key && styles.tabActive]} onPress={() => setTab(key)} accessibilityRole="tab" accessibilityState={{ selected: tab === key }}>
                <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {tab === 'source' && quiz.source ? (
          <View style={styles.card}>
            <Text style={styles.eyebrow}>{SOURCE_LABEL[quiz.source.kind].toUpperCase()}</Text>
            {quiz.source.name ? <Text style={styles.sourceName}>{quiz.source.name}</Text> : null}
            <Text style={styles.sourceText} selectable>{quiz.source.text}</Text>
          </View>
        ) : (
          <>
            <View style={styles.toolbar}>
              {topics.length > 1 && (
                <Pressable style={({ pressed }) => [styles.topicButton, pressed && styles.pressed]} onPress={() => setTopicsOpen((open) => !open)} accessibilityRole="button" accessibilityLabel={`Topic: ${topic === 'all' ? 'All topics' : topic}`}>
                  <Text style={styles.topicText} numberOfLines={1}>{topic === 'all' ? 'All topics' : topic}</Text>
                  <Ionicons name={topicsOpen ? 'chevron-up' : 'chevron-down'} size={16} color={themeColor('#5B42D8')} />
                </Pressable>
              )}
              <View style={styles.progressWrap} accessible accessibilityLabel={`${checkedCount} of ${total} answered`}>
                <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round((checkedCount / Math.max(1, total)) * 100)}%` }]} /></View>
                <Text style={styles.progressText}>{checkedCount}/{total}</Text>
              </View>
              {isFaculty && (
                <Pressable style={[styles.keyToggle, answerKey && styles.keyToggleOn]} onPress={() => setAnswerKey((value) => !value)} accessibilityRole="switch" accessibilityState={{ checked: answerKey }} accessibilityLabel="Answer key">
                  <Ionicons name={answerKey ? 'eye' : 'eye-off-outline'} size={14} color={themeColor(answerKey ? '#FFFFFF' : '#5B42D8')} />
                  <Text style={[styles.keyToggleText, answerKey && styles.keyToggleTextOn]}>Answer key</Text>
                </Pressable>
              )}
            </View>
            {topicsOpen && (
              <View style={styles.topicList}>
                {['all', ...topics].map((name) => (
                  <Pressable
                    key={name}
                    style={({ pressed }) => [styles.topicOption, topic === name && styles.topicOptionOn, pressed && styles.pressed]}
                    onPress={() => {
                      setTopic(name);
                      setPosition(0);
                      setTopicsOpen(false);
                    }}
                    accessibilityRole="button"
                  >
                    <Text style={[styles.topicOptionText, topic === name && styles.topicOptionTextOn]}>{name === 'all' ? 'All topics' : name}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            {retry && <Text style={styles.note}>Retrying the {retry.length} you missed. <Text style={styles.link} onPress={() => restart(null)}>Take the whole quiz</Text></Text>}

            {current && (
              <View style={styles.card}>
                <View style={styles.questionTop}>
                  <Text style={styles.questionCount}>Question {at + 1} of {shown.length}</Text>
                  <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{TYPE_LABEL[type]}</Text></View>
                </View>
                {current.question.topic ? <Text style={styles.questionTopic}>{current.question.topic}</Text> : null}
                <Text style={styles.questionText}>{current.question.question}</Text>
                {(type === 'multiple-choice' || type === 'true-false') && (
                  <Choices question={current.question} answer={answer} shown={reveal} locked={locked} onPick={(choice) => update(current.index, { choice })} styles={styles} />
                )}
                {(type === 'fill-blank' || type === 'identification') && (
                  <Typed question={current.question} answer={answer} result={result} shown={reveal} locked={locked} onType={(text) => update(current.index, { text })} styles={styles} />
                )}
                {type === 'matching' && (
                  <Matching
                    key={current.index}
                    question={current.question}
                    index={current.index}
                    answer={answer}
                    result={result}
                    shown={reveal}
                    locked={locked}
                    onMatch={(left, pair) => update(current.index, { matches: { ...(answer?.matches ?? {}), [left]: pair } })}
                    styles={styles}
                  />
                )}
                {type === 'essay' && (
                  <Essay
                    question={current.question}
                    answer={answer}
                    result={result}
                    shown={reveal}
                    locked={locked}
                    checkFailed={checkFailed[current.index] ?? ''}
                    onWrite={(essay) => update(current.index, { essay })}
                    onJudge={(status) => setResults((all) => ({ ...all, [current.index]: { status, self: true } }))}
                    styles={styles}
                  />
                )}
                {result && type !== 'essay' && (
                  <Text style={[styles.outcome, result.status === 'correct' ? styles.outcomeRight : result.status === 'partial' ? styles.outcomeMid : styles.outcomeWrong]}>
                    {result.status === 'correct' ? 'Correct!' : result.status === 'partial' ? 'Partly right' : 'Not quite'}
                  </Text>
                )}
                {reveal && current.question.explanation ? (
                  <View style={styles.why}>
                    <Text style={styles.whyTitle}>Why</Text>
                    <Text style={styles.whyText}>{current.question.explanation}</Text>
                  </View>
                ) : null}
              </View>
            )}

            <View style={styles.controls}>
              <Pressable style={({ pressed }) => [styles.arrow, at === 0 && styles.disabled, pressed && styles.pressed]} onPress={() => goTo(at - 1)} disabled={at === 0} accessibilityRole="button" accessibilityLabel="Previous question">
                <Ionicons name="chevron-back" size={20} color={themeColor('#5B42D8')} />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primary, styles.controlMain, primaryDisabled && styles.disabled, pressed && styles.pressed]} onPress={onPrimary} disabled={primaryDisabled} accessibilityRole="button">
                {checking ? <ActivityIndicator color="#FFFFFF" /> : null}
                <Text style={styles.primaryText}>{primaryLabel}</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.arrow, last && styles.disabled, pressed && styles.pressed]} onPress={() => goTo(at + 1)} disabled={last} accessibilityRole="button" accessibilityLabel="Next question">
                <Ionicons name="chevron-forward" size={20} color={themeColor('#5B42D8')} />
              </Pressable>
            </View>
            {checkedCount > 0 && !last && (
              <Pressable onPress={() => setFinished(true)} accessibilityRole="button" hitSlop={8}><Text style={[styles.link, styles.centerText]}>Finish and see my score</Text></Pressable>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F7F8FF' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 0.6, color: '#7E5EE8' },
  title: { fontSize: 21, fontWeight: '900', color: '#24212D' },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488', marginTop: 2, textAlign: 'left' },
  card: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  tabs: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: '#F1EEF8' },
  tab: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  tabActive: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CDBDF8' },
  tabText: { fontSize: 13, fontWeight: '800', color: '#7A7488' },
  tabTextActive: { color: '#5B42D8' },
  toolbar: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10 },
  topicButton: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 260, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#CDBDF8', backgroundColor: '#FFFFFF' },
  topicText: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  topicList: { gap: 4, padding: 6, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E0FB' },
  topicOption: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10 },
  topicOptionOn: { backgroundColor: '#F1ECFF' },
  topicOptionText: { fontSize: 13, fontWeight: '700', color: '#3A3648' },
  topicOptionTextOn: { color: '#4A34C4', fontWeight: '900' },
  progressWrap: { flex: 1, minWidth: 140, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bar: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#EEEAF5', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: '#7E5EE8' },
  progressText: { fontSize: 12, fontWeight: '800', color: '#5F5A70' },
  keyToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, borderWidth: 1, borderColor: '#CDBDF8' },
  keyToggleOn: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  keyToggleText: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  keyToggleTextOn: { color: '#FFFFFF' },
  questionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  questionCount: { fontSize: 13, fontWeight: '700', color: '#6E6887' },
  typeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#F1ECFF' },
  typeBadgeText: { fontSize: 12, fontWeight: '800', color: '#6D4FE0' },
  questionTopic: { fontSize: 12, fontWeight: '700', color: '#8A80B8' },
  questionText: { fontSize: 18, lineHeight: 26, fontWeight: '800', color: '#24212D' },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  choice: { flexGrow: 1, flexBasis: 240, minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#E3DDF2', backgroundColor: '#FFFFFF' },
  choiceWide: { flexBasis: 120, justifyContent: 'center' },
  choicePicked: { borderColor: '#7E5EE8', backgroundColor: '#F5F1FF' },
  choiceRight: { borderColor: '#2E8F5E', backgroundColor: '#E9F7EF' },
  choiceWrong: { borderColor: '#C2412F', backgroundColor: '#FDECEA' },
  letter: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#D8D2E8' },
  letterPicked: { backgroundColor: '#7E5EE8', borderColor: '#7E5EE8' },
  letterRight: { backgroundColor: '#2E8F5E', borderColor: '#2E8F5E' },
  letterWrong: { backgroundColor: '#C2412F', borderColor: '#C2412F' },
  letterText: { fontSize: 12, fontWeight: '900', color: '#6E6887' },
  letterTextOn: { color: '#FFFFFF' },
  choiceText: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: '600', color: '#2D2A3D' },
  choiceTextCenter: { textAlign: 'center', fontWeight: '800' },
  gap: { gap: 10 },
  input: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: '#E0D9F5', backgroundColor: '#FBFAFF', paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, color: '#24212D' },
  inputRight: { borderColor: '#2E8F5E', backgroundColor: '#E9F7EF' },
  inputWrong: { borderColor: '#C2412F', backgroundColor: '#FDECEA' },
  webInput: { outlineStyle: 'none' } as object,
  essayInput: { minHeight: 150 },
  keyLine: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#3A3648' },
  keyStrong: { fontWeight: '900', color: '#2E8F5E' },
  matchRow: { gap: 6 },
  matchLeft: { fontSize: 15, fontWeight: '800', color: '#2D2A3D' },
  matchSlot: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: '#E3DDF2', backgroundColor: '#FFFFFF' },
  matchChosen: { borderColor: '#7E5EE8', backgroundColor: '#F5F1FF' },
  matchSlotText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#2D2A3D' },
  matchPlaceholder: { color: '#9A94A4' },
  matchOptions: { gap: 6, padding: 6, borderRadius: 12, backgroundColor: '#F7F4FF' },
  matchOption: { paddingHorizontal: 10, paddingVertical: 10, borderRadius: 10, backgroundColor: '#FFFFFF' },
  matchOptionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#2D2A3D' },
  matchUsed: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#9A94A4' },
  verdict: { gap: 4, padding: 12, borderRadius: 14 },
  verdictGood: { backgroundColor: '#E9F7EF' },
  verdictMid: { backgroundColor: '#FFF4D9' },
  verdictLow: { backgroundColor: '#FDECEA' },
  verdictTitle: { fontSize: 14, fontWeight: '900', color: '#2D2A3D' },
  verdictText: { fontSize: 14, lineHeight: 20, color: '#3A3648' },
  keyBox: { gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F7F4FF' },
  keyTitle: { fontSize: 13, fontWeight: '900', color: '#4A34C4' },
  keyPoint: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  keyPointText: { flex: 1, fontSize: 14, lineHeight: 20, color: '#3A3648' },
  sample: { fontSize: 14, lineHeight: 20, color: '#3A3648' },
  judgeRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  judgeLabel: { width: '100%', fontSize: 13, fontWeight: '800', color: '#3A3648' },
  judge: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#CDBDF8', backgroundColor: '#FFFFFF' },
  judgeText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  outcome: { fontSize: 15, fontWeight: '900' },
  outcomeRight: { color: '#2E8F5E' },
  outcomeMid: { color: '#B4701C' },
  outcomeWrong: { color: '#C2412F' },
  why: { gap: 4, padding: 12, borderRadius: 14, backgroundColor: '#F5F3FA' },
  whyTitle: { fontSize: 12, fontWeight: '900', color: '#6E6887' },
  whyText: { fontSize: 14, lineHeight: 20, color: '#3A3648' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  arrow: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#CDBDF8', backgroundColor: '#FFFFFF' },
  controlMain: { flex: 1 },
  primary: { flexDirection: 'row', gap: 8, minHeight: 52, paddingHorizontal: 18, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  secondary: { minHeight: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: '#DCD3F5', backgroundColor: '#FFFFFF' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#5B42D8' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.85 },
  note: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#6E6887' },
  link: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  centerText: { textAlign: 'center' },
  sourceName: { fontSize: 16, fontWeight: '900', color: '#24212D' },
  sourceText: { fontSize: 14, lineHeight: 21, color: '#3A3648' },
  resultCard: { alignItems: 'center', paddingVertical: 26, gap: 6 },
  resultPercent: { fontSize: 44, fontWeight: '900', color: '#5B42D8' },
  resultTitle: { fontSize: 19, fontWeight: '900', color: '#24212D' },
  resultText: { fontSize: 14, fontWeight: '600', color: '#5F5A70', textAlign: 'center' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  reviewText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#2D2A3D' },
});
