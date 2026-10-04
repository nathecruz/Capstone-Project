import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBaseUrl, getAuthenticatedHeaders } from '@/authentication';
import { AiChatSheet, AskAiCard, useAiChat, type ChatAnswer } from '@/components/ai-chat';
import { HabitAnalysisPanel } from '@/components/habit-analysis-panel';
import { ProgressRing } from '@/components/progress-ring';
import { getHabitProgressSummary, getRecentCompletionHistory, useAppColorScheme } from '@/hooks/color-scheme-context';
import { getChartGeometry } from '@/utils/line-chart';
import { historyStats } from '@/utils/achievements';
import { getPredictionPresentation } from '@/utils/ai-presentation';
import { askAi } from '@/utils/ai-client';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { createThemedStyles, themedColor, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

type HeatmapView = 'Days' | 'Weeks' | 'Months';
type HeatmapRow = { label: string; average: string; values: number[]; isToday?: boolean };

const formatDate = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', options).format(date);

function getLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getHabitMachineLearningSignal(habit: { completionDates: string[]; progress: number; streak: number; label: string; category: string; reminderEnabled: boolean }) {
  const today = new Date();
  const lastSevenDays: number[] = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setHours(0, 0, 0, 0);
    date.setDate(today.getDate() - (6 - index));
    return habit.completionDates.includes(getLocalDateKey(date)) ? 1 : 0;
  });
  const completedDays = lastSevenDays.reduce((total, value) => total + value, 0);
  const category = habit.category.toLowerCase();
  const goalType = category.includes('health') ? 'health' : category.includes('mind') ? 'mindfulness' : category.includes('productivity') ? 'productivity' : 'balanced';

  return {
    habit_name: habit.label,
    streak: habit.streak,
    completion_rate: completedDays / lastSevenDays.length,
    missed_days: lastSevenDays.length - completedDays,
    last_7_days: lastSevenDays,
    priority: habit.progress < 40 ? 'high' : habit.progress < 75 ? 'balanced' : 'low',
    goal_type: goalType,
  };
}

function getHeatmapData(view: HeatmapView, selectedMonth: number, selectedWeekOffset: number, completionDates: Set<string>, today = new Date()) {
  const getDayValue = (date: Date) => completionDates.has(getLocalDateKey(date)) ? 4 : 1;
  const getWeekValues = (start: Date) => Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return getDayValue(date);
  });
  const getAverage = (dates: Date[]) => {
    const completedDays = dates.filter((date) => completionDates.has(getLocalDateKey(date))).length;
    return `${Math.round((completedDays / Math.max(1, dates.length)) * 100)}%`;
  };
  let rows: HeatmapRow[];
  let subtitle: string;
  let badge: string;

  if (view === 'Days') {
    const monthStart = new Date(today.getFullYear(), selectedMonth, 1);
    const monthEnd = new Date(today.getFullYear(), selectedMonth + 1, 0);
    const lastDay = selectedMonth === today.getMonth() ? today.getDate() : monthEnd.getDate();
    const firstDay = Math.max(1, lastDay - 6);
    rows = Array.from({ length: lastDay - firstDay + 1 }, (_, index) => {
      const date = new Date(today.getFullYear(), selectedMonth, firstDay + index);
      const values = [getDayValue(date)];
      const average = values[0] * 25;
      return {
        label: formatDate(date, { weekday: 'short', month: 'short', day: 'numeric' }),
        average: `${average}%`,
        values,
        isToday: selectedMonth === today.getMonth() && date.getDate() === today.getDate(),
      };
    });
    subtitle = `Daily consistency for ${formatDate(monthStart, { month: 'long', year: 'numeric' })}`;
    badge = `${formatDate(monthStart, { month: 'short' })} ${today.getFullYear()}`;
  } else if (view === 'Weeks') {
    const anchor = new Date(today);
    anchor.setDate(today.getDate() - (selectedWeekOffset * 7));
    rows = Array.from({ length: 4 }, (_, index) => {
      const start = new Date(anchor);
      start.setDate(anchor.getDate() - ((3 - index) * 7));
      return { label: `Week of ${formatDate(start, { month: 'short', day: 'numeric' })}`, average: getAverage(Array.from({ length: 7 }, (_, day) => { const date = new Date(start); date.setDate(start.getDate() + day); return date; })), values: getWeekValues(start) };
    });
    subtitle = `Your weekly consistency ending ${formatDate(anchor, { month: 'short', day: 'numeric' })}`;
    badge = selectedWeekOffset === 0 ? 'This week' : `${selectedWeekOffset} week${selectedWeekOffset === 1 ? '' : 's'} ago`;
  } else {
    const monthStart = new Date(today.getFullYear(), selectedMonth, 1);
    const daysInMonth = new Date(today.getFullYear(), selectedMonth + 1, 0).getDate();
    const firstDay = monthStart.getDay();
    const weekCount = Math.ceil((daysInMonth + firstDay) / 7);
    rows = Array.from({ length: weekCount }, (_, index) => {
      const start = new Date(today.getFullYear(), selectedMonth, (index * 7) - firstDay + 1);
      const dates = Array.from({ length: 7 }, (_, day) => { const date = new Date(start); date.setDate(start.getDate() + day); return date; }).filter((date) => date.getMonth() === selectedMonth);
      return { label: `Week ${index + 1}`, average: getAverage(dates), values: getWeekValues(start) };
    });
    subtitle = `Your consistency for ${formatDate(monthStart, { month: 'long', year: 'numeric' })}`;
    badge = formatDate(monthStart, { month: 'short', year: 'numeric' });
  }

  return { subtitle, badge, rows, isDaily: view === 'Days' };
}

function useDeviceDate() {
  const [deviceDate, setDeviceDate] = useState(() => new Date());

  useEffect(() => {
    const refreshDate = () => setDeviceDate(new Date());
    const interval = setInterval(refreshDate, 60 * 1000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshDate();
    });

    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, []);

  return deviceDate;
}

