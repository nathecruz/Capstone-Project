import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

export default function ActivityHistoryScreen() {
  const { isDarkMode, habits } = useAppColorScheme();
  const [rangeDays, setRangeDays] = useState(7);
  const [showActiveDaysOnly, setShowActiveDaysOnly] = useState(false);
  const [oldestFirst, setOldestFirst] = useState(false);
  const [search, setSearch] = useState('');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - rangeDays + 1);
  const getDateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  const formatShortDate = (date: Date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const rangeLabel = `${formatShortDate(startDate)} - ${today.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  const normalizedSearch = search.trim().toLowerCase();
  const activityEntries = habits.flatMap((habit) => habit.completionDates.map((dateKey) => ({ habit, dateKey })))
    .filter(({ dateKey }) => dateKey >= getDateKey(startDate) && dateKey <= getDateKey(today))
    .filter(({ habit }) => !normalizedSearch || `${habit.label} ${habit.category} ${habit.frequency} ${habit.meta}`.toLowerCase().includes(normalizedSearch))
    .sort((first, second) => oldestFirst
      ? first.dateKey.localeCompare(second.dateKey)
      : second.dateKey.localeCompare(first.dateKey));
  const allDailyActivity = Array.from({ length: Math.min(rangeDays, 7) }, (_, index) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Math.min(rangeDays, 7) - 1 - index));
    const dateKey = getDateKey(date);
    return { date, dateKey, count: activityEntries.filter((entry) => entry.dateKey === dateKey).length };
  });
  const dailyActivity = showActiveDaysOnly ? allDailyActivity.filter((day) => day.count > 0) : allDailyActivity;
  const completed = activityEntries.length;
  const activeDays = new Set(activityEntries.map((entry) => entry.dateKey)).size;
  const averageProgress = habits.length && rangeDays ? Math.round((completed / (habits.length * rangeDays)) * 100) : 0;

  return (
    <>
      <StatusBar style="dark" />
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={21} color="#292633" />
              </Pressable>
              <Text style={styles.headerTitle}>Activity History</Text>
              <Pressable style={[styles.filterButton, isDarkMode && styles.darkCard]} onPress={() => setSettingsVisible(true)} accessibilityLabel="Open activity history settings">
                <Ionicons name="settings-outline" size={18} color={isDarkMode ? '#F2EFF8' : '#4B4656'} />
              </Pressable>
            </View>

            <View style={[styles.rangePicker, isDarkMode && styles.darkCard]}>
              {[7, 30].map((days) => <Pressable key={days} style={[styles.rangeOption, rangeDays === days && styles.rangeOptionActive]} onPress={() => setRangeDays(days)} accessibilityRole="button"><Text style={[styles.rangeOptionText, isDarkMode && styles.darkMutedText, rangeDays === days && styles.rangeOptionTextActive]}>{days} days</Text></Pressable>)}
            </View>
            <View style={styles.rangeRow}>
              <Ionicons name="calendar-outline" size={14} color="#716B7C" />
              <Text style={styles.rangeText}>{rangeLabel}</Text>
            </View>

            <View style={[styles.searchBox, isDarkMode && styles.darkCard]}>
              <Ionicons name="search-outline" size={17} color="#8B8496" />
              <TextInput value={search} onChangeText={setSearch} placeholder="Search your activity..." placeholderTextColor="#9A94A4" style={[styles.searchInput, isDarkMode && styles.darkText]} accessibilityLabel="Search activity history" />
              {search.length > 0 && <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear activity search"><Ionicons name="close-circle" size={18} color="#8B8496" /></Pressable>}
            </View>
            {normalizedSearch ? <Text style={[styles.resultText, isDarkMode && styles.darkMutedText]}>{activityEntries.length} matching completion{activityEntries.length === 1 ? '' : 's'}</Text> : null}

            <View style={styles.metricsCard}>
              <View style={styles.metricCell}><Text style={styles.metricValue}>{completed}</Text><Text style={styles.metricLabel}>Completions</Text></View>
              <View style={styles.metricDivider} />
              <View style={styles.metricCell}><Text style={styles.metricValue}>{averageProgress}%</Text><Text style={styles.metricLabel}>Avg. Rate</Text></View>
              <View style={styles.metricDivider} />
              <View style={styles.metricCell}><Text style={styles.metricValue}>{activeDays}</Text><Text style={styles.metricLabel}>Active Days</Text></View>
            </View>

            <Text style={styles.sectionTitle}>Daily Breakdown</Text>
            <View style={styles.chartCard}>
              <View style={styles.chartRow}>
                {dailyActivity.some((day) => day.count) ? dailyActivity.map((day) => (
                  <View key={day.dateKey} style={styles.barColumn}>
                    <View style={styles.barTrack}><View style={[styles.bar, { height: `${habits.length ? Math.max((day.count / habits.length) * 100, 8) : 0}%` as `${number}%` }]} /></View>
                    <Text style={styles.dayLabel}>{day.date.toLocaleDateString('en-US', { weekday: 'short' })}</Text>
                  </View>
                )) : <Text style={styles.emptyText}>Add habits to see your progress.</Text>}
              </View>
            </View>

            <View style={styles.activityHeader}>
              <Text style={styles.sectionTitle}>Recent Activity</Text>
              <Pressable onPress={() => setRangeDays(rangeDays === 7 ? 30 : 7)} accessibilityRole="button"><Text style={styles.viewAll}>{rangeDays === 7 ? 'Show 30 days' : 'Show 7 days'}</Text></Pressable>
            </View>
            <View style={styles.activityCard}>
              {activityEntries.length ? activityEntries.slice(0, 12).map(({ habit, dateKey }, index) => (
                <Pressable key={`${habit.id}-${dateKey}`} style={[styles.activityRow, index < Math.min(activityEntries.length, 12) - 1 && styles.activityBorder]} onPress={() => router.push({ pathname: '/today-progress', params: { date: dateKey } })} accessibilityRole="button" accessibilityLabel={`Open ${habit.label} on ${dateKey}`}>
                  <View style={[styles.activityIcon, { backgroundColor: `${habit.color}20` }]}>
                    <Ionicons name={habit.icon} size={17} color={habit.color} />
                  </View>
                  <View style={styles.activityCopy}><Text style={styles.activityTitle}>{habit.label}</Text><Text style={styles.activityDate}>{new Date(`${dateKey}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text></View>
                  <Ionicons name="checkmark-circle" size={17} color="#48A66A" />
                </Pressable>
              )) : <Text style={styles.emptyText}>Complete a habit to build your activity history.</Text>}
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal visible={settingsVisible} transparent animationType="slide" onRequestClose={() => setSettingsVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.settingsSheet, isDarkMode && styles.darkCard]}>
            <View style={styles.sheetHeader}>
              <View><Text style={[styles.sheetEyebrow, isDarkMode && styles.darkMutedText]}>ACTIVITY HISTORY</Text><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>History Settings</Text></View>
              <Pressable style={styles.closeButton} onPress={() => setSettingsVisible(false)} accessibilityLabel="Close activity history settings"><Ionicons name="close" size={20} color="#655E75" /></Pressable>
            </View>
            <Text style={[styles.settingLabel, isDarkMode && styles.darkMutedText]}>DATE RANGE</Text>
            <View style={styles.sheetRangeRow}>{[7, 30].map((days) => <Pressable key={days} style={[styles.sheetRangeOption, rangeDays === days && styles.sheetRangeOptionActive]} onPress={() => setRangeDays(days)}><Text style={[styles.sheetRangeText, rangeDays === days && styles.sheetRangeTextActive]}>{days} days</Text></Pressable>)}</View>
            <Pressable style={styles.settingToggleRow} onPress={() => setShowActiveDaysOnly((current) => !current)} accessibilityRole="switch" accessibilityState={{ checked: showActiveDaysOnly }}>
              <View style={styles.settingToggleCopy}><Text style={[styles.settingTitle, isDarkMode && styles.darkText]}>Active days only</Text><Text style={[styles.settingSubtitle, isDarkMode && styles.darkMutedText]}>Hide zero-activity days from the chart.</Text></View>
              <View style={[styles.toggle, showActiveDaysOnly && styles.toggleActive]}><View style={[styles.toggleKnob, showActiveDaysOnly && styles.toggleKnobActive]} /></View>
            </Pressable>
            <Pressable style={styles.settingToggleRow} onPress={() => setOldestFirst((current) => !current)} accessibilityRole="switch" accessibilityState={{ checked: oldestFirst }}>
              <View style={styles.settingToggleCopy}><Text style={[styles.settingTitle, isDarkMode && styles.darkText]}>Oldest first</Text><Text style={[styles.settingSubtitle, isDarkMode && styles.darkMutedText]}>Show your earliest completions at the top.</Text></View>
              <View style={[styles.toggle, oldestFirst && styles.toggleActive]}><View style={[styles.toggleKnob, oldestFirst && styles.toggleKnobActive]} /></View>
            </Pressable>
            <Pressable style={styles.doneButton} onPress={() => setSettingsVisible(false)} accessibilityRole="button"><Text style={styles.doneButtonText}>Apply Settings</Text></Pressable>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 }, darkScreen: { backgroundColor: '#111018' },
  darkText: { color: '#F2EFF8' },
  content: { paddingBottom: 110 },
  container: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  filterButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#24212D' },
  rangeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 14 },
  rangePicker: { flexDirection: 'row', alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, padding: 3, marginBottom: 10 },
  rangeOption: { minWidth: 82, alignItems: 'center', paddingVertical: 8, borderRadius: 9 },
  rangeOptionActive: { backgroundColor: '#5B42D8' },
  rangeOptionText: { color: '#827C8C', fontSize: 11, fontWeight: '800' },
  rangeOptionTextActive: { color: '#FFFFFF' },
  darkCard: { backgroundColor: '#1D1A24' },
  darkMutedText: { color: '#AAA4B7' },
  rangeArrow: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  rangeText: { fontSize: 11, color: '#5D5968', fontWeight: '700' },
  metricsCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, paddingVertical: 14, marginBottom: 18 },
  metricCell: { flex: 1, alignItems: 'center' },
  metricValue: { fontSize: 18, fontWeight: '800', color: '#302B3B' },
  metricLabel: { fontSize: 9, color: '#827C8C', fontWeight: '600', textAlign: 'center', marginTop: 3 },
  metricDivider: { width: 1, height: 32, backgroundColor: '#ECE9F0' },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' },
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, marginTop: 9, marginBottom: 18 },
  chartRow: { height: 145, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-around' },
  emptyText: { flex: 1, alignSelf: 'center', textAlign: 'center', color: '#827C8C', fontSize: 11, fontWeight: '600' },
  barColumn: { flex: 1, alignItems: 'center', justifyContent: 'flex-end' },
  barTrack: { width: 19, height: 104, justifyContent: 'flex-end', backgroundColor: '#F5F1FF', borderRadius: 10, overflow: 'hidden' },
  bar: { width: '100%', backgroundColor: '#5B42D8', borderRadius: 10 },
  dayLabel: { fontSize: 9, color: '#817B89', fontWeight: '700', marginTop: 8 },
  activityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 },
  viewAll: { fontSize: 10, color: '#5B42D8', fontWeight: '800' },
  activityCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  activityBorder: { borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  activityIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  activityCopy: { flex: 1 },
  activityTitle: { fontSize: 11, fontWeight: '800', color: '#393440' },
  activityDate: { fontSize: 9, color: '#888291', fontWeight: '600', marginTop: 3 },
  searchBox: { minHeight: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 12, gap: 8, marginBottom: 7 },
  searchInput: { flex: 1, color: '#393440', fontSize: 12, fontWeight: '600', paddingVertical: 0 },
  resultText: { color: '#827C8C', fontSize: 10, fontWeight: '700', marginBottom: 12, marginLeft: 4 },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(29, 23, 49, 0.45)' },
  settingsSheet: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 },
  sheetEyebrow: { color: '#827C8C', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  sheetTitle: { color: '#302B3B', fontSize: 22, fontWeight: '900', marginTop: 4 },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F2EFF8', alignItems: 'center', justifyContent: 'center' },
  settingLabel: { color: '#827C8C', fontSize: 10, fontWeight: '800', letterSpacing: 0.8, marginBottom: 9 },
  sheetRangeRow: { flexDirection: 'row', gap: 9, marginBottom: 22 },
  sheetRangeOption: { flex: 1, height: 44, borderWidth: 1, borderColor: '#E4DFEE', borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sheetRangeOptionActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  sheetRangeText: { color: '#6F687D', fontSize: 12, fontWeight: '800' },
  sheetRangeTextActive: { color: '#FFFFFF' },
  settingToggleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1, borderTopColor: '#F0EEF3', paddingTop: 17 },
  settingToggleCopy: { flex: 1 },
  settingTitle: { color: '#302B3B', fontSize: 13, fontWeight: '800' },
  settingSubtitle: { color: '#827C8C', fontSize: 10, fontWeight: '600', marginTop: 4 },
  toggle: { width: 48, height: 28, borderRadius: 14, backgroundColor: '#D8D4DF', padding: 3, justifyContent: 'center' },
  toggleActive: { backgroundColor: '#5B42D8' },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' },
  toggleKnobActive: { alignSelf: 'flex-end' },
  doneButton: { height: 46, borderRadius: 13, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  doneButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
});

