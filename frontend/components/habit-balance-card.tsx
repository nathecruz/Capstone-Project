// Health and Academics this week: a split bar and, when all habits are of one area, a nudge to add
// one of the other (it opens the Add screen on that area).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { Habit } from '@/hooks/app-state/types';
import { useHabitCategories } from '@/hooks/use-habit-categories';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { habitBalance } from '@/utils/habit-balance';

export function HabitBalanceCard({ habits }: { habits: Habit[] }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const categories = useHabitCategories();
  const balance = habitBalance(habits);
  if (!habits.length) return null;
  const colorOf = (label: string) => themeColor(categories.find((item) => item.label === label)?.color || '#5B42D8');
  const total = balance.Health + balance.Academics;
  const message = balance.missing
    ? `All your habits this week are ${balance.missing === 'Health' ? 'Academics' : 'Health'}. Add a ${balance.missing} habit to balance your week.`
    : 'Your week has both Health and Academics habits.';
  return (
    <View style={styles.card} accessible={!balance.missing} accessibilityLabel={`Habit balance: ${balance.Health} Health, ${balance.Academics} Academics. ${message}`}>
      <View style={styles.header}>
        <Ionicons name="scale-outline" size={18} color={themeColor('#5B42D8')} />
        <Text style={styles.title}>Health and Academics</Text>
      </View>
      <View style={styles.bar}>
        {(['Health', 'Academics'] as const).map((label) => balance[label] > 0 && (
          <View key={label} style={[styles.segment, { flex: balance[label] / total, backgroundColor: colorOf(label) }]} />
        ))}
      </View>
      <View style={styles.legend}>
        {(['Health', 'Academics'] as const).map((label) => (
          <View key={label} style={styles.legendItem}>
            <View style={[styles.dot, { backgroundColor: colorOf(label) }]} />
            <Text style={styles.legendText}>{label} {balance[label]}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.message}>{message}</Text>
      {balance.missing && (
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => router.push({ pathname: '/(tabs)/add', params: { category: balance.missing ?? undefined } })} accessibilityRole="button" accessibilityLabel={`Add a ${balance.missing} habit`}>
          <Ionicons name="add" size={16} color="#FFFFFF" />
          <Text style={styles.buttonText}>Add a {balance.missing} habit</Text>
        </Pressable>
      )}
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, gap: 10, borderWidth: 1, borderColor: '#ECE6F8', marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  bar: { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', backgroundColor: '#EEEAF5', gap: 2 },
  segment: { height: 10 },
  legend: { flexDirection: 'row', gap: 16 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, fontWeight: '800', color: '#4A4458' },
  message: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#777282' },
  button: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, minHeight: 38, borderRadius: 12, backgroundColor: '#5B42D8' },
  buttonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  pressed: { opacity: 0.8 },
});