export default function InsightsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const appTheme = useAppTheme();
  const heatmapColors = ['#F0ECFF', '#DCD2FF', '#A998F2', '#5B42D8'].map((color) => themedColor(color, appTheme));
  const { isDarkMode, habits, streakFreeze } = useAppColorScheme();
  const frozenDays = streakFreeze?.frozenDays;
  const bestStreak = useMemo(() => historyStats(habits, new Date(), frozenDays).bestStreak, [frozenDays, habits]);
  const deviceDate = useDeviceDate();
  const [activeTab, setActiveTab] = useState<'Insights' | 'Predictions'>('Insights');
  const [heatmapView, setHeatmapView] = useState<HeatmapView>('Weeks');
  const [selectedMonth, setSelectedMonth] = useState(deviceDate.getMonth());
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedHabitId, setSelectedHabitId] = useState('all');
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantFocus, setAssistantFocus] = useState(false);
  const [mlPrediction, setMlPrediction] = useState<{ habit_name?: string; completion_probability?: number; dropout_risk?: number; confidence?: number; recommended_action?: string; suggested_reminder_time?: string; summary?: string; prediction_source?: 'model' | 'fallback'; is_fallback?: boolean } | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const { completed, averageProgress, maxStreak } = getHabitProgressSummary(habits);
  const completionHistory = getRecentCompletionHistory(habits, 7);
  const dailyRates = completionHistory.map((entry) => habits.length ? Math.round((entry.count / habits.length) * 100) : 0);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const trendChart = getChartGeometry(dailyRates, chartSize.width, chartSize.height);
  const trendChange = dailyRates.length > 1 ? dailyRates[dailyRates.length - 1] - dailyRates[0] : 0;
  // The share of habits done per day over the last 7 days.
  const weeklyRate = dailyRates.length ? Math.round(dailyRates.reduce((total, rate) => total + rate, 0) / dailyRates.length) : 0;
  // Not missed yet: a habit can be completed until the day is over.
  const openHabits = Math.max(0, habits.length - completed);
  const strongestHabit = [...habits].sort((a, b) => b.progress - a.progress || b.streak - a.streak)[0];
  const weakestHabit = [...habits].sort((a, b) => a.progress - b.progress || a.streak - b.streak)[0];
  const insightMessages = weeklyRate >= 80
    ? ['You are building a reliable rhythm.', 'Your consistency is becoming a strength.', 'Small wins are turning into a strong routine.']
    : weeklyRate >= 40
      ? ['You are making steady progress.', 'Your routine is taking shape one win at a time.', 'Keep the next action small and repeatable.']
      : ['Start with one easy win today.', 'A small action is enough to restart your rhythm.', 'Your next completed habit can change the trend.'];
  const insightIndex = (deviceDate.getDate() + completed + Math.max(0, trendChange)) % insightMessages.length;
  const weeklyInsight = insightMessages[insightIndex];
  const suggestionOptions = weakestHabit
    ? [`Give ${weakestHabit.label} a two-minute start today.`, `Try ${weakestHabit.label} before your next break.`, `A smaller version of ${weakestHabit.label} can keep your streak moving.`]
    : ['Add one simple habit to start your consistency data.', 'Pick one small action and repeat it tomorrow.', 'Your first habit is the beginning of your trend.'];
  const suggestion = suggestionOptions[(deviceDate.getDate() + habits.length + completed) % suggestionOptions.length];
  // The hero cards are purple in both modes; their rings need the same colour in the middle.
  const heroBackground = themedColor(isDarkMode ? '#30215A' : '#5B42D8', appTheme);

  // "What HabitAI noticed": patterns in the student's own data, each one a question for the AI.
  // The strongest habit is only an anchor once it has some progress or a streak.
  const anchorHabit = strongestHabit && (strongestHabit.progress > 0 || strongestHabit.streak > 0) ? strongestHabit : null;
  const focusHabit = weakestHabit && weakestHabit.id !== anchorHabit?.id ? weakestHabit : null;
  const noticed: { icon: keyof typeof Ionicons.glyphMap; color: string; background: string; title: string; detail: string; ask: string }[] = habits.length === 0 ? [] : [
    { icon: 'today', color: '#5B42D8', background: '#EEE9FF', title: `${completed} of ${habits.length} done today`, detail: openHabits ? `${openHabits} still open. There is time before the day ends.` : 'Everything is done today. Nice work!', ask: 'What should I focus on today?' },
    ...(anchorHabit ? [{ icon: 'trophy' as const, color: '#C98A0E', background: '#FFF4D9', title: `${anchorHabit.label} is your anchor`, detail: `${anchorHabit.progress}% progress · ${anchorHabit.streak}-day streak. Keep it at the same time each day.`, ask: `How do I keep ${anchorHabit.label} going?` }] : []),
    ...(focusHabit ? [{ icon: 'leaf' as const, color: '#2F9E6E', background: '#E3F6EC', title: `${focusHabit.label} needs a smaller step`, detail: suggestion, ask: `How can I improve ${focusHabit.label}?` }] : []),
  ];

  // AI Assistant: the server answers from the student's habits and check-ins (only the question
  // is sent). If it cannot, a tip from the same data is shown and labelled as such.
  const offlineTip = weakestHabit && openHabits > 0
    ? `Start with ${weakestHabit.label}: do the smallest version of it before the day ends, then check it in.`
    : 'Pick one habit and repeat it at the same time tomorrow, so it becomes automatic.';
  const assistantChat = useAiChat(async (question): Promise<ChatAnswer> => {
    const result = await askAi('assistant', question);
    if (result.ok) return { ok: true, answer: result.answer };
    if (result.status === 401 || result.status === 429) return { ok: false, message: result.message, tone: 'warning' };
    return { ok: true, answer: offlineTip, note: `Offline tip from your habit data. ${result.message}` };
  });
  const openAssistant = (question?: string) => {
    setAssistantOpen(true);
    setAssistantFocus(!question);
    if (question) void assistantChat.send(question);
  };
  const assistantGreeting = habits.length === 0
    ? 'Hi! Add your first habit and I can turn your check-ins into a personal plan.'
    : openHabits === 0
      ? `All ${habits.length} habits are done today. Ask me how to keep this going, or about your streaks and goals.`
      : `You have ${openHabits} habit${openHabits === 1 ? '' : 's'} left today${weakestHabit ? `, and ${weakestHabit.label} needs the most attention` : ''}. Ask me anything about your habits, streaks or goals.`;
  const assistantSuggestions = [
    'What should I focus on today?',
    ...(weakestHabit ? [`How can I improve ${weakestHabit.label}?`] : []),
    'Which day am I most consistent?',
    'How do I protect my streak?',
  ];
  const currentYear = deviceDate.getFullYear();
  const currentMonth = deviceDate.getMonth();
  const activeMonth = Math.min(selectedMonth, currentMonth);
  const selectedHabit = habits.find((habit) => habit.id === selectedHabitId);
  const predictionHabitId = selectedHabit?.id || weakestHabit?.id || strongestHabit?.id || habits[0]?.id;
  const completionDates = new Set(selectedHabit ? selectedHabit.completionDates : habits.flatMap((habit) => habit.completionDates));
  const selectedHeatmap = getHeatmapData(heatmapView, activeMonth, selectedWeekOffset, completionDates, deviceDate);
  const apiUrl = getApiBaseUrl();

  useEffect(() => {
    const controller = new AbortController();
    let latestRequestId = 0;

    const loadPrediction = async () => {
      if (!apiUrl || habits.length === 0) {
        setMlPrediction(null);
        setPredictionError(null);
        setPredictionLoading(false);
        return;
      }

      const requestId = ++latestRequestId;
      const predictionHabit = habits.find((habit) => habit.id === predictionHabitId) || habits[0];
      if (!predictionHabit) return;
      const habitSignal = getHabitMachineLearningSignal(predictionHabit);

      try {
        setPredictionError(null);
        setPredictionLoading(true);
        const authHeaders = await getAuthenticatedHeaders();
        const response = await fetch(`${apiUrl}/api/habit/predict`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify(habitSignal),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('Prediction service unavailable');
        }

        const result = await response.json() as { completion_probability?: number; dropout_risk?: number; confidence?: number; recommended_action?: string; suggested_reminder_time?: string; summary?: string; habit_name?: string; prediction_source?: 'model' | 'fallback'; is_fallback?: boolean };
        if (requestId === latestRequestId) setMlPrediction(result);
      } catch {
        if (controller.signal.aborted || requestId !== latestRequestId) return;
        setMlPrediction(null);
        setPredictionError('Live AI forecast is unavailable. Showing your actual progress data instead.');
      } finally {
        if (!controller.signal.aborted && requestId === latestRequestId) setPredictionLoading(false);
      }
    };

    void loadPrediction();
    const refreshInterval = setInterval(() => {
      void loadPrediction();
    }, 60 * 1000);
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadPrediction();
    });

    return () => {
      controller.abort();
      clearInterval(refreshInterval);
      appStateSubscription.remove();
    };
  }, [apiUrl, habits, predictionHabitId]);

  const predictionPresentation = getPredictionPresentation(mlPrediction, predictionLoading);
  const displayedCompletionProbability = mlPrediction
    ? Math.round((mlPrediction.completion_probability ?? averageProgress / 100) * 100)
    : averageProgress;
  const displayedPredictionConfidence = mlPrediction ? Math.round((mlPrediction.confidence ?? 0) * 100) : null;
  const displayedPredictionSummary = mlPrediction?.summary || `${averageProgress}% is your current average habit progress based on recorded activity.`;
  const displayedRecommendation = mlPrediction?.recommended_action || 'Keep the routine small and repeatable to build momentum.';
  const displayedRisk = mlPrediction ? Math.round((mlPrediction.dropout_risk ?? 0) * 100) : null;
  const forecastHeadline = !predictionPresentation.hasForecast
    ? 'Recorded progress so far'
    : displayedCompletionProbability >= 75 ? 'Your next week looks promising.' : displayedCompletionProbability >= 50 ? 'Your next week looks steady.' : 'Your next week needs a reset.';
  // Named as well as coloured, so the level does not rely on colour alone.
  const riskLevel = displayedRisk === null ? null : displayedRisk >= 60 ? { label: 'High', color: '#FF7A85' } : displayedRisk >= 30 ? { label: 'Medium', color: '#FFC15E' } : { label: 'Low', color: '#5FD69C' };

  return (
    <>
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              {/* Insights is a tab, so there is nothing to go back to; the spacer keeps the title centred. */}
              <View style={styles.headerSpacer} />
              <View style={styles.headerTitleWrap}>
                <Text style={[styles.eyebrow, isDarkMode && styles.darkMutedText]}>YOUR PERSONAL DASHBOARD</Text>
                <Text style={[styles.headerTitle, isDarkMode && styles.darkPrimaryText]}>AI Insights</Text>
              </View>
              <View style={[styles.headerBadge, isDarkMode && styles.darkBadge]}>
                <Ionicons name="sparkles" size={16} color={themeColor('#5B42D8')} />
              </View>
            </View>

            <View style={[styles.segmentedControl, isDarkMode && styles.darkSegmentedControl]} accessibilityRole="tablist">
              {(['Insights', 'Predictions'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  style={[styles.segment, activeTab === tab && styles.segmentActive]}
                  onPress={() => setActiveTab(tab)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: activeTab === tab }}
                >
                  <Ionicons name={tab === 'Insights' ? 'bulb' : 'trending-up'} size={15} color={activeTab === tab ? themeColor('#FFFFFF') : isDarkMode ? '#AAA4B7' : '#777283'} />
                  <Text style={[styles.segmentText, isDarkMode && styles.darkSegmentText, activeTab === tab && styles.segmentTextActive]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            {activeTab === 'Insights' ? (
              <>
                <View style={[styles.heroCard, isDarkMode && styles.darkHeroCard]}>
                  <View style={styles.heroCopy}>
                    <View style={styles.heroLabelRow}>
                      <Ionicons name="sparkles" size={12} color={themedColor('#D8D0FF', appTheme)} />
                      <Text style={styles.heroLabel}>AI WEEKLY OVERVIEW</Text>
                    </View>
                    <Text style={styles.heroTitle}>{weeklyInsight}</Text>
                    <Text style={styles.heroSubtitle}>You did {weeklyRate}% of your habits over the last 7 days. Today: {completed} of {habits.length} done.</Text>
                  </View>
                  <ProgressRing value={weeklyRate} size={96} thickness={9} color="#FFFFFF" trackColor="rgba(255,255,255,0.2)" innerColor={heroBackground}>
                    <Text style={styles.heroScoreValue}>{weeklyRate}%</Text>
                    <Text style={styles.heroScoreLabel}>this week</Text>
                  </ProgressRing>
                </View>

                <View style={styles.metricsRow}>
                  {[{ value: `${completed}/${habits.length}`, label: 'Done today', icon: 'checkmark-circle', color: '#46B883', background: '#E7F8F0' }, { value: String(maxStreak), label: 'Current streak', icon: 'flame', color: '#EE9B43', background: '#FFF2E2' }, { value: String(bestStreak), label: 'Best streak', icon: 'trophy', color: '#6B57D9', background: '#EEEAFF' }].map((metric) => (
                    <View key={metric.label} style={[styles.metricCard, isDarkMode && styles.darkCard]}>
                      <View style={[styles.metricIcon, { backgroundColor: isDarkMode ? '#2B263A' : metric.background }]}>
                        <Ionicons name={metric.icon as keyof typeof Ionicons.glyphMap} size={16} color={isDarkMode ? '#C8BFFF' : metric.color} />
                      </View>
                      <Text style={[styles.metricValue, isDarkMode && styles.darkPrimaryText]}>{metric.value}</Text>
                      <Text style={[styles.metricLabel, isDarkMode && styles.darkMutedText]}>{metric.label}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.consistencyCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <Text style={[styles.cardTitle, isDarkMode && styles.darkPrimaryText]}>Consistency trend</Text>
                      <Text style={[styles.cardSubtitle, isDarkMode && styles.darkMutedText]}>Last 7 days</Text>
                    </View>
                    <View style={[styles.trendPill, trendChange < 0 && styles.trendPillDown]}><Ionicons name={trendChange < 0 ? 'arrow-down' : 'arrow-up'} size={12} color={trendChange < 0 ? themeColor('#D56A6A') : themeColor('#42A85F')} /><Text style={[styles.trendPillText, trendChange < 0 && styles.trendPillTextDown]}>{trendChange >= 0 ? '+' : ''}{trendChange}%</Text></View>
                  </View>
                  <View style={styles.chart}>
                    <View style={styles.yAxis}>
                      <Text style={styles.axisText}>100%</Text>
                      <Text style={styles.axisText}>75%</Text>
                      <Text style={styles.axisText}>50%</Text>
                      <Text style={styles.axisText}>25%</Text>
                      <Text style={styles.axisText}>0%</Text>
                    </View>
                    <View style={styles.chartPlot} onLayout={(event) => setChartSize({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
                      {[0, 1, 2, 3, 4].map((line) => <View key={line} style={[styles.chartGuide, isDarkMode && styles.darkChartGuide]} />)}
                      {chartSize.width > 0 && trendChart.segments.map((segment, index) => (
                        <View key={`segment-${index}`} style={[styles.chartSegment, segment]} />
                      ))}
                      {chartSize.width > 0 && trendChart.points.map((point, index) => (
                        <View key={`point-${index}`} style={[styles.chartPoint, { left: point.x, top: point.y }]}>
                          <View style={styles.chartPointInner} />
                        </View>
                      ))}
                    </View>
                    <View style={styles.xAxis}>
                      {completionHistory.map((day, index) => (
                        <Text key={day.dateKey} style={[styles.axisText, styles.xAxisLabel, { left: trendChart.points[index]?.x ?? 0 }]}>{index === completionHistory.length - 1 ? 'Today' : day.label}</Text>
                      ))}
                    </View>
                  </View>
                </View>

                <View style={[styles.noticedCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.noticedHeader}>
                    <Ionicons name="sparkles" size={18} color={themeColor('#5B42D8')} />
                    <View style={styles.noticedHeaderCopy}>
                      <Text style={[styles.cardTitle, isDarkMode && styles.darkPrimaryText]}>What HabitAI noticed</Text>
                      <Text style={[styles.cardSubtitle, isDarkMode && styles.darkMutedText]}>Tap one to ask the AI about it</Text>
                    </View>
                  </View>
                  {noticed.length === 0 ? (
                    <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>{suggestion}</Text>
                  ) : noticed.map((item, index) => (
                    <Pressable
                      key={item.title}
                      style={({ pressed }) => [styles.noticedRow, index > 0 && styles.noticedRowBorder, isDarkMode && styles.darkNoticedRow, pressed && styles.pressed]}
                      onPress={() => openAssistant(item.ask)}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}. ${item.detail} Ask HabitAI: ${item.ask}`}
                    >
                      <View style={[styles.noticedIcon, { backgroundColor: themeColor(item.background, 'backgroundColor') }]}>
                        <Ionicons name={item.icon} size={17} color={themeColor(item.color)} />
                      </View>
                      <View style={styles.noticedCopy}>
                        <Text style={[styles.noticedTitle, isDarkMode && styles.darkPrimaryText]}>{item.title}</Text>
                        <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>{item.detail}</Text>
                      </View>
                      <View style={[styles.askTag, isDarkMode && styles.darkAskTag]}>
                        <Ionicons name="chatbubble-ellipses" size={12} color={themeColor('#5B42D8')} />
                        <Text style={styles.askTagText}>Ask</Text>
                      </View>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : (
              <View style={styles.predictionScreen}>
                <HabitAnalysisPanel habits={habits} />
                <View style={[styles.forecastCard, isDarkMode && styles.darkHeroCard]}>
                  <View style={styles.heroLabelRow}>
                    <Ionicons name="sparkles" size={12} color={themedColor('#D8D0FF', appTheme)} />
                    <Text style={styles.heroLabel}>NEXT WEEK</Text>
                    <View style={styles.forecastPill}><Ionicons name={predictionPresentation.icon as keyof typeof Ionicons.glyphMap} size={12} color="#FFFFFF" /><Text style={styles.forecastPillText}>{predictionPresentation.label}</Text></View>
                  </View>

                  <View style={styles.forecastBody}>
                    <ProgressRing value={displayedCompletionProbability} size={112} thickness={10} color="#FFFFFF" trackColor="rgba(255,255,255,0.2)" innerColor={heroBackground}>
                      <Text style={styles.forecastValue}>{displayedCompletionProbability}%</Text>
                      <Text style={styles.forecastValueLabel}>{predictionPresentation.hasForecast ? 'likely done' : 'avg progress'}</Text>
                    </ProgressRing>
                    <View style={styles.forecastCopy}>
                      <Text style={styles.forecastTitle}>{forecastHeadline}</Text>
                      {mlPrediction?.habit_name ? <Text style={styles.forecastFor} numberOfLines={1}>For {mlPrediction.habit_name}</Text> : null}
                      <View style={styles.riskRow}>
                        <Text style={styles.riskLabel}>Dropout risk</Text>
                        <Text style={styles.riskValue}>{displayedRisk === null || !riskLevel ? '--' : `${displayedRisk}% · ${riskLevel.label}`}</Text>
                      </View>
                      <View style={styles.riskTrack}>
                        <View style={[styles.riskFill, { width: `${displayedRisk ?? 0}%`, backgroundColor: riskLevel?.color ?? 'transparent' }]} />
                      </View>
                    </View>
                  </View>

                  <View style={styles.nextStep}>
                    <View style={styles.nextStepIcon}><Ionicons name="bulb" size={16} color="#FFD36E" /></View>
                    <View style={styles.nextStepCopy}>
                      <Text style={styles.nextStepLabel}>NEXT STEP</Text>
                      <Text style={styles.nextStepText}>{displayedRecommendation}</Text>
                      {mlPrediction?.suggested_reminder_time ? (
                        <View style={styles.reminderChip}>
                          <Ionicons name="alarm-outline" size={13} color="#FFFFFF" />
                          <Text style={styles.reminderChipText}>Suggested reminder: {mlPrediction.suggested_reminder_time}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                  <Text style={styles.forecastNote}>{predictionLoading ? 'Checking for a model forecast…' : `${displayedPredictionSummary} ${predictionPresentation.detail}`}</Text>
                  {predictionError ? <Text style={styles.predictionErrorText}>{predictionError}</Text> : null}
                </View>

                <View style={styles.statGrid}>
                  {([
                    { icon: 'git-compare', color: '#5B42D8', background: '#EEE9FF', value: displayedPredictionConfidence === null ? '--' : `${displayedPredictionConfidence}%`, label: 'Model agreement', hint: 'Uncalibrated' },
                    { icon: 'trending-up', color: '#2E9D5C', background: '#E3F6EC', value: `${averageProgress}%`, label: 'Average progress' },
                    { icon: 'albums', color: '#C98A0E', background: '#FFF4D9', value: String(habits.length), label: 'Habits tracked' },
                    { icon: 'time', color: '#D56A6A', background: '#FFECEC', value: String(openHabits), label: 'Open today' },
                  ] as const).map((stat) => (
                    <View key={stat.label} style={[styles.statTile, isDarkMode && styles.darkCard]}>
                      <View style={[styles.statIcon, { backgroundColor: themeColor(stat.background, 'backgroundColor') }]}><Ionicons name={stat.icon} size={17} color={themeColor(stat.color)} /></View>
                      <View style={styles.statCopy}>
                        <Text style={[styles.statValue, isDarkMode && styles.darkPrimaryText]}>{stat.value}</Text>
                        <Text style={[styles.statLabel, isDarkMode && styles.darkMutedText]} numberOfLines={1}>{stat.label}</Text>
                        {'hint' in stat ? <Text style={[styles.statHint, isDarkMode && styles.darkMutedText]}>{stat.hint}</Text> : null}
                      </View>
                    </View>
                  ))}
                </View>
                <View style={[styles.predictionTrendCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <View style={styles.heatmapTitleRow}>
                        <View style={styles.heatmapIcon}><Ionicons name="grid-outline" size={16} color={themeColor('#5B42D8')} /></View>
                        <Text style={[styles.cardTitle, isDarkMode && styles.darkPrimaryText]}>Completion heatmap</Text>
                      </View>
                      <Text style={[styles.cardSubtitle, isDarkMode && styles.darkMutedText]}>{selectedHeatmap.subtitle}</Text>
                    </View>
                    <Pressable style={styles.heatmapRangeBadge} onPress={() => setMonthDropdownOpen((open) => !open)} accessibilityRole="button" accessibilityLabel={heatmapView === 'Weeks' ? 'Choose heatmap week' : 'Choose heatmap month'} accessibilityState={{ expanded: monthDropdownOpen }}>
                      <Ionicons name="calendar-outline" size={13} color={themeColor('#5B42D8')} />
                      <Text style={styles.heatmapRangeText}>{heatmapView === 'Days' || heatmapView === 'Months' ? formatDate(new Date(currentYear, activeMonth, 1), { month: 'short', year: 'numeric' }) : selectedHeatmap.badge}</Text>
                      <Ionicons name="chevron-down" size={13} color={themeColor('#5B42D8')} />
                    </Pressable>
                  </View>

                  {monthDropdownOpen && (
                    <View style={[styles.calendarDropdown, isDarkMode && styles.darkCalendarDropdown]}>
                      <View style={styles.calendarDropdownHeader}>
                        <View style={styles.calendarDropdownTitleRow}>
                          <View style={styles.calendarDropdownIcon}><Ionicons name="calendar" size={15} color={themeColor('#5B42D8')} /></View>
                          <View>
                            <Text style={[styles.calendarDropdownTitle, isDarkMode && styles.darkPrimaryText]}>Calendar range</Text>
                            <Text style={[styles.calendarDropdownSubtitle, isDarkMode && styles.darkMutedText]}>Live device calendar · {currentYear}</Text>
                          </View>
                        </View>
                        <View style={styles.todayBadge}><Text style={styles.todayBadgeText}>Today {formatDate(deviceDate, { month: 'short', day: 'numeric' })}</Text></View>
                      </View>
                      <View style={styles.calendarMonthGrid}>
                        {heatmapView === 'Weeks' ? Array.from({ length: 4 }, (_, index) => {
                          const offset = index;
                          const weekEnd = new Date(deviceDate);
                          weekEnd.setDate(deviceDate.getDate() - (offset * 7));
                          const isSelected = selectedWeekOffset === offset;
                          return (
                            <Pressable
                              key={`week-${offset}`}
                              style={[styles.calendarMonthOption, styles.calendarWeekOption, isDarkMode && styles.darkCalendarMonthOption, isSelected && styles.calendarMonthOptionActive]}
                              onPress={() => { setSelectedWeekOffset(offset); setMonthDropdownOpen(false); }}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isSelected }}
                              accessibilityLabel={`Show week ending ${formatDate(weekEnd, { month: 'long', day: 'numeric' })}`}
                            >
                              <Ionicons name="calendar-outline" size={13} color={isSelected ? themeColor('#FFFFFF') : themeColor('#5B42D8')} />
                              <Text style={[styles.calendarMonthText, isSelected && styles.calendarMonthTextActive]}>{offset === 0 ? 'This week' : `${offset} week${offset === 1 ? '' : 's'} ago`}</Text>
                              {isSelected && <Ionicons name="checkmark" size={12} color={themeColor('#FFFFFF')} />}
                            </Pressable>
                          );
                        }) : Array.from({ length: currentMonth + 1 }, (_, index) => {
                          const month = new Date(currentYear, index, 1);
                          const isSelected = activeMonth === index;
                          return (
                            <Pressable
                              key={index}
                              style={[styles.calendarMonthOption, isDarkMode && styles.darkCalendarMonthOption, isSelected && styles.calendarMonthOptionActive]}
                              onPress={() => { setSelectedMonth(index); setMonthDropdownOpen(false); }}
                              accessibilityRole="button"
                              accessibilityState={{ selected: isSelected }}
                              accessibilityLabel={`Show ${formatDate(month, { month: 'long' })} calendar data`}
                            >
                              <Text style={[styles.calendarMonthText, isSelected && styles.calendarMonthTextActive]}>{formatDate(month, { month: 'short' })}</Text>
                              {isSelected && <Ionicons name="checkmark" size={12} color={themeColor('#FFFFFF')} />}
                            </Pressable>
                          );
                        })}
                      </View>
                    </View>
                  )}

                  <View style={[styles.heatmapViewPicker, isDarkMode && styles.darkHeatmapViewPicker]}>
                    {(['Days', 'Weeks', 'Months'] as const).map((view) => (
                      <Pressable
                        key={view}
                        style={[styles.heatmapViewButton, heatmapView === view && styles.heatmapViewButtonActive]}
                        onPress={() => setHeatmapView(view)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: heatmapView === view }}
                        accessibilityLabel={`Show ${view} consistency`}
                      >
                        <Text style={[styles.heatmapViewText, heatmapView === view && styles.heatmapViewTextActive]}>{view}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Pressable style={[styles.habitFilterButton, isDarkMode && styles.darkHabitFilterButton]} onPress={() => setHabitDropdownOpen((open) => !open)} accessibilityRole="button" accessibilityLabel="Choose habit for heatmap" accessibilityState={{ expanded: habitDropdownOpen }}>
                    <Ionicons name="options-outline" size={14} color={themeColor('#5B42D8')} />
                    <Text style={styles.habitFilterText}>{selectedHabit?.label || 'All habits'}</Text>
                    <Ionicons name={habitDropdownOpen ? 'chevron-up' : 'chevron-down'} size={13} color={themeColor('#5B42D8')} />
                  </Pressable>

                  {habitDropdownOpen && (
                    <View style={[styles.habitDropdown, isDarkMode && styles.darkHabitDropdown]}>
                      <View style={styles.habitDropdownHeader}>
                        <View>
                          <Text style={[styles.habitDropdownTitle, isDarkMode && styles.darkPrimaryText]}>Your habits</Text>
                          <Text style={[styles.habitDropdownSubtitle, isDarkMode && styles.darkMutedText]}>{habits.length} habit{habits.length === 1 ? '' : 's'} tracked</Text>
                        </View>
                        <Ionicons name="sparkles-outline" size={16} color={themeColor('#5B42D8')} />
                      </View>
                      <Pressable style={[styles.habitOption, selectedHabitId === 'all' && styles.habitOptionActive]} onPress={() => { setSelectedHabitId('all'); setHabitDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: selectedHabitId === 'all' }}>
                        <View style={[styles.habitOptionIcon, selectedHabitId === 'all' && styles.habitOptionIconActive]}><Ionicons name="layers-outline" size={16} color={selectedHabitId === 'all' ? themeColor('#FFFFFF') : themeColor('#5B42D8')} /></View>
                        <View style={styles.habitOptionCopy}><Text style={[styles.habitOptionTitle, selectedHabitId === 'all' && styles.habitOptionTextActive]}>All habits</Text><Text style={[styles.habitOptionMeta, selectedHabitId === 'all' && styles.habitOptionMetaActive]}>Combined consistency</Text></View>
                        {selectedHabitId === 'all' && <Ionicons name="checkmark-circle" size={17} color={themeColor('#FFFFFF')} />}
                      </Pressable>
                      {habits.map((habit) => (
                        <Pressable key={habit.id} style={[styles.habitOption, selectedHabitId === habit.id && styles.habitOptionActive]} onPress={() => { setSelectedHabitId(habit.id); setHabitDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: selectedHabitId === habit.id }}>
                          <View style={[styles.habitOptionIcon, { backgroundColor: selectedHabitId === habit.id ? 'rgba(255,255,255,0.2)' : `${habit.color}22` }]}><Ionicons name={habit.icon as keyof typeof Ionicons.glyphMap} size={16} color={selectedHabitId === habit.id ? themeColor('#FFFFFF') : habit.color} /></View>
                          <View style={styles.habitOptionCopy}><Text style={[styles.habitOptionTitle, selectedHabitId === habit.id && styles.habitOptionTextActive]} numberOfLines={1}>{habit.label}</Text><Text style={[styles.habitOptionMeta, selectedHabitId === habit.id && styles.habitOptionMetaActive]}>{habit.progress}% progress{habit.done ? ' · Done today' : ''}</Text></View>
                          {selectedHabitId === habit.id && <Ionicons name="checkmark-circle" size={17} color={themeColor('#FFFFFF')} />}
                        </Pressable>
                      ))}
                      {habits.length === 0 && <Text style={[styles.habitEmptyText, isDarkMode && styles.darkMutedText]}>Add a habit to view its heatmap.</Text>}
                    </View>
                  )}

                  <View style={styles.heatmapHeaderRow}>
                    <View style={[styles.heatmapHeaderLabel, selectedHeatmap.isDaily && styles.heatmapDailySpacer]}>{selectedHeatmap.isDaily && <Ionicons name="calendar-outline" size={14} color={themeColor('#6E6887')} />}<Text style={styles.heatmapHeaderText}>{selectedHeatmap.isDaily ? 'Date' : 'Period'}</Text></View>
                    {selectedHeatmap.isDaily ? <View style={styles.heatmapCompletionHeader}><Ionicons name="briefcase-outline" size={14} color={themeColor('#6E6887')} /><Text style={styles.heatmapHeaderText}>Completion</Text></View> : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <Text key={day} style={styles.heatmapDayLabel}>{day}</Text>)}
                    <View style={styles.heatmapAverageHeader}><Ionicons name="trending-up-outline" size={14} color={themeColor('#6E6887')} /><Text style={styles.heatmapHeaderText}>Avg.</Text></View>
                  </View>
                  {selectedHeatmap.rows.map((week) => (
                    <View key={week.label} style={[styles.heatmapRow, selectedHeatmap.isDaily && styles.dailyHeatmapRow, week.isToday && styles.todayHeatmapRow, week.isToday && isDarkMode && styles.darkTodayHeatmapRow]}>
                      <Text style={[styles.heatmapWeekLabel, selectedHeatmap.isDaily && styles.heatmapDailyLabel]}>{week.label}</Text>
                      <View style={styles.heatmapCells}>
                        {week.values.map((level, index) => <View key={`${week.label}-${index}`} style={[styles.heatmapCell, selectedHeatmap.isDaily && styles.dailyHeatmapCell, { backgroundColor: heatmapColors[level - 1] }]} accessibilityLabel={`${week.label}, habit ${index + 1}, ${level} of 4 completion intensity`} />)}
                      </View>
                      <View style={[styles.heatmapAverageBadge, week.isToday && styles.todayAverageBadge]}><Text style={styles.heatmapAverage}>{week.average}</Text></View>
                    </View>
                  ))}

                  <View style={styles.heatmapFooter}>
                    <Text style={styles.heatmapGuide}>{selectedHeatmap.isDaily ? 'Live view based on your current habit status' : 'Each square represents one day'}</Text>
                    <View style={styles.heatmapLegend}><Text style={styles.legendText}>Less</Text>{heatmapColors.map((color) => <View key={color} style={[styles.heatmapLegendCell, { backgroundColor: color }]} />)}<Text style={styles.legendText}>More</Text></View>
                    <View style={styles.heatmapNote}><Ionicons name="trending-up" size={14} color={themeColor('#2E9D5C')} /><Text style={styles.heatmapNoteText}>{completed ? `${completed} habit${completed === 1 ? '' : 's'} completed today` : 'Complete a habit to build your activity history'}</Text></View>
                  </View>
                </View>

              </View>
            )}

            <View style={styles.askCardWrap}>
              <AskAiCard
                title="Ask HabitAI"
                subtitle="Answers from your real habits, check-ins and goals."
                suggestions={assistantSuggestions.slice(0, 2)}
                onOpen={() => openAssistant()}
                onAsk={openAssistant}
              />
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
      <AiChatSheet
        chat={assistantChat}
        visible={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        title="HabitAI Assistant"
        subtitle="Answers from your habits, check-ins and goals"
        greeting={assistantGreeting}
        suggestions={assistantSuggestions}
        placeholder="Ask about your habits..."
        footnote="Free to use. Answered by the secure HabitAI server (Groq AI); answers can be wrong."
        autoFocus={assistantFocus}
      />
    </>
  );
}

const themedStyles = createThemedStyles({
  pressed: { opacity: 0.75 },
  noticedCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 2, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  noticedHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 6 },
  noticedHeaderCopy: { flex: 1 },
  noticedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  noticedRowBorder: { borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  darkNoticedRow: { borderTopColor: '#2C2838' },
  noticedIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  noticedCopy: { flex: 1, minWidth: 0, gap: 2 },
  noticedTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800', color: '#302B3B' },
  askTag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1ECFF' },
  darkAskTag: { backgroundColor: '#2E2648' },
  askTagText: { fontSize: 11, fontWeight: '800', color: '#5B42D8' },
  forecastCard: { backgroundColor: '#5B42D8', borderRadius: 26, padding: 18, gap: 14, overflow: 'hidden' },
  forecastBody: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  forecastValue: { fontSize: 26, fontWeight: '900', color: '#FFFFFF' },
  forecastValueLabel: { fontSize: 11, fontWeight: '700', color: '#D8D0FF', marginTop: 1 },
  forecastCopy: { flex: 1, minWidth: 0 },
  forecastTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900', color: '#FFFFFF' },
  forecastFor: { fontSize: 12, fontWeight: '700', color: '#D8D0FF', marginTop: 4 },
  riskRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12 },
  riskLabel: { fontSize: 11, fontWeight: '700', color: '#D8D0FF' },
  riskValue: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  riskTrack: { height: 7, marginTop: 6, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.2)' },
  riskFill: { height: '100%', borderRadius: 4 },
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  nextStepIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  nextStepCopy: { flex: 1, minWidth: 0 },
  nextStepLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: '#D8D0FF' },
  nextStepText: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#FFFFFF', marginTop: 3 },
  reminderChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 8, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)' },
  reminderChipText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  forecastNote: { fontSize: 11, lineHeight: 16, fontWeight: '600', color: '#D8D0FF' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statTile: { flexGrow: 1, flexBasis: '45%', flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 72, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF' },
  statIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  statCopy: { flex: 1, minWidth: 0 },
  statValue: { fontSize: 19, fontWeight: '900', color: '#2C2C46' },
  statLabel: { fontSize: 11, fontWeight: '700', color: '#6B6780', marginTop: 1 },
  statHint: { fontSize: 11, fontWeight: '600', color: '#9A94A4' },
  askCardWrap: { marginTop: 18 },
  screen: { flex: 1, backgroundColor: '#F5F4F9' }, darkScreen: { backgroundColor: '#111018' },
  content: { flexGrow: 1, paddingBottom: 110 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  headerSpacer: { width: 38, height: 38 },
  headerTitleWrap: { alignItems: 'center', flex: 1 },
  eyebrow: { fontSize: 9, letterSpacing: 1.2, color: '#8D8998', fontWeight: '800', marginBottom: 3 },
  headerTitle: { fontSize: 23, fontWeight: '800', color: '#24212D' },
  headerBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECE8FF' },
  darkBadge: { backgroundColor: '#2B263A' },
  segmentedControl: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 16, padding: 4, marginBottom: 18 },
  segment: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  segmentActive: { backgroundColor: '#5B42D8' },
  segmentText: { fontSize: 13, color: '#777283', fontWeight: '700' },
  segmentTextActive: { color: '#FFFFFF' },
  darkSegmentedControl: { backgroundColor: '#1F1B28', borderColor: '#302B3B' },
  darkSegmentText: { color: '#AAA4B7' },
  darkCard: { backgroundColor: '#1B1823' },
  darkHeroCard: { backgroundColor: '#30215A' },
  darkPrimaryText: { color: '#F7F4FF' },
  darkMutedText: { color: '#AAA4B7' },
  heroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#5B42D8', borderRadius: 24, padding: 20, marginBottom: 14, overflow: 'hidden' },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  heroLabel: { fontSize: 10, color: '#D8D0FF', fontWeight: '800', letterSpacing: 1 },
  heroTitle: { fontSize: 21, lineHeight: 26, color: '#FFFFFF', fontWeight: '800', marginBottom: 6 },
  heroSubtitle: { fontSize: 12, lineHeight: 17, color: '#D8D0FF', fontWeight: '600' },
  heroScoreValue: { fontSize: 22, color: '#FFFFFF', fontWeight: '900' },
  heroScoreLabel: { fontSize: 11, color: '#D8D0FF', fontWeight: '700', marginTop: 1 },
  metricsRow: { flexDirection: 'row', gap: 9, marginBottom: 14 },
  metricCard: { flex: 1, minHeight: 105, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 11, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  metricIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 9 },
  metricValue: { fontSize: 19, color: '#25222E', fontWeight: '800' },
  metricLabel: { fontSize: 10, color: '#817C8C', fontWeight: '700', marginTop: 2 },
  consistencyCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 14, shadowColor: '#292047', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  cardHeaderRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#25222E', marginBottom: 5 },
  cardSubtitle: { fontSize: 11, lineHeight: 16, color: '#777282', fontWeight: '600' },
  trendPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#EAF8F0' },
  trendPillText: { fontSize: 10, color: '#42A85F', fontWeight: '800' },
  trendPillDown: { backgroundColor: '#FFF0F0' },
  trendPillTextDown: { color: '#D56A6A' },
  chart: { height: 190, marginTop: 20, paddingLeft: 36, paddingBottom: 26 },
  yAxis: { position: 'absolute', left: 0, top: 0, bottom: 26, justifyContent: 'space-between' },
  axisText: { fontSize: 9, color: '#8D8998', fontWeight: '600' },
  chartPlot: { flex: 1, position: 'relative', justifyContent: 'space-between' },
  chartGuide: { height: 1, backgroundColor: '#F0EEF4' },
  darkChartGuide: { backgroundColor: '#302B39' },
  chartSegment: { position: 'absolute', height: 2, backgroundColor: '#5B42D8', transformOrigin: 'left center' },
  chartPoint: { position: 'absolute', width: 9, height: 9, borderRadius: 5, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#5B42D8', marginLeft: -4, marginTop: -4 },
  chartPointInner: { flex: 1, margin: 2, borderRadius: 3, backgroundColor: '#5B42D8' },
  xAxis: { position: 'absolute', left: 36, right: 0, bottom: 0, height: 14 },
  xAxisLabel: { position: 'absolute', width: 30, marginLeft: -15, textAlign: 'center' },
  insightBody: { fontSize: 12, lineHeight: 18, color: '#6F6A79', fontWeight: '600' },
  predictionScreen: { gap: 16 },
  forecastPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5, marginLeft: 'auto' },
  forecastPillText: { fontSize: 11, color: '#FFFFFF', fontWeight: '800' },
  predictionErrorText: { fontSize: 11, lineHeight: 16, color: '#FFD9C7', fontWeight: '700' },
  predictionTrendCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 20, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  heatmapTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heatmapIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center' },
  heatmapRangeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F0EBFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8 },
  heatmapRangeText: { fontSize: 9, color: '#5B42D8', fontWeight: '800' },
  calendarDropdown: { marginTop: 10, padding: 13, borderRadius: 16, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#E9E4F7' },
  darkCalendarDropdown: { backgroundColor: '#252130', borderColor: '#3B334C' },
  calendarDropdownHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 },
  calendarDropdownTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  calendarDropdownIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAE3FF' },
  calendarDropdownTitle: { fontSize: 11, color: '#302B3B', fontWeight: '800' },
  calendarDropdownSubtitle: { fontSize: 9, color: '#827C8C', fontWeight: '600', marginTop: 2 },
  todayBadge: { backgroundColor: '#EAF8F0', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 6 },
  todayBadgeText: { fontSize: 9, color: '#328651', fontWeight: '800' },
  calendarMonthGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  calendarMonthOption: { minWidth: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, backgroundColor: '#FFFFFF', borderRadius: 9, paddingHorizontal: 8, paddingVertical: 8 },
  calendarWeekOption: { width: '100%', justifyContent: 'flex-start' },
  darkCalendarMonthOption: { backgroundColor: '#332D43' },
  calendarMonthOptionActive: { backgroundColor: '#5B42D8' },
  calendarMonthText: { fontSize: 10, color: '#6E6887', fontWeight: '800' },
  calendarMonthTextActive: { color: '#FFFFFF' },
  heatmapViewPicker: { flexDirection: 'row', backgroundColor: '#F5F3FA', borderRadius: 13, padding: 4, marginTop: 18, marginBottom: 2 },
  darkHeatmapViewPicker: { backgroundColor: '#29243A' },
  heatmapViewButton: { flex: 1, alignItems: 'center', borderRadius: 10, paddingVertical: 9 },
  heatmapViewButtonActive: { backgroundColor: '#5B42D8' },
  heatmapViewText: { fontSize: 10, color: '#777283', fontWeight: '800' },
  heatmapViewTextActive: { color: '#FFFFFF' },
  habitFilterButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: '#F0EBFF', borderRadius: 11, paddingHorizontal: 10, paddingVertical: 8, marginTop: 12 },
  darkHabitFilterButton: { backgroundColor: '#332B49' },
  habitFilterText: { maxWidth: 190, color: '#5B42D8', fontSize: 10, fontWeight: '800' },
  habitDropdown: { marginTop: 8, padding: 9, borderRadius: 16, backgroundColor: '#F8F7FC', borderWidth: 1, borderColor: '#E9E4F7' },
  darkHabitDropdown: { backgroundColor: '#252130', borderColor: '#3B334C' },
  habitDropdownHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 7, paddingBottom: 8 },
  habitDropdownTitle: { fontSize: 11, color: '#302B3B', fontWeight: '800' },
  habitDropdownSubtitle: { fontSize: 9, color: '#827C8C', fontWeight: '600', marginTop: 2 },
  habitOption: { flexDirection: 'row', alignItems: 'center', minHeight: 47, borderRadius: 11, paddingHorizontal: 8, paddingVertical: 6, marginTop: 3 },
  habitOptionActive: { backgroundColor: '#5B42D8' },
  habitOptionIcon: { width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAE3FF' },
  habitOptionIconActive: { backgroundColor: 'rgba(255,255,255,0.2)' },
  habitOptionCopy: { flex: 1, marginHorizontal: 9 },
  habitOptionTitle: { color: '#393440', fontSize: 10, fontWeight: '800' },
  habitOptionTextActive: { color: '#FFFFFF' },
  habitOptionMeta: { color: '#827C8C', fontSize: 9, fontWeight: '600', marginTop: 2 },
  habitOptionMetaActive: { color: '#E9E2FF' },
  habitEmptyText: { color: '#827C8C', fontSize: 10, fontWeight: '600', padding: 10, textAlign: 'center' },
  heatmapHeaderRow: { flexDirection: 'row', alignItems: 'center', marginTop: 24, marginBottom: 9 },
  heatmapHeaderLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 48 },
  heatmapCompletionHeader: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  heatmapAverageHeader: { width: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 },
  heatmapHeaderText: { fontSize: 9, color: '#6E6887', fontWeight: '800' },
  heatmapDailySpacer: { width: 112 },
  heatmapDayLabel: { flex: 1, textAlign: 'center', fontSize: 9, color: '#8D8998', fontWeight: '800' },
  heatmapRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dailyHeatmapRow: { minHeight: 42, paddingHorizontal: 7, paddingVertical: 5, borderRadius: 12 },
  todayHeatmapRow: { backgroundColor: '#F5F1FF' },
  darkTodayHeatmapRow: { backgroundColor: '#29233A' },
  heatmapWeekLabel: { width: 48, fontSize: 9, color: '#6E6887', fontWeight: '800' },
  heatmapDailyLabel: { width: 112 },
  heatmapCells: { flex: 1, flexDirection: 'row', gap: 7 },
  heatmapCell: { flex: 1, aspectRatio: 1, maxWidth: 31, borderRadius: 7, borderWidth: 1, borderColor: 'rgba(91,66,216,0.08)' },
  dailyHeatmapCell: { maxWidth: 20, borderRadius: 5 },
  heatmapAverageBadge: { width: 43, alignItems: 'center', backgroundColor: '#F0EBFF', borderRadius: 10, paddingVertical: 6 },
  todayAverageBadge: { backgroundColor: '#DDD3FF' },
  heatmapAverage: { fontSize: 10, color: '#5B42D8', fontWeight: '800' },
  heatmapFooter: { marginTop: 16, gap: 10 },
  heatmapGuide: { fontSize: 10, color: '#8D8998', fontWeight: '600' },
  heatmapLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  heatmapLegendCell: { width: 13, height: 13, borderRadius: 4 },
  legendText: { fontSize: 10, color: '#6E6887', fontWeight: '600' },
  heatmapNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EAF8F0', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  heatmapNoteText: { flex: 1, fontSize: 10, color: '#328651', fontWeight: '700' },
});

