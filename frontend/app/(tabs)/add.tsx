import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitCategories, type HabitCategory } from '@/authentication';
import { ReminderTimesEditor } from '@/components/reminder-time-sheet';
import { useAppDialog } from '@/components/ui/app-dialog';
import { FACULTY_HABIT_IDEAS } from '@/constants/faculty';
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import { requestNotificationAccess, useAppColorScheme } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { themeSheet, themedColor, withReadableText } from '@/hooks/use-themed-styles';
import { detectBadHabit } from '@/utils/habit-detection';
import { classifyHabit } from '@/utils/ai-client';

const frequencies = ['Daily', 'Weekly', 'Monthly', 'Custom'];
const popularHabits = ['Drink Water', 'Exercise / Workout', 'Read a Book', 'Sleep Early', 'Meditate', 'Eat Healthy'];
const allPopularHabits = [
  ...popularHabits,
  'Journal', 'Practice Gratitude', 'Walk 10,000 Steps', 'Save Money',
  'Learn a Language', 'Take Vitamins', 'Plan Tomorrow', 'Limit Screen Time',
];
const repeatOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const customFrequencyPresets = ['Weekdays only', 'Twice a week'];

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function displayDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AddScreen() {
  const showAlert = useAppDialog();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const compactDayButton = compactLayout ? 30 : 34;
  const { isDarkMode, addHabit: createHabit, ringInterval, snoozeFrequency, isFaculty } = useAppColorScheme();
  // Faculty mode suggests habits for a teacher's day instead of a student's.
  const habitIdeas = isFaculty ? FACULTY_HABIT_IDEAS.slice(0, popularHabits.length) : popularHabits;
  const allHabitIdeas = isFaculty ? FACULTY_HABIT_IDEAS : allPopularHabits;
  const { habit: selectedHabit } = useLocalSearchParams<{ habit?: string }>();
  const appTheme = useAppTheme();
  const styles = themeSheet(baseStyles, appTheme);
  const dark: Partial<typeof darkStyles> = isDarkMode ? themeSheet(darkStyles, appTheme) : {};
  const accent = themedColor(isDarkMode ? '#B9A9FF' : '#5B42D8', appTheme);
  const iconInk = isDarkMode ? '#E6E1F0' : '#403A4A';
  const [name, setName] = useState(selectedHabit ?? '');
  const [categories, setCategories] = useState<HabitCategory[]>(DEFAULT_HABIT_CATEGORIES);
  const [category, setCategory] = useState('Health');
  const [frequency, setFrequency] = useState('Daily');
  const [startDate, setStartDate] = useState(() => formatDate(new Date()));
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [customFrequency, setCustomFrequency] = useState('Weekdays only');
  const [goal, setGoal] = useState('');
  const [reminder, setReminder] = useState(Platform.OS !== 'web');
  const [reminderPermissionPending, setReminderPermissionPending] = useState(false);
  const [reminderTimes, setReminderTimes] = useState(['07:00 AM']);
  const [repeatDays, setRepeatDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [reminderSoundEnabled, setReminderSoundEnabled] = useState(true);
  const [smartReminder, setSmartReminder] = useState(false);
  const [popularVisible, setPopularVisible] = useState(false);
  const [smartInfoVisible, setSmartInfoVisible] = useState(false);
  const [habitAddedVisible, setHabitAddedVisible] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addedHabitSummary, setAddedHabitSummary] = useState({ name: '', schedule: '', reminder: '' });
  const [messageVisible, setMessageVisible] = useState(false);
  const [messageContent, setMessageContent] = useState({ title: '', body: '' });
  const [cancelVisible, setCancelVisible] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  useEffect(() => {
    let active = true;
    void getHabitCategories().then((managed) => {
      if (!active || !managed?.length) return;
      setCategories(managed);
      setCategory((current) => (managed.some((item) => item.label === current) ? current : managed[0].label));
    });
    return () => {
      active = false;
    };
  }, []);

  const showMessage = (title: string, body: string) => {
    setMessageContent({ title, body });
    setMessageVisible(true);
  };

  const toggleRepeatDay = (day: string) => {
    setRepeatDays((days) => days.includes(day) ? days.filter((item) => item !== day) : [...days, day]);
    if (frequency === 'Custom') setCustomFrequency('Selected days');
  };

  const selectCustomFrequency = (preset: string) => {
    setCustomFrequency(preset);
    setRepeatDays(preset === 'Weekdays only' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] : ['Tue', 'Fri']);
  };

  const toggleReminder = async () => {
    if (reminderPermissionPending) return;
    const nextReminder = !reminder;
    if (nextReminder && Platform.OS === 'web') {
      setReminderPermissionPending(true);
      let hasAccess = false;
      try {
        hasAccess = await requestNotificationAccess();
      } catch {
        hasAccess = false;
      } finally {
        setReminderPermissionPending(false);
      }
      if (!hasAccess) {
        showAlert('Browser notifications unavailable', 'Use HTTPS and allow notifications. On iPhone, add HabitAI to your Home Screen first.');
        return;
      }
    }
    setReminder(nextReminder);
  };

  // The AI checks the text is a real habit, flags ones that harm daily life or productivity, and
  // whether the chosen category fits; the on-device keyword check is the fallback when the AI is
  // offline or unavailable.
  const classifyHabitRisk = async (habitName: string): Promise<{ isHabit: boolean; isBadHabit: boolean; categoryFits: boolean; suggestedCategory: string; reason: string }> => {
    const ai = await classifyHabit(habitName, { category, categories: categories.map((item) => item.label) });
    if (ai.ok) return { isHabit: ai.isHabit, isBadHabit: ai.isBadHabit, categoryFits: ai.categoryFits, suggestedCategory: ai.suggestedCategory, reason: ai.reason };
    // Offline fallback: the keyword check only knows good vs bad, so let the habit through.
    const detected = detectBadHabit(habitName);
    return { isHabit: true, isBadHabit: detected.isBadHabit, categoryFits: true, suggestedCategory: category, reason: detected.reason };
  };

  const addHabit = async () => {
    if (adding) return;
    if (!name.trim()) { showMessage('Habit name required', 'Give your new habit a name first.'); return; }
    if ((frequency === 'Custom' || frequency === 'Weekly') && !repeatDays.length) { showMessage('Choose repeat days', 'Select at least one day for this schedule.'); return; }
    setAdding(true);
    let detected: { isHabit: boolean; isBadHabit: boolean; categoryFits: boolean; suggestedCategory: string; reason: string };
    try {
      detected = await classifyHabitRisk(name);
    } finally {
      setAdding(false);
    }
    // Random text or something that is not an activity: ask for a real habit instead of adding it.
    if (!detected.isHabit) {
      showMessage('That doesn’t look like a habit', detected.reason || 'Try a real habit like “Drink water”, “Read 20 minutes” or “Sleep early”.');
      return;
    }
    // A good habit filed under a category that does not relate to it cannot be created as is.
    if (!detected.isBadHabit && !detected.categoryFits) {
      const suggestion = categories.find((item) => item.label === detected.suggestedCategory);
      if (suggestion && suggestion.label !== category) setCategory(suggestion.label);
      showMessage('Category doesn’t match', suggestion && suggestion.label !== category
        ? `“${name.trim()}” fits ${suggestion.label} better than ${category}. We switched it — tap Add habit again.`
        : `“${name.trim()}” does not fit the ${category} category. Choose a category that matches it.`);
      return;
    }
    const resolvedCategory = detected.isBadHabit ? 'Bad Habit' : category;
    const selectedCategory = categories.find((item) => item.label === resolvedCategory) ?? categories[0];
    if (detected.isBadHabit) {
      showMessage('Bad habit detected', detected.reason || 'This habit can harm your daily routine or productivity.');
    }
    createHabit({
      startDate,
      label: name.trim(),
      meta: `${frequency === 'Custom' ? customFrequency : frequency} • ${reminder ? reminderTimes.join(', ') : 'Anytime'}${frequency === 'Custom' ? ` • ${repeatDays.join(', ')}` : ''}`,
      category: resolvedCategory,
      frequency,
      icon: (selectedCategory?.icon || 'ellipse-outline') as keyof typeof Ionicons.glyphMap,
      color: selectedCategory?.color || '#57B991',
      goal: Number.parseInt(goal, 10) || 1,
      reminderEnabled: reminder && reminderTimes.length > 0,
      reminderTime: reminderTimes[0] || '07:00 AM',
      reminderTimes: reminderTimes,
      reminderDays: frequency === 'Custom' || frequency === 'Weekly' ? repeatDays : [],
      reminderSoundEnabled,
      smartReminderEnabled: smartReminder,
      isBadHabit: detected.isBadHabit,
      badHabitReason: detected.reason,
    });
    setAddedHabitSummary({
      name: name.trim(),
      schedule: frequency === 'Custom' ? `${customFrequency} • ${repeatDays.join(', ')}` : frequency,
      reminder: reminder ? `${reminderTimes.length} reminder${reminderTimes.length === 1 ? '' : 's'}` : 'Reminders off',
    });
    resetForm();
    setHabitAddedVisible(true);
  };

  const toggleSmartReminder = async () => {
    if (smartReminder) {
      setSmartReminder(false);
      setSmartInfoVisible(false);
      return;
    }
    if (Platform.OS === 'web') {
      if (reminderPermissionPending) return;
      setReminderPermissionPending(true);
      let hasAccess = false;
      try {
        hasAccess = await requestNotificationAccess();
      } catch {
        hasAccess = false;
      } finally {
        setReminderPermissionPending(false);
      }
      if (!hasAccess) {
        showAlert('Browser notifications unavailable', 'Use HTTPS and allow notifications. On iPhone, add HabitAI to your Home Screen first.');
        return;
      }
    }
    setSmartReminder(true);
    setSmartInfoVisible(true);
  };

  const resetForm = () => {
    setName('');
    setCategory(categories[0]?.label ?? 'Health');
    setFrequency('Daily');
    setStartDate(formatDate(new Date()));
    setCustomFrequency('Weekdays only');
    setGoal('');
    setReminder(Platform.OS !== 'web');
    setReminderTimes(['07:00 AM']);
    setRepeatDays(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
    setReminderSoundEnabled(true);
    setSmartReminder(false);
  };

  const cancelHabitForm = () => {
    resetForm();
    setCancelVisible(false);
    router.replace('/(tabs)/habits');
  };


  const selectedCategory = categories.find((item) => item.label === category);
  const categoryColor = selectedCategory?.color || '#5B42D8';
  const categoryIcon = (selectedCategory?.icon || 'ellipse-outline') as keyof typeof Ionicons.glyphMap;
  const goalCount = Math.max(1, Number.parseInt(goal, 10) || 1);
  const goalUnit = frequency === 'Weekly' ? 'a week' : frequency === 'Monthly' ? 'a month' : 'a day';
  const scheduleText = frequency === 'Custom' ? `${customFrequency} · ${repeatDays.join(', ') || 'no days'}` : frequency;
  const changeGoal = (step: number) => setGoal(String(Math.min(50, Math.max(1, goalCount + step))));
  const close = () => {
    if (name.trim() || goal.trim()) {
      showAlert('Discard habit?', 'Your current entries will be cleared.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }]);
    } else router.back();
  };
  const section = (number: number, title: string, hint: string) => (
    <View style={styles.sectionHead}>
      <View style={[styles.sectionNumber, dark.sectionNumber]}><Text style={[styles.sectionNumberText, dark.sectionNumberText]}>{number}</Text></View>
      <View style={styles.sectionCopy}>
        <Text style={[styles.sectionTitle, dark.sectionTitle]}>{title}</Text>
        <Text style={[styles.sectionHint, dark.sectionHint]}>{hint}</Text>
      </View>
    </View>
  );

  return <SafeAreaView style={[styles.screen, dark.screen]}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 18 }]}>
    <View style={styles.headerRow}>
      <View style={styles.headerCopy}>
        <Text style={[styles.title, dark.title]}>New habit</Text>
        <Text style={[styles.subtitle, dark.subtitle]}>Small, specific and repeatable works best.</Text>
      </View>
      <Pressable style={[styles.closeButton, dark.closeButton]} onPress={close} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={iconInk} /></Pressable>
    </View>

    {/* Live preview: how the habit will look in the list. */}
    <View style={[styles.preview, dark.preview]} accessible accessibilityLabel={`Preview: ${name.trim() || 'Your new habit'}, ${scheduleText}, ${goalCount} times ${goalUnit}, ${reminder ? `${reminderTimes.length} reminders` : 'no reminder'}`}>
      <View style={[styles.previewIcon, { backgroundColor: `${categoryColor}26` }]}><Ionicons name={categoryIcon} size={26} color={categoryColor} /></View>
      <View style={styles.previewCopy}>
        <Text style={[styles.previewLabel, dark.previewLabel]}>PREVIEW · {category.toUpperCase()}</Text>
        <Text style={[styles.previewTitle, dark.previewTitle]} numberOfLines={2}>{name.trim() || 'Your new habit'}</Text>
        <View style={styles.previewChips}>
          {[
            { icon: 'calendar-outline' as const, text: scheduleText },
            { icon: 'repeat' as const, text: `${goalCount}× ${goalUnit}` },
            { icon: (reminder ? 'notifications-outline' : 'notifications-off-outline') as keyof typeof Ionicons.glyphMap, text: reminder ? reminderTimes.join(', ') || 'No time set' : 'No reminder' },
          ].map((chip) => (
            <View key={chip.icon} style={[styles.previewChip, dark.previewChip]}>
              <Ionicons name={chip.icon} size={12} color={accent} />
              <Text style={[styles.previewChipText, dark.previewChipText]} numberOfLines={1}>{chip.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>

    {section(1, 'What do you want to do?', 'Name it, then pick a category.')}
    <View style={[styles.card, dark.card]}>
      <Text style={[styles.fieldLabel, dark.fieldLabel]}>Habit name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="e.g., Drink Water" placeholderTextColor="#A19AAA" style={[styles.input, dark.input, nameFocused && styles.inputFocused, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} maxLength={40} onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} accessibilityLabel="Habit name" />
      <Text style={[styles.counter, dark.counter]}>{name.length}/40</Text>
      <Text style={[styles.fieldLabel, dark.fieldLabel]}>Quick ideas</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ideaRow} keyboardShouldPersistTaps="handled">
        {habitIdeas.map((habit) => (
          <Pressable key={habit} style={({ pressed }) => [styles.ideaChip, dark.ideaChip, name === habit && styles.ideaChipActive, pressed && styles.pressed]} onPress={() => setName(habit)} accessibilityRole="button" accessibilityLabel={`Use ${habit}`}>
            <Text style={[styles.ideaText, dark.ideaText, name === habit && styles.ideaTextActive]}>{habit}</Text>
          </Pressable>
        ))}
        <Pressable style={({ pressed }) => [styles.ideaChip, styles.moreChip, dark.moreChip, pressed && styles.pressed]} onPress={() => router.push('/all-habits')} accessibilityRole="button">
          <Text style={[styles.moreText, dark.moreText]}>More ideas</Text>
          <Ionicons name="arrow-forward" size={14} color={accent} />
        </Pressable>
      </ScrollView>
      <Text style={[styles.fieldLabel, dark.fieldLabel]}>Category</Text>
      <View style={styles.categoryGrid}>
        {categories.map((item) => {
          const active = category === item.label;
          const color = item.color || '#5B42D8';
          return (
            <Pressable key={item.label} style={({ pressed }) => [styles.categoryTile, dark.categoryTile, active && [styles.categoryTileActive, dark.categoryTileActive, { borderColor: color }], pressed && styles.pressed]} onPress={() => setCategory(item.label)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={item.label}>
              <View style={[styles.categoryIcon, { backgroundColor: `${color}${active ? '33' : '1A'}` }]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={color} /></View>
              <Text style={[styles.categoryText, dark.categoryText, active && styles.categoryTextActive, active && dark.categoryTextActive]} numberOfLines={1}>{item.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>

    {section(2, 'How often?', 'Choose when it repeats and how many times.')}
    <View style={[styles.card, dark.card]}>
      <View style={[styles.segment, dark.segment]} accessibilityRole="radiogroup" accessibilityLabel="Frequency">
        {frequencies.map((item) => {
          const active = frequency === item;
          return (
            <Pressable key={item} style={[styles.segmentOption, active && [styles.segmentOptionActive, dark.segmentOptionActive]]} onPress={() => setFrequency(item)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={item}>
              <Text style={[styles.segmentText, dark.segmentText, active && styles.segmentTextActive, active && dark.segmentTextActive]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
      {frequency === 'Custom' && (
        <View style={[styles.customFrequencyCard, dark.customFrequencyCard]}>
          <Text style={[styles.customFrequencyTitle, dark.customFrequencyTitle]}>Repeat on</Text>
          <View style={styles.customPresetRow}>{customFrequencyPresets.map((preset) => <Pressable key={preset} style={[styles.customPreset, dark.customPreset, customFrequency === preset && styles.customPresetActive]} onPress={() => selectCustomFrequency(preset)} accessibilityRole="button"><Text style={[styles.customPresetText, dark.customPresetText, customFrequency === preset && styles.customPresetTextActive]}>{preset}</Text></Pressable>)}</View>
          <View style={styles.daysRow}>{repeatOptions.map((day) => <Pressable key={day} style={[styles.dayButton, dark.dayButton, repeatDays.includes(day) && styles.dayButtonActive, { width: compactDayButton, height: compactDayButton }]} onPress={() => toggleRepeatDay(day)} accessibilityRole="checkbox" accessibilityState={{ checked: repeatDays.includes(day) }} accessibilityLabel={day}><Text style={[styles.dayText, dark.dayText, repeatDays.includes(day) && styles.dayTextActive]}>{day}</Text></Pressable>)}</View>
          <Text style={[styles.customFrequencyHint, dark.customFrequencyHint]}>{repeatDays.length ? `Repeats every week on ${repeatDays.join(', ')}` : 'Select at least one day'}</Text>
        </View>
      )}
      <View style={[styles.goalRow, dark.goalRow]}>
        <View style={styles.goalCopy}>
          <Text style={[styles.goalTitle, dark.goalTitle]}>How many times</Text>
          <Text style={[styles.goalHint, dark.goalHint]}>{goalCount === 1 ? `Once ${goalUnit}` : `${goalCount} times ${goalUnit}`}, e.g. glasses of water</Text>
        </View>
        <View style={styles.stepper}>
          <Pressable style={({ pressed }) => [styles.stepperButton, dark.stepperButton, goalCount <= 1 && styles.stepperDisabled, pressed && styles.pressed]} onPress={() => changeGoal(-1)} disabled={goalCount <= 1} accessibilityRole="button" accessibilityLabel="Fewer times"><Ionicons name="remove" size={18} color={accent} /></Pressable>
          <Text style={[styles.stepperValue, dark.stepperValue]} accessibilityLabel={`${goalCount} times`}>{goalCount}</Text>
          <Pressable style={({ pressed }) => [styles.stepperButton, dark.stepperButton, goalCount >= 50 && styles.stepperDisabled, pressed && styles.pressed]} onPress={() => changeGoal(1)} disabled={goalCount >= 50} accessibilityRole="button" accessibilityLabel="More times"><Ionicons name="add" size={18} color={accent} /></Pressable>
        </View>
      </View>
      <View style={[styles.startDateRow, dark.startDateRow]}>
        <View style={styles.startDateCopy}>
          <Ionicons name="calendar-outline" size={20} color={accent} />
          <View>
            <Text style={[styles.startDateTitle, dark.startDateTitle]}>Start date</Text>
            <Text style={[styles.startDateHint, dark.startDateHint]}>Tracking begins on this day</Text>
          </View>
        </View>
        {Platform.OS === 'web' ? (
          // The browser's own date picker: an invisible native input over the button opens it on click.
          <View style={[styles.startDateButton, dark.startDateButton, styles.startDateWebButton]}>
            <Text style={[styles.startDateButtonText, dark.startDateButtonText]}>{displayDate(startDate)}</Text>
            <Ionicons name="chevron-down" size={15} color={accent} />
            <input
              type="date"
              aria-label={`Start date ${displayDate(startDate)}. Change`}
              value={startDate}
              min={formatDate(new Date())}
              onClick={(event) => { try { event.currentTarget.showPicker?.(); } catch { /* older browsers still allow typing */ } }}
              onChange={(event) => { const value = event.currentTarget.value; if (value) setStartDate(value); }}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
          </View>
        ) : (
          <Pressable style={[styles.startDateButton, dark.startDateButton]} onPress={() => setStartDatePickerVisible(true)} accessibilityRole="button" accessibilityLabel={`Start date ${displayDate(startDate)}. Change`}>
            <Text style={[styles.startDateButtonText, dark.startDateButtonText]}>{displayDate(startDate)}</Text>
            <Ionicons name="chevron-down" size={15} color={accent} />
          </Pressable>
        )}
      </View>
      {startDatePickerVisible && Platform.OS !== 'web' && <DateTimePicker value={new Date(`${startDate}T00:00:00`)} mode="date" minimumDate={new Date()} onChange={(_event, date) => { setStartDatePickerVisible(false); if (date) setStartDate(formatDate(date)); }} />}
    </View>

    {section(3, 'Reminders', 'Get a nudge at the times you choose.')}
    <View style={[styles.reminderSection, dark.reminderSection]}>
      <Pressable style={[styles.reminderHeader, dark.reminderHeader, !reminder && styles.reminderHeaderClosed, reminderPermissionPending && styles.reminderHeaderPending]} onPress={() => void toggleReminder()} disabled={reminderPermissionPending} accessibilityRole="switch" accessibilityState={{ checked: reminder, disabled: reminderPermissionPending }} accessibilityLabel="Toggle custom reminders">
        <View style={styles.reminderTitleWrap}>
          <View style={[styles.reminderIcon, dark.reminderIcon]}><Ionicons name="notifications-outline" size={24} color={accent} /></View>
          <View style={styles.reminderTitleCopy}>
            <Text style={[styles.reminderTitle, dark.reminderTitle]}>Custom Reminders</Text>
            <Text style={[styles.reminderDescription, dark.reminderDescription]}>{Platform.OS === 'web' ? 'Allow notifications to receive reminders. On iPhone, open HabitAI from your Home Screen.' : 'Get reminders at the times you choose to stay consistent.'}</Text>
          </View>
        </View>
        <View style={[styles.toggle, dark.toggle, reminder && styles.toggleOn]}>
          <View style={[styles.knob, reminder && styles.knobOn]} />
        </View>
      </Pressable>
      {reminder && <>
        <View style={styles.reminderEditor}><ReminderTimesEditor times={reminderTimes} onChange={setReminderTimes} /></View>
        {(frequency === 'Weekly' || frequency === 'Custom') && <><Text style={[styles.reminderSubheaderText, dark.reminderSubheaderText]}>Repeat</Text><View style={styles.daysRow}>{repeatOptions.map((day) => <Pressable key={day} style={[styles.dayButton, dark.dayButton, repeatDays.includes(day) && styles.dayButtonActive, { width: compactDayButton, height: compactDayButton }]} onPress={() => toggleRepeatDay(day)}><Text style={[styles.dayText, dark.dayText, repeatDays.includes(day) && styles.dayTextActive]}>{day}</Text></Pressable>)}</View></>}
        <View style={[styles.reminderOptionRow, dark.reminderOptionRow]}><View style={[styles.optionIcon, dark.optionIcon]}><Ionicons name="musical-notes-outline" size={21} color={accent} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Reminder Sound</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>{reminderSoundEnabled ? 'Sound enabled' : 'Sound off'}</Text></View><Pressable style={[styles.soundToggle, dark.soundToggle, reminderSoundEnabled && styles.soundToggleOn]} onPress={() => setReminderSoundEnabled((enabled) => !enabled)} accessibilityRole="switch" accessibilityState={{ checked: reminderSoundEnabled }} accessibilityLabel="Toggle reminder sound"><View style={[styles.soundKnob, reminderSoundEnabled && styles.soundKnobOn]} /></Pressable></View>
        <Pressable style={[styles.reminderOptionRow, dark.reminderOptionRow]} onPress={() => router.push('/snooze-settings')}><View style={[styles.optionIcon, dark.optionIcon]}><Ionicons name="alarm-outline" size={21} color={accent} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Snooze</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Ring Interval: {ringInterval}</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Frequency: {snoozeFrequency}</Text></View><Ionicons name="chevron-forward" size={19} color="#777282" /></Pressable>
        <View style={[styles.smartRow, dark.smartRow]}><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Smart Reminder <Text style={styles.optional}>(Optional)</Text></Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Keeps your reminder time and adds a tip from your recent check-ins. When the habit is at risk of being skipped, you also get a nudge 30 minutes earlier.</Text>{smartReminder && <Text style={styles.smartActiveText}>Starts after you save this habit.</Text>}</View><Pressable style={[styles.toggle, dark.toggle, smartReminder && styles.toggleOn]} onPress={toggleSmartReminder} accessibilityRole="switch" accessibilityState={{ checked: smartReminder }} accessibilityLabel="Toggle smart reminder"><View style={[styles.knob, smartReminder && styles.knobOn]} /></Pressable></View>
      </>}
    </View>
    <Modal visible={smartInfoVisible} transparent animationType="fade" onRequestClose={() => setSmartInfoVisible(false)}><View style={styles.smartModalBackdrop}><View style={[styles.smartModalCard, dark.smartModalCard]}><View style={[styles.smartModalIcon, dark.smartModalIcon]}><Ionicons name="sparkles" size={26} color={accent} /></View><Text style={[styles.smartModalTitle, dark.smartModalTitle]}>Smart Reminder enabled</Text><Text style={[styles.smartModalBody, dark.smartModalBody]}>After you save this habit, recent activity and available prediction guidance will be used to choose a reminder time.</Text><View style={[styles.smartModalStatus, dark.smartModalStatus]}><Ionicons name="notifications-outline" size={17} color="#3C9A63" /><Text style={[styles.smartModalStatusText, dark.smartModalStatusText]}>Reminder starts after saving</Text></View><Pressable style={styles.smartModalButton} onPress={() => setSmartInfoVisible(false)} accessibilityRole="button"><Text style={styles.smartModalButtonText}>Done</Text></Pressable></View></View></Modal>
    <Modal visible={habitAddedVisible} transparent animationType="fade" onRequestClose={() => setHabitAddedVisible(false)}><View style={styles.successModalBackdrop}><View style={[styles.successModalCard, dark.successModalCard]}><View style={styles.successModalIcon}><Ionicons name="checkmark" size={28} color="#FFFFFF" /></View><Text style={[styles.successModalTitle, dark.successModalTitle]}>Habit added successfully</Text><Text style={[styles.successModalBody, dark.successModalBody]}>Your new habit is ready to track.</Text><View style={[styles.successSummary, dark.successSummary]}><Text style={[styles.successHabitName, dark.successHabitName]}>{addedHabitSummary.name}</Text><View style={styles.successSummaryRow}><Ionicons name="calendar-outline" size={16} color={accent} /><Text style={[styles.successSummaryText, dark.successSummaryText]}>{addedHabitSummary.schedule}</Text></View><View style={styles.successSummaryRow}><Ionicons name="notifications-outline" size={16} color={accent} /><Text style={[styles.successSummaryText, dark.successSummaryText]}>{addedHabitSummary.reminder}</Text></View></View><Pressable style={styles.successModalButton} onPress={() => { setHabitAddedVisible(false); router.replace('/(tabs)/habits'); }} accessibilityRole="button"><Text style={styles.successModalButtonText}>View My Habits</Text><Ionicons name="arrow-forward" size={17} color="#FFFFFF" /></Pressable></View></View></Modal>
    <Modal visible={messageVisible} transparent animationType="fade" onRequestClose={() => setMessageVisible(false)}><View style={styles.messageModalBackdrop}><View style={[styles.messageModalCard, dark.messageModalCard]}><View style={[styles.messageModalIcon, dark.messageModalIcon]}><Ionicons name="alert-circle" size={27} color="#D98932" /></View><Text style={[styles.messageModalTitle, dark.messageModalTitle]}>{messageContent.title}</Text><Text style={[styles.messageModalBody, dark.messageModalBody]}>{messageContent.body}</Text><Pressable style={styles.messageModalButton} onPress={() => setMessageVisible(false)} accessibilityRole="button"><Text style={styles.messageModalButtonText}>OK</Text></Pressable></View></View></Modal>
    <Modal visible={cancelVisible} transparent animationType="fade" onRequestClose={() => setCancelVisible(false)}><View style={styles.cancelModalBackdrop}><View style={[styles.cancelModalCard, dark.cancelModalCard]}><View style={[styles.cancelModalIcon, dark.cancelModalIcon]}><Ionicons name="refresh-outline" size={27} color={accent} /></View><Text style={[styles.cancelModalTitle, dark.cancelModalTitle]}>Clear this habit?</Text><Text style={[styles.cancelModalBody, dark.cancelModalBody]}>Your current inputs will be cleared and you&apos;ll return to My Habits.</Text><View style={styles.cancelModalActions}><Pressable style={[styles.keepEditingButton, dark.keepEditingButton]} onPress={() => setCancelVisible(false)} accessibilityRole="button"><Text style={[styles.keepEditingText, dark.keepEditingText]}>Keep Editing</Text></Pressable><Pressable style={styles.clearExitButton} onPress={cancelHabitForm} accessibilityRole="button"><Text style={styles.clearExitText}>Clear &amp; Exit</Text></Pressable></View></View></View></Modal>
    <Pressable style={({ pressed }) => [styles.addHabitButton, (pressed || adding) && styles.pressed]} onPress={addHabit} disabled={adding} accessibilityRole="button" accessibilityState={{ disabled: adding, busy: adding }}><Ionicons name={adding ? 'sparkles' : 'add'} size={21} color="#FFFFFF" /><Text style={styles.addHabitText}>{adding ? 'Checking habit…' : 'Add habit'}</Text></Pressable>
    <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={() => setCancelVisible(true)} accessibilityRole="button"><Ionicons name="refresh-outline" size={17} color={accent} /><Text style={[styles.cancelText, dark.cancelText]}>Clear form</Text></Pressable>
  </View></ScrollView><Modal visible={popularVisible} transparent animationType="slide" onRequestClose={() => setPopularVisible(false)}><View style={styles.modalBackdrop}><View style={[styles.modalCard, dark.modalCard]}><View style={styles.modalHeader}><View><Text style={[styles.modalTitle, dark.modalTitle]}>Popular Habits</Text><Text style={[styles.modalSubtitle, dark.modalSubtitle]}>Choose a habit to add to your form.</Text></View><Pressable onPress={() => setPopularVisible(false)} accessibilityLabel="Close popular habits"><Ionicons name="close" size={22} color={iconInk} /></Pressable></View><ScrollView showsVerticalScrollIndicator={false}>{allHabitIdeas.map((habit) => <Pressable key={habit} style={[styles.modalHabit, dark.modalHabit]} onPress={() => { setName(habit); setPopularVisible(false); }}><View style={[styles.modalHabitIcon, dark.modalHabitIcon]}><Ionicons name="add" size={18} color={accent} /></View><Text style={[styles.modalHabitText, dark.modalHabitText]}>{habit}</Text><Ionicons name="chevron-forward" size={17} color="#A19AAA" /></Pressable>)}</ScrollView></View></View></Modal></SafeAreaView>;
}

const baseStyles = StyleSheet.create(withReadableText({
  messageModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  messageModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 },
  messageModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#FFF2DF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  messageModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  messageModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 },
  messageModalButton: { width: '100%', height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  messageModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  cancelModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  cancelModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 },
  cancelModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  cancelModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  cancelModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 },
  cancelModalActions: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 20 },
  keepEditingButton: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#DCD3F5', alignItems: 'center', justifyContent: 'center' },
  keepEditingText: { color: '#5B42D8', fontSize: 12, fontWeight: '800' },
  clearExitButton: { flex: 1, height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  clearExitText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  container: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 18 },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F0EEF4' },
  // Reminders off: no divider under the switch (nothing follows it).
  reminderHeaderClosed: { borderBottomWidth: 0, paddingBottom: 0 },
  reminderHeaderPending: { opacity: 0.65 },
  reminderTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  reminderTitleCopy: { flex: 1, minWidth: 0 },
  reminderIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  customPresetActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  customPresetTextActive: { color: '#FFFFFF' },
  reminderEditor: { marginTop: 14, marginBottom: 6 },
  dayButtonActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  dayTextActive: { color: '#FFFFFF' },
  reminderOptionRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0EEF4', gap: 9 },
  optionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', marginRight: 1 },
  optionCopy: { flex: 1 },
  soundToggle: { width: 39, height: 23, borderRadius: 12, backgroundColor: '#D8D4DF', padding: 3, justifyContent: 'center' },
  soundToggleOn: { backgroundColor: '#5B42D8' },
  soundKnob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  soundKnobOn: { alignSelf: 'flex-end' },
  smartRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0EEF4', paddingTop: 13, marginTop: 4 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(36, 32, 54, 0.45)', justifyContent: 'flex-end' },
  modalCard: { maxHeight: '82%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 },
  modalTitle: { fontSize: 19, fontWeight: '800', color: '#302B3B' },
  modalSubtitle: { fontSize: 11, color: '#827C8C', marginTop: 4 },
  modalHabit: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  modalHabitIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  modalHabitText: { flex: 1, fontSize: 13, color: '#393440', fontWeight: '700' },
  optional: { color: '#9993A0', fontSize: 10, fontWeight: '600' },
  toggle: { width: 39, height: 23, borderRadius: 12, backgroundColor: '#D8D4DF', padding: 3, justifyContent: 'center' },
  toggleOn: { backgroundColor: '#5B42D8' },
  knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' },
  knobOn: { alignSelf: 'flex-end' },
  smartModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  smartModalCard: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  smartModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  smartModalTitle: { fontSize: 19, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  smartModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 },
  smartModalStatus: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#EDF9F1', borderRadius: 11, paddingVertical: 10, marginTop: 16 },
  smartModalStatusText: { fontSize: 11, color: '#3C9A63', fontWeight: '800' },
  smartModalButton: { width: '100%', height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  smartModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  successModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  successModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 },
  successModalIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#49B878', alignItems: 'center', justifyContent: 'center', marginBottom: 15 },
  successModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' },
  successModalBody: { fontSize: 12, color: '#777282', fontWeight: '600', marginTop: 7, textAlign: 'center' },
  successSummary: { width: '100%', backgroundColor: '#F7F4FF', borderWidth: 1, borderColor: '#E6DEFF', borderRadius: 15, padding: 14, marginTop: 18, gap: 10 },
  successHabitName: { fontSize: 16, color: '#302B3B', fontWeight: '900', marginBottom: 2 },
  successSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  successSummaryText: { flex: 1, fontSize: 11, color: '#625B72', fontWeight: '700' },
  successModalButton: { width: '100%', height: 46, borderRadius: 13, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  successModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  content: { paddingBottom: 120 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16, paddingTop: 8 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: '900', color: '#1F1C26', letterSpacing: -0.5 },
  subtitle: { fontSize: 14, fontWeight: '600', color: '#6E6887', marginTop: 3 },
  closeButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#E4DDF6', marginBottom: 20 },
  previewIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  previewCopy: { flex: 1, minWidth: 0 },
  previewLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: '#8A8497' },
  previewTitle: { fontSize: 18, lineHeight: 23, fontWeight: '900', color: '#1F1C26', marginTop: 2 },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  previewChip: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#F2EEFF' },
  previewChipText: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#4A3E8C' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10, marginTop: 4 },
  sectionNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  sectionNumberText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  sectionCopy: { flex: 1, minWidth: 0 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: '#1F1C26' },
  sectionHint: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 1 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 20, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginBottom: 8 },
  input: { minHeight: 52, backgroundColor: '#FAF9FD', borderRadius: 14, borderWidth: 1.5, borderColor: '#E6E2F0', paddingHorizontal: 14, fontSize: 16, color: '#1F1C26' },
  inputFocused: { borderColor: '#8E7AE8', backgroundColor: '#FFFFFF' },
  counter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '700', color: '#8A8497', marginTop: 5, marginBottom: 8 },
  ideaRow: { gap: 8, paddingBottom: 14 },
  ideaChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#E1DAF7', backgroundColor: '#FAF8FF' },
  ideaChipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  ideaText: { fontSize: 13, fontWeight: '700', color: '#4A4458' },
  ideaTextActive: { color: '#FFFFFF' },
  moreChip: { borderStyle: 'dashed', borderColor: '#B8AAEE', backgroundColor: '#FFFFFF' },
  moreText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  categoryTile: { flexGrow: 1, flexBasis: '30%', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 74, paddingHorizontal: 6, paddingVertical: 10, borderRadius: 14, borderWidth: 1.5, borderColor: '#EEEAF5', backgroundColor: '#FFFFFF' },
  categoryTileActive: { backgroundColor: '#F7F4FF' },
  categoryIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  categoryText: { fontSize: 13, fontWeight: '700', color: '#5C5670', textAlign: 'center' },
  categoryTextActive: { color: '#1F1C26', fontWeight: '900' },
  segment: { flexDirection: 'row', backgroundColor: '#F2F0F7', borderRadius: 14, padding: 4, gap: 4 },
  segmentOption: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentOptionActive: { backgroundColor: '#5B42D8' },
  segmentText: { fontSize: 13, fontWeight: '800', color: '#6E6887' },
  segmentTextActive: { color: '#FFFFFF' },
  customFrequencyCard: { backgroundColor: '#F8F6FF', borderRadius: 16, padding: 12, marginTop: 12 },
  customFrequencyTitle: { fontSize: 13, color: '#3B3650', fontWeight: '800' },
  customFrequencyHint: { fontSize: 12, color: '#7A7488', fontWeight: '600' },
  customPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  customPreset: { minHeight: 34, justifyContent: 'center', borderRadius: 999, borderWidth: 1, borderColor: '#DCD3F5', backgroundColor: '#FFFFFF', paddingHorizontal: 12 },
  customPresetText: { fontSize: 12, color: '#5C5670', fontWeight: '800' },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6, marginTop: 12, marginBottom: 10 },
  dayButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1.5, borderColor: '#DCD8E5', alignItems: 'center', justifyContent: 'center', flexShrink: 0, backgroundColor: '#FFFFFF' },
  dayText: { fontSize: 12, color: '#5C5670', fontWeight: '800' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: '#F8F6FF' },
  goalCopy: { flex: 1, minWidth: 0 },
  goalTitle: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  goalHint: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepperButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#DCD3F5' },
  stepperDisabled: { opacity: 0.4 },
  stepperValue: { minWidth: 30, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#1F1C26' },
  startDateRow: { minHeight: 60, marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: '#F8F6FF', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  startDateCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  startDateTitle: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  startDateHint: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  startDateButton: { minHeight: 38, borderRadius: 12, backgroundColor: '#FFFFFF', paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 5 },
  startDateWebButton: { position: 'relative' },
  startDateButtonText: { fontSize: 13, color: '#5B42D8', fontWeight: '900' },
  reminderSection: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 8, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  reminderTitle: { fontSize: 15, fontWeight: '900', color: '#2D2A3D' },
  reminderDescription: { fontSize: 12, lineHeight: 17, color: '#7A7488', marginTop: 3, fontWeight: '600' },
  optionTitle: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  optionSubtitle: { fontSize: 12, lineHeight: 17, color: '#7A7488', marginTop: 3, fontWeight: '600' },
  reminderSubheaderText: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginTop: 4 },
  smartActiveText: { fontSize: 12, color: '#2E9D5C', fontWeight: '800', marginTop: 4 },
  addHabitButton: { minHeight: 56, borderRadius: 16, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16, shadowColor: '#5B42D8', shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  addHabitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  cancelButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, minHeight: 48 },
  cancelText: { color: '#5B42D8', fontSize: 14, fontWeight: '800' },
  pressed: { opacity: 0.8 },

}));

// Dark-mode overrides, layered over `styles` as [styles.x, dark.x]; same palette as the other screens.
const darkInk = { color: '#F2EFF8' };
const darkMuted = { color: '#AAA4B7' };
const darkLink = { color: '#C9BCFF' };
const darkCard = { backgroundColor: '#1D1A24', borderColor: '#302B3B' };
const darkField = { backgroundColor: '#25212E', borderColor: '#3B3647' };
const darkTint = { backgroundColor: '#2A2440' };
const darkModal = { backgroundColor: '#1B1823', borderWidth: 1, borderColor: '#342C43' };
const darkStyles = StyleSheet.create({
  screen: { backgroundColor: '#111018' },
  title: darkInk,
  subtitle: { color: '#A9A2B8' },
  closeButton: { backgroundColor: '#221E2B' },
  customFrequencyTitle: darkInk,
  customFrequencyHint: darkMuted,
  customPreset: darkField,
  customPresetText: { color: '#D7D1E0' },
  dayText: { color: '#D7D1E0' },
  startDateTitle: darkInk,
  startDateHint: darkMuted,
  startDateButtonText: darkLink,
  reminderSection: darkCard,
  reminderHeader: { borderBottomColor: '#302B3B' },
  reminderIcon: darkTint,
  reminderTitle: darkInk,
  reminderDescription: darkMuted,
  reminderSubheaderText: darkInk,
  reminderOptionRow: { borderTopColor: '#302B3B' },
  optionIcon: darkTint,
  optionTitle: darkInk,
  optionSubtitle: darkMuted,
  smartRow: { borderTopColor: '#302B3B' },
  toggle: { backgroundColor: '#3B3647' },
  soundToggle: { backgroundColor: '#3B3647' },
  cancelText: darkLink,
  messageModalCard: darkModal,
  messageModalIcon: { backgroundColor: '#3A2C1C' },
  messageModalTitle: darkInk,
  messageModalBody: darkMuted,
  cancelModalCard: darkModal,
  cancelModalIcon: darkTint,
  cancelModalTitle: darkInk,
  cancelModalBody: darkMuted,
  keepEditingButton: { borderColor: '#40365C' },
  keepEditingText: darkLink,
  successModalCard: darkModal,
  successModalTitle: darkInk,
  successModalBody: darkMuted,
  successSummary: { backgroundColor: '#221D33', borderColor: '#3A3150' },
  successHabitName: darkInk,
  successSummaryText: { color: '#CFC8DE' },
  smartModalCard: darkModal,
  smartModalIcon: darkTint,
  smartModalTitle: darkInk,
  smartModalBody: darkMuted,
  smartModalStatus: { backgroundColor: '#1D3028' },
  smartModalStatusText: { color: '#7FD3A2' },
  modalCard: darkModal,
  modalTitle: darkInk,
  modalSubtitle: darkMuted,
  modalHabit: { borderBottomColor: '#302B3B' },
  modalHabitIcon: darkTint,
  modalHabitText: { color: '#E6E1F0' },
  preview: { backgroundColor: '#1D1A24', borderColor: '#3A3150' },
  previewLabel: darkMuted,
  previewTitle: darkInk,
  previewChip: { backgroundColor: '#2A2440' },
  previewChipText: { color: '#D2C8FF' },
  sectionNumber: { backgroundColor: '#6A52E0' },
  sectionNumberText: { color: '#FFFFFF' },
  sectionTitle: darkInk,
  sectionHint: darkMuted,
  card: { backgroundColor: '#1D1A24' },
  fieldLabel: { color: '#E6E1F0' },
  input: { ...darkField, color: '#F2EFF8' },
  counter: darkMuted,
  ideaChip: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  ideaText: { color: '#D7D1E0' },
  moreChip: { backgroundColor: '#1D1A24', borderColor: '#6A52E0' },
  moreText: darkLink,
  categoryTile: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  categoryTileActive: { backgroundColor: '#2A2440' },
  categoryText: { color: '#CFC8DE' },
  categoryTextActive: darkInk,
  segment: { backgroundColor: '#25212E' },
  segmentOptionActive: { backgroundColor: '#5B42D8' },
  segmentText: darkMuted,
  segmentTextActive: { color: '#FFFFFF' },
  goalRow: { backgroundColor: '#25212E' },
  goalTitle: darkInk,
  goalHint: darkMuted,
  stepperButton: { backgroundColor: '#1D1A24', borderColor: '#40365C' },
  stepperValue: darkInk,
  startDateRow: { backgroundColor: '#25212E' },
  startDateButton: { backgroundColor: '#1D1A24' },
  dayButton: { borderColor: '#3B3647', backgroundColor: '#1D1A24' },
  customFrequencyCard: { backgroundColor: '#25212E' },

});
