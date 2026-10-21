// Insights > Predictions: each habit analysed by the machine-learning model (chance of doing it
// next time, dropout risk) and the AI (best time, three steps, what to watch out for). Habits last
// one week: this week's come first, then those of the last four weeks, so their history can still
// be analysed (the server counts an ended habit only up to its last day).
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { analyzeHabit, type HabitAnalysis } from '@/authentication';
import type { Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { hasHabitEnded, weekEndKey } from '@/utils/habit-week';

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** How many past weeks of ended habits can still be picked. */
const PAST_WEEKS = 4;

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const shortDate = (dateKey: string) => new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** "Last week", or the Monday-to-Sunday dates of an older week that ended on `weekEnd` (a Sunday). */
export function pastWeekLabel(weekEnd: string, today: string) {
  if (weekEnd === shiftDay(weekEndKey(today), -7)) return 'Last week';
  return `${shortDate(shiftDay(weekEnd, -6))} – ${shortDate(weekEnd)}`;
}

/**
 * The habits that can be analysed: this week's first, in the student's order, then those whose week
 * ended in the last four weeks, the newest first, each with its week as `week`. Older ones only
 * count in the history totals.
 */
export function analysableHabits(habits: Habit[], today: string): { habit: Habit; week: string | null }[] {
  const oldest = shiftDay(weekEndKey(today), -7 * PAST_WEEKS);
  const lastDay = (habit: Habit) => habit.activeUntil ?? '';
  const ended = habits
    .filter((habit) => hasHabitEnded(habit, today) && lastDay(habit) >= oldest)
    .sort((a, b) => lastDay(b).localeCompare(lastDay(a)));
  return [
    ...habits.filter((habit) => !hasHabitEnded(habit, today)).map((habit) => ({ habit, week: null })),
    ...ended.map((habit) => ({ habit, week: pastWeekLabel(lastDay(habit), today) })),
  ];
}

/** `habits` is every habit, also those of past weeks. */
export function HabitAnalysisPanel({ habits, now }: { habits: Habit[]; now?: Date }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Results of this visit, so switching between habits does not ask the server again.
  const [results, setResults] = useState<Record<string, HabitAnalysis>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; message: string } | null>(null);
  const today = getLocalDateKey(now ?? new Date());
  const choices = useMemo(() => analysableHabits(habits, today), [habits, today]);
  const choice = choices.find((item) => item.habit.id === selectedId) ?? choices[0] ?? null;
  const selected = choice?.habit ?? null;
  const analysis = selected ? results[selected.id] : undefined;

  const run = useCallback(async (habit: Habit) => {
    setLoadingId(habit.id);
    setError(null);
    const result = await analyzeHabit(habit.id);
    setLoadingId((current) => (current === habit.id ? null : current));
    if (result.ok) setResults((current) => ({ ...current, [habit.id]: result.analysis }));
    else setError({ id: habit.id, message: result.message });
  }, []);

  // Analyses the shown habit automatically the first time it is shown.
  const selectedHabitId = selected?.id;
  useEffect(() => {
    if (!selectedHabitId || results[selectedHabitId] || loadingId) return;
    if (error?.id === selectedHabitId) return;
    const habit = choices.find((item) => item.habit.id === selectedHabitId)?.habit;
    // Deferred, so the request starts after this render instead of inside the effect.
    const timer = setTimeout(() => { if (habit) void run(habit); }, 0);
    return () => clearTimeout(timer);
  }, [selectedHabitId, results, loadingId, error, choices, run]);

  if (!selected) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Habit analysis</Text>
        <Text style={styles.muted}>Add a habit and check it in for a few days to get its analysis.</Text>
      </View>
    );
  }

  const loading = loadingId === selected.id;
  const failed = error?.id === selected.id ? error.message : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}><Ionicons name="analytics" size={18} color={themeColor('#5B42D8')} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Habit analysis</Text>
          <Text style={styles.muted}>Machine learning + AI, from your real check-ins</Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {choices.map(({ habit, week }) => {
          const active = habit.id === selected.id;
          return (
            <Pressable
              key={habit.id}
              style={[styles.chip, week !== null && styles.chipPast, active && styles.chipActive]}
              onPress={() => setSelectedId(habit.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={week ? `${habit.label}, ${week}` : habit.label}
            >
              <Ionicons name={habit.icon} size={14} color={active ? themeColor('#5B42D8') : themeColor('#85808D')} />
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{habit.label}</Text>
              {week ? <Text style={[styles.chipWeek, active && styles.chipWeekActive]} numberOfLines={1}>{week}</Text> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {choice?.week ? (
        <View style={styles.pastNote}>
          <Ionicons name="time-outline" size={14} color={themeColor('#6E6887')} />
          <Text style={styles.pastNoteText}>{choice.week === 'Last week' ? "Last week's habit" : `A habit of ${choice.week}`}: its week has ended. Its check-ins stay in your history.</Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={themeColor('#5B42D8')} />
          <Text style={styles.muted}>Analysing your check-ins for {selected.label}…</Text>
        </View>
      ) : failed ? (
        <View style={styles.loading}>
          <Text style={styles.errorText}>{failed}</Text>
          <Pressable style={styles.retryButton} onPress={() => void run(selected)} accessibilityRole="button">
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : analysis ? (
        <View style={styles.result}>
          <View style={styles.metrics}>
            {[
              { label: 'Chance next time', value: analysis.ml ? percent(analysis.ml.completionProbability) : '—' },
              { label: 'Done (4 weeks)', value: analysis.stats.scheduledDays ? `${analysis.stats.completedDays}/${analysis.stats.scheduledDays}` : '—' },
              { label: 'Streak', value: String(analysis.stats.streak) },
            ].map((metric) => (
              <View key={metric.label} style={styles.metric}>
                <Text style={styles.metricValue}>{metric.value}</Text>
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.source}>
            {analysis.ml
              ? `${analysis.ml.source === 'model' ? 'ML model forecast' : 'ML estimate (rules, until a trained model is approved)'}${analysis.ml.dropoutRisk !== null ? ` · dropout risk ${percent(analysis.ml.dropoutRisk)}` : ''}`
              : 'The ML forecast is unavailable right now.'}
          </Text>
          {(analysis.stats.strongestWeekday || analysis.stats.usualCheckInTime) && (
            <Text style={styles.pattern}>
              {[analysis.stats.strongestWeekday && `Best on ${analysis.stats.strongestWeekday}`, analysis.stats.weakestWeekday && `hardest on ${analysis.stats.weakestWeekday}`, analysis.stats.usualCheckInTime && `usually done around ${analysis.stats.usualCheckInTime}`].filter(Boolean).join(' · ')}
            </Text>
          )}

          {analysis.ai ? (
            <View style={styles.advice}>
              <Text style={styles.headline}>{analysis.ai.headline}</Text>
              {analysis.ai.strength ? (
                <View style={styles.strength}>
                  <Ionicons name="checkmark-circle-outline" size={15} color={themeColor('#2E9D5C')} />
                  <Text style={styles.strengthText}>{analysis.ai.strength}</Text>
                </View>
              ) : null}
              <View style={styles.bestTime}>
                <Ionicons name="time-outline" size={15} color={themeColor('#5B42D8')} />
                <Text style={styles.bestTimeText}>{analysis.ai.bestTime}</Text>
              </View>
              {analysis.ai.steps.map((step, index) => (
                <View key={step} style={styles.step}>
                  <Text style={styles.stepNumber}>{index + 1}</Text>
                  <Text style={styles.stepText}>{step}</Text>
                </View>
              ))}
              <View style={styles.watchOut}>
                <Ionicons name="alert-circle-outline" size={15} color={themeColor('#C27A1A')} />
                <Text style={styles.watchOutText}>{analysis.ai.watchOut}</Text>
              </View>
              {analysis.ai.encouragement ? (
                <View style={styles.encouragement}>
                  <Ionicons name="heart" size={14} color={themeColor('#C2549B')} />
                  <Text style={styles.encouragementText}>{analysis.ai.encouragement}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.noAdvice}>
              <Text style={styles.muted}>{analysis.ml?.recommendedAction || 'AI advice is unavailable right now.'}</Text>
              {analysis.aiStatus === 'limited' && (
                <View style={styles.limitNote}>
                  <Ionicons name="hourglass-outline" size={14} color={themeColor('#8A5A12')} />
                  <Text style={styles.limitText}>New AI advice is paused for a few minutes (AI limit). The forecast above is always up to date.</Text>
                </View>
              )}
            </View>
          )}

          <Pressable style={styles.refresh} onPress={() => void run(selected)} accessibilityRole="button" accessibilityLabel={`Analyse ${selected.label} again`}>
            <Ionicons name="refresh" size={14} color={themeColor('#5B42D8')} />
            <Text style={styles.refreshText}>Analyse again</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 12, marginBottom: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#F1EEFF', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontSize: 17, fontWeight: '800', color: '#2D2A3D' },
  muted: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A728B' },
  noAdvice: { gap: 8 },
  limitNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, padding: 10, borderRadius: 12, backgroundColor: '#FFF6E5' },
  limitText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#8A5A12' },
  chips: { gap: 8, paddingRight: 4 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: 200, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E4E0EC', backgroundColor: '#FFFFFF' },
  chipActive: { borderColor: '#5B42D8', backgroundColor: '#F1EEFF' },
  chipText: { flexShrink: 1, fontSize: 13, fontWeight: '600', color: '#5E5868' },
  chipTextActive: { color: '#5B42D8', fontWeight: '800' },
  // A habit of a past week: dashed, with its week after the name.
  chipPast: { maxWidth: 260, borderStyle: 'dashed' },
  chipWeek: { flexShrink: 0, fontSize: 11, fontWeight: '700', color: '#8A8492' },
  chipWeekActive: { color: '#6E58D8' },
  pastNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, padding: 10, borderRadius: 12, backgroundColor: '#F7F5FC' },
  pastNoteText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#5E5868' },
  loading: { alignItems: 'center', gap: 10, paddingVertical: 18 },
  errorText: { fontSize: 13, fontWeight: '600', color: '#C24456', textAlign: 'center' },
  retryButton: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: '#5B42D8' },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  result: { gap: 10 },
  metrics: { flexDirection: 'row', gap: 8 },
  metric: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: '#F7F5FC' },
  metricValue: { fontSize: 18, fontWeight: '800', color: '#2D2A3D' },
  metricLabel: { marginTop: 2, fontSize: 10, fontWeight: '700', color: '#7A728B', textAlign: 'center' },
  source: { fontSize: 11, fontWeight: '600', color: '#7A728B' },
  pattern: { fontSize: 12, fontWeight: '700', color: '#4B4558' },
  advice: { gap: 8, padding: 12, borderRadius: 16, backgroundColor: '#F7F5FC' },
  headline: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#2D2A3D' },
  strength: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  strengthText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#237A4D', fontWeight: '700' },
  bestTime: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  bestTimeText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#4B3BB0' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepNumber: { width: 20, height: 20, borderRadius: 10, overflow: 'hidden', backgroundColor: '#5B42D8', color: '#FFFFFF', fontSize: 11, fontWeight: '800', textAlign: 'center', lineHeight: 20 },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19, color: '#3B3746', fontWeight: '600' },
  watchOut: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingTop: 4 },
  watchOutText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#7A5A1A', fontWeight: '600' },
  encouragement: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
  encouragementText: { flex: 1, fontSize: 12, lineHeight: 17, color: '#8A3A6B', fontWeight: '700' },
  refresh: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, paddingVertical: 4 },
  refreshText: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
});
