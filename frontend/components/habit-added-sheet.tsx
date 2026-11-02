// The sheet after a habit is added (from the Add screen or a one-tap template): what was added, how
// its check-in is proven, and a few follow-up questions (the capstone panel: the AI asks about what
// was added). The app's own questions set the habit as they are answered (its reminder time, the
// minutes or steps of its proof); the AI's adds a question about this habit, and the answers end
// with a tip (backend services/habit-follow-up.js; the rules answer without the AI).
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { getHabitFollowUp, getHabitInsight, type FollowUpOption, type FollowUpQuestion } from '@/authentication/authService';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import type { HabitProof } from '@/hooks/app-state/types';
import { useHabitCategories } from '@/hooks/use-habit-categories';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { editedHabitFields } from '@/utils/habit-edit';
import { proofIcon, proofText } from '@/utils/habit-templates';

export type AddedHabit = { id: string; label: string; category: string; schedule: string; reminder: string; proof?: HabitProof };

/** How the student checks this habit in. */
export function proofHowTo(proof: HabitProof | undefined) {
  if (proof?.type === 'timer') return `Check in by finishing the ${proof.minutes}-minute Focus timer.`;
  if (proof?.type === 'steps') return `Check in by walking ${proof.steps.toLocaleString('en-US')} steps with HabitAI open on your phone.`;
  if (proof?.type === 'photo') return 'Check in by taking a photo of it when you are done.';
  return '';
}

