import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { AppState } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getApiBaseUrl, getAuthenticatedHeaders } from '@/authentication';
import { getHabitCompletionHistory, getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';
import { getPredictionPresentation } from '@/utils/ai-presentation';
import { askAi } from '@/utils/ai-client';

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

const CHART_X_INSET = 16;

/**
 * Points and connecting segments in pixels of the measured plot. (Percentages used to mix the
 * plot's width and height, so lines pointed the wrong way whenever the chart was not phone-sized.)
 */
function getChartGeometry(rates: number[], width: number, height: number) {
  const step = (width - CHART_X_INSET * 2) / Math.max(1, rates.length - 1);
  const points = rates.map((rate, index) => ({ x: CHART_X_INSET + index * step, y: height - (Math.max(0, Math.min(100, rate)) / 100) * height }));
  const segments = points.slice(0, -1).map((point, index) => {
    const next = points[index + 1];
    const dx = next.x - point.x;
    const dy = next.y - point.y;
    return { left: point.x, top: point.y - 1, width: Math.sqrt(dx ** 2 + dy ** 2), transform: [{ rotate: `${Math.atan2(dy, dx) * (180 / Math.PI)}deg` }] };
  });
  return { points, segments };
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
  const { isDarkMode, habits } = useAppColorScheme();
  const deviceDate = useDeviceDate();
  const [activeTab, setActiveTab] = useState<'Insights' | 'Predictions'>('Insights');
  const [heatmapView, setHeatmapView] = useState<HeatmapView>('Weeks');
  const [selectedMonth, setSelectedMonth] = useState(deviceDate.getMonth());
  const [selectedWeekOffset, setSelectedWeekOffset] = useState(0);
  const [selectedHabitId, setSelectedHabitId] = useState('all');
  const [monthDropdownOpen, setMonthDropdownOpen] = useState(false);
  const [habitDropdownOpen, setHabitDropdownOpen] = useState(false);
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [assistantResponse, setAssistantResponse] = useState('');
  const [assistantResponseSource, setAssistantResponseSource] = useState<'gemini' | 'local' | null>(null);
  const [assistantError, setAssistantError] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const assistantInputRef = useRef<TextInput | null>(null);
  const assistantScrollRef = useRef<ScrollView | null>(null);
  const [mlPrediction, setMlPrediction] = useState<{ habit_name?: string; completion_probability?: number; dropout_risk?: number; confidence?: number; recommended_action?: string; suggested_reminder_time?: string; summary?: string; prediction_source?: 'model' | 'fallback'; is_fallback?: boolean } | null>(null);
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionProgress] = useState(() => new Animated.Value(0));
  const { completed, completionPercent, averageProgress, maxStreak } = getHabitProgressSummary(habits);
  const completionHistory = getHabitCompletionHistory(habits, 7);
  const dailyRates = completionHistory.map((entry) => habits.length ? Math.round((entry.count / habits.length) * 100) : 0);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });
  const trendChart = getChartGeometry(dailyRates, chartSize.width, chartSize.height);
  const trendChange = dailyRates.length > 1 ? dailyRates[dailyRates.length - 1] - dailyRates[0] : 0;
  // Not missed yet: a habit can be completed until the day is over.
  const openHabits = Math.max(0, habits.length - completed);
  const successRate = habits.length ? Math.round(habits.reduce((total, habit) => total + habit.progress, 0) / habits.length) : 0;
  const strongestHabit = [...habits].sort((a, b) => b.progress - a.progress || b.streak - a.streak)[0];
  const weakestHabit = [...habits].sort((a, b) => a.progress - b.progress || a.streak - b.streak)[0];
  const insightMessages = completionPercent >= 80
    ? ['You are building a reliable rhythm.', 'Your consistency is becoming a strength.', 'Small wins are turning into a strong routine.']
    : completionPercent >= 40
      ? ['You are making steady progress.', 'Your routine is taking shape one win at a time.', 'Keep the next action small and repeatable.']
      : ['Start with one easy win today.', 'A small action is enough to restart your rhythm.', 'Your next completed habit can change the trend.'];
  const insightIndex = (deviceDate.getDate() + completed + Math.max(0, trendChange)) % insightMessages.length;
  const weeklyInsight = insightMessages[insightIndex];
  const suggestionOptions = weakestHabit
    ? [`Give ${weakestHabit.label} a two-minute start today.`, `Try ${weakestHabit.label} before your next break.`, `A smaller version of ${weakestHabit.label} can keep your streak moving.`]
    : ['Add one simple habit to start your consistency data.', 'Pick one small action and repeat it tomorrow.', 'Your first habit is the beginning of your trend.'];
  const suggestion = suggestionOptions[(deviceDate.getDate() + habits.length + completed) % suggestionOptions.length];

  useEffect(() => {
    const keyboardDidShow = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardInset(event.endCoordinates?.height ?? 0);
      setTimeout(() => {
        assistantScrollRef.current?.scrollToEnd({ animated: true });
        assistantInputRef.current?.focus();
      }, 80);
    });
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardInset(0);
    });

    return () => {
      keyboardDidShow.remove();
      keyboardDidHide.remove();
    };
  }, []);

  const askAssistant = () => {
    setAssistantResponse('');
    setAssistantResponseSource(null);
    setAssistantError('');
    setAssistantVisible(true);
  };

  const assistantReply = assistantQuestion.trim()
    ? `Based on your data, ${completionPercent}% of tracked habits are complete today. Focus next on ${weakestHabit?.label || 'one small habit'} and keep the action easy to repeat.`
    : strongestHabit
      ? `${strongestHabit.label} is currently your strongest habit at ${strongestHabit.progress}%. Keep that routine as your anchor, then give ${weakestHabit?.label || 'your next habit'} a smaller starting step.`
      : 'Add your first habit and I can turn your activity into a personalized plan.';

  const requestAssistantGuidance = async () => {
    if (assistantLoading) return;
    const localReply = assistantQuestion.trim()
      ? assistantReply
      : 'Try one small action next: complete the habit with the lowest progress before the day ends.';
    setAssistantResponse('Thinking...');
    setAssistantResponseSource(null);
    setAssistantError('');
    setAssistantLoading(true);
    try {
      // The server reads the student's habits and check-ins itself; only the question is sent.
      const result = await askAi('assistant', assistantQuestion || 'What should I focus on next?');
      if (result.ok) {
        setAssistantResponse(result.answer);
        setAssistantResponseSource('gemini');
      } else {
        setAssistantResponse(localReply);
        setAssistantResponseSource('local');
        setAssistantError(result.message);
      }
    } finally {
      setAssistantLoading(false);
    }
  };

  type PredictionTone = 'green' | 'blue' | 'orange';

  const toneStyles: Record<PredictionTone, object> = {
    green: styles.greenCard,
    blue: styles.blueCard,
    orange: styles.orangeCard,
  };
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
  const forecastMessage = displayedRecommendation;

  useEffect(() => {
    Animated.timing(predictionProgress, {
      toValue: displayedCompletionProbability,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [displayedCompletionProbability, predictionProgress]);

  return (
    <>
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={[styles.backButton, isDarkMode && styles.darkIconButton]} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={21} color={isDarkMode ? '#F7F4FF' : '#292633'} />
              </Pressable>
              <View style={styles.headerTitleWrap}>
                <Text style={[styles.eyebrow, isDarkMode && styles.darkMutedText]}>YOUR PERSONAL DASHBOARD</Text>
                <Text style={[styles.headerTitle, isDarkMode && styles.darkPrimaryText]}>AI Insights</Text>
              </View>
              <View style={[styles.headerBadge, isDarkMode && styles.darkBadge]}>
                <Ionicons name="sparkles" size={16} color="#5B42D8" />
              </View>
            </View>

            <View style={styles.segmentedControl}>
              {(['Insights', 'Predictions'] as const).map((tab) => (
                <Pressable
                  key={tab}
                  style={[styles.segment, activeTab === tab && styles.segmentActive]}
                  onPress={() => setActiveTab(tab)}
                >
                  <Text style={[styles.segmentText, activeTab === tab && styles.segmentTextActive]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            {activeTab === 'Insights' ? (
              <>
                <View style={[styles.heroCard, isDarkMode && styles.darkHeroCard]}>
                  <View style={styles.heroCopy}>
                    <View style={styles.heroLabelRow}>
                      <View style={styles.liveDot} />
                      <Text style={styles.heroLabel}>WEEKLY OVERVIEW</Text>
                    </View>
                    <Text style={styles.heroTitle}>{insightMessages[insightIndex]}</Text>
                    <Text style={styles.heroSubtitle}>{completionPercent}% of today&apos;s tracked habits are complete. Keep showing up for your routine.</Text>
                  </View>
                  <View style={styles.heroScore}>
                    <Text style={styles.heroScoreValue}>{completionPercent}%</Text>
                    <Text style={styles.heroScoreLabel}>consistency</Text>
                  </View>
                </View>

                <View style={styles.metricsRow}>
                  {[{ value: String(completed), label: 'Completed', icon: 'checkmark-circle', color: '#46B883', background: '#E7F8F0' }, { value: String(maxStreak), label: 'Best streak', icon: 'flame', color: '#EE9B43', background: '#FFF2E2' }, { value: `${averageProgress}%`, label: 'Avg. progress', icon: 'trending-up', color: '#6B57D9', background: '#EEEAFF' }].map((metric) => (
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
                    <View style={[styles.trendPill, trendChange < 0 && styles.trendPillDown]}><Ionicons name={trendChange < 0 ? 'arrow-down' : 'arrow-up'} size={12} color={trendChange < 0 ? '#D56A6A' : '#42A85F'} /><Text style={[styles.trendPillText, trendChange < 0 && styles.trendPillTextDown]}>{trendChange >= 0 ? '+' : ''}{trendChange}%</Text></View>
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
                      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
                        <Text key={day} style={[styles.axisText, styles.xAxisLabel, { left: trendChart.points[index]?.x ?? 0 }]}>{day}</Text>
                      ))}
                    </View>
                  </View>
                </View>

                <View style={[styles.insightCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.insightHeading}>
                    <View style={styles.statusDot} />
                    <Text style={[styles.insightTitle, isDarkMode && styles.darkPrimaryText]}>Weekly Insight</Text>
                  </View>
                  <Text style={styles.insightHeadline}>{weeklyInsight}</Text>
                  <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>{completed} completed and {openHabits} still open today. Your current average progress is {averageProgress}%.</Text>
                </View>

                <View style={[styles.suggestionCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.suggestionHeading}>
                    <Ionicons name="sparkles" size={18} color="#5B42D8" />
                    <Text style={[styles.insightTitle, isDarkMode && styles.darkPrimaryText]}>Habit suggestion</Text>
                  </View>
                  <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>{suggestion}</Text>
                </View>
              </>
            ) : (
              <View style={styles.predictionScreen}>
                <View style={[styles.predictionHeroCard, isDarkMode && styles.darkHeroCard]}>
                  <View style={styles.heroLabelRow}>
                    <View style={styles.liveDot} />
                    <Text style={styles.heroLabel}>NEXT WEEK</Text>
                      <View style={styles.forecastPill}><Ionicons name={predictionPresentation.icon as keyof typeof Ionicons.glyphMap} size={11} color="#5B42D8" /><Text style={styles.forecastPillText}>{predictionPresentation.label}</Text></View>
                  </View>

                  <View style={styles.predictionHeroLayout}>
                    <View style={styles.predictionHeroTextWrap}>
                      <Text style={[styles.predictionTitle, isDarkMode && styles.darkPrimaryText]}>
                        {forecastHeadline}
                      </Text>
                      <Text style={[styles.predictionSubtitle, isDarkMode && styles.darkMutedText]}>
                        {displayedPredictionSummary} {predictionPresentation.detail}
                      </Text>
                      <View style={styles.predictionSummaryBox}>
                        <View style={styles.predictionSummaryRow}>
                          <Text style={styles.predictionSummaryLabel}>{predictionPresentation.hasForecast ? 'Completion forecast' : 'Average progress'}</Text>
                            <Text style={styles.predictionSummaryValue}>{displayedCompletionProbability}%</Text>
                        </View>
                        <View style={styles.predictionSummaryRow}>
                          <Text style={styles.predictionSummaryLabel}>Dropout risk</Text>
                            <Text style={styles.predictionSummaryValue}>{displayedRisk === null ? '--' : `${displayedRisk}%`}</Text>
                        </View>
                        <View style={styles.predictionProgressTrack}>
                          <Animated.View style={[styles.predictionProgressFill, { width: predictionProgress.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
                        </View>
                        <Text style={styles.predictionProgressLabel}>{predictionLoading ? 'Checking for a model forecast...' : predictionPresentation.hasForecast ? `${displayedCompletionProbability}% predicted completion` : `${displayedCompletionProbability}% recorded average progress`}</Text>
                      </View>
                      {predictionError ? <Text style={styles.predictionErrorText}>{predictionError}</Text> : null}
                    </View>

                    <View style={styles.chatBubbleWrap}>
                      <View style={styles.chatBubble}>
                        <Text style={styles.chatBubbleText}>{forecastMessage}</Text>
                      </View>
                      <View style={styles.robotBubble}>
                        <View style={styles.robotHead}>
                          <View style={styles.robotFace}>
                            <View style={styles.robotEye} />
                            <View style={styles.robotEye} />
                            <View style={styles.robotMouth} />
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>

                  <View style={styles.predictionStatsRow}>
                    <View style={styles.predictionStatCard}>
                      <View style={styles.circleGauge}>
                        <Text style={styles.circleGaugeText}>{displayedPredictionConfidence === null ? '--' : `${displayedPredictionConfidence}%`}</Text>
                      </View>
                      <Text style={styles.predictionStatLabel}>model agreement (uncalibrated)</Text>
                    </View>
                    <View style={styles.predictionStatCard}>
                      <View style={styles.trendPillLarge}><Ionicons name="trending-up" size={16} color="#2E9D5C" /></View>
                      <Text style={styles.predictionStatValue}>{averageProgress}%</Text>
                      <Text style={styles.predictionStatLabel}>average progress</Text>
                    </View>
                    <View style={styles.predictionStatCard}>
                      <View style={styles.trophyBadgeLarge}><Ionicons name="trophy" size={16} color="#E8A126" /></View>
                      <Text style={styles.predictionStatValue}>{habits.length}</Text>
                      <Text style={styles.predictionStatLabel}>habits tracked</Text>
                    </View>
                    <View style={styles.predictionStatCard}>
                      <View style={styles.trendPillLarge}><Ionicons name="close-circle" size={16} color="#D56A6A" /></View>
                      <Text style={styles.predictionStatValue}>{openHabits}</Text>
                      <Text style={styles.predictionStatLabel}>open today</Text>
                    </View>
                  </View>
                </View>

                <View style={[styles.suggestionCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.suggestionHeading}>
                    <Ionicons name="bulb-outline" size={18} color="#5B42D8" />
                    <Text style={[styles.insightTitle, isDarkMode && styles.darkPrimaryText]}>Prediction action</Text>
                  </View>
                  <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>{displayedRecommendation}</Text>
                  {mlPrediction?.suggested_reminder_time ? (
                    <Text style={[styles.insightBody, isDarkMode && styles.darkMutedText]}>
                      Suggested reminder: {mlPrediction.suggested_reminder_time}
                    </Text>
                  ) : null}
                </View>

                <View style={[styles.predictionTrendCard, isDarkMode && styles.darkCard]}>
                  <View style={styles.cardHeaderRow}>
                    <View>
                      <View style={styles.heatmapTitleRow}>
                        <View style={styles.heatmapIcon}><Ionicons name="grid-outline" size={16} color="#5B42D8" /></View>
                        <Text style={[styles.cardTitle, isDarkMode && styles.darkPrimaryText]}>Completion heatmap</Text>
                      </View>
                      <Text style={[styles.cardSubtitle, isDarkMode && styles.darkMutedText]}>{selectedHeatmap.subtitle}</Text>
                    </View>
                    <Pressable style={styles.heatmapRangeBadge} onPress={() => setMonthDropdownOpen((open) => !open)} accessibilityRole="button" accessibilityLabel={heatmapView === 'Weeks' ? 'Choose heatmap week' : 'Choose heatmap month'} accessibilityState={{ expanded: monthDropdownOpen }}>
                      <Ionicons name="calendar-outline" size={13} color="#5B42D8" />
                      <Text style={styles.heatmapRangeText}>{heatmapView === 'Days' || heatmapView === 'Months' ? formatDate(new Date(currentYear, activeMonth, 1), { month: 'short', year: 'numeric' }) : selectedHeatmap.badge}</Text>
                      <Ionicons name="chevron-down" size={13} color="#5B42D8" />
                    </Pressable>
                  </View>

                  {monthDropdownOpen && (
                    <View style={[styles.calendarDropdown, isDarkMode && styles.darkCalendarDropdown]}>
                      <View style={styles.calendarDropdownHeader}>
                        <View style={styles.calendarDropdownTitleRow}>
                          <View style={styles.calendarDropdownIcon}><Ionicons name="calendar" size={15} color="#5B42D8" /></View>
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
                              <Ionicons name="calendar-outline" size={13} color={isSelected ? '#FFFFFF' : '#5B42D8'} />
                              <Text style={[styles.calendarMonthText, isSelected && styles.calendarMonthTextActive]}>{offset === 0 ? 'This week' : `${offset} week${offset === 1 ? '' : 's'} ago`}</Text>
                              {isSelected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
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
                              {isSelected && <Ionicons name="checkmark" size={12} color="#FFFFFF" />}
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
                    <Ionicons name="options-outline" size={14} color="#5B42D8" />
                    <Text style={styles.habitFilterText}>{selectedHabit?.label || 'All habits'}</Text>
                    <Ionicons name={habitDropdownOpen ? 'chevron-up' : 'chevron-down'} size={13} color="#5B42D8" />
                  </Pressable>

                  {habitDropdownOpen && (
                    <View style={[styles.habitDropdown, isDarkMode && styles.darkHabitDropdown]}>
                      <View style={styles.habitDropdownHeader}>
                        <View>
                          <Text style={[styles.habitDropdownTitle, isDarkMode && styles.darkPrimaryText]}>Your habits</Text>
                          <Text style={[styles.habitDropdownSubtitle, isDarkMode && styles.darkMutedText]}>{habits.length} habit{habits.length === 1 ? '' : 's'} tracked</Text>
                        </View>
                        <Ionicons name="sparkles-outline" size={16} color="#5B42D8" />
                      </View>
                      <Pressable style={[styles.habitOption, selectedHabitId === 'all' && styles.habitOptionActive]} onPress={() => { setSelectedHabitId('all'); setHabitDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: selectedHabitId === 'all' }}>
                        <View style={[styles.habitOptionIcon, selectedHabitId === 'all' && styles.habitOptionIconActive]}><Ionicons name="layers-outline" size={16} color={selectedHabitId === 'all' ? '#FFFFFF' : '#5B42D8'} /></View>
                        <View style={styles.habitOptionCopy}><Text style={[styles.habitOptionTitle, selectedHabitId === 'all' && styles.habitOptionTextActive]}>All habits</Text><Text style={[styles.habitOptionMeta, selectedHabitId === 'all' && styles.habitOptionMetaActive]}>Combined consistency</Text></View>
                        {selectedHabitId === 'all' && <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />}
                      </Pressable>
                      {habits.map((habit) => (
                        <Pressable key={habit.id} style={[styles.habitOption, selectedHabitId === habit.id && styles.habitOptionActive]} onPress={() => { setSelectedHabitId(habit.id); setHabitDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: selectedHabitId === habit.id }}>
                          <View style={[styles.habitOptionIcon, { backgroundColor: selectedHabitId === habit.id ? 'rgba(255,255,255,0.2)' : `${habit.color}22` }]}><Ionicons name={habit.icon as keyof typeof Ionicons.glyphMap} size={16} color={selectedHabitId === habit.id ? '#FFFFFF' : habit.color} /></View>
                          <View style={styles.habitOptionCopy}><Text style={[styles.habitOptionTitle, selectedHabitId === habit.id && styles.habitOptionTextActive]} numberOfLines={1}>{habit.label}</Text><Text style={[styles.habitOptionMeta, selectedHabitId === habit.id && styles.habitOptionMetaActive]}>{habit.progress}% progress{habit.done ? ' · Done today' : ''}</Text></View>
                          {selectedHabitId === habit.id && <Ionicons name="checkmark-circle" size={17} color="#FFFFFF" />}
                        </Pressable>
                      ))}
                      {habits.length === 0 && <Text style={[styles.habitEmptyText, isDarkMode && styles.darkMutedText]}>Add a habit to view its heatmap.</Text>}
                    </View>
                  )}

                  <View style={styles.heatmapHeaderRow}>
                    <View style={[styles.heatmapHeaderLabel, selectedHeatmap.isDaily && styles.heatmapDailySpacer]}><Ionicons name="calendar-outline" size={14} color="#6E6887" /><Text style={styles.heatmapHeaderText}>{selectedHeatmap.isDaily ? 'Date' : 'Period'}</Text></View>
                    {selectedHeatmap.isDaily ? <View style={styles.heatmapCompletionHeader}><Ionicons name="briefcase-outline" size={14} color="#6E6887" /><Text style={styles.heatmapHeaderText}>Completion</Text></View> : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <Text key={day} style={styles.heatmapDayLabel}>{day}</Text>)}
                    <View style={styles.heatmapAverageHeader}><Ionicons name="trending-up-outline" size={14} color="#6E6887" /><Text style={styles.heatmapHeaderText}>Avg.</Text></View>
                  </View>
                  {selectedHeatmap.rows.map((week) => (
                    <View key={week.label} style={[styles.heatmapRow, selectedHeatmap.isDaily && styles.dailyHeatmapRow, week.isToday && styles.todayHeatmapRow, week.isToday && isDarkMode && styles.darkTodayHeatmapRow]}>
                      <Text style={[styles.heatmapWeekLabel, selectedHeatmap.isDaily && styles.heatmapDailyLabel]}>{week.label}</Text>
                      <View style={styles.heatmapCells}>
                        {week.values.map((level, index) => <View key={`${week.label}-${index}`} style={[styles.heatmapCell, selectedHeatmap.isDaily && styles.dailyHeatmapCell, { backgroundColor: ['#F0ECFF', '#DCD2FF', '#A998F2', '#5B42D8'][level - 1] }]} accessibilityLabel={`${week.label}, habit ${index + 1}, ${level} of 4 completion intensity`} />)}
                      </View>
                      <View style={[styles.heatmapAverageBadge, week.isToday && styles.todayAverageBadge]}><Text style={styles.heatmapAverage}>{week.average}</Text></View>
                    </View>
                  ))}

                  <View style={styles.heatmapFooter}>
                    <Text style={styles.heatmapGuide}>{selectedHeatmap.isDaily ? 'Live view based on your current habit status' : 'Each square represents one day'}</Text>
                    <View style={styles.heatmapLegend}><Text style={styles.legendText}>Less</Text>{['#F0ECFF', '#DCD2FF', '#A998F2', '#5B42D8'].map((color) => <View key={color} style={[styles.heatmapLegendCell, { backgroundColor: color }]} />)}<Text style={styles.legendText}>More</Text></View>
                    <View style={styles.heatmapNote}><Ionicons name="trending-up" size={14} color="#2E9D5C" /><Text style={styles.heatmapNoteText}>{completed ? `${completed} habit${completed === 1 ? '' : 's'} completed today` : 'Complete a habit to build your activity history'}</Text></View>
                  </View>
                </View>

                <View style={styles.quickPredictionsHeader}>
                  <View>
                    <Text style={[styles.quickPredictionsTitle, isDarkMode && styles.darkPrimaryText]}>Quick Predictions</Text>
                    <Text style={[styles.quickPredictionsSubtitle, isDarkMode && styles.darkMutedText]}>AI insights to help you stay on track.</Text>
                  </View>
                  <Pressable style={styles.viewAllTextWrap} onPress={() => setActiveTab('Predictions')} accessibilityRole="button">
                    <Text style={styles.viewAllText}>View All</Text>
                    <Ionicons name="chevron-forward" size={13} color="#5B42D8" />
                  </Pressable>
                </View>

                <View style={styles.quickCardsRow}>
                  {([
                    { title: 'Completed today', value: `${completed} habit${completed === 1 ? '' : 's'}`, detail: `${completionPercent}% of your tracked habits are complete today.`, tone: 'green', icon: 'trophy', tag: 'Live progress' },
                    { title: 'Success rate', value: `${successRate}%`, detail: `${averageProgress}% average progress across your current habits.`, tone: 'blue', icon: 'calendar', tag: 'Live progress' },
                    { title: 'Open habits', value: String(openHabits), detail: `${maxStreak}-day best streak. Keep the next action small.`, tone: 'orange', icon: 'flash', tag: 'Live progress' },
                  ] as const).map((card) => (
                    <View key={card.title} style={[styles.quickCard, toneStyles[card.tone]]}>
                      <View style={styles.quickCardTopRow}>
                        <View style={styles.quickIconWrap}><Ionicons name={card.icon as keyof typeof Ionicons.glyphMap} size={18} color={card.tone === 'green' ? '#2E9D5C' : card.tone === 'blue' ? '#4D57D4' : '#D9841A'} /></View>
                        <View style={styles.quickTag}><Text style={styles.quickTagText}>{card.tag}</Text></View>
                      </View>
                      <Text style={styles.quickCardTitle}>{card.title}</Text>
                      <Text style={styles.quickCardValue}>{card.value}</Text>
                      <Text style={styles.quickCardDetail}>{card.detail}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.finalInsightBanner, isDarkMode && styles.darkCard]}>
                  <View style={styles.bannerIcon}><Ionicons name="flag" size={20} color="#5B42D8" /></View>
                  <View style={styles.bannerCopy}>
                    <Text style={[styles.bannerTitle, isDarkMode && styles.darkPrimaryText]}>Small steps, big results!</Text>
                    <Text style={[styles.bannerSubtitle, isDarkMode && styles.darkMutedText]}>Stay consistent and make next week even better.</Text>
                  </View>
                </View>
              </View>
            )}

            <Pressable style={styles.assistantButton} onPress={askAssistant} accessibilityRole="button">
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
              <Text style={styles.assistantText}>Ask AI Assistant</Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal visible={assistantVisible} transparent animationType="slide" onRequestClose={() => setAssistantVisible(false)}>
        <View style={styles.assistantModalBackdrop}>
          <View style={[
            styles.assistantModalCard,
            isDarkMode && styles.darkCard,
            keyboardInset > 0 ? { marginBottom: Math.min(keyboardInset, 260) } : null,
          ]}>
            <View style={styles.assistantModalHeader}>
              <View style={styles.assistantModalIcon}><Ionicons name="sparkles" size={20} color="#5B42D8" /></View>
              <View style={styles.assistantModalHeaderCopy}><Text style={[styles.assistantModalTitle, isDarkMode && styles.darkPrimaryText]}>Ask AI Assistant</Text><Text style={[styles.assistantModalSubtitle, isDarkMode && styles.darkMutedText]}>Personal guidance from your habit data</Text></View>
              <Pressable onPress={() => setAssistantVisible(false)} accessibilityLabel="Close AI Assistant"><Ionicons name="close-circle" size={25} color={isDarkMode ? '#AAA4B7' : '#888291'} /></Pressable>
            </View>
            <View style={styles.assistantReply}><Text style={[styles.assistantReplyLabel, isDarkMode && styles.darkMutedText]}>{assistantResponseSource === 'gemini' ? 'Gemini response' : assistantResponseSource === 'local' ? 'Local guidance' : 'Your insight'}</Text><Text style={[styles.assistantReplyText, isDarkMode && styles.darkPrimaryText]}>{assistantResponse || assistantReply}</Text>{assistantError ? <Text style={styles.assistantError}>{assistantError}</Text> : null}</View>
            <TextInput
              ref={assistantInputRef}
              value={assistantQuestion}
              onChangeText={setAssistantQuestion}
              placeholder="Ask about your consistency..."
              placeholderTextColor={isDarkMode ? '#8C849B' : '#9A94A4'}
              style={[styles.assistantInput, isDarkMode && styles.darkAssistantInput]}
              multiline
              autoCapitalize="sentences"
              autoFocus
              selectionColor="#5B42D8"
              textAlignVertical="top"
              onFocus={() => setTimeout(() => assistantScrollRef.current?.scrollToEnd({ animated: true }), 100)}
            />
            <Pressable style={[styles.assistantSendButton, assistantLoading && styles.assistantSendButtonDisabled]} onPress={requestAssistantGuidance} disabled={assistantLoading} accessibilityRole="button"><Ionicons name="send" size={16} color="#FFFFFF" /><Text style={styles.assistantSendText}>{assistantLoading ? 'Thinking...' : 'Get guidance'}</Text></Pressable>
            <Text style={[styles.assistantFootnote, isDarkMode && styles.darkMutedText]}>Powered by your secure Gemini backend.</Text>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4F9' }, darkScreen: { backgroundColor: '#111018' },
  content: { flexGrow: 1, paddingBottom: 110 },
  container: { flex: 1, paddingHorizontal: 18, paddingTop: 8 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backButton: { width: 38, height: 38, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: '#FFFFFF' },
  darkIconButton: { backgroundColor: '#211D2C' },
  headerTitleWrap: { alignItems: 'center', flex: 1 },
  eyebrow: { fontSize: 9, letterSpacing: 1.2, color: '#8D8998', fontWeight: '800', marginBottom: 3 },
  headerTitle: { fontSize: 23, fontWeight: '800', color: '#24212D' },
  headerBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECE8FF' },
  darkBadge: { backgroundColor: '#2B263A' },
  segmentedControl: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 16, padding: 4, marginBottom: 18 },
  segment: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12 },
  segmentActive: { backgroundColor: '#5B42D8' },
  segmentText: { fontSize: 13, color: '#777283', fontWeight: '700' },
  segmentTextActive: { color: '#FFFFFF' },
  darkCard: { backgroundColor: '#1B1823' },
  darkHeroCard: { backgroundColor: '#30215A' },
  darkPrimaryText: { color: '#F7F4FF' },
  darkMutedText: { color: '#AAA4B7' },
  heroCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#5B42D8', borderRadius: 24, padding: 20, marginBottom: 14, overflow: 'hidden' },
  heroCopy: { flex: 1, paddingRight: 14 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#A9F0C7', marginRight: 7 },
  heroLabel: { fontSize: 10, color: '#D8D0FF', fontWeight: '800', letterSpacing: 1 },
  heroTitle: { fontSize: 21, lineHeight: 26, color: '#FFFFFF', fontWeight: '800', marginBottom: 6 },
  heroSubtitle: { fontSize: 12, lineHeight: 17, color: '#D8D0FF', fontWeight: '600' },
  heroScore: { width: 82, height: 82, borderRadius: 41, borderWidth: 1, borderColor: '#9584EC', backgroundColor: '#4B32C0', alignItems: 'center', justifyContent: 'center' },
  heroScoreValue: { fontSize: 21, color: '#FFFFFF', fontWeight: '800' },
  heroScoreLabel: { fontSize: 9, color: '#D8D0FF', fontWeight: '700', marginTop: 2 },
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
  insightCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 17, marginBottom: 12 },
  insightHeading: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  statusDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#42A85F', marginRight: 8 },
  insightTitle: { fontSize: 14, fontWeight: '800', color: '#302B3B' },
  insightHeadline: { fontSize: 15, fontWeight: '800', color: '#4A2CC9', marginBottom: 4 },
  insightBody: { fontSize: 12, lineHeight: 18, color: '#6F6A79', fontWeight: '600' },
  suggestionCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 17, marginBottom: 16 },
  suggestionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  predictionScreen: { gap: 20 },
  predictionHeroCard: { backgroundColor: '#F0EBFF', borderRadius: 28, padding: 20, marginBottom: 0, shadowColor: '#5B42D8', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 2 },
  forecastPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 5, marginLeft: 'auto' },
  forecastPillText: { fontSize: 9, color: '#5B42D8', fontWeight: '800' },
  predictionHeroLayout: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, marginTop: 12 },
  predictionHeroTextWrap: { flex: 1 },
  hightlightText: { color: '#5B42D8' },
  predictionTitle: { fontSize: 20, lineHeight: 25, fontWeight: '800', color: '#302B3B', textAlign: 'left', marginVertical: 0 },
  predictionSubtitle: { fontSize: 12, lineHeight: 18, color: '#6F6A79', fontWeight: '600', marginTop: 12 },
  predictionSummaryBox: { marginTop: 12, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  predictionSummaryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  predictionSummaryLabel: { fontSize: 10, color: '#D9D0FF', fontWeight: '700', letterSpacing: 0.5 },
  predictionSummaryValue: { fontSize: 12, color: '#FFFFFF', fontWeight: '800' },
  predictionProgressTrack: { height: 7, marginTop: 9, overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.28)' },
  predictionProgressFill: { height: '100%', borderRadius: 4, backgroundColor: '#FFFFFF' },
  predictionProgressLabel: { marginTop: 5, fontSize: 9, color: '#E7E0FF', fontWeight: '700' },
  predictionErrorText: { marginTop: 10, fontSize: 10, color: '#F8DCCD', fontWeight: '700' },
  chatBubbleWrap: { width: 140, alignItems: 'center' },
  chatBubble: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  chatBubbleText: { fontSize: 11, color: '#4F4780', fontWeight: '700', textAlign: 'center', lineHeight: 15 },
  robotBubble: { width: 110, height: 84, alignItems: 'center', justifyContent: 'center' },
  robotHead: { width: 98, height: 70, borderRadius: 32, backgroundColor: '#E8EBF8', borderWidth: 4, borderColor: '#F8F9FF', alignItems: 'center', justifyContent: 'center' },
  robotFace: { width: 72, height: 46, borderRadius: 22, backgroundColor: '#4A46A6', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 10 },
  robotEye: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFFFFF' },
  robotMouth: { position: 'absolute', width: 20, height: 10, borderBottomWidth: 3, borderBottomColor: '#FFFFFF', borderRadius: 10, bottom: 10 },
  predictionStatsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22, gap: 8 },
  predictionStatCard: { flex: 1, height: 104, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 10 },
  circleGauge: { width: 52, height: 52, borderRadius: 26, borderWidth: 5, borderColor: '#5B42D8', borderTopColor: '#DCD4FF', transform: [{ rotate: '45deg' }], alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  circleGaugeText: { fontSize: 12, fontWeight: '800', color: '#5B42D8', transform: [{ rotate: '-45deg' }] },
  trendPillLarge: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#EAF8F0', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  trophyBadgeLarge: { width: 32, height: 32, borderRadius: 12, backgroundColor: '#FFF4D9', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  predictionStatValue: { fontSize: 19, fontWeight: '800', color: '#2C2C46', marginBottom: 3 },
  predictionStatLabel: { fontSize: 10, color: '#6B6780', fontWeight: '700', textAlign: 'center' },
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
  heatmapWeekSpacer: { width: 48, fontSize: 9, color: '#8D8998', fontWeight: '700' },
  heatmapDailySpacer: { width: 112 },
  heatmapDayLabel: { flex: 1, textAlign: 'center', fontSize: 9, color: '#8D8998', fontWeight: '800' },
  heatmapAverageLabel: { width: 39, textAlign: 'right', fontSize: 9, color: '#8D8998', fontWeight: '800' },
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
  heatmapLevel1: { backgroundColor: '#F0ECFF' },
  heatmapLevel2: { backgroundColor: '#DCD2FF' },
  heatmapLevel3: { backgroundColor: '#A998F2' },
  heatmapLevel4: { backgroundColor: '#5B42D8' },
  heatmapFooter: { marginTop: 16, gap: 10 },
  heatmapGuide: { fontSize: 10, color: '#8D8998', fontWeight: '600' },
  heatmapLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  heatmapLegendCell: { width: 13, height: 13, borderRadius: 4 },
  legendText: { fontSize: 10, color: '#6E6887', fontWeight: '600' },
  heatmapNote: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EAF8F0', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  heatmapNoteText: { flex: 1, fontSize: 10, color: '#328651', fontWeight: '700' },
  quickPredictionsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  quickPredictionsTitle: { fontSize: 19, lineHeight: 23, fontWeight: '800', color: '#2D2A3D' },
  quickPredictionsSubtitle: { fontSize: 12, lineHeight: 17, color: '#7A728B', fontWeight: '600', marginTop: 5 },
  viewAllTextWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewAllText: { fontSize: 11, color: '#5B42D8', fontWeight: '700' },
  quickCardsRow: { gap: 10, marginTop: 15 },
  quickCard: { borderRadius: 18, padding: 15, minHeight: 146 },
  greenCard: { backgroundColor: '#EAF9F0' },
  blueCard: { backgroundColor: '#EEF0FF' },
  orangeCard: { backgroundColor: '#FFF5E9' },
  quickCardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  quickIconWrap: { width: 32, height: 32, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  quickCardTitle: { fontSize: 12, lineHeight: 16, color: '#413B5C', fontWeight: '700' },
  quickCardValue: { fontSize: 17, lineHeight: 21, fontWeight: '800', color: '#2D2A3D', marginTop: 5, marginBottom: 8 },
  quickCardDetail: { fontSize: 10.5, lineHeight: 16, color: '#5C5870', fontWeight: '600' },
  quickTag: { backgroundColor: 'rgba(255,255,255,0.7)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6 },
  quickTagText: { fontSize: 9, color: '#3F3B55', fontWeight: '800' },
  finalInsightBanner: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  bannerIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  bannerCopy: { flex: 1 },
  bannerTitle: { fontSize: 14, fontWeight: '800', color: '#2F2A3F' },
  bannerSubtitle: { fontSize: 10, color: '#736E84', marginTop: 4 },
  bannerButton: { backgroundColor: '#5B42D8', borderRadius: 12, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 8 },
  bannerButtonText: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  assistantButton: { height: 48, borderRadius: 13, backgroundColor: '#5B2BC7', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12 },
  assistantModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(25, 19, 42, 0.5)' },
  assistantModalScrollView: { flex: 1 },
  assistantModalScrollContent: { flexGrow: 1, justifyContent: 'flex-end', paddingTop: 16 },
  assistantModalCard: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 28 },
  assistantModalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  assistantModalIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center' },
  assistantModalHeaderCopy: { flex: 1 },
  assistantModalTitle: { fontSize: 18, fontWeight: '900', color: '#2D2A3D' },
  assistantModalSubtitle: { fontSize: 10, color: '#7A728B', fontWeight: '600', marginTop: 3 },
  assistantReply: { backgroundColor: '#F5F1FF', borderRadius: 15, borderWidth: 1, borderColor: '#E4DAFF', padding: 14, marginTop: 18 },
  assistantReplyLabel: { fontSize: 10, color: '#7A728B', fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.6 },
  assistantReplyText: { fontSize: 13, lineHeight: 19, color: '#393440', fontWeight: '700', marginTop: 6 },
  assistantError: { color: '#B34242', fontSize: 11, lineHeight: 15, marginTop: 8 },
  assistantInput: { minHeight: 48, maxHeight: 90, borderWidth: 1, borderColor: '#DDD6EC', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, color: '#302B3B', fontSize: 12, marginTop: 12, textAlignVertical: 'top', backgroundColor: '#F9F7FF' },
  darkAssistantInput: { borderColor: '#40374F', color: '#F2EFF8', backgroundColor: '#211D2B' },
  assistantSendButton: { height: 44, borderRadius: 12, backgroundColor: '#5B2BC7', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 10 },
  assistantSendButtonDisabled: { opacity: 0.65 },
  assistantSendText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  assistantFootnote: { color: '#8A8492', fontSize: 9, lineHeight: 14, textAlign: 'center', marginTop: 10 },
  assistantText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});

