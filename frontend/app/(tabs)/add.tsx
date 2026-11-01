import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitCategories, type HabitCategory } from '@/authentication';
import { HabitAddedSheet, type AddedHabit } from '@/components/habit-added-sheet';
import { ReminderTimesEditor } from '@/components/reminder-time-sheet';
import { useAppDialog } from '@/components/ui/app-dialog';
import { DEFAULT_HABIT_CATEGORIES, FOCUS_CATEGORIES, focusCategory, focusCategoryList, type FocusCategory } from '@/constants/habit-categories';
import { habitTemplatesFor, type HabitTemplate } from '@/constants/habit-templates';
import { requestNotificationAccess, useAppColorScheme, type HabitProof } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { themeSheet, themedColor, withReadableText } from '@/hooks/use-themed-styles';
import { detectBadHabit } from '@/utils/habit-detection';
import { classifyHabit } from '@/utils/ai-client';
import { habitFromTemplate, normalizedProof, proofIcon, proofText, STEP_TARGET, suggestedProof, TIMER_MINUTES } from '@/utils/habit-templates';

const frequencies = ['Daily', 'Weekly', 'Monthly', 'Custom'];
const proofTypes: { type: HabitProof['type']; label: string; hint: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { type: 'timer', label: 'Focus timer', hint: 'Counts when the timer ends', icon: 'timer-outline' },
  { type: 'steps', label: 'Steps', hint: 'Counted by your phone', icon: 'footsteps-outline' },
  { type: 'photo', label: 'Photo', hint: 'Taken when you are done', icon: 'camera-outline' },
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
  const { isDarkMode, addHabit: createHabit, ringInterval, snoozeFrequency, isFaculty, currentHabits } = useAppColorScheme();
  // Faculty mode offers habits for a teacher's day instead of a student's.
  const templates = habitTemplatesFor(isFaculty);
  // `category` comes from the Health and Academics balance card (components/habit-balance-card.tsx).
  const { habit: selectedHabit, category: selectedCategory } = useLocalSearchParams<{ habit?: string; category?: string }>();
  const [templateCategory, setTemplateCategory] = useState<FocusCategory>(() => focusCategory(selectedCategory) ?? 'Health');
  const appTheme = useAppTheme();
  const styles = themeSheet(baseStyles, appTheme);
  const dark: Partial<typeof darkStyles> = isDarkMode ? themeSheet(darkStyles, appTheme) : {};
  const accent = themedColor(isDarkMode ? '#B9A9FF' : '#5B42D8', appTheme);
  const iconInk = isDarkMode ? '#E6E1F0' : '#403A4A';
  const [name, setName] = useState(selectedHabit ?? '');
  const [categories, setCategories] = useState<HabitCategory[]>(DEFAULT_HABIT_CATEGORIES);
  const [category, setCategory] = useState<string>(() => focusCategory(selectedCategory) ?? 'Health');
  // How the check-in is proven: suggested from the name until the student picks one.
  const [chosenProof, setChosenProof] = useState<HabitProof | null>(null);
  const [frequency, setFrequency] = useState('Daily');
  const [startDate, setStartDate] = useState(() => formatDate(new Date()));
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const [customFrequency, setCustomFrequency] = useState('Weekdays only');
  const [reminder, setReminder] = useState(Platform.OS !== 'web');
  const [reminderPermissionPending, setReminderPermissionPending] = useState(false);
  const [reminderTimes, setReminderTimes] = useState(['07:00 AM']);
  const [repeatDays, setRepeatDays] = useState(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
  const [reminderSoundEnabled, setReminderSoundEnabled] = useState(true);
  const [smartReminder, setSmartReminder] = useState(false);
  const [smartInfoVisible, setSmartInfoVisible] = useState(false);
  const [addedHabit, setAddedHabit] = useState<AddedHabit | null>(null);
  const [adding, setAdding] = useState(false);
  const [messageVisible, setMessageVisible] = useState(false);
  const [messageContent, setMessageContent] = useState({ title: '', body: '' });
  const [cancelVisible, setCancelVisible] = useState(false);
  const [nameFocused, setNameFocused] = useState(false);

  useEffect(() => {
    let active = true;
    void getHabitCategories().then((managed) => {
      if (!active || !managed?.length) return;
      const focus = focusCategoryList(managed);
      setCategories(focus);
      setCategory((current) => (focus.some((item) => item.label === current) ? current : focus[0].label));
    });
    return () => {
      active = false;
    };
  }, []);

  const showMessage = (title: string, body: string) => {
    setMessageContent({ title, body });
    setMessageVisible(true);
  };

  const proof = chosenProof ?? suggestedProof(name);

  const alreadyThisWeek = (label: string) => currentHabits.some((habit) => habit.label.trim().toLowerCase() === label.trim().toLowerCase());

  // One tap adds a ready-made habit: daily, its reminder and its proof set.
  const addTemplate = (template: HabitTemplate) => {
    if (alreadyThisWeek(template.label)) {
      showMessage('Already in your habits', `You already have "${template.label}" this week.`);
      return;
    }
    const habit = habitFromTemplate(template, categories, formatDate(new Date()));
    createHabit(habit);
    setAddedHabit({ label: habit.label, category: habit.category, schedule: 'Daily', reminder: template.reminderTime, proof: habit.proof });
  };

  const chooseProof = (type: HabitProof['type']) => {
    if (proof.type === type) setChosenProof(proof);
    else setChosenProof(type === 'timer' ? { type, minutes: TIMER_MINUTES.default } : type === 'steps' ? { type, steps: STEP_TARGET.default } : { type });
  };
  const adjustProof = (direction: -1 | 1) => {
    setChosenProof(normalizedProof(proof.type === 'timer' ? { type: 'timer', minutes: proof.minutes + direction * 5 } : proof.type === 'steps' ? { type: 'steps', steps: proof.steps + direction * 500 } : proof));
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
    // Fallback: the keyword check only knows good vs bad, so let the habit through.
    const detected = detectBadHabit(habitName);
    return { isHabit: true, isBadHabit: detected.isBadHabit, categoryFits: true, suggestedCategory: category, reason: detected.reason };
  };

  const addHabit = async () => {
    if (adding) return;
    if (!name.trim()) { showMessage('Habit name required', 'Give your new habit a name first.'); return; }
    if (alreadyThisWeek(name)) { showMessage('Already in your habits', `You already have "${name.trim()}" this week.`); return; }
    if ((frequency === 'Custom' || frequency === 'Weekly') && !repeatDays.length) { showMessage('Choose repeat days', 'Select at least one day for this schedule.'); return; }
    setAdding(true);
    let detected: { isHabit: boolean; isBadHabit: boolean; categoryFits: boolean; suggestedCategory: string; reason: string };
    try {
      detected = await classifyHabitRisk(name);
    } finally {
      setAdding(false);
    }
    // The AI only advises; it never blocks the habit. A habit under a clearly wrong category is filed
    // under the fitting one the AI suggests (Health or Academics); a bad habit is marked as one.
    let resolvedCategory = category;
    if (!detected.categoryFits && detected.suggestedCategory) {
      const suggestion = categories.find((item) => item.label === detected.suggestedCategory);
      if (suggestion) resolvedCategory = suggestion.label;
    }
    if (resolvedCategory !== category) setCategory(resolvedCategory);
    const resolved = categories.find((item) => item.label === resolvedCategory) ?? categories[0];
    if (detected.isBadHabit) {
      showMessage('Bad habit detected', detected.reason || 'This habit can harm your daily routine or productivity. We marked it as a bad habit so you can work on it.');
    }
    createHabit({
      startDate,
      label: name.trim(),
      meta: `${frequency === 'Custom' ? customFrequency : frequency} • ${reminder ? reminderTimes.join(', ') : 'Anytime'}${frequency === 'Custom' ? ` • ${repeatDays.join(', ')}` : ''}`,
      category: resolvedCategory,
      frequency,
      icon: (resolved?.icon || 'ellipse-outline') as keyof typeof Ionicons.glyphMap,
      color: resolved?.color || '#57B991',
      goal: 1,
      reminderEnabled: reminder && reminderTimes.length > 0,
      reminderTime: reminderTimes[0] || '07:00 AM',
      reminderTimes: reminderTimes,
      reminderDays: frequency === 'Custom' || frequency === 'Weekly' ? repeatDays : [],
      reminderSoundEnabled,
      smartReminderEnabled: smartReminder,
      isBadHabit: detected.isBadHabit,
      badHabitReason: detected.reason,
      proof: normalizedProof(proof),
    });
    setAddedHabit({
      label: name.trim(),
      category: resolvedCategory,
      schedule: frequency === 'Custom' ? `${customFrequency} • ${repeatDays.join(', ')}` : frequency,
      reminder: reminder ? reminderTimes.join(', ') || 'No time set' : 'Reminders off',
      proof: normalizedProof(proof),
    });
    resetForm();
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
    setChosenProof(null);
    setCategory(categories[0]?.label ?? 'Health');
    setFrequency('Daily');
    setStartDate(formatDate(new Date()));
    setCustomFrequency('Weekdays only');
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


  const chosenCategory = categories.find((item) => item.label === category);
  const categoryColor = chosenCategory?.color || '#5B42D8';
  const categoryIcon = (chosenCategory?.icon || 'ellipse-outline') as keyof typeof Ionicons.glyphMap;
  const scheduleText = frequency === 'Custom' ? `${customFrequency} · ${repeatDays.join(', ') || 'no days'}` : frequency;
  const close = () => {
    if (name.trim()) {
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
    <View style={[styles.preview, dark.preview]} accessible accessibilityLabel={`Preview: ${name.trim() || 'Your new habit'}, ${scheduleText}, ${reminder ? `${reminderTimes.length} reminders` : 'no reminder'}`}>
      <View style={[styles.previewIcon, { backgroundColor: `${categoryColor}26` }]}><Ionicons name={categoryIcon} size={26} color={categoryColor} /></View>
      <View style={styles.previewCopy}>
        <Text style={[styles.previewLabel, dark.previewLabel]}>PREVIEW · {category.toUpperCase()}</Text>
        <Text style={[styles.previewTitle, dark.previewTitle]} numberOfLines={2}>{name.trim() || 'Your new habit'}</Text>
        <View style={styles.previewChips}>
          {[
            { icon: 'calendar-outline' as const, text: scheduleText },
            { icon: (reminder ? 'notifications-outline' : 'notifications-off-outline') as keyof typeof Ionicons.glyphMap, text: reminder ? reminderTimes.join(', ') || 'No time set' : 'No reminder' },
            { icon: proofIcon(proof), text: proofText(proof) },
          ].map((chip) => (
            <View key={chip.icon} style={[styles.previewChip, dark.previewChip]}>
              <Ionicons name={chip.icon} size={12} color={accent} />
              <Text style={[styles.previewChipText, dark.previewChipText]} numberOfLines={1}>{chip.text}</Text>
            </View>
          ))}
        </View>
      </View>
    </View>

    {section(1, 'Add in one tap', 'Ready-made habits with the reminder and proof already set.')}
    <View style={[styles.card, dark.card]}>
      <View style={[styles.segment, dark.segment]} accessibilityRole="radiogroup" accessibilityLabel="Ready-made habits for">
        {FOCUS_CATEGORIES.map((item) => {
          const active = templateCategory === item;
          return (
            <Pressable key={item} style={[styles.segmentOption, active && [styles.segmentOptionActive, dark.segmentOptionActive]]} onPress={() => setTemplateCategory(item)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${item} ready-made habits`}>
              <Text style={[styles.segmentText, dark.segmentText, active && styles.segmentTextActive, active && dark.segmentTextActive]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.templateList}>
        {templates.filter((template) => template.category === templateCategory).map((template) => {
          const added = alreadyThisWeek(template.label);
          const color = categories.find((item) => item.label === template.category)?.color || '#5B42D8';
          return (
            <Pressable key={template.id} style={({ pressed }) => [styles.templateRow, dark.templateRow, pressed && styles.pressed]} onPress={() => addTemplate(template)} disabled={added} accessibilityRole="button" accessibilityState={{ disabled: added }} accessibilityLabel={added ? `${template.label}, already in your habits` : `Add ${template.label}, reminder ${template.reminderTime}, proof ${proofText(template.proof)}`}>
              <View style={[styles.templateIcon, { backgroundColor: `${color}22` }]}><Ionicons name={template.icon} size={20} color={color} /></View>
              <View style={styles.templateCopy}>
                <Text style={[styles.templateTitle, dark.templateTitle]} numberOfLines={2}>{template.label}</Text>
                <View style={styles.templateMeta}>
                  <Ionicons name={proofIcon(template.proof)} size={12} color={accent} />
                  <Text style={[styles.templateMetaText, dark.templateMetaText]} numberOfLines={1}>{template.reminderTime} · {proofText(template.proof)}</Text>
                </View>
              </View>
              <Ionicons name={added ? 'checkmark-circle' : 'add-circle'} size={28} color={added ? '#49B878' : accent} />
            </Pressable>
          );
        })}
      </View>
      <Pressable style={({ pressed }) => [styles.moreLink, pressed && styles.pressed]} onPress={() => router.push('/all-habits')} accessibilityRole="button">
        <Text style={[styles.moreText, dark.moreText]}>More ideas</Text>
        <Ionicons name="arrow-forward" size={14} color={accent} />
      </Pressable>
    </View>

    {section(2, 'Or make your own', 'Name it, then pick Health or Academics.')}
    <View style={[styles.card, dark.card]}>
      <Text style={[styles.fieldLabel, dark.fieldLabel]}>Habit name</Text>
      <TextInput value={name} onChangeText={setName} placeholder="e.g., Study for 30 minutes" placeholderTextColor="#A19AAA" style={[styles.input, dark.input, nameFocused && styles.inputFocused, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} maxLength={40} onFocus={() => setNameFocused(true)} onBlur={() => setNameFocused(false)} accessibilityLabel="Habit name" />
      <Text style={[styles.counter, dark.counter]}>{name.length}/40</Text>
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

    {section(3, 'How you prove it', 'A check-in counts once it is proven, so your progress is real.')}
    <View style={[styles.card, dark.card]}>
      <View style={styles.proofGrid} accessibilityRole="radiogroup" accessibilityLabel="Proof">
        {proofTypes.map((option) => {
          const active = proof.type === option.type;
          return (
            <Pressable key={option.type} style={({ pressed }) => [styles.proofTile, dark.proofTile, active && [styles.proofTileActive, dark.proofTileActive], pressed && styles.pressed]} onPress={() => chooseProof(option.type)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={`${option.label}: ${option.hint}`}>
              <Ionicons name={option.icon} size={20} color={accent} />
              <Text style={[styles.proofLabel, dark.proofLabel, active && styles.proofLabelActive, active && dark.proofLabelActive]}>{option.label}</Text>
              <Text style={[styles.proofHint, dark.proofHint]}>{option.hint}</Text>
            </Pressable>
          );
        })}
      </View>
      {proof.type !== 'photo' && (
        <View style={[styles.proofStepper, dark.proofStepper]}>
          <Pressable style={({ pressed }) => [styles.stepperButton, dark.stepperButton, pressed && styles.pressed]} onPress={() => adjustProof(-1)} accessibilityRole="button" accessibilityLabel={proof.type === 'timer' ? 'Five minutes less' : '500 steps fewer'}><Ionicons name="remove" size={18} color={accent} /></Pressable>
          <Text style={[styles.stepperValue, dark.stepperValue]} accessibilityLiveRegion="polite">{proofText(proof)}</Text>
          <Pressable style={({ pressed }) => [styles.stepperButton, dark.stepperButton, pressed && styles.pressed]} onPress={() => adjustProof(1)} accessibilityRole="button" accessibilityLabel={proof.type === 'timer' ? 'Five minutes more' : '500 steps more'}><Ionicons name="add" size={18} color={accent} /></Pressable>
        </View>
      )}
    </View>

    {section(4, 'How often?', 'Choose when it repeats and how many times.')}
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

    {section(5, 'Reminders', 'Get a nudge at the times you choose.')}
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
    <HabitAddedSheet habit={addedHabit} onClose={() => setAddedHabit(null)} onViewHabits={() => { setAddedHabit(null); router.replace('/(tabs)/habits'); }} />
    <Modal visible={messageVisible} transparent animationType="fade" onRequestClose={() => setMessageVisible(false)}><View style={styles.messageModalBackdrop}><View style={[styles.messageModalCard, dark.messageModalCard]}><View style={[styles.messageModalIcon, dark.messageModalIcon]}><Ionicons name="alert-circle" size={27} color="#D98932" /></View><Text style={[styles.messageModalTitle, dark.messageModalTitle]}>{messageContent.title}</Text><Text style={[styles.messageModalBody, dark.messageModalBody]}>{messageContent.body}</Text><Pressable style={styles.messageModalButton} onPress={() => setMessageVisible(false)} accessibilityRole="button"><Text style={styles.messageModalButtonText}>OK</Text></Pressable></View></View></Modal>
    <Modal visible={cancelVisible} transparent animationType="fade" onRequestClose={() => setCancelVisible(false)}><View style={styles.cancelModalBackdrop}><View style={[styles.cancelModalCard, dark.cancelModalCard]}><View style={[styles.cancelModalIcon, dark.cancelModalIcon]}><Ionicons name="refresh-outline" size={27} color={accent} /></View><Text style={[styles.cancelModalTitle, dark.cancelModalTitle]}>Clear this habit?</Text><Text style={[styles.cancelModalBody, dark.cancelModalBody]}>Your current inputs will be cleared and you&apos;ll return to My Habits.</Text><View style={styles.cancelModalActions}><Pressable style={[styles.keepEditingButton, dark.keepEditingButton]} onPress={() => setCancelVisible(false)} accessibilityRole="button"><Text style={[styles.keepEditingText, dark.keepEditingText]}>Keep Editing</Text></Pressable><Pressable style={styles.clearExitButton} onPress={cancelHabitForm} accessibilityRole="button"><Text style={styles.clearExitText}>Clear &amp; Exit</Text></Pressable></View></View></View></Modal>
    <Pressable style={({ pressed }) => [styles.addHabitButton, (pressed || adding) && styles.pressed]} onPress={addHabit} disabled={adding} accessibilityRole="button" accessibilityState={{ disabled: adding, busy: adding }}><Ionicons name={adding ? 'sparkles' : 'add'} size={21} color="#FFFFFF" /><Text style={styles.addHabitText}>{adding ? 'Checking habit…' : 'Add habit'}</Text></Pressable>
    <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={() => setCancelVisible(true)} accessibilityRole="button"><Ionicons name="refresh-outline" size={17} color={accent} /><Text style={[styles.cancelText, dark.cancelText]}>Clear form</Text></Pressable>
  </View></ScrollView></SafeAreaView>;
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
  moreText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  moreLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 40, marginTop: 6 },
  templateList: { gap: 8, marginTop: 12 },
  templateRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 64, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16, borderWidth: 1, borderColor: '#EEEAF5', backgroundColor: '#FAF9FD' },
  templateIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  templateCopy: { flex: 1, minWidth: 0 },
  templateTitle: { fontSize: 14, fontWeight: '800', color: '#1F1C26' },
  templateMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  templateMetaText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: '#6E6887' },
  proofGrid: { flexDirection: 'row', gap: 8 },
  proofTile: { flex: 1, minWidth: 0, alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 12, borderRadius: 14, borderWidth: 1.5, borderColor: '#EEEAF5', backgroundColor: '#FFFFFF' },
  proofTileActive: { borderColor: '#5B42D8', backgroundColor: '#F7F4FF' },
  proofLabel: { fontSize: 13, fontWeight: '800', color: '#5C5670', textAlign: 'center' },
  proofLabelActive: { color: '#1F1C26', fontWeight: '900' },
  proofHint: { fontSize: 11, lineHeight: 14, fontWeight: '600', color: '#7A7488', textAlign: 'center' },
  proofStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 12, padding: 8, borderRadius: 14, backgroundColor: '#F8F6FF' },
  stepperButton: { width: 40, height: 40, borderRadius: 12, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  stepperValue: { flex: 1, fontSize: 14, fontWeight: '900', color: '#2D2A3D', textAlign: 'center' },
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
  smartModalCard: darkModal,
  smartModalIcon: darkTint,
  smartModalTitle: darkInk,
  smartModalBody: darkMuted,
  smartModalStatus: { backgroundColor: '#1D3028' },
  smartModalStatusText: { color: '#7FD3A2' },
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
  moreText: darkLink,
  templateRow: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  templateTitle: darkInk,
  templateMetaText: darkMuted,
  proofTile: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  proofTileActive: { backgroundColor: '#2A2440', borderColor: '#8E7AE8' },
  proofLabel: { color: '#CFC8DE' },
  proofLabelActive: darkInk,
  proofHint: darkMuted,
  proofStepper: { backgroundColor: '#25212E' },
  stepperButton: { backgroundColor: '#1D1A24' },
  stepperValue: darkInk,
  categoryTile: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  categoryTileActive: { backgroundColor: '#2A2440' },
  categoryText: { color: '#CFC8DE' },
  categoryTextActive: darkInk,
  segment: { backgroundColor: '#25212E' },
  segmentOptionActive: { backgroundColor: '#5B42D8' },
  segmentText: darkMuted,
  segmentTextActive: { color: '#FFFFFF' },
  startDateRow: { backgroundColor: '#25212E' },
  startDateButton: { backgroundColor: '#1D1A24' },
  dayButton: { borderColor: '#3B3647', backgroundColor: '#1D1A24' },
  customFrequencyCard: { backgroundColor: '#25212E' },

});
