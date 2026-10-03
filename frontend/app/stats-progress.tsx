import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitProgressSummary, getRecentCompletionHistory, useAppColorScheme } from '@/hooks/color-scheme-context';
import { historyStats } from '@/utils/achievements';
import { getChartGeometry } from '@/utils/line-chart';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const tabs = ['Overview', 'Habits', 'Activity'] as const;
export default function StatsProgressScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { isDarkMode, habits, preferences } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const { completed, completionPercent, maxStreak } = getHabitProgressSummary(habits);
  const history = useMemo(() => historyStats(habits), [habits]);
  const consistency = history.last30Rate;
  const completionHistory = getRecentCompletionHistory(habits, 7);
  const maximumDailyCompletions = Math.max(1, ...completionHistory.map((entry) => entry.count));
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const chart = getChartGeometry(completionHistory.map((entry) => (entry.count / maximumDailyCompletions) * 100), chartSize.width, chartSize.height);
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]>('Overview');
  const topHabits = [...habits].sort((a, b) => b.progress - a.progress).slice(0, 4);

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 20 }]}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={21} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
              <View style={styles.headerCopy}>
                <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>Stats &amp; Progress</Text>
                <Text style={[styles.headerSubtitle, isDarkMode && styles.darkMutedText]}>See how your habits are growing</Text>
              </View>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.tabs}>
              {tabs.map((tab) => (
                <Pressable key={tab} style={[styles.tab, isDarkMode && styles.darkTab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)}>
                  <Text style={[styles.tabText, isDarkMode && styles.darkMutedText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            {preferences.hideProgress ? (
              <View style={[styles.chartCard, isDarkMode && styles.darkCard]}>
                <Ionicons name="eye-off-outline" size={28} color={themeColor('#6844D8')} />
                <Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>Progress is hidden</Text>
                <Text style={[styles.breakdownSubtitle, isDarkMode && styles.darkMutedText]}>Turn off Hide Progress in Settings to view your goals and activity.</Text>
              </View>
            ) : (
            <View style={[styles.chartCard, isDarkMode && styles.darkCard]}>
              <View style={styles.cardHeader}>
                <View>
                  <Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>Overall Completion Rate</Text>
                  <View style={styles.metricRow}>
                    <Text style={styles.metric}>{completionPercent}%</Text>
                    <Text style={styles.positive}>{completed} completed today</Text>
                  </View>
                </View>
                <Ionicons name="trending-up" size={22} color={themeColor('#49A866')} />
              </View>
              <View style={styles.chart}>
                <View style={styles.chartPlot} onLayout={(event) => setChartSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
                  {[0, 1, 2, 3].map((line) => <View key={line} style={[styles.guideLine, isDarkMode && styles.darkGuideLine]} />)}
                  {chartSize.width > 0 && chart.segments.map((segment, index) => <View key={`segment-${index}`} style={[styles.segment, segment]} />)}
                  {chartSize.width > 0 && chart.points.map((point, index) => <View key={`point-${index}`} style={[styles.point, { left: point.x, top: point.y }]} />)}
                </View>
                <View style={styles.labels}>
                  {completionHistory.map((entry, index) => <Text key={entry.dateKey} style={[styles.axisText, styles.label, isDarkMode && styles.darkMutedText, { left: chart.points[index]?.x ?? 0 }]}>{index === completionHistory.length - 1 ? 'Today' : entry.label}</Text>)}
                </View>
              </View>
            </View>
            )}

            {activeTab === 'Overview' ? (
              <>
                <View style={styles.summaryGrid}>
                  <View style={[styles.summaryCard, isDarkMode && styles.darkCard]}>
                    <Text style={[styles.summaryLabel, isDarkMode && styles.darkMutedText]}>Last 7 Days</Text>
                    <Text style={[styles.summaryValue, isDarkMode && styles.darkText]}>{history.last7Rate}%</Text>
                    <View style={styles.miniRing}><View style={[styles.miniRingFill, { transform: [{ rotate: `${Math.round(history.last7Rate * 1.8)}deg` }] }]} /></View>
                  </View>
                  <View style={[styles.summaryCard, isDarkMode && styles.darkCard]}>
                    <Text style={[styles.summaryLabel, isDarkMode && styles.darkMutedText]}>Total Check-ins</Text>
                    <Text style={[styles.summaryValue, isDarkMode && styles.darkText]}>{history.totalCheckIns}</Text>
                    <Ionicons name="checkmark-circle" size={22} color={themeColor('#49A866')} />
                  </View>
                </View>
                <View style={styles.summaryGrid}>
                  <View style={[styles.smallCard, isDarkMode && styles.darkCard]}><Ionicons name="flame" size={18} color={themeColor('#E68D3D')} /><Text style={[styles.smallValue, isDarkMode && styles.darkText]}>{maxStreak}</Text><Text style={[styles.smallLabel, isDarkMode && styles.darkMutedText]}>Day Streak</Text></View>
                  <View style={[styles.smallCard, isDarkMode && styles.darkCard]}><Ionicons name="trophy-outline" size={18} color={themeColor('#5B42D8')} /><Text style={[styles.smallValue, isDarkMode && styles.darkText]}>{history.bestStreak}</Text><Text style={[styles.smallLabel, isDarkMode && styles.darkMutedText]}>Best Streak</Text></View>
                </View>
                <View style={[styles.consistencyCard, isDarkMode && styles.darkCard]}>
                  <View><Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>Consistency Score</Text><Text style={styles.score}>{consistency} <Text style={styles.scoreLabel}>{consistency >= 80 ? 'Excellent' : consistency >= 50 ? 'Building' : 'Starting'}</Text></Text></View>
                  <View style={styles.meter} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: consistency }}><View style={styles.meterTrack}><View style={[styles.meterFill, { width: `${consistency}%` }]} /></View><Text style={[styles.meterCaption, isDarkMode && styles.darkMutedText]}>last 30 days</Text></View>
                </View>
              </>
            ) : (
              activeTab === 'Habits' ? (
                <View style={[styles.breakdownCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.breakdownHeader}>
                    <View><Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>Habit breakdown</Text><Text style={[styles.breakdownSubtitle, isDarkMode && styles.darkMutedText]}>Your strongest habits this week</Text></View>
                    <Ionicons name="bar-chart-outline" size={20} color={themeColor('#5B42D8')} />
                  </View>
                  {topHabits.length ? topHabits.map((habit) => (
                    <View key={habit.id} style={styles.breakdownRow}>
                      <View style={[styles.breakdownIcon, { backgroundColor: `${habit.color}22` }]}><Ionicons name={habit.icon} size={17} color={habit.color} /></View>
                      <View style={styles.breakdownCopy}><Text style={[styles.breakdownName, isDarkMode && styles.darkText]}>{habit.label}</Text><View style={[styles.breakdownTrack, isDarkMode && styles.darkGuideLine]}><View style={[styles.breakdownFill, { width: `${habit.progress}%`, backgroundColor: habit.color }]} /></View></View>
                      <Text style={styles.breakdownPercent}>{habit.progress}%</Text>
                    </View>
                  )) : <Text style={[styles.emptyBody, isDarkMode && styles.darkMutedText]}>Add a habit to see your progress breakdown.</Text>}
                </View>
              ) : (
                <View style={[styles.breakdownCard, isDarkMode && styles.darkCard]}><View style={styles.breakdownHeader}><View><Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>Activity timeline</Text><Text style={[styles.breakdownSubtitle, isDarkMode && styles.darkMutedText]}>Completions from the last 7 days</Text></View><Ionicons name="calendar-outline" size={20} color={themeColor('#5B42D8')} /></View>{completionHistory.map((entry) => <View key={entry.dateKey} style={styles.breakdownRow}><Text style={[styles.breakdownName, isDarkMode && styles.darkText]}>{entry.label}</Text><View style={styles.breakdownCopy}><View style={[styles.breakdownTrack, isDarkMode && styles.darkGuideLine]}><View style={[styles.breakdownFill, { width: `${(entry.count / maximumDailyCompletions) * 100}%`, backgroundColor: '#5B42D8' }]} /></View></View><Text style={styles.breakdownPercent}>{entry.count}</Text></View>)}</View>
              )
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 16 }, darkScreen: { backgroundColor: '#111018' },
  darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  content: { paddingBottom: 110 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  headerCopy: { flex: 1 },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#24212D' },
  headerSubtitle: { fontSize: 11, color: '#888291', fontWeight: '600', marginTop: 3 },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 16, padding: 4, marginBottom: 16 },
  darkTab: { backgroundColor: '#211D2B' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  activeTab: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 11, color: '#777283', fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  chartCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 17, marginBottom: 14, shadowColor: '#000000', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardTitle: { fontSize: 13, fontWeight: '800', color: '#302B3B' },
  metricRow: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 5 },
  metric: { fontSize: 22, fontWeight: '800', color: '#4A2CC9' },
  positive: { fontSize: 9, color: '#49A866', fontWeight: '700' },
  chart: { height: 160, marginTop: 14, paddingBottom: 24 },
  chartPlot: { flex: 1, position: 'relative', justifyContent: 'space-between' },
  guideLine: { height: 1, backgroundColor: '#F0EEF4' },
  darkGuideLine: { backgroundColor: '#342F3F' },
  segment: { position: 'absolute', height: 2, backgroundColor: '#5B42D8', transformOrigin: 'left center' },
  point: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: '#5B42D8', marginLeft: -4, marginTop: -4 },
  labels: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 12 },
  label: { position: 'absolute', width: 32, marginLeft: -16, textAlign: 'center' },
  axisText: { fontSize: 8, color: '#8D8998', fontWeight: '600' },
  summaryGrid: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  summaryCard: { flex: 1, minHeight: 116, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, shadowColor: '#000000', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  summaryLabel: { fontSize: 10, color: '#777282', fontWeight: '700', lineHeight: 14 },
  summaryValue: { fontSize: 22, fontWeight: '800', color: '#302B3B', marginTop: 8 },
  miniRing: { position: 'absolute', right: 14, bottom: 14, width: 40, height: 40, borderRadius: 20, borderWidth: 5, borderColor: '#E8E1FF' },
  miniRingFill: { position: 'absolute', top: -5, right: -5, width: 40, height: 40, borderRadius: 20, borderWidth: 5, borderColor: '#5B42D8', borderLeftColor: 'transparent', borderBottomColor: 'transparent' },
  smallCard: { flex: 1, minHeight: 84, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 13 },
  smallValue: { fontSize: 16, fontWeight: '800', color: '#302B3B', marginTop: 6 },
  smallLabel: { fontSize: 9, color: '#777282', fontWeight: '600', marginTop: 2 },
  consistencyCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  score: { fontSize: 22, fontWeight: '800', color: '#49A866', marginTop: 7 },
  scoreLabel: { fontSize: 10, fontWeight: '700' },
  // A real meter for the score (it used to be two crossed lines that looked like a broken chart).
  meter: { width: 120, alignItems: 'flex-end', gap: 6 },
  meterTrack: { width: '100%', height: 8, borderRadius: 999, backgroundColor: '#E4F3E8', overflow: 'hidden' },
  meterFill: { height: '100%', borderRadius: 999, backgroundColor: '#49A866' },
  meterCaption: { fontSize: 10, fontWeight: '700', color: '#7A7F8C' },
  breakdownCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16 },
  breakdownHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  breakdownSubtitle: { fontSize: 10, color: '#777282', fontWeight: '600', marginTop: 3 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 15 },
  breakdownIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  breakdownCopy: { flex: 1, marginRight: 10 },
  breakdownName: { fontSize: 12, fontWeight: '700', color: '#302B3B', marginBottom: 6 },
  breakdownTrack: { height: 6, borderRadius: 99, backgroundColor: '#ECEAF1', overflow: 'hidden' },
  breakdownFill: { height: '100%', borderRadius: 99 },
  breakdownPercent: { width: 34, textAlign: 'right', fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  emptyCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, alignItems: 'center' },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#302B3B', marginVertical: 12 },
  emptyBody: { fontSize: 12, color: '#777282', textAlign: 'center', lineHeight: 18 },
});