/** The follow-up questions of one added habit, answered with a tap each, then its tip. */
function FollowUp({ habit }: { habit: AddedHabit }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { habits, updateHabit } = useAppColorScheme();
  const categories = useHabitCategories();
  const [questions, setQuestions] = useState<FollowUpQuestion[] | null>(null);
  const [source, setSource] = useState<'ai' | 'rules'>('rules');
  const [unavailable, setUnavailable] = useState(false);
  const [answers, setAnswers] = useState<Record<string, FollowUpOption>>({});
  const [insight, setInsight] = useState('');
  const { label, category, proof } = habit;

  useEffect(() => {
    let active = true;
    void getHabitFollowUp({ label, category, ...(proof ? { proof } : {}) }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setUnavailable(true);
        return;
      }
      setQuestions(result.questions);
      setSource(result.source);
    });
    return () => {
      active = false;
    };
  }, [category, label, proof]);

  const answer = (question: FollowUpQuestion, option: FollowUpOption) => {
    const current = habits.find((item) => item.id === habit.id);
    if (current && option.reminderTime) {
      updateHabit(current.id, editedHabitFields(current, { label: current.label, category: current.category, frequency: current.frequency, reminders: [option.reminderTime] }, categories));
    }
    if (current && option.proof) {
      updateHabit(current.id, { ...editedHabitFields(current, { label: current.label, category: current.category, frequency: current.frequency }, categories), proof: option.proof });
    }
    const next = { ...answers, [question.id]: option };
    setAnswers(next);
    if (questions && !insight && questions.every((item) => next[item.id])) {
      const replies = questions.map((item) => ({ question: item.text, answer: next[item.id].label }));
      void getHabitInsight({ label, category, ...(proof ? { proof } : {}) }, replies).then((result) => {
        if (result.ok) setInsight(result.insight);
      });
    }
  };

  if (unavailable) return null;
  return (
    <View style={styles.followUp}>
      <View style={styles.followUpHeader}>
        <Ionicons name="sparkles" size={16} color={themeColor('#5B42D8')} />
        <Text style={styles.followUpTitle}>Make it yours</Text>
        {source === 'ai' && <Text style={styles.aiBadge}>AI</Text>}
      </View>
      {!questions ? (
        <ActivityIndicator color={themeColor('#5B42D8')} accessibilityLabel="Loading questions" />
      ) : (
        questions.map((question) => (
          <View key={question.id} style={styles.question}>
            <Text style={styles.questionText}>{question.text}</Text>
            <View style={styles.options} accessibilityRole="radiogroup" accessibilityLabel={question.text}>
              {question.options.map((option) => {
                const chosen = answers[question.id]?.id === option.id;
                return (
                  <Pressable key={option.id} style={({ pressed }) => [styles.option, chosen && styles.optionChosen, pressed && styles.pressed]} onPress={() => answer(question, option)} accessibilityRole="radio" accessibilityState={{ checked: chosen }} accessibilityLabel={option.label}>
                    <Text style={[styles.optionText, chosen && styles.optionTextChosen]}>{option.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))
      )}
      {insight ? (
        <View style={styles.insight} accessibilityLiveRegion="polite">
          <Ionicons name="bulb" size={16} color={themeColor('#B7791F')} />
          <Text style={styles.insightText}>{insight}</Text>
        </View>
      ) : null}
    </View>
  );
}

export function HabitAddedSheet({ habit, onClose, onViewHabits }: { habit: AddedHabit | null; onClose: () => void; onViewHabits: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { habits } = useAppColorScheme();
  const accent = themeColor('#5B42D8');
  // As the follow-up answers change it (its reminder, its proof).
  const live = habit ? habits.find((item) => item.id === habit.id) : undefined;
  const reminder = live ? (live.reminderEnabled ? (live.reminderTimes ?? [live.reminderTime]).join(', ') : 'Reminders off') : habit?.reminder;
  const proof = live?.proof ?? habit?.proof;
  const rows = habit ? [
    { icon: 'pricetag-outline' as const, text: habit.category },
    { icon: 'calendar-outline' as const, text: habit.schedule },
    { icon: 'notifications-outline' as const, text: reminder ?? '' },
    ...(proof ? [{ icon: proofIcon(proof), text: proofText(proof) }] : []),
  ] : [];
  return (
    <Modal visible={Boolean(habit)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.cardContent} showsVerticalScrollIndicator={false}>
            <View style={styles.icon}><Ionicons name="checkmark" size={28} color="#FFFFFF" /></View>
            <Text style={styles.title}>Habit added</Text>
            <Text style={styles.body}>Your new habit is ready to track.</Text>
            {habit && (
              <View style={styles.summary}>
                <Text style={styles.name}>{habit.label}</Text>
                {rows.map((row) => (
                  <View key={row.icon} style={styles.row}>
                    <Ionicons name={row.icon} size={16} color={accent} />
                    <Text style={styles.rowText}>{row.text}</Text>
                  </View>
                ))}
                {proof && <Text style={styles.howTo}>{proofHowTo(proof)}</Text>}
              </View>
            )}
            {habit && <FollowUp key={habit.id} habit={habit} />}
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onViewHabits} accessibilityRole="button">
              <Text style={styles.buttonText}>View My Habits</Text>
              <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
            </Pressable>
            <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryText}>Add another</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  card: { width: '100%', maxWidth: 380, maxHeight: '90%', backgroundColor: '#FFFFFF', borderRadius: 24 },
  cardContent: { padding: 22, alignItems: 'center' },
  icon: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#49B878', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  title: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  body: { fontSize: 12, color: '#777282', fontWeight: '600', marginTop: 7, textAlign: 'center' },
  summary: { width: '100%', backgroundColor: '#F7F4FF', borderWidth: 1, borderColor: '#E6DEFF', borderRadius: 15, padding: 14, marginTop: 18, gap: 10 },
  name: { fontSize: 16, color: '#302B3B', fontWeight: '900', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, fontSize: 12, color: '#625B72', fontWeight: '700' },
  howTo: { fontSize: 12, lineHeight: 17, color: '#4A3E8C', fontWeight: '700' },
  followUp: { width: '100%', marginTop: 14, gap: 12 },
  followUpHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  followUpTitle: { flex: 1, fontSize: 14, fontWeight: '900', color: '#302B3B' },
  aiBadge: { fontSize: 10, fontWeight: '900', color: '#5B42D8', backgroundColor: '#EEE8FF', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, overflow: 'hidden' },
  question: { gap: 8 },
  questionText: { fontSize: 13, fontWeight: '800', color: '#3B3650' },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: { minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#DCD3F5', backgroundColor: '#FFFFFF', justifyContent: 'center' },
  optionChosen: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  optionText: { fontSize: 12, fontWeight: '800', color: '#4A4458' },
  optionTextChosen: { color: '#FFFFFF' },
  insight: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#FFF7E8' },
  insightText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '700', color: '#5C4A1E' },
  button: { width: '100%', height: 46, borderRadius: 13, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondary: { width: '100%', height: 42, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
