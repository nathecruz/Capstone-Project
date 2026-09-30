import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';

const weekdays = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function getCalendarDays(month: Date) {
  const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const days: (Date | null)[] = Array(mondayOffset).fill(null);

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }

  return days;
}

function isSameDate(firstDate: Date, secondDate: Date) {
  return firstDate.toDateString() === secondDate.toDateString();
}

function formatDate(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function getDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getInsightMessages(completedCount: number, habitCount: number) {
  const completionPercent = habitCount ? Math.round((completedCount / habitCount) * 100) : 0;
  if (habitCount === 0) return ['Add your first habit to start building a consistency pattern.', 'Your next small habit can become the start of a stronger routine.'];
  if (completionPercent === 100) return [`Perfect work: all ${habitCount} habits are complete for this day.`, 'You showed up for every habit on this day. Keep the rhythm going.'];
  if (completedCount > 0) return [`You completed ${completedCount} of ${habitCount} habits on this day. One more step keeps the momentum alive.`, `${completionPercent}% complete for this day. Finish one more habit when you are ready.`];
  return ['No habits are complete on this day yet. Start with the easiest one.', 'A small action is enough to get this day moving. Pick one habit to begin.'];
}

export default function InsightsScreen() {
  const { isDarkMode, habits, toggleHabitForDate } = useAppColorScheme();
  const { date: initialDate } = useLocalSearchParams<{ date?: string }>();
  const { maxStreak } = getHabitProgressSummary(habits);
  const [selectedDate, setSelectedDate] = useState(() => initialDate ? new Date(`${initialDate}T12:00:00`) : new Date());
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = initialDate ? new Date(`${initialDate}T12:00:00`) : new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  const [calendarVisible, setCalendarVisible] = useState(false);
  const selectedDateKey = getDateKey(selectedDate);
  // Every habit can be completed all day, so all of them are listed for the selected date.
  const visibleHabits = habits;
  const selectedDateProgress = visibleHabits.filter((habit) => habit.completionDates.includes(selectedDateKey));
  const selectedCompletedCount = selectedDateProgress.length;
  const selectedCompletionPercent = visibleHabits.length ? Math.round((selectedCompletedCount / visibleHabits.length) * 100) : 0;
  const insightMessages = getInsightMessages(selectedCompletedCount, visibleHabits.length);
  const [insightIndex, setInsightIndex] = useState(0);
  const insightMessage = insightMessages[insightIndex % insightMessages.length];
  const progressSegments = Array.from({ length: 48 }, (_, index) => {
    const angle = (index / 48) * Math.PI * 2;
    return {
      left: 44 + Math.sin(angle) * 34 - 3,
      top: 44 - Math.cos(angle) * 34 - 3,
      active: index < Math.round((selectedCompletionPercent / 100) * 48),
    };
  });
  const calendarDays = getCalendarDays(calendarMonth);
  const hasActivity = (date: Date) => habits.some((habit) => habit.completionDates.includes(getDateKey(date)));

  const changeDate = (amount: number) => {
    const nextDate = new Date(selectedDate);
    nextDate.setDate(nextDate.getDate() + amount);
    setSelectedDate(nextDate);
    setCalendarMonth(new Date(nextDate.getFullYear(), nextDate.getMonth(), 1));
  };

  const changeMonth = (amount: number) => {
    setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + amount, 1));
  };

  const selectDate = (date: Date) => {
    setSelectedDate(new Date(date));
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    setCalendarVisible(false);
  };

  useEffect(() => {
    const interval = setInterval(() => {
      setInsightIndex((currentIndex) => (currentIndex + 1 + Math.floor(Math.random() * (insightMessages.length - 1))) % insightMessages.length);
    }, 7000);
    return () => clearInterval(interval);
  }, [selectedDateKey, selectedCompletedCount, habits.length, insightMessages.length]);

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} accessibilityLabel="Go back" onPress={() => router.back()}>
                <Ionicons name="chevron-back" size={17} color="#282631" />
              </Pressable>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>Today&apos;s Progress</Text>
              <Pressable
                style={[styles.selectDateButton, isDarkMode && styles.darkSelectDateButton]}
                accessibilityRole="button"
                accessibilityLabel="Select date"
                onPress={() => setCalendarVisible(true)}
              >
                <Ionicons name="calendar-outline" size={16} color="#5B42D8" />
                <Text style={styles.selectDateButtonText}>Select Date</Text>
              </Pressable>
            </View>

            <View style={styles.dateRow}>
              <Pressable style={styles.dateArrow} accessibilityLabel="Previous day" onPress={() => changeDate(-1)}>
                <Ionicons name="chevron-back" size={13} color="#6D687A" />
              </Pressable>
              <Text style={styles.dateText}>{formatDate(selectedDate)}</Text>
              <Pressable style={styles.dateArrow} accessibilityLabel="Next day" onPress={() => changeDate(1)}>
                <Ionicons name="chevron-forward" size={13} color="#6D687A" />
              </Pressable>
            </View>

            <View style={[styles.summaryCard, isDarkMode && styles.darkCard]}>
              <View style={styles.progressRing}>
                <View style={styles.progressRingTrack} />
                {progressSegments.map((segment, index) => <View key={index} style={[styles.progressSegment, { left: segment.left, top: segment.top }, segment.active && styles.progressSegmentActive]} />)}
                <Text style={styles.progressValue}>{selectedCompletionPercent}%</Text>
              </View>
              <View style={styles.summaryTextWrap}>
                <Text style={styles.progressMeta}>{selectedCompletedCount} / {visibleHabits.length} habits</Text>
                <Text style={styles.progressStats}>completed</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#B4B0BE" />
            </View>

            <View style={[styles.weeklyCard, isDarkMode && styles.darkCard]}>
              {visibleHabits.length ? visibleHabits.map((habit) => (
                <Pressable key={habit.id} style={styles.habitProgressRow} onPress={() => toggleHabitForDate(habit.id, selectedDate)} accessibilityRole="button" accessibilityLabel={`Toggle ${habit.label} for ${formatDate(selectedDate)}`}>
                  <View style={[styles.habitProgressIcon, { backgroundColor: `${habit.color}22` }]}>
                    <Ionicons name={habit.icon} size={17} color={habit.color} />
                  </View>
                  <View style={styles.habitProgressCopy}>
                    <Text numberOfLines={1} style={[styles.habitProgressName, isDarkMode && styles.darkText]}>{habit.label}</Text>
                    <Text style={[styles.habitProgressMeta, isDarkMode && styles.darkMutedText]}>{habit.meta}</Text>
                  </View>
                  <View style={styles.habitProgressStatus}>
                    <Text style={[styles.habitProgressPercent, isDarkMode && styles.darkText]}>{habit.completionDates.includes(selectedDateKey) ? 'Done' : 'Open'}</Text>
                    <View style={[styles.dayDot, habit.completionDates.includes(selectedDateKey) && styles.dayDotComplete]}>
                      {habit.completionDates.includes(selectedDateKey) && <Ionicons name="checkmark" size={9} color="#FFFFFF" />}
                    </View>
                  </View>
                </Pressable>
              )) : <Text style={styles.emptyChartText}>Add a habit to see it here.</Text>}
            </View>

            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>This Week Overview</Text>
              <Text style={[styles.sectionCaption, isDarkMode && styles.darkMutedText]}>Initialized habits</Text>
            </View>

            <View style={[styles.overviewCard, isDarkMode && styles.darkCard]}>
              <View style={styles.chartArea}>
                <View style={styles.chartGuides}>
                  <View style={styles.guideLine} />
                  <View style={styles.guideLine} />
                  <View style={styles.guideLine} />
                </View>
                <View style={styles.chartRow}>
                  {visibleHabits.length ? visibleHabits.map((habit) => (
                    <View key={habit.id} style={styles.chartColumn}>
                      <View style={[styles.chartBar, { height: habit.completionDates.includes(selectedDateKey) ? 50 : 0 }]} />
                      <Text style={styles.chartLabel}>{habit.label.slice(0, 4)}</Text>
                    </View>
                  )) : <Text style={styles.emptyChartText}>No initialized habits yet.</Text>}
                </View>
              </View>
            </View>

            <View style={[styles.aiCard, isDarkMode && styles.darkAiCard]}>
              <View style={styles.aiIconWrap}>
                <Ionicons name="sparkles" size={15} color="#5B42D8" />
              </View>
              <View style={styles.aiContent}>
                <Text style={styles.aiTitle}>AI insight</Text>
                <Text style={styles.aiText}>{insightMessage}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.push('/(tabs)/insights')}>
                  <Text style={styles.aiLink}>View insights</Text>
                </Pressable>
              </View>
            </View>

            <View style={[styles.streakCard, isDarkMode && styles.darkStreakCard]}>
              <View style={styles.streakIconWrap}>
                <Ionicons name="flame" size={17} color="#E68D3D" />
              </View>
              <View style={styles.streakTextWrap}>
                <Text style={styles.streakTitle}>You&apos;re on a {maxStreak}-day streak!</Text>
                <Text style={styles.streakSubtitle}>Keep the momentum going.</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#B4B0BE" />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal
        visible={calendarVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCalendarVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.calendarCard, isDarkMode && styles.darkCard]}>
            <View style={styles.calendarHeader}>
              <View>
                <Text style={styles.calendarEyebrow}>SELECT DATE</Text>
                <Text style={styles.calendarTitle}>{formatDate(selectedDate)}</Text>
                <Text style={styles.calendarSummary}>{selectedCompletedCount} of {visibleHabits.length} habits completed</Text>
              </View>
              <Pressable style={styles.closeButton} onPress={() => setCalendarVisible(false)} accessibilityLabel="Close calendar">
                <Ionicons name="close" size={22} color="#4C4858" />
              </Pressable>
            </View>

            <View style={styles.monthRow}>
              <Pressable style={styles.monthArrow} onPress={() => changeMonth(-1)} accessibilityLabel="Previous month">
                <Ionicons name="chevron-back" size={20} color="#5B42D8" />
              </Pressable>
              <Text style={styles.monthTitle}>
                {monthNames[calendarMonth.getMonth()]} {calendarMonth.getFullYear()}
              </Text>
              <Pressable style={styles.monthArrow} onPress={() => changeMonth(1)} accessibilityLabel="Next month">
                <Ionicons name="chevron-forward" size={20} color="#5B42D8" />
              </Pressable>
            </View>
            <Pressable
              style={styles.todayButton}
              onPress={() => selectDate(new Date())}
              accessibilityRole="button"
            >
              <Ionicons name="locate-outline" size={15} color="#5B42D8" />
              <Text style={styles.todayButtonText}>Jump to Today</Text>
            </Pressable>

            <View style={styles.calendarWeekRow}>
              {weekdays.map((day, index) => <Text key={`${day}-${index}`} style={styles.calendarWeekday}>{day}</Text>)}
            </View>
            <View style={styles.calendarGrid}>
              {calendarDays.map((day, index) => (
                <Pressable
                  key={day ? day.toISOString() : `empty-${index}`}
                  style={[
                    styles.calendarDay,
                    day && hasActivity(day) && styles.calendarDayHasActivity,
                    day && isSameDate(day, new Date()) && styles.calendarDayToday,
                    day && isSameDate(day, selectedDate) && styles.calendarDaySelected,
                  ]}
                  disabled={!day}
                  onPress={() => day && selectDate(day)}
                >
                  {day && <><Text style={[styles.calendarDayText, isSameDate(day, selectedDate) && styles.calendarDayTextSelected]}>{day.getDate()}</Text>{hasActivity(day) && <View style={[styles.activityMarker, isSameDate(day, selectedDate) && styles.activityMarkerSelected]} />}</>}
                </Pressable>
              ))}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F5F4F9',
    paddingTop: 26,
  },
  darkScreen: { backgroundColor: '#111018' },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  darkAiCard: { backgroundColor: '#292044', borderColor: '#493878' },
  darkStreakCard: { backgroundColor: '#30261C', borderColor: '#634A2B' },
  content: {
    flexGrow: 1,
    paddingBottom: 100,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#171922',
  },
  backButton: {
    width: 34,
    height: 34,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  selectDateButton: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#F0ECFF', borderRadius: 12, paddingHorizontal: 11 },
  darkSelectDateButton: { backgroundColor: '#292340' },
  selectDateButtonText: { color: '#5B42D8', fontSize: 11, fontWeight: '800' },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    marginBottom: 16,
  },
  dateArrow: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateText: {
    fontSize: 13,
    color: '#5D5968',
    fontWeight: '700',
  },
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 10,
  },
  progressRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F7F4FF',
    marginRight: 18,
  },
  progressRingTrack: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 7,
    borderColor: '#E6E1FF',
  },
  progressSegment: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E6E1FF',
  },
  progressSegmentActive: {
    backgroundColor: '#5B42D8',
  },
  progressValue: {
    fontSize: 21,
    fontWeight: '800',
    color: '#1A1A1F',
  },
  summaryTextWrap: {
    flex: 1,
  },
  progressMeta: {
    fontSize: 14,
    color: '#5E6270',
    fontWeight: '600',
    marginBottom: 5,
  },
  progressStats: {
    fontSize: 18,
    fontWeight: '700',
    color: '#20212A',
  },
  weeklyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
    marginBottom: 20,
    shadowColor: '#000000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  habitProgressRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0EEF4', paddingVertical: 9 },
  habitProgressCopy: { flex: 1, minWidth: 0, marginHorizontal: 10 },
  habitProgressIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  habitProgressName: { fontSize: 13, color: '#282631', fontWeight: '800' },
  habitProgressMeta: { fontSize: 10, color: '#827C8C', fontWeight: '600', marginTop: 3 },
  habitProgressStatus: { alignItems: 'flex-end', gap: 4 },
  habitProgressPercent: { fontSize: 11, color: '#282631', fontWeight: '800' },
  dayDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: '#D8D5DF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  dayDotComplete: {
    backgroundColor: '#38A169',
    borderColor: '#38A169',
  },
  dayLabel: {
    fontSize: 12,
    color: '#6B7180',
    fontWeight: '700',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1B1B1F',
  },
  sectionCaption: {
    fontSize: 11,
    color: '#8B8795',
    fontWeight: '600',
  },
  overviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    marginBottom: 16,
  },
  chartArea: {
    height: 150,
    position: 'relative',
  },
  emptyChartText: { flex: 1, textAlign: 'center', alignSelf: 'center', color: '#827C8C', fontSize: 11, fontWeight: '600' },
  chartGuides: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 8,
    bottom: 20,
    justifyContent: 'space-between',
  },
  guideLine: {
    height: 1,
    backgroundColor: '#F0EEF4',
  },
  chartRow: {
    height: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-around',
  },
  chartColumn: {
    height: '100%',
    alignItems: 'center',
    justifyContent: 'flex-end',
    flex: 1,
  },
  chartBar: {
    width: 20,
    maxHeight: 110,
    borderRadius: 10,
    backgroundColor: '#5B42D8',
  },
  chartLabel: {
    fontSize: 11,
    color: '#7D7888',
    fontWeight: '700',
    marginTop: 8,
  },
  aiCard: {
    backgroundColor: '#F6F2FF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#E9E0FF',
    flexDirection: 'row',
  },
  aiIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#E9E0FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  aiContent: {
    flex: 1,
  },
  aiTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4F2AC8',
    marginBottom: 5,
  },
  aiText: {
    fontSize: 13,
    color: '#3D4050',
    fontWeight: '600',
    lineHeight: 20,
  },
  aiLink: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5B42D8',
    marginTop: 8,
  },
  streakCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFF8ED',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#F7E6C9',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  streakIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFE8C5',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  streakTextWrap: {
    flex: 1,
  },
  streakTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#393129',
    marginBottom: 4,
  },
  streakSubtitle: {
    fontSize: 11,
    color: '#887665',
    fontWeight: '600',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(28, 24, 45, 0.42)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  calendarCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingVertical: 22,
    shadowColor: '#201444',
    shadowOpacity: 0.2,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },
  calendarHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  calendarEyebrow: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8B8795',
    letterSpacing: 1,
    marginBottom: 5,
  },
  calendarTitle: {
    fontSize: 23,
    fontWeight: '800',
    color: '#24212D',
  },
  calendarSummary: { fontSize: 11, color: '#827C8C', fontWeight: '600', marginTop: 5 },
  closeButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#F4F1FA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  monthArrow: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F5F1FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#2E2A3B',
  },
  todayButton: { alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0ECFF', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 16 },
  todayButtonText: { fontSize: 11, color: '#5B42D8', fontWeight: '800' },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  calendarWeekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#8B8795',
    fontWeight: '800',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  calendarDay: {
    width: '14.2857%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 24,
    marginVertical: 2,
  },
  calendarDaySelected: {
    backgroundColor: '#5B42D8',
  },
  calendarDayToday: {
    borderWidth: 2,
    borderColor: '#5B42D8',
  },
  calendarDayHasActivity: { backgroundColor: '#F7F4FF' },
  calendarDayText: {
    fontSize: 15,
    color: '#3E3A49',
    fontWeight: '700',
  },
  calendarDayTextSelected: {
    color: '#FFFFFF',
  },
  activityMarker: { position: 'absolute', bottom: 4, width: 4, height: 4, borderRadius: 2, backgroundColor: '#5B42D8' },
  activityMarkerSelected: { backgroundColor: '#FFFFFF' },
});

