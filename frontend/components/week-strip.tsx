// The last seven days at a glance: one bar per day, filled by the share of that day's habits checked in.
import React from 'react';
import { Text, View } from 'react-native';
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';
import type { Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';
import { isHabitActiveOn } from '@/utils/habit-week';
import { isHabitScheduledOn } from '@/utils/streaks';

const BAR_HEIGHT = 44;

type DayHabit = Pick<Habit, 'completionDates' | 'startDate' | 'activeUntil' | 'frequency' | 'meta' | 'reminderDays'>;

/**
 * One day's completion, from every habit (habits last one week, utils/habit-week.ts): `due` is the
 * habits due that day (active then and scheduled) and `done` how many of them were checked in. A
 * habit checked in on a day it was not scheduled counts as due and done, so `share` never goes above
 * 1. Habits of other weeks, or not started yet, do not count, so a past week is measured by its own
 * habits and never by how many there are now.
 */
export function dayCompletion(habits: DayHabit[], dateKey: string) {
  let due = 0;
  let done = 0;
  for (const habit of habits) {
    if (!isHabitActiveOn(habit, dateKey)) continue;
    const checkedIn = habit.completionDates.includes(dateKey);
    if (checkedIn || isHabitScheduledOn(habit, dateKey)) due += 1;
    if (checkedIn) done += 1;
  }
  return { due, done, share: due ? done / due : 0 };
}

/** The `days` days ending on `today` (oldest first), each with its completion. */
export function recentDayCompletion(habits: DayHabit[], days: number, today = new Date()) {
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - index));
    const dateKey = getLocalDateKey(date);
    return { dateKey, label: date.toLocaleDateString('en-US', { weekday: 'short' }), ...dayCompletion(habits, dateKey) };
  });
}

/** The share (0 to 1) of the check-ins due over these days that were done; 0 when none were due. */
export function periodShare(days: { due: number; done: number }[]) {
  const due = days.reduce((sum, day) => sum + day.due, 0);
  return due ? days.reduce((sum, day) => sum + day.done, 0) / due : 0;
}

/** Share of each of the last seven days' habits checked in (oldest first), from 0 to 1. */
export function weekCompletion(habits: Habit[], today = new Date()) {
  return recentDayCompletion(habits, 7, today).map((day, index, days) => ({ ...day, isToday: index === days.length - 1 }));
}

/** Pass every habit, also those of past weeks: each day counts the habits of its own week. */
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
            accessibilityLabel={`${day.label}: ${day.done} of ${day.due} habits done`}
          >
            <View style={styles.track}>
              <View style={[styles.fill, day.share === 1 && styles.fillPerfect, { height: Math.max(day.done ? 6 : 0, Math.round(day.share * BAR_HEIGHT)) }]} />
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
