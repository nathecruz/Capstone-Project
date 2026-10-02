// The last seven days at a glance: one bar per day, filled by the share of habits checked in.
import React from 'react';
import { Text, View } from 'react-native';
import { getRecentCompletionHistory } from '@/hooks/app-state/habit-progress';
import type { Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';

const BAR_HEIGHT = 44;

/** Share of habits checked in on each of the last seven days (oldest first), from 0 to 1. */
export function weekCompletion(habits: Habit[], today = new Date()) {
  return getRecentCompletionHistory(habits, 7, today).map((day, index, days) => ({
    ...day,
    share: habits.length ? Math.min(1, day.count / habits.length) : 0,
    isToday: index === days.length - 1,
  }));
}

export function WeekStrip({ habits, style }: { habits: Habit[]; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const days = weekCompletion(habits);
  const perfectDays = days.filter((day) => day.share === 1).length;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <Text style={styles.title}>Last 7 days</Text>
        <Text style={styles.summary}>{perfectDays} perfect day{perfectDays === 1 ? '' : 's'}</Text>
      </View>
      <View style={styles.bars}>
        {days.map((day) => (
          <View
            key={day.dateKey}
            style={styles.day}
            accessible
            accessibilityLabel={`${day.label}: ${day.count} of ${habits.length} habits done`}
          >
            <View style={styles.track}>
              <View style={[styles.fill, day.share === 1 && styles.fillPerfect, { height: Math.max(day.count ? 6 : 0, Math.round(day.share * BAR_HEIGHT)) }]} />
            </View>
            <Text style={[styles.label, day.isToday && styles.labelToday]}>{day.isToday ? 'Today' : day.label.slice(0, 3)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    shadowColor: '#201444',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  title: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  summary: { fontSize: 12, fontWeight: '700', color: '#777282' },
  bars: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  day: { flex: 1, alignItems: 'center', gap: 6 },
  track: { width: 14, height: BAR_HEIGHT, borderRadius: 7, backgroundColor: '#EFEBFA', justifyContent: 'flex-end', overflow: 'hidden' },
  fill: { width: '100%', borderRadius: 7, backgroundColor: '#8B78E8' },
  fillPerfect: { backgroundColor: '#5B42D8' },
  label: { fontSize: 10, fontWeight: '700', color: '#8A8492' },
  labelToday: { color: '#5B42D8', fontWeight: '800' },
});
