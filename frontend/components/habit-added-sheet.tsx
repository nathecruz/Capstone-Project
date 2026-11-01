// The sheet after a habit is added (from the Add screen or a one-tap template): what was added, when
// it reminds, and how its check-in is proven.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import type { HabitProof } from '@/hooks/app-state/types';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { proofIcon, proofText } from '@/utils/habit-templates';

export type AddedHabit = { label: string; category: string; schedule: string; reminder: string; proof?: HabitProof };

/** How the student checks this habit in. */
export function proofHowTo(proof: HabitProof | undefined) {
  if (proof?.type === 'timer') return `Check in by finishing the ${proof.minutes}-minute Focus timer.`;
  if (proof?.type === 'steps') return `Check in by walking ${proof.steps.toLocaleString('en-US')} steps with HabitAI open on your phone.`;
  if (proof?.type === 'photo') return 'Check in by taking a photo of it when you are done.';
  return '';
}

export function HabitAddedSheet({ habit, onClose, onViewHabits }: { habit: AddedHabit | null; onClose: () => void; onViewHabits: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const accent = themeColor('#5B42D8');
  const rows = habit ? [
    { icon: 'pricetag-outline' as const, text: habit.category },
    { icon: 'calendar-outline' as const, text: habit.schedule },
    { icon: 'notifications-outline' as const, text: habit.reminder },
    ...(habit.proof ? [{ icon: proofIcon(habit.proof), text: proofText(habit.proof) }] : []),
  ] : [];
  return (
    <Modal visible={Boolean(habit)} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
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
              {habit.proof && <Text style={styles.howTo}>{proofHowTo(habit.proof)}</Text>}
            </View>
          )}
          <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={onViewHabits} accessibilityRole="button">
            <Text style={styles.buttonText}>View My Habits</Text>
            <Ionicons name="arrow-forward" size={17} color="#FFFFFF" />
          </Pressable>
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
            <Text style={styles.secondaryText}>Add another</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center' },
  icon: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#49B878', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  title: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  body: { fontSize: 12, color: '#777282', fontWeight: '600', marginTop: 7, textAlign: 'center' },
  summary: { width: '100%', backgroundColor: '#F7F4FF', borderWidth: 1, borderColor: '#E6DEFF', borderRadius: 15, padding: 14, marginTop: 18, gap: 10 },
  name: { fontSize: 16, color: '#302B3B', fontWeight: '900', marginBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowText: { flex: 1, fontSize: 12, color: '#625B72', fontWeight: '700' },
  howTo: { fontSize: 12, lineHeight: 17, color: '#4A3E8C', fontWeight: '700' },
  button: { width: '100%', height: 46, borderRadius: 13, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondary: { width: '100%', height: 42, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  secondaryText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.8 },
});
