import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Image, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ClassPulseCard } from '@/components/class-pulse-card';
import { BuddyCard } from '@/components/buddy';
import { DailyChallengeCard, LevelBar, MysteryBoxCard, NextBadgeCard, StreakRiskBanner, WeeklyQuestsCard, WeeklyRecapCard } from '@/components/engagement-cards';
import { TodayAgenda } from '@/components/today-agenda';
import { WeekStrip } from '@/components/week-strip';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { historyStats } from '@/utils/achievements';
import { greetingFor } from '@/utils/greeting';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const popularHabits = ['Drink Water', 'Exercise / Workout', 'Read a Book', 'Sleep Early', 'Meditate', 'Eat Healthy'];
const quickRepeatOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const quickPickerHours = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const quickPickerMinutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const quickPickerPeriods = ['AM', 'PM'] as const;

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function HomeScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { isDarkMode, avatarImage, habits, profile, addHabit: createHabit, toggleHabit, isFaculty, points, goals, tokenHistory, applyWallet } = useAppColorScheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  // Tablets and laptops: the hero image sits beside the title, and on laptops the progress
  // card and the stats share one row instead of leaving the sides of the page empty.
  const { isCentered: wide, isDesktop } = useResponsiveLayout();
  const compact = width < 370;
  const contentPadding = Math.max(16, Math.min(28, width * 0.07));
  const [now, setNow] = React.useState(() => new Date());
  const [quickAddVisible, setQuickAddVisible] = React.useState(false);
  const [quickHabitName, setQuickHabitName] = React.useState('');
  const [quickCategory, setQuickCategory] = React.useState('Health');
  const [quickFrequency, setQuickFrequency] = React.useState('Daily');
  const [quickStartDate, setQuickStartDate] = React.useState(() => formatDate(new Date()));
  React.useEffect(() => {
    // Keeps the greeting right when the app stays open across morning, afternoon and evening.
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(clock);
  }, []);
  const greeting = greetingFor(now);
  const [quickStartDatePickerVisible, setQuickStartDatePickerVisible] = React.useState(false);
  const [quickCustomFrequency, setQuickCustomFrequency] = React.useState('Every week');
  const [quickRepeatDays, setQuickRepeatDays] = React.useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [quickReminder, setQuickReminder] = React.useState(false);
  const [quickReminderTime, setQuickReminderTime] = React.useState('09:00 AM');
  const [quickTimeModalVisible, setQuickTimeModalVisible] = React.useState(false);
  const [quickTimeHour, setQuickTimeHour] = React.useState('09');
  const [quickTimeMinute, setQuickTimeMinute] = React.useState('00');
  const [quickTimePeriod, setQuickTimePeriod] = React.useState<'AM' | 'PM'>('AM');
  const { completionPercent } = getHabitProgressSummary(habits);
  const currentStreak = Math.max(0, ...habits.map((habit) => habit.streak));
  const history = React.useMemo(() => historyStats(habits), [habits]);
  const quickFrequencies = [
    { label: 'Daily', icon: 'sunny-outline' },
    { label: 'Weekly', icon: 'calendar-outline' },
    { label: 'Monthly', icon: 'calendar-number-outline' },
    { label: 'Custom', icon: 'options-outline' },
  ];

  const submitQuickHabit = () => {
    if (!quickHabitName.trim()) {
      showAlert('Habit name required', 'Give your new habit a name first.');
      return;
    }
    if (quickFrequency === 'Custom' && !quickRepeatDays.length) {
      showAlert('Choose repeat days', 'Select at least one day for a custom schedule.');
      return;
    }

    createHabit({
      startDate: quickStartDate,
      label: quickHabitName.trim(),
      meta: `${quickFrequency === 'Custom' ? quickCustomFrequency : quickFrequency} • ${quickReminder ? quickReminderTime : 'Anytime'}${quickFrequency === 'Custom' ? ` • ${quickRepeatDays.join(', ')}` : ''}`,
      category: quickCategory,
      frequency: quickFrequency,
      icon: quickCategory === 'Health' ? 'heart-outline' : quickCategory === 'Mind' ? 'bulb-outline' : quickCategory === 'Productivity' ? 'locate-outline' : 'leaf-outline',
      color: quickCategory === 'Health' ? '#E58D8D' : quickCategory === 'Mind' ? '#7A6AED' : quickCategory === 'Productivity' ? '#4BA3FF' : '#57B991',
      goal: 1,
      reminderEnabled: Platform.OS !== 'web' && quickReminder,
      reminderTime: quickReminderTime,
    });
    setQuickHabitName('');
    setQuickStartDate(formatDate(new Date()));
    setQuickAddVisible(false);
  };

  const openQuickTimePicker = () => {
    if (Platform.OS === 'web') {
      showAlert('Device reminders need the mobile app', 'Scheduled reminders are available in native iOS and Android builds.');
      return;
    }
    const [clock, period] = quickReminderTime.split(' ');
    const [hour, minute] = clock.split(':');
    setQuickTimeHour(hour);
    setQuickTimeMinute(minute);
    setQuickTimePeriod(period as 'AM' | 'PM');
    setQuickTimeModalVisible(true);
  };

  const saveQuickReminderTime = () => {
    setQuickReminderTime(`${quickTimeHour}:${quickTimeMinute} ${quickTimePeriod}`);
    setQuickReminder(true);
    setQuickTimeModalVisible(false);
  };

  return (
    <SafeAreaView edges={['left', 'right']} style={[styles.screen, isDarkMode && styles.darkScreen]}>
      {/* The page itself does not scroll on the web (overflow hidden), so Home scrolls here. */}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, wide && styles.wideContent, { paddingTop: insets.top + 16, paddingBottom: 104 + insets.bottom }]} showsVerticalScrollIndicator={false}>
          <View style={[styles.deviceFrame, wide && styles.wideFrame, isDarkMode && styles.darkDeviceFrame]}>
          <View style={[styles.backgroundBlobOne, isDarkMode && styles.darkBlob]} />
          <View style={[styles.backgroundBlobTwo, isDarkMode && styles.darkBlob]} />

          <View style={[styles.heroHeader, { paddingHorizontal: contentPadding }]}>
            <View style={styles.heroSection}>
              <Text style={[styles.greeting, isDarkMode && styles.darkGreeting]}>{profile.firstName || profile.fullName ? `${greeting}, ${profile.firstName || profile.fullName.split(' ')[0]}!` : `${greeting}!`}</Text>
              <Text style={[styles.titleText, compact && styles.compactTitle, isDarkMode && styles.darkTitleText]}>{'Small Habits,\nBig Progress.'}</Text>
              <Text style={[styles.subtitleText, isDarkMode && styles.darkSubtitleText]}>{'Every habit you build today\nshapes your better tomorrow.'}</Text>
              {isFaculty && (
                <View style={styles.facultyModePill} accessible accessibilityLabel="PSAU Faculty mode">
                  <Ionicons name="briefcase" size={12} color="#FFFFFF" />
                  <Text style={styles.facultyModeText}>PSAU Faculty mode</Text>
                </View>
              )}
              <LevelBar points={points} streak={currentStreak} style={styles.levelBar} />
            </View>

            {wide && (
              <View style={styles.wideCharacterWrap}>
                <Image source={require('../../assets/images/download.jpg')} style={styles.characterImage} resizeMode="cover" />
              </View>
            )}

            <View style={styles.heroRight}>
              <View style={styles.topControls}>
                <Pressable
                  style={styles.avatarWrap}
                  onPress={() => router.navigate('/(tabs)/profile')}
                  accessibilityLabel="Open profile"
                  accessibilityRole="button"
                >
                  {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>👩🏻</Text>}
                </Pressable>
                <Pressable
                  style={styles.alertBubble}
                  onPress={() => router.push('/notifications')}
                  hitSlop={8}
                >
                  <Ionicons name="notifications-outline" size={18} color={themeColor('#1d1d1d')} />
                </Pressable>
              </View>
              {/* Phones: the mascot sits beside the title, so Today shows without scrolling. */}
              {!wide && (
                <View style={styles.phoneCharacter}>
                  <View style={styles.phoneCharacterImage}>
                    <Image source={require('../../assets/images/download.jpg')} style={styles.characterImage} resizeMode="cover" />
                  </View>
                  <Text style={styles.phoneSparkle}>✦</Text>
                  <Text style={styles.phoneSparkleTwo}>✦</Text>
                </View>
              )}
            </View>
          </View>

          <View style={[isDesktop && styles.dashboardRow, isDesktop && { paddingHorizontal: contentPadding }]}>
          <View style={isDesktop && styles.dashboardMainColumn}>
            <StreakRiskBanner habits={habits} now={now} style={!isDesktop && styles.cardPhone} />
            <TodayAgenda habits={habits} now={now} onCheck={(habit) => toggleHabit(habit.id)} style={!isDesktop && styles.agendaPhone} />
            {habits.length > 0 && <BuddyCard habits={habits} style={!isDesktop && styles.cardPhone} />}
          </View>

          <View style={isDesktop && styles.dashboardSide}>
          <MysteryBoxCard habits={habits} tokenHistory={tokenHistory} onWallet={applyWallet} style={!isDesktop && styles.cardPhone} />
          <DailyChallengeCard habits={habits} now={now} style={!isDesktop && styles.cardPhone} />
          <WeeklyQuestsCard habits={habits} now={now} style={!isDesktop && styles.cardPhone} />
          <NextBadgeCard habits={habits} goals={goals} style={!isDesktop && styles.cardPhone} />
          <WeeklyRecapCard habits={habits} now={now} style={!isDesktop && styles.cardPhone} />
          <View style={[styles.statsRow, isDesktop && styles.dashboardStats]}>
            {[{ value: String(currentStreak), label: 'Day Streak' }, { value: String(history.totalCheckIns), label: 'Check-ins' }, { value: String(history.bestStreak), label: 'Best Streak' }].map((item) => (
              <View key={item.label} style={[styles.statCell, isDesktop && styles.dashboardStatCell]}>
                <Text style={styles.statValue}>{item.value}</Text>
                <Text style={styles.statLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          {habits.length > 0 && <WeekStrip habits={habits} style={!isDesktop && styles.weekStripPhone} />}
          {isFaculty && <ClassPulseCard style={!isDesktop && styles.weekStripPhone} />}

          <Pressable style={[styles.progressLink, isDesktop && styles.dashboardLink]} onPress={() => router.push('/progress')} accessibilityRole="button" accessibilityLabel="View habit progress">
            <Text style={styles.progressLinkText}>View Progress</Text>
            <Ionicons name="arrow-forward" size={16} color={themeColor('#4f2ac8')} />
          </Pressable>
          </View>
          </View>
        </View>
      </ScrollView>
      <Modal visible={quickAddVisible} transparent animationType="none" onRequestClose={() => setQuickAddVisible(false)}>
        <View style={styles.quickModalOverlay}>
          <View style={[styles.quickModalCard, isDarkMode && styles.quickModalDarkCard]}>
            <View style={styles.quickModalHandle} />
            <ScrollView
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.quickModalScrollContent}
            >
              <View style={styles.quickModalHeader}>
              <View>
                <Text style={styles.quickModalTitle}>Quick Add Habit</Text>
                <Text style={styles.quickModalSubtitle}>Level up by building better habits!</Text>
              </View>
              <Pressable onPress={() => setQuickAddVisible(false)} accessibilityLabel="Close quick add habit">
                <Ionicons name="close-circle" size={27} color={isDarkMode ? '#AAA4B7' : '#888291'} />
              </Pressable>
              </View>
            <View style={styles.quickXpRow}><View style={styles.quickXpBadge}><Ionicons name="star" size={17} color={themeColor('#FFD44D')} /></View><Text style={styles.quickXpText}>{completionPercent} / 100 XP</Text><View style={styles.quickXpTrack}><View style={[styles.quickXpFill, { width: `${completionPercent}%` }]} /></View></View>
            <View style={styles.quickSection}><Text style={styles.quickSectionNumber}>1.</Text><Text style={styles.quickSectionTitle}>Name your habit</Text><TextInput value={quickHabitName} onChangeText={setQuickHabitName} placeholder="e.g. Read 20 pages a day" placeholderTextColor={themeColor('#928DAA')} style={styles.quickNameInput} autoFocus /></View>
            <View style={styles.quickSection}><Text style={styles.quickSectionNumber}>2.</Text><Text style={styles.quickSectionTitle}>Choose a category</Text><View style={styles.quickCategoryGrid}>{['Health', 'Mind', 'Productivity', 'Lifestyle', 'Study', 'Finance', 'Creativity', 'Others'].map((category) => <Pressable key={category} style={[styles.quickCategoryChoice, quickCategory === category && styles.quickChoiceActive]} onPress={() => setQuickCategory(category)}><Ionicons name={category === 'Health' ? 'heart' : category === 'Mind' ? 'leaf' : category === 'Productivity' ? 'locate' : category === 'Lifestyle' ? 'water' : category === 'Study' ? 'school' : category === 'Finance' ? 'wallet' : category === 'Creativity' ? 'brush' : 'ellipsis-horizontal'} size={18} color={quickCategory === category ? themeColor('#FF7BD8') : themeColor('#B8B0D8')} /><Text style={[styles.quickChoiceText, quickCategory === category && styles.quickChoiceTextActive]}>{category}</Text></Pressable>)}</View></View>
            <View style={styles.quickSection}><View style={styles.quickSectionHeading}><Text style={styles.quickSectionNumber}>3.</Text><Text style={styles.quickSectionTitle}>Set reminder</Text><Pressable style={[styles.quickToggle, quickReminder && styles.quickToggleOn]} onPress={() => { if (Platform.OS === 'web') { showAlert('Device reminders need the mobile app', 'Scheduled reminders are available in native iOS and Android builds.'); return; } setQuickReminder(!quickReminder); }} accessibilityRole="switch" accessibilityState={{ checked: quickReminder, disabled: Platform.OS === 'web' }}><View style={[styles.quickToggleKnob, quickReminder && styles.quickToggleKnobOn]} /></Pressable></View><View style={styles.quickReminderRow}><Pressable style={styles.quickTimeButton} onPress={openQuickTimePicker}><Ionicons name="time-outline" size={17} color={themeColor('#D0C8E9')} /><Text style={styles.quickTimeText}>{quickReminderTime}</Text><Ionicons name="chevron-down" size={14} color={themeColor('#A8A0C5')} /></Pressable><Text style={styles.quickReminderHint}>{Platform.OS === 'web' ? 'Requires the mobile app' : quickReminder ? 'Reminder enabled' : 'Tap toggle to enable'}</Text></View></View>
            <View style={styles.quickSection}><Text style={styles.quickSectionNumber}>4.</Text><Text style={styles.quickSectionTitle}>Frequency</Text><View style={styles.quickFrequencySelect}><Ionicons name={quickFrequency === 'Daily' ? 'sunny-outline' : quickFrequency === 'Weekly' ? 'calendar-outline' : quickFrequency === 'Monthly' ? 'calendar-number-outline' : 'options-outline'} size={17} color={themeColor('#D0C8E9')} /><Text style={styles.quickFrequencySelectText}>{quickFrequency}</Text><Ionicons name="chevron-down" size={14} color={themeColor('#A8A0C5')} /></View><View style={styles.quickChoiceRow}>{quickFrequencies.map((frequency) => <Pressable key={frequency.label} style={[styles.quickFrequencyChoice, quickFrequency === frequency.label && styles.quickChoiceActive]} onPress={() => setQuickFrequency(frequency.label)}><Ionicons name={frequency.icon as keyof typeof Ionicons.glyphMap} size={19} color={quickFrequency === frequency.label ? themeColor('#FFFFFF') : themeColor('#B8B0D8')} /><Text style={[styles.quickChoiceText, quickFrequency === frequency.label && styles.quickChoiceTextActive]}>{frequency.label}</Text></Pressable>)}</View>{quickFrequency === 'Custom' && <View style={styles.quickCustomFrequencyCard}><Text style={styles.quickCustomFrequencyTitle}>Create your own schedule</Text><TextInput value={quickCustomFrequency} onChangeText={setQuickCustomFrequency} placeholder="e.g., Every 2 weeks" placeholderTextColor={themeColor('#928DAA')} style={styles.quickCustomFrequencyInput} /><Text style={styles.quickCustomFrequencyHint}>Choose the days to repeat.</Text><View style={styles.quickDaysRow}>{quickRepeatOptions.map((day) => <Pressable key={day} style={[styles.quickDayButton, quickRepeatDays.includes(day) && styles.quickDayButtonActive]} onPress={() => setQuickRepeatDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day])}><Text style={[styles.quickDayText, quickRepeatDays.includes(day) && styles.quickDayTextActive]}>{day}</Text></Pressable>)}</View></View>}</View>
            <View style={styles.quickSection}><Text style={styles.quickSectionNumber}>5.</Text><Text style={styles.quickSectionTitle}>Start date</Text><Pressable style={styles.quickDateButton} onPress={() => setQuickStartDatePickerVisible(true)}><Ionicons name="calendar-outline" size={17} color={themeColor('#D0C8E9')} /><Text style={styles.quickDateText}>{displayDate(quickStartDate)}</Text><Ionicons name="chevron-down" size={14} color={themeColor('#A8A0C5')} /></Pressable><Text style={styles.quickReminderHint}>Reminders and tracking begin on this date.</Text></View>
            {quickStartDatePickerVisible && <DateTimePicker value={new Date(`${quickStartDate}T00:00:00`)} mode="date" minimumDate={new Date()} onChange={(_event, date) => { setQuickStartDatePickerVisible(false); if (date) setQuickStartDate(formatDate(date)); }} />}
            <View style={styles.quickPopularSection}><View style={styles.quickPopularHeader}><Text style={styles.quickPreviewLabel}>6. Choose from Popular Habits</Text><Pressable onPress={() => { setQuickAddVisible(false); router.push('/all-habits'); }} accessibilityRole="button"><Text style={styles.quickViewAll}>View All</Text></Pressable></View><View style={styles.quickPopularGrid}>{popularHabits.map((habit) => <Pressable key={habit} style={styles.quickPopularItem} onPress={() => setQuickHabitName(habit)}><Text style={styles.quickPopularText}>{habit}</Text><Ionicons name="add-circle-outline" size={17} color={themeColor('#B8B0D8')} /></Pressable>)}</View></View>
              <Pressable style={styles.quickSaveButton} onPress={submitQuickHabit}><Ionicons name="star" size={19} color={themeColor('#FFD44D')} /><Text style={styles.quickSaveText}>Add Habit &amp; Start My Journey</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={quickTimeModalVisible} transparent animationType="fade" onRequestClose={() => setQuickTimeModalVisible(false)}>
        <View style={styles.quickTimeModalBackdrop}><View style={styles.quickTimeModalCard}><Text style={styles.quickTimeModalTitle}>Set Reminder Time</Text><Text style={styles.quickTimeModalSubtitle}>Scroll or tap to choose a time.</Text><View style={styles.quickTimeWheelRow}><View style={styles.quickTimeWheelColumn}><Text style={styles.quickTimeWheelLabel}>Hour</Text><ScrollView style={styles.quickTimeWheel} contentContainerStyle={styles.quickTimeWheelContent} contentOffset={{ x: 0, y: quickPickerHours.indexOf(quickTimeHour) * 42 }} showsVerticalScrollIndicator={false} snapToInterval={42} decelerationRate="fast">{quickPickerHours.map((hour) => <Pressable key={hour} style={[styles.quickTimeWheelOption, quickTimeHour === hour && styles.quickTimeWheelOptionActive]} onPress={() => setQuickTimeHour(hour)}><Text style={[styles.quickTimeWheelText, quickTimeHour === hour && styles.quickTimeWheelTextActive]}>{hour}</Text></Pressable>)}</ScrollView></View><Text style={styles.quickTimeWheelColon}>:</Text><View style={styles.quickTimeWheelColumn}><Text style={styles.quickTimeWheelLabel}>Minute</Text><ScrollView style={styles.quickTimeWheel} contentContainerStyle={styles.quickTimeWheelContent} contentOffset={{ x: 0, y: quickPickerMinutes.indexOf(quickTimeMinute) * 42 }} showsVerticalScrollIndicator={false} snapToInterval={42} decelerationRate="fast">{quickPickerMinutes.map((minute) => <Pressable key={minute} style={[styles.quickTimeWheelOption, quickTimeMinute === minute && styles.quickTimeWheelOptionActive]} onPress={() => setQuickTimeMinute(minute)}><Text style={[styles.quickTimeWheelText, quickTimeMinute === minute && styles.quickTimeWheelTextActive]}>{minute}</Text></Pressable>)}</ScrollView></View><View style={styles.quickTimeWheelColumn}><Text style={styles.quickTimeWheelLabel}>Period</Text><View style={styles.quickPeriodWheel}>{quickPickerPeriods.map((period) => <Pressable key={period} style={[styles.quickTimeWheelOption, quickTimePeriod === period && styles.quickTimeWheelOptionActive]} onPress={() => setQuickTimePeriod(period)}><Text style={[styles.quickTimeWheelText, quickTimePeriod === period && styles.quickTimeWheelTextActive]}>{period}</Text></Pressable>)}</View></View></View><View style={styles.quickTimeModalActions}><Pressable onPress={() => setQuickTimeModalVisible(false)}><Text style={styles.quickTimeCancelText}>Cancel</Text></Pressable><Pressable style={styles.quickTimeSaveButton} onPress={saveQuickReminderTime}><Text style={styles.quickTimeSaveText}>Save Time</Text></Pressable></View></View></View>
      </Modal>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: {
    flex: 1,
    // Same as the page behind centered screens, so no seam shows beside the content column.
    backgroundColor: '#f5f4f9',
  },
  scroll: { flex: 1 },
  wideContent: { justifyContent: 'flex-start' },
  darkScreen: { backgroundColor: '#111018' },
  darkDeviceFrame: { backgroundColor: '#111018' },
  // The hero was light-only: dark text over pale blobs was unreadable in dark mode.
  darkBlob: { backgroundColor: '#3B3266', opacity: 0.55 },
  darkGreeting: { color: '#CFC8DE' },
  darkTitleText: { color: '#F4F0FA' },
  darkSubtitleText: { color: '#A9A2B8' },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
    paddingVertical: 0,
    paddingTop: 0,
    paddingBottom: 118,
  },
  deviceFrame: {
    position: 'relative',
    width: '100%',
    backgroundColor: '#f5f4f9',
    overflow: 'hidden',
  },
  backgroundBlobOne: {
    position: 'absolute',
    top: -50,
    left: -40,
    width: 260,
    height: 260,
    borderRadius: 140,
    backgroundColor: '#c9c6ee',
    opacity: 0.5,
  },
  backgroundBlobTwo: {
    position: 'absolute',
    bottom: -60,
    right: -30,
    width: 280,
    height: 280,
    borderRadius: 160,
    backgroundColor: '#d7d0f4',
    opacity: 0.55,
  },
  heroHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 28,
    gap: 12,
  },
  topControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#f1d7d4',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: '#ffffff',
  },
  avatarEmoji: {
    fontSize: 22,
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 21,
  },
  alertBubble: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  heroSection: {
    flex: 1,
    paddingRight: 6,
    zIndex: 2,
  },
  // Faculty mode is on: shown under the greeting so it is easy to spot.
  facultyModePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#5b42d8' },
  facultyModeText: { fontSize: 11, fontWeight: '800', color: '#ffffff' },
  greeting: {
    fontSize: 15,
    color: '#3b3b40',
    fontWeight: '600',
    marginBottom: 4,
  },
  titleText: {
    marginTop: 0,
    fontSize: 34,
    lineHeight: 40,
    fontWeight: '800',
    color: '#1b1a1f',
    letterSpacing: -1.2,
  },
  compactTitle: {
    fontSize: 30,
    lineHeight: 35,
  },
  subtitleText: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    color: '#5e6371',
    fontWeight: '500',
  },
  characterImage: {
    width: '100%',
    height: '100%',
    borderRadius: 75,
  },
  // Phones: the mascot beside the title, under the profile and bell buttons.
  heroRight: { alignItems: 'flex-end', gap: 12 },
  phoneCharacter: { width: 104, height: 104 },
  phoneCharacterImage: {
    width: 104,
    height: 104,
    borderRadius: 52,
    overflow: 'hidden',
    backgroundColor: '#f3e7dd',
    borderWidth: 4,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  phoneSparkle: { position: 'absolute', left: -22, top: 4, fontSize: 16, color: '#f7b26f' },
  phoneSparkleTwo: { position: 'absolute', left: -12, top: 34, fontSize: 12, color: '#ffcf8f' },
  focusCard: {
    marginHorizontal: 18,
    marginTop: 18,
    backgroundColor: '#ffffff',
    borderRadius: 26,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 14,
    shadowColor: '#201444',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  focusHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  focusLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#2f2d3c',
  },
  progressRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f7f3ff',
  },
  progressRingTrack: {
    position: 'absolute',
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 5,
    borderColor: '#eaddff',
  },
  progressSegment: {
    position: 'absolute',
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#eaddff',
  },
  progressSegmentActive: {
    backgroundColor: '#5b42d8',
  },
  progressText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#2d2a38',
  },
  habitList: {
    marginTop: 12,
    gap: 8,
  },
  habitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#f7f4ff',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  habitMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  habitIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#ede7ff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  habitLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#2b2b35',
  },
  emptyHabitText: {
    fontSize: 13,
    color: '#777282',
    fontWeight: '600',
    textAlign: 'center',
    paddingVertical: 18,
  },
  // An empty ring that fills on hover or press: the row checks the habit off for today.
  checkWrap: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#5b42d8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkWrapActive: { backgroundColor: '#5b42d8' },
  undoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: '#ecf8f1' },
  undoText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#2c6b4c' },
  undoAction: { fontSize: 13, fontWeight: '800', color: '#4f2ac8' },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#fff7e8' },
  allDoneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  allDoneCopy: { flex: 1 },
  allDoneTitle: { fontSize: 15, fontWeight: '800', color: '#2f2d3c' },
  allDoneText: { marginTop: 2, fontSize: 12, lineHeight: 17, color: '#6a6f7d', fontWeight: '600' },
  weekStripPhone: { marginHorizontal: 18, marginTop: 14 },
  habitRowActive: { backgroundColor: '#efe9ff' },
  focusHint: { marginTop: 2, fontSize: 12, color: '#777282', fontWeight: '600' },
  // Tablets and laptops: a rounded canvas, so the background shapes end in a curve, not a hard cut.
  wideFrame: { borderRadius: 32, borderWidth: 1, borderColor: '#ebe7f6', paddingTop: 28, paddingBottom: 28 },
  wideCharacterWrap: {
    width: 150,
    height: 150,
    borderRadius: 75,
    overflow: 'hidden',
    borderWidth: 4,
    borderColor: '#ffffff',
    backgroundColor: '#f3e7dd',
    alignSelf: 'center',
    zIndex: 2,
  },
  dashboardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 16, marginTop: 22 },
  dashboardMainColumn: { flex: 3, gap: 12 },
  agendaPhone: { marginHorizontal: 18, marginTop: 18 },
  cardPhone: { marginHorizontal: 18, marginTop: 14 },
  levelBar: { marginTop: 14, maxWidth: 360 },
  dashboardSide: { flex: 2, gap: 12 },
  dashboardStats: { marginHorizontal: 0, marginTop: 0, flexDirection: 'column', paddingVertical: 6, paddingHorizontal: 16 },
  dashboardStatCell: { flexDirection: 'row-reverse', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, width: '100%' },
  dashboardLink: { marginHorizontal: 0, marginTop: 0, backgroundColor: '#ffffff', borderRadius: 18, paddingVertical: 14 },
  addButton: {
    marginTop: 12,
    backgroundColor: '#5d42d8',
    borderRadius: 16,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
  },
  quickModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(20, 16, 35, 0.48)',
    justifyContent: 'flex-end',
    paddingTop: 20,
  },
  quickModalCard: {
    backgroundColor: '#0C102C',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 14,
    maxHeight: '94%',
    shadowColor: '#201444',
    shadowOpacity: 0.2,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: -5 },
    elevation: 12,
  },
  quickModalScrollContent: { paddingBottom: 4 },
  quickModalDarkCard: { backgroundColor: '#0C102C' },
  quickModalHandle: {
    alignSelf: 'center',
    width: 48,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#C9C4D2',
    marginBottom: 10,
  },
  quickModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  quickModalTitle: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  quickModalSubtitle: { fontSize: 12, color: '#AAA8C1', marginTop: 4 },
  quickXpRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  quickXpBadge: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#4327A0', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  quickXpText: { color: '#D5CEEA', fontSize: 10, fontWeight: '700', marginRight: 8 },
  quickXpTrack: { flex: 1, height: 6, borderRadius: 3, backgroundColor: '#29254F' },
  quickXpFill: { width: '0%', height: '100%', borderRadius: 3, backgroundColor: '#A96DFF' },
  quickSection: { backgroundColor: '#12183A', borderWidth: 1, borderColor: '#29315B', borderRadius: 15, padding: 10, marginBottom: 6 },
  quickSectionHeading: { flexDirection: 'row', alignItems: 'center' },
  quickSectionNumber: { fontSize: 12, color: '#FFFFFF', fontWeight: '800', marginRight: 5 },
  quickSectionTitle: { fontSize: 13, color: '#FFFFFF', fontWeight: '800', marginBottom: 10 },
  quickCategoryGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 7 },
  quickCategoryChoice: { width: '23%', minHeight: 56, borderRadius: 10, backgroundColor: '#1B2247', alignItems: 'center', justifyContent: 'center', gap: 4, borderWidth: 1, borderColor: '#29315B' },
  quickFieldLabel: { fontSize: 12, fontWeight: '800', color: '#FFFFFF', marginBottom: 8, marginTop: 5 },
  quickNameInput: { height: 42, borderWidth: 1, borderColor: '#303967', borderRadius: 10, paddingHorizontal: 13, fontSize: 12, color: '#FFFFFF', backgroundColor: '#1B2247', marginBottom: 0 },
  quickDarkInput: { backgroundColor: '#24202F', borderColor: '#3A3548', color: '#F2EFF8' },
  quickChoiceRow: { flexDirection: 'row', gap: 7, marginBottom: 7 },
  quickChoice: { flex: 1, minHeight: 38, borderWidth: 1, borderColor: '#303967', borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  quickChoiceActive: { backgroundColor: '#5B42D8', borderColor: '#D65DCB' },
  quickChoiceText: { fontSize: 10, color: '#B8B0D8', fontWeight: '700' },
  quickChoiceTextActive: { color: '#FFFFFF' },
  quickFrequencySelect: { height: 40, flexDirection: 'row', alignItems: 'center', backgroundColor: '#1B2247', borderWidth: 1, borderColor: '#303967', borderRadius: 9, paddingHorizontal: 10, gap: 8, marginBottom: 10 },
  quickFrequencySelectText: { flex: 1, fontSize: 11, color: '#FFFFFF', fontWeight: '700' },
  quickReminderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  quickTimeButton: { flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#1B2247', borderWidth: 1, borderColor: '#303967', borderRadius: 9, paddingHorizontal: 10 },
  quickTimeText: { flex: 1, fontSize: 11, color: '#FFFFFF', fontWeight: '700' },
  quickDateButton: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: '#1B2247', borderWidth: 1, borderColor: '#303967', borderRadius: 9, paddingHorizontal: 10, marginBottom: 7 },
  quickDateText: { flex: 1, fontSize: 11, color: '#FFFFFF', fontWeight: '700' },
  quickReminderHint: { flex: 1, fontSize: 10, color: '#AAA8C1' },
  quickToggle: { width: 42, height: 24, borderRadius: 12, backgroundColor: '#30344B', padding: 3, justifyContent: 'center', marginLeft: 'auto', marginBottom: 9 },
  quickToggleOn: { backgroundColor: '#5B42D8' },
  quickToggleKnob: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#FFFFFF' },
  quickToggleKnobOn: { alignSelf: 'flex-end' },
  quickFrequencyChoice: { flex: 1, minHeight: 67, borderWidth: 1, borderColor: '#29315B', borderRadius: 10, backgroundColor: '#1B2247', alignItems: 'center', justifyContent: 'center', gap: 5, paddingHorizontal: 3 },
  quickCustomFrequencyCard: { backgroundColor: '#161D42', borderRadius: 11, borderWidth: 1, borderColor: '#303967', padding: 10, marginTop: 3 },
  quickCustomFrequencyTitle: { fontSize: 11, color: '#FFFFFF', fontWeight: '800' },
  quickCustomFrequencyInput: { height: 38, backgroundColor: '#1B2247', borderWidth: 1, borderColor: '#303967', borderRadius: 9, paddingHorizontal: 10, color: '#FFFFFF', fontSize: 11, marginTop: 8 },
  quickCustomFrequencyHint: { fontSize: 10, color: '#AAA8C1', marginTop: 7 },
  quickDaysRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 9 },
  quickDayButton: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: '#454B73', alignItems: 'center', justifyContent: 'center' },
  quickDayButtonActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  quickDayText: { fontSize: 8, color: '#AAA8C1', fontWeight: '700' },
  quickDayTextActive: { color: '#FFFFFF' },
  quickPreview: { marginBottom: 4 },
  quickPreviewLabel: { fontSize: 12, color: '#FFFFFF', fontWeight: '800', marginBottom: 7 },
  quickPreviewCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#161D42', borderRadius: 11, padding: 10 },
  quickPreviewIcon: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#D83F91', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  quickPreviewTitle: { fontSize: 12, color: '#FFFFFF', fontWeight: '800' },
  quickPreviewMeta: { fontSize: 9, color: '#AAA8C1', marginTop: 4 },
  quickPopularSection: { backgroundColor: '#12183A', borderWidth: 1, borderColor: '#29315B', borderRadius: 15, padding: 10, marginBottom: 6 },
  quickPopularHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  quickViewAll: { color: '#C084FF', fontSize: 11, fontWeight: '800' },
  quickPopularGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 7 },
  quickPopularItem: { flexBasis: '48%', flexGrow: 1, minWidth: 120, minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#1B2247', borderRadius: 9, paddingHorizontal: 9, borderWidth: 1, borderColor: '#29315B' },
  quickPopularText: { flex: 1, color: '#E6E1F5', fontSize: 10, fontWeight: '700', marginRight: 5 },
  quickSaveButton: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#7B2FE5', borderRadius: 12, marginTop: 8 },
  quickSaveText: { fontSize: 14, color: '#FFFFFF', fontWeight: '800' },
  quickTimeModalBackdrop: { flex: 1, backgroundColor: 'rgba(8, 10, 30, 0.72)', alignItems: 'center', justifyContent: 'center', padding: 22 },
  quickTimeModalCard: { width: '100%', backgroundColor: '#12183A', borderRadius: 20, padding: 18, borderWidth: 1, borderColor: '#303967' },
  quickTimeModalTitle: { fontSize: 18, color: '#FFFFFF', fontWeight: '900' },
  quickTimeModalSubtitle: { fontSize: 11, color: '#AAA8C1', marginTop: 4 },
  quickTimeWheelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, gap: 4 },
  quickTimeWheelColumn: { flex: 1, alignItems: 'center' },
  quickTimeWheelLabel: { fontSize: 9, color: '#AAA8C1', fontWeight: '800', marginBottom: 6 },
  quickTimeWheel: { height: 126, width: '100%', backgroundColor: '#1B2247', borderRadius: 11 },
  quickTimeWheelContent: { paddingVertical: 42 },
  quickTimeWheelOption: { height: 42, minWidth: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 8, paddingHorizontal: 7 },
  quickTimeWheelOptionActive: { backgroundColor: '#5B42D8' },
  quickTimeWheelText: { fontSize: 16, color: '#AAA8C1', fontWeight: '700' },
  quickTimeWheelTextActive: { color: '#FFFFFF', fontWeight: '900' },
  quickTimeWheelColon: { color: '#D0C8E9', fontSize: 21, fontWeight: '900', marginTop: 18 },
  quickPeriodWheel: { height: 126, width: '100%', justifyContent: 'center', backgroundColor: '#1B2247', borderRadius: 11 },
  quickTimeModalActions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 18, marginTop: 18 },
  quickTimeCancelText: { color: '#C8C1DE', fontSize: 12, fontWeight: '800' },
  quickTimeSaveButton: { backgroundColor: '#7B2FE5', borderRadius: 10, paddingHorizontal: 15, paddingVertical: 10 },
  quickTimeSaveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  darkModalText: { color: '#F2EFF8' },
  darkModalMutedText: { color: '#AAA4B7' },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 18,
    marginTop: 16,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 12,
    shadowColor: '#201444',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#21222b',
  },
  statLabel: {
    marginTop: 2,
    fontSize: 11,
    color: '#6a6f7d',
    fontWeight: '600',
    textAlign: 'center',
  },
  progressLink: {
    marginTop: 14,
    marginHorizontal: 18,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 6,
  },
  progressLinkText: {
    color: '#4a2cc9',
    fontSize: 15,
    fontWeight: '700',
  },
});
