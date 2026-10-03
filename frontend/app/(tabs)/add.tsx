import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitCategories, type HabitCategory } from '@/authentication';
import { useAppDialog } from '@/components/ui/app-dialog';
import { FACULTY_HABIT_IDEAS } from '@/constants/faculty';
import { DEFAULT_HABIT_CATEGORIES } from '@/constants/habit-categories';
import { requestNotificationAccess, useAppColorScheme } from '@/hooks/color-scheme-context';

const frequencies = ['Daily', 'Weekly', 'Monthly', 'Custom'];
const popularHabits = ['Drink Water', 'Exercise / Workout', 'Read a Book', 'Sleep Early', 'Meditate', 'Eat Healthy'];
const allPopularHabits = [
  ...popularHabits,
  'Journal', 'Practice Gratitude', 'Walk 10,000 Steps', 'Save Money',
  'Learn a Language', 'Take Vitamins', 'Plan Tomorrow', 'Limit Screen Time',
];
const repeatOptions = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const customFrequencyPresets = ['Weekdays only', 'Twice a week'];
const pickerHours = Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'));
const pickerMinutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));
const pickerPeriods = ['AM', 'PM'] as const;

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
  const dark: Partial<typeof darkStyles> = isDarkMode ? darkStyles : {};
  const accent = isDarkMode ? '#B9A9FF' : '#5B42D8';
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
  const [reminderSound, setReminderSound] = useState('reminder_sound.mp3');
  const [smartReminder, setSmartReminder] = useState(false);
  const [timeModalVisible, setTimeModalVisible] = useState(false);
  const [timeHour, setTimeHour] = useState('08');
  const [timeMinute, setTimeMinute] = useState('00');
  const [timePeriod, setTimePeriod] = useState<'AM' | 'PM'>('PM');
  const [editingReminderTime, setEditingReminderTime] = useState<string | null>(null);
  const [popularVisible, setPopularVisible] = useState(false);
  const [smartInfoVisible, setSmartInfoVisible] = useState(false);
  const [habitAddedVisible, setHabitAddedVisible] = useState(false);
  const [addedHabitSummary, setAddedHabitSummary] = useState({ name: '', schedule: '', reminder: '' });
  const [messageVisible, setMessageVisible] = useState(false);
  const [messageContent, setMessageContent] = useState({ title: '', body: '' });
  const [cancelVisible, setCancelVisible] = useState(false);

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

  const addHabit = () => {
    if (!name.trim()) { showMessage('Habit name required', 'Give your new habit a name first.'); return; }
    if ((frequency === 'Custom' || frequency === 'Weekly') && !repeatDays.length) { showMessage('Choose repeat days', 'Select at least one day for this schedule.'); return; }
    const selectedCategory = categories.find((item) => item.label === category);
    createHabit({
      startDate,
      label: name.trim(),
      meta: `${frequency === 'Custom' ? customFrequency : frequency} • ${reminder ? reminderTimes.join(', ') : 'Anytime'}${frequency === 'Custom' ? ` • ${repeatDays.join(', ')}` : ''}`,
      category,
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
    });
    setAddedHabitSummary({
      name: name.trim(),
      schedule: frequency === 'Custom' ? `${customFrequency} • ${repeatDays.join(', ')}` : frequency,
      reminder: reminder ? `${reminderTimes.length} reminder${reminderTimes.length === 1 ? '' : 's'}` : 'Reminders off',
    });
    resetForm();
    setHabitAddedVisible(true);
  };

  const addReminderTime = () => {
    const hour = Number.parseInt(timeHour, 10);
    const minute = Number.parseInt(timeMinute, 10);
    if (!hour || hour > 12 || minute < 0 || minute > 59) {
      showAlert('Invalid time', 'Use an hour from 01 to 12 and minutes from 00 to 59.');
      return;
    }
    const formattedTime = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${timePeriod}`;
    const duplicate = reminderTimes.some((time) => time === formattedTime && time !== editingReminderTime);
    if (duplicate) {
      showAlert('Time already added', 'Choose a different reminder time.');
      return;
    }
    if (editingReminderTime) {
      setReminderTimes((times) => times.map((time) => time === editingReminderTime ? formattedTime : time));
    } else if (reminderTimes.length < 2) {
      setReminderTimes((times) => [...times, formattedTime]);
    } else {
      showAlert('Reminder limit reached', 'You can add up to 2 reminder times only.');
      return;
    }
    setEditingReminderTime(null);
    setTimeModalVisible(false);
  };

  const editReminderTime = (time: string) => {
    const [clock, period] = time.split(' ');
    const [hour, minute] = clock.split(':');
    setTimeHour(hour);
    setTimeMinute(minute);
    setTimePeriod(period as 'AM' | 'PM');
    setEditingReminderTime(time);
    setTimeModalVisible(true);
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
    setReminderSound('reminder_sound.mp3');
    setSmartReminder(false);
  };

  const cancelHabitForm = () => {
    resetForm();
    setCancelVisible(false);
    router.replace('/(tabs)/habits');
  };


  return <SafeAreaView style={[styles.screen, dark.screen]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 18 }]}>
    <View style={[styles.headerRow, compactLayout && styles.headerRowCompact]}><View style={[styles.heroIcon, dark.heroIcon]}><Ionicons name="clipboard-outline" size={30} color={accent} /><Ionicons name="add-circle" size={20} color={accent} /></View><View style={styles.headerCopy}><Text style={[styles.title, dark.title]}>Add a New Habit</Text><Text style={[styles.subtitle, dark.subtitle]}>Build good habits. Track progress. Become your best.</Text></View><Pressable style={[styles.closeButton, dark.closeButton]} onPress={() => { if (name.trim() || goal.trim()) { showAlert('Discard habit?', 'Your current entries will be cleared.', [{ text: 'Keep editing', style: 'cancel' }, { text: 'Discard', style: 'destructive', onPress: () => router.back() }]); } else router.back(); }} accessibilityLabel="Close"><Ionicons name="close" size={22} color={iconInk} /></Pressable></View>
    <Text style={[styles.stepTitle, dark.stepTitle]}>1 <Text style={[styles.stepLabel, dark.stepLabel]}>Habit Name</Text></Text><TextInput value={name} onChangeText={setName} placeholder="e.g., Drink Water" placeholderTextColor="#A19AAA" style={[styles.input, dark.input]} maxLength={40} />
    <Text style={[styles.stepTitle, dark.stepTitle]}>2 <Text style={[styles.stepLabel, dark.stepLabel]}>Category</Text></Text><View style={styles.optionGrid}>{categories.map((item) => <Pressable key={item.label} style={[styles.optionCard, dark.optionCard, category === item.label && [styles.optionActive, dark.optionActive], { minWidth: compactLayout ? 78 : 88, flexBasis: compactLayout ? '30%' : '31%' }]} onPress={() => setCategory(item.label)}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={20} color={category === item.label ? accent : '#85808D'} /><Text style={[styles.optionText, dark.optionText, category === item.label && [styles.optionTextActive, dark.optionTextActive]]}>{item.label}</Text></Pressable>)}</View>
    <Text style={[styles.stepTitle, dark.stepTitle]}>3 <Text style={[styles.stepLabel, dark.stepLabel]}>Frequency</Text></Text><View style={styles.frequencyRow}>{frequencies.map((item) => <Pressable key={item} style={[styles.frequencyButton, dark.frequencyButton, frequency === item && [styles.frequencyActive, dark.frequencyActive], { minWidth: compactLayout ? 70 : 90, flexBasis: compactLayout ? '31%' : 'auto' }]} onPress={() => setFrequency(item)}><Ionicons name={item === 'Daily' ? 'sunny-outline' : item === 'Weekly' ? 'calendar-outline' : item === 'Monthly' ? 'calendar-number-outline' : 'options-outline'} size={18} color={frequency === item ? accent : '#85808D'} /><Text style={[styles.frequencyText, dark.frequencyText, frequency === item && [styles.optionTextActive, dark.optionTextActive]]}>{item}</Text></Pressable>)}</View>{frequency === 'Custom' && <View style={[styles.customFrequencyCard, dark.customFrequencyCard]}><Text style={[styles.customFrequencyTitle, dark.customFrequencyTitle]}>Set weekly repeat days</Text><TextInput value={customFrequency} editable={false} placeholder="Choose a preset" placeholderTextColor="#9A94A4" style={[styles.customFrequencyInput, dark.customFrequencyInput]} /><Text style={[styles.customFrequencyHint, dark.customFrequencyHint]}>Custom schedules repeat weekly on the selected days.</Text><View style={styles.customPresetRow}>{customFrequencyPresets.map((preset) => <Pressable key={preset} style={[styles.customPreset, dark.customPreset, customFrequency === preset && styles.customPresetActive]} onPress={() => selectCustomFrequency(preset)}><Text style={[styles.customPresetText, dark.customPresetText, customFrequency === preset && styles.customPresetTextActive]}>{preset}</Text></Pressable>)}</View><View style={styles.daysRow}>{repeatOptions.map((day) => <Pressable key={day} style={[styles.dayButton, dark.dayButton, repeatDays.includes(day) && styles.dayButtonActive, { width: compactDayButton, height: compactDayButton }]} onPress={() => toggleRepeatDay(day)}><Text style={[styles.dayText, dark.dayText, repeatDays.includes(day) && styles.dayTextActive]}>{day}</Text></Pressable>)}</View><Text style={[styles.customFrequencyHint, dark.customFrequencyHint]}>{repeatDays.length ? `Repeats on ${repeatDays.join(', ')}` : 'Select at least one day'}</Text></View>}
    <Text style={[styles.stepTitle, dark.stepTitle]}>4 <Text style={[styles.stepLabel, dark.stepLabel]}>Goal <Text style={styles.optional}>(Optional)</Text></Text></Text><View style={[styles.goalRow, dark.goalRow]}><Ionicons name="locate-outline" size={22} color={accent} /><TextInput value={goal} onChangeText={setGoal} placeholder="e.g., 8 glasses of water" placeholderTextColor="#A19AAA" style={[styles.goalInput, dark.goalInput]} /><Text style={[styles.goalUnit, dark.goalUnit]}>times</Text></View>
    <View style={[styles.startDateRow, dark.startDateRow]}><View style={styles.startDateCopy}><Ionicons name="calendar-outline" size={21} color={accent} /><View><Text style={[styles.startDateTitle, dark.startDateTitle]}>Start date</Text><Text style={[styles.startDateHint, dark.startDateHint]}>Begin tracking this habit on {displayDate(startDate)}.</Text></View></View><Pressable style={[styles.startDateButton, dark.startDateButton]} onPress={() => setStartDatePickerVisible(true)}><Text style={[styles.startDateButtonText, dark.startDateButtonText]}>{displayDate(startDate)}</Text><Ionicons name="chevron-down" size={15} color={accent} /></Pressable></View>
    {startDatePickerVisible && <DateTimePicker value={new Date(`${startDate}T00:00:00`)} mode="date" minimumDate={new Date()} onChange={(_event, date) => { setStartDatePickerVisible(false); if (date) setStartDate(formatDate(date)); }} />}
    <View style={[styles.reminderSection, dark.reminderSection]}>
      <Pressable style={[styles.reminderHeader, dark.reminderHeader, reminderPermissionPending && styles.reminderHeaderPending]} onPress={() => void toggleReminder()} disabled={reminderPermissionPending} accessibilityRole="switch" accessibilityState={{ checked: reminder, disabled: reminderPermissionPending }} accessibilityLabel="Toggle custom reminders">
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
        <View style={styles.reminderSubheader}><View><Text style={[styles.reminderSubheaderText, dark.reminderSubheaderText]}>Reminder Times</Text><Text style={[styles.reminderHint, dark.reminderHint]}>{reminderTimes.length}/2 times added</Text></View><Pressable style={[styles.addTimeButton, reminderTimes.length >= 2 && styles.addTimeButtonDisabled]} onPress={() => { if (reminderTimes.length >= 2) { showAlert('Reminder limit reached', 'You can add up to 2 reminder times only.'); return; } setEditingReminderTime(null); setTimeModalVisible(true); }} accessibilityRole="button" accessibilityLabel="Add reminder time"><Ionicons name="add" size={15} color="#FFFFFF" /><Text style={styles.addTimeButtonText}>Add Time</Text></Pressable></View>
        <View style={styles.reminderTimesList}>{reminderTimes.length ? reminderTimes.map((time) => <View key={time} style={[styles.reminderTimeRow, dark.reminderTimeRow]}><View style={[styles.reminderTimeIcon, dark.reminderTimeIcon]}><Ionicons name="time-outline" size={20} color={accent} /></View><View style={styles.reminderTimeCopy}><Text style={[styles.reminderTimeText, dark.reminderTimeText]}>{time}</Text><Text style={[styles.reminderTimeHint, dark.reminderTimeHint]}>{time.includes('AM') ? 'Morning reminder' : 'Evening reminder'}</Text></View><Pressable style={[styles.editTimeButton, dark.editTimeButton]} onPress={() => editReminderTime(time)} accessibilityLabel={`Edit reminder at ${time}`}><Ionicons name="create-outline" size={16} color={accent} /><Text style={[styles.editTimeText, dark.editTimeText]}>Edit</Text></Pressable><Pressable style={[styles.removeTimeButton, dark.removeTimeButton]} onPress={() => setReminderTimes((times) => times.filter((item) => item !== time))} accessibilityLabel={`Remove reminder at ${time}`}><Ionicons name="trash-outline" size={17} color="#D45A68" /></Pressable></View>) : <Text style={[styles.emptyReminderText, dark.emptyReminderText]}>No reminder time added yet.</Text>}</View>
        {(frequency === 'Weekly' || frequency === 'Custom') && <><Text style={[styles.reminderSubheaderText, dark.reminderSubheaderText]}>Repeat</Text><View style={styles.daysRow}>{repeatOptions.map((day) => <Pressable key={day} style={[styles.dayButton, dark.dayButton, repeatDays.includes(day) && styles.dayButtonActive, { width: compactDayButton, height: compactDayButton }]} onPress={() => toggleRepeatDay(day)}><Text style={[styles.dayText, dark.dayText, repeatDays.includes(day) && styles.dayTextActive]}>{day}</Text></Pressable>)}</View></>}
        <View style={[styles.reminderOptionRow, dark.reminderOptionRow]}><View style={[styles.optionIcon, dark.optionIcon]}><Ionicons name="musical-notes-outline" size={21} color={accent} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Reminder Sound</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>{reminderSoundEnabled ? 'Sound enabled' : 'Sound off'}</Text></View><Pressable style={[styles.soundToggle, dark.soundToggle, reminderSoundEnabled && styles.soundToggleOn]} onPress={() => setReminderSoundEnabled((enabled) => !enabled)} accessibilityRole="switch" accessibilityState={{ checked: reminderSoundEnabled }} accessibilityLabel="Toggle reminder sound"><View style={[styles.soundKnob, reminderSoundEnabled && styles.soundKnobOn]} /></Pressable></View>
        <Pressable style={[styles.reminderOptionRow, dark.reminderOptionRow]} onPress={() => router.push('/snooze-settings')}><View style={[styles.optionIcon, dark.optionIcon]}><Ionicons name="alarm-outline" size={21} color={accent} /></View><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Snooze</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Ring Interval: {ringInterval}</Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Frequency: {snoozeFrequency}</Text></View><Ionicons name="chevron-forward" size={19} color="#777282" /></Pressable>
        <View style={[styles.smartRow, dark.smartRow]}><View style={styles.optionCopy}><Text style={[styles.optionTitle, dark.optionTitle]}>Smart Reminder <Text style={styles.optional}>(Optional)</Text></Text><Text style={[styles.optionSubtitle, dark.optionSubtitle]}>Uses your recent check-ins to pick the reminder time: earlier when the habit is at risk, a little later when it is going well.</Text>{smartReminder && <Text style={styles.smartActiveText}>Starts after you save this habit.</Text>}</View><Pressable style={[styles.toggle, dark.toggle, smartReminder && styles.toggleOn]} onPress={toggleSmartReminder} accessibilityRole="switch" accessibilityState={{ checked: smartReminder }} accessibilityLabel="Toggle smart reminder"><View style={[styles.knob, smartReminder && styles.knobOn]} /></Pressable></View>
      </>}
    </View>
    <Modal visible={smartInfoVisible} transparent animationType="fade" onRequestClose={() => setSmartInfoVisible(false)}><View style={styles.smartModalBackdrop}><View style={[styles.smartModalCard, dark.smartModalCard]}><View style={[styles.smartModalIcon, dark.smartModalIcon]}><Ionicons name="sparkles" size={26} color={accent} /></View><Text style={[styles.smartModalTitle, dark.smartModalTitle]}>Smart Reminder enabled</Text><Text style={[styles.smartModalBody, dark.smartModalBody]}>After you save this habit, recent activity and available prediction guidance will be used to choose a reminder time.</Text><View style={[styles.smartModalStatus, dark.smartModalStatus]}><Ionicons name="notifications-outline" size={17} color="#3C9A63" /><Text style={[styles.smartModalStatusText, dark.smartModalStatusText]}>Reminder starts after saving</Text></View><Pressable style={styles.smartModalButton} onPress={() => setSmartInfoVisible(false)} accessibilityRole="button"><Text style={styles.smartModalButtonText}>Done</Text></Pressable></View></View></Modal>
    <Modal visible={habitAddedVisible} transparent animationType="fade" onRequestClose={() => setHabitAddedVisible(false)}><View style={styles.successModalBackdrop}><View style={[styles.successModalCard, dark.successModalCard]}><View style={styles.successModalIcon}><Ionicons name="checkmark" size={28} color="#FFFFFF" /></View><Text style={[styles.successModalTitle, dark.successModalTitle]}>Habit added successfully</Text><Text style={[styles.successModalBody, dark.successModalBody]}>Your new habit is ready to track.</Text><View style={[styles.successSummary, dark.successSummary]}><Text style={[styles.successHabitName, dark.successHabitName]}>{addedHabitSummary.name}</Text><View style={styles.successSummaryRow}><Ionicons name="calendar-outline" size={16} color={accent} /><Text style={[styles.successSummaryText, dark.successSummaryText]}>{addedHabitSummary.schedule}</Text></View><View style={styles.successSummaryRow}><Ionicons name="notifications-outline" size={16} color={accent} /><Text style={[styles.successSummaryText, dark.successSummaryText]}>{addedHabitSummary.reminder}</Text></View></View><Pressable style={styles.successModalButton} onPress={() => { setHabitAddedVisible(false); router.replace('/(tabs)/habits'); }} accessibilityRole="button"><Text style={styles.successModalButtonText}>View My Habits</Text><Ionicons name="arrow-forward" size={17} color="#FFFFFF" /></Pressable></View></View></Modal>
    <Modal visible={messageVisible} transparent animationType="fade" onRequestClose={() => setMessageVisible(false)}><View style={styles.messageModalBackdrop}><View style={[styles.messageModalCard, dark.messageModalCard]}><View style={[styles.messageModalIcon, dark.messageModalIcon]}><Ionicons name="alert-circle" size={27} color="#D98932" /></View><Text style={[styles.messageModalTitle, dark.messageModalTitle]}>{messageContent.title}</Text><Text style={[styles.messageModalBody, dark.messageModalBody]}>{messageContent.body}</Text><Pressable style={styles.messageModalButton} onPress={() => setMessageVisible(false)} accessibilityRole="button"><Text style={styles.messageModalButtonText}>OK</Text></Pressable></View></View></Modal>
    <Modal visible={cancelVisible} transparent animationType="fade" onRequestClose={() => setCancelVisible(false)}><View style={styles.cancelModalBackdrop}><View style={[styles.cancelModalCard, dark.cancelModalCard]}><View style={[styles.cancelModalIcon, dark.cancelModalIcon]}><Ionicons name="refresh-outline" size={27} color={accent} /></View><Text style={[styles.cancelModalTitle, dark.cancelModalTitle]}>Clear this habit?</Text><Text style={[styles.cancelModalBody, dark.cancelModalBody]}>Your current inputs will be cleared and you&apos;ll return to My Habits.</Text><View style={styles.cancelModalActions}><Pressable style={[styles.keepEditingButton, dark.keepEditingButton]} onPress={() => setCancelVisible(false)} accessibilityRole="button"><Text style={[styles.keepEditingText, dark.keepEditingText]}>Keep Editing</Text></Pressable><Pressable style={styles.clearExitButton} onPress={cancelHabitForm} accessibilityRole="button"><Text style={styles.clearExitText}>Clear &amp; Exit</Text></Pressable></View></View></View></Modal>
    <View style={styles.popularHeader}><Text style={[styles.stepTitle, dark.stepTitle]}>6 <Text style={[styles.stepLabel, dark.stepLabel]}>Choose from Popular Habits</Text></Text><Pressable onPress={() => router.push('/all-habits')} accessibilityRole="button"><Text style={[styles.viewAll, dark.viewAll]}>View All →</Text></Pressable></View><View style={styles.popularGrid}>{habitIdeas.map((habit) => <Pressable key={habit} style={[styles.popularItem, dark.popularItem]} onPress={() => setName(habit)}><Text style={[styles.popularText, dark.popularText]}>{habit}</Text><Ionicons name="add-circle-outline" size={17} color="#8B8495" /></Pressable>)}</View>
    <Text style={[styles.stepTitle, dark.stepTitle]}>7 <Text style={[styles.stepLabel, dark.stepLabel]}>Preview</Text></Text><View style={[styles.preview, dark.preview]}><View style={[styles.previewIcon, dark.previewIcon]}><Ionicons name={(categories.find((item) => item.label === category)?.icon || 'ellipse-outline') as keyof typeof Ionicons.glyphMap} size={25} color={accent} /></View><View style={styles.previewCopy}><Text style={[styles.previewTitle, dark.previewTitle]}>{name || 'Your new habit'}</Text><Text style={[styles.previewMeta, dark.previewMeta]}>{frequency === 'Custom' ? customFrequency || 'Custom schedule' : frequency} • {goal || '1'} times • {category}</Text><Text style={[styles.previewReminder, dark.previewReminder]}>{reminder ? `${reminderTimes.length} reminder${reminderTimes.length === 1 ? '' : 's'} • ${reminderSoundEnabled ? `Sound on · ${reminderSound}` : 'Sound off'}` : 'Reminders off'}</Text></View></View>
    <Pressable style={styles.addHabitButton} onPress={addHabit}><Ionicons name="add" size={21} color="#FFFFFF" /><Text style={styles.addHabitText}>Add Habit</Text></Pressable><Pressable style={styles.cancelButton} onPress={() => setCancelVisible(true)} accessibilityRole="button"><Ionicons name="refresh-outline" size={17} color={accent} /><Text style={[styles.cancelText, dark.cancelText]}>Clear &amp; Cancel</Text></Pressable>
  </View></ScrollView><Modal visible={popularVisible} transparent animationType="slide" onRequestClose={() => setPopularVisible(false)}><View style={styles.modalBackdrop}><View style={[styles.modalCard, dark.modalCard]}><View style={styles.modalHeader}><View><Text style={[styles.modalTitle, dark.modalTitle]}>Popular Habits</Text><Text style={[styles.modalSubtitle, dark.modalSubtitle]}>Choose a habit to add to your form.</Text></View><Pressable onPress={() => setPopularVisible(false)} accessibilityLabel="Close popular habits"><Ionicons name="close" size={22} color={iconInk} /></Pressable></View><ScrollView showsVerticalScrollIndicator={false}>{allHabitIdeas.map((habit) => <Pressable key={habit} style={[styles.modalHabit, dark.modalHabit]} onPress={() => { setName(habit); setPopularVisible(false); }}><View style={[styles.modalHabitIcon, dark.modalHabitIcon]}><Ionicons name="add" size={18} color={accent} /></View><Text style={[styles.modalHabitText, dark.modalHabitText]}>{habit}</Text><Ionicons name="chevron-forward" size={17} color="#A19AAA" /></Pressable>)}</ScrollView></View></View></Modal><Modal visible={timeModalVisible} transparent animationType="fade" onRequestClose={() => setTimeModalVisible(false)}><View style={styles.timeModalBackdrop}><View style={[styles.timeModalCard, dark.timeModalCard]}><Text style={[styles.modalTitle, dark.modalTitle]}>Add Reminder Time</Text><Text style={[styles.modalSubtitle, dark.modalSubtitle]}>Scroll or tap to choose a time.</Text><View style={styles.timeWheelRow}><View style={styles.timeWheelColumn}><Text style={[styles.timeWheelLabel, dark.timeWheelLabel]}>Hour</Text><ScrollView style={[styles.timeWheel, dark.timeWheel]} contentContainerStyle={styles.timeWheelContent} contentOffset={{ x: 0, y: pickerHours.indexOf(timeHour) * 42 }} showsVerticalScrollIndicator={false} snapToInterval={42} decelerationRate="fast">{pickerHours.map((hour) => <Pressable key={hour} style={[styles.timeWheelOption, timeHour === hour && styles.timeWheelOptionActive]} onPress={() => setTimeHour(hour)}><Text style={[styles.timeWheelText, dark.timeWheelText, timeHour === hour && styles.timeWheelTextActive]}>{hour}</Text></Pressable>)}</ScrollView></View><Text style={[styles.timeWheelColon, dark.timeWheelColon]}>:</Text><View style={styles.timeWheelColumn}><Text style={[styles.timeWheelLabel, dark.timeWheelLabel]}>Minute</Text><ScrollView style={[styles.timeWheel, dark.timeWheel]} contentContainerStyle={styles.timeWheelContent} contentOffset={{ x: 0, y: pickerMinutes.indexOf(timeMinute) * 42 }} showsVerticalScrollIndicator={false} snapToInterval={42} decelerationRate="fast">{pickerMinutes.map((minute) => <Pressable key={minute} style={[styles.timeWheelOption, timeMinute === minute && styles.timeWheelOptionActive]} onPress={() => setTimeMinute(minute)}><Text style={[styles.timeWheelText, dark.timeWheelText, timeMinute === minute && styles.timeWheelTextActive]}>{minute}</Text></Pressable>)}</ScrollView></View><View style={styles.timeWheelColumn}><Text style={[styles.timeWheelLabel, dark.timeWheelLabel]}>Period</Text><View style={[styles.periodWheel, dark.periodWheel]}>{pickerPeriods.map((period) => <Pressable key={period} style={[styles.timeWheelOption, timePeriod === period && styles.timeWheelOptionActive]} onPress={() => setTimePeriod(period)}><Text style={[styles.timeWheelText, dark.timeWheelText, timePeriod === period && styles.timeWheelTextActive]}>{period}</Text></Pressable>)}</View></View></View><View style={styles.timeModalActions}><Pressable onPress={() => setTimeModalVisible(false)}><Text style={[styles.cancelText, dark.cancelText]}>Cancel</Text></Pressable><Pressable style={styles.saveTimeButton} onPress={addReminderTime}><Text style={styles.saveTimeText}>Save Time</Text></Pressable></View></View></View></Modal></SafeAreaView>;
}

const styles = StyleSheet.create({
  messageModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }, messageModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 }, messageModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#FFF2DF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, messageModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' }, messageModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 }, messageModalButton: { width: '100%', height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginTop: 18 }, messageModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  cancelModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }, cancelModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 }, cancelModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, cancelModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' }, cancelModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 }, cancelModalActions: { width: '100%', flexDirection: 'row', gap: 9, marginTop: 20 }, keepEditingButton: { flex: 1, height: 44, borderRadius: 12, borderWidth: 1, borderColor: '#DCD3F5', alignItems: 'center', justifyContent: 'center' }, keepEditingText: { color: '#5B42D8', fontSize: 12, fontWeight: '800' }, clearExitButton: { flex: 1, height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' }, clearExitText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: '#F5F4F9' }, content: { paddingBottom: 110 }, container: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 18 },
  startDateRow: { minHeight: 70, backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E4DDF4', padding: 12, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, startDateCopy: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 }, startDateTitle: { fontSize: 12, fontWeight: '800', color: '#393440' }, startDateHint: { fontSize: 9, color: '#827C8C', marginTop: 3 }, startDateButton: { minHeight: 34, borderRadius: 9, backgroundColor: '#F0EAFF', paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 4 }, startDateButtonText: { fontSize: 9, color: '#5B42D8', fontWeight: '800' },
  reminderSection: { backgroundColor: '#FFFFFF', borderRadius: 16, borderWidth: 1, borderColor: '#E7E1F2', marginTop: 16, padding: 14 },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F0EEF4' },
  reminderHeaderPending: { opacity: 0.65 },
  reminderTitleWrap: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  reminderTitleCopy: { flex: 1, minWidth: 0 },
  reminderIcon: { width: 46, height: 46, borderRadius: 15, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  reminderTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' }, reminderDescription: { fontSize: 10, color: '#827C8C', marginTop: 4 },
  customFrequencyCard: { backgroundColor: '#F8F6FF', borderRadius: 13, padding: 12, marginTop: 10 }, customFrequencyTitle: { fontSize: 11, color: '#393440', fontWeight: '800' }, customFrequencyInput: { height: 42, backgroundColor: '#FFFFFF', borderRadius: 10, borderWidth: 1, borderColor: '#E4DDF4', paddingHorizontal: 11, marginTop: 9, fontSize: 12, color: '#302B3B' }, customFrequencyHint: { fontSize: 10, color: '#827C8C', fontWeight: '600', marginTop: 7 },
  customPresetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 9 }, customPreset: { borderRadius: 10, borderWidth: 1, borderColor: '#DCD3F5', backgroundColor: '#FFFFFF', paddingHorizontal: 9, paddingVertical: 7 }, customPresetActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' }, customPresetText: { fontSize: 9, color: '#6F6880', fontWeight: '700' }, customPresetTextActive: { color: '#FFFFFF' },
  reminderSubheader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 15, marginBottom: 9 }, reminderSubheaderText: { fontSize: 12, fontWeight: '800', color: '#393440', marginTop: 0 }, reminderHint: { fontSize: 10, color: '#827C8C', marginTop: 3 }, addTimeButton: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#5B42D8', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 }, addTimeButtonDisabled: { backgroundColor: '#B8AEDF' }, addTimeButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }, addTimeText: { color: '#5B42D8', fontSize: 12, fontWeight: '800' },
  reminderTimesList: { gap: 8 }, reminderTimeRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F7FC', borderRadius: 11, paddingHorizontal: 10, gap: 7 }, reminderTimeIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center' }, reminderTimeCopy: { flex: 1 }, reminderTimeText: { fontSize: 17, fontWeight: '800', color: '#302B3B' }, reminderTimeHint: { fontSize: 10, color: '#827C8C', fontWeight: '600', marginTop: 2 }, editTimeButton: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 9, backgroundColor: '#EEE8FF', paddingHorizontal: 8 }, editTimeText: { color: '#5B42D8', fontSize: 10, fontWeight: '800' }, removeTimeButton: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#FFF0F2', alignItems: 'center', justifyContent: 'center' }, emptyReminderText: { color: '#827C8C', fontSize: 11, backgroundColor: '#F8F7FC', borderRadius: 11, padding: 14, textAlign: 'center' },
  daysRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 7, marginTop: 10, marginBottom: 16 }, dayButton: { width: 34, height: 34, borderRadius: 17, borderWidth: 1, borderColor: '#DCD8E5', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }, dayButtonActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' }, dayText: { fontSize: 9, color: '#656071', fontWeight: '700' }, dayTextActive: { color: '#FFFFFF' },
  reminderOptionRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0EEF4', gap: 9 }, optionIcon: { width: 34, height: 34, borderRadius: 10, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', marginRight: 1 }, optionCopy: { flex: 1 }, optionTitle: { fontSize: 12, fontWeight: '800', color: '#393440' }, optionSubtitle: { fontSize: 10, color: '#827C8C', marginTop: 3 }, bundledSoundText: { fontSize: 10, color: '#5B42D8', fontWeight: '800', marginTop: 5 }, smartActiveText: { fontSize: 9, color: '#3C9A63', fontWeight: '800', marginTop: 4 }, soundToggle: { width: 39, height: 23, borderRadius: 12, backgroundColor: '#D8D4DF', padding: 3, justifyContent: 'center' }, soundToggleOn: { backgroundColor: '#5B42D8' }, soundKnob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' }, soundKnobOn: { alignSelf: 'flex-end' }, smartRow: { flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: '#F0EEF4', paddingTop: 13, marginTop: 4 },
  timeModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }, timeModalCard: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20 }, timeWheelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 18, gap: 5 }, timeWheelColumn: { flex: 1, alignItems: 'center' }, timeWheelLabel: { fontSize: 10, color: '#827C8C', fontWeight: '800', marginBottom: 6 }, timeWheel: { height: 126, width: '100%', backgroundColor: '#F7F4FF', borderRadius: 12 }, timeWheelContent: { paddingVertical: 42 }, timeWheelOption: { height: 42, minWidth: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 9, paddingHorizontal: 8 }, timeWheelOptionActive: { backgroundColor: '#5B42D8' }, timeWheelText: { fontSize: 17, fontWeight: '700', color: '#8A8492' }, timeWheelTextActive: { color: '#FFFFFF', fontWeight: '900' }, timeWheelColon: { fontSize: 22, fontWeight: '900', color: '#5B42D8', marginTop: 18 }, periodWheel: { height: 126, width: '100%', justifyContent: 'center', backgroundColor: '#F7F4FF', borderRadius: 12 }, timeInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 20, gap: 8 }, timeInput: { width: 62, height: 52, textAlign: 'center', fontSize: 22, fontWeight: '800', color: '#302B3B', backgroundColor: '#F5F2FF', borderRadius: 10, borderWidth: 1, borderColor: '#DDD3F8' }, timeColon: { fontSize: 22, fontWeight: '800', color: '#5B42D8' }, periodButton: { height: 52, paddingHorizontal: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8', borderRadius: 10 }, periodText: { color: '#FFFFFF', fontWeight: '800' }, timeModalActions: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 18, marginTop: 22 }, saveTimeButton: { backgroundColor: '#5B42D8', borderRadius: 10, paddingHorizontal: 15, paddingVertical: 11 }, saveTimeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(36, 32, 54, 0.45)', justifyContent: 'flex-end' }, modalCard: { maxHeight: '82%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 22, paddingBottom: 30 }, modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }, modalTitle: { fontSize: 19, fontWeight: '800', color: '#302B3B' }, modalSubtitle: { fontSize: 11, color: '#827C8C', marginTop: 4 }, modalHabit: { minHeight: 56, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#F0EEF3' }, modalHabitIcon: { width: 34, height: 34, borderRadius: 11, backgroundColor: '#F1ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, modalHabitText: { flex: 1, fontSize: 13, color: '#393440', fontWeight: '700' },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 }, headerRowCompact: { alignItems: 'flex-start' }, heroIcon: { width: 63, height: 63, borderRadius: 18, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center', position: 'relative', marginRight: 12 }, headerCopy: { flex: 1, minWidth: 0 }, title: { fontSize: 24, fontWeight: '800', color: '#24212D' }, subtitle: { fontSize: 10, color: '#777282', fontWeight: '600', marginTop: 4, lineHeight: 15 }, closeButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, stepTitle: { fontSize: 13, fontWeight: '800', color: '#5B42D8', marginTop: 15, marginBottom: 8 }, stepLabel: { color: '#302B3B' }, optional: { color: '#9993A0', fontSize: 10, fontWeight: '600' }, input: { height: 46, backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E4DDF4', paddingHorizontal: 14, fontSize: 13, color: '#302B3B' }, optionGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-start', rowGap: 8, columnGap: 8 }, optionCard: { minWidth: 88, flexGrow: 1, flexBasis: '31%', minHeight: 67, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: '#EEEAF5' }, optionActive: { borderColor: '#5B42D8', backgroundColor: '#F4F0FF' }, optionText: { fontSize: 9, color: '#85808D', fontWeight: '700', textAlign: 'center' }, optionTextActive: { color: '#5B42D8' }, frequencyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, frequencyButton: { flex: 1, minWidth: 90, minHeight: 68, borderRadius: 13, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: '#EEEAF5' }, frequencyActive: { borderColor: '#5B42D8', backgroundColor: '#F4F0FF' }, frequencyText: { fontSize: 9, color: '#85808D', fontWeight: '700' }, goalRow: { height: 48, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: '#E4DDF4' }, goalInput: { flex: 1, paddingHorizontal: 10, fontSize: 12, color: '#302B3B' }, goalUnit: { fontSize: 10, color: '#777282', fontWeight: '700' }, reminderRow: { height: 49, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 13 }, reminderText: { flex: 1, fontSize: 11, color: '#777282', fontWeight: '600' }, toggle: { width: 39, height: 23, borderRadius: 12, backgroundColor: '#D8D4DF', padding: 3, justifyContent: 'center' }, toggleOn: { backgroundColor: '#5B42D8' }, knob: { width: 17, height: 17, borderRadius: 9, backgroundColor: '#FFFFFF' }, knobOn: { alignSelf: 'flex-end' }, popularHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, viewAll: { fontSize: 9, color: '#5B42D8', fontWeight: '800' }, popularGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 }, popularItem: { width: '48.5%', minHeight: 39, borderRadius: 10, backgroundColor: '#FFFFFF', paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, popularText: { fontSize: 10, color: '#514B5D', fontWeight: '700' }, preview: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F0EAFF', borderRadius: 14, padding: 12 }, previewIcon: { width: 44, height: 44, borderRadius: 13, backgroundColor: '#E4DAFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 }, previewCopy: { flex: 1 }, previewTitle: { fontSize: 14, fontWeight: '800', color: '#302B3B' }, previewMeta: { fontSize: 9, color: '#777282', marginTop: 4, fontWeight: '600' }, previewReminder: { fontSize: 9, color: '#5B42D8', marginTop: 4, fontWeight: '800' }, addHabitButton: { height: 47, borderRadius: 13, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 20 }, addHabitText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' }, cancelButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13 }, cancelText: { color: '#5B42D8', fontSize: 11, fontWeight: '800' },
  smartModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 }, smartModalCard: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 22, padding: 22, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.15, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, smartModalIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 14 }, smartModalTitle: { fontSize: 19, fontWeight: '900', color: '#302B3B', textAlign: 'center' }, smartModalBody: { fontSize: 12, lineHeight: 18, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 8 }, smartModalStatus: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#EDF9F1', borderRadius: 11, paddingVertical: 10, marginTop: 16 }, smartModalStatusText: { fontSize: 11, color: '#3C9A63', fontWeight: '800' }, smartModalButton: { width: '100%', height: 44, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginTop: 14 }, smartModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  successModalBackdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 24 }, successModalCard: { width: '100%', maxWidth: 350, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, alignItems: 'center', shadowColor: '#000000', shadowOpacity: 0.18, shadowRadius: 20, shadowOffset: { width: 0, height: 9 }, elevation: 10 }, successModalIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#49B878', alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, successModalTitle: { fontSize: 20, fontWeight: '900', color: '#302B3B', textAlign: 'center' }, successModalBody: { fontSize: 12, color: '#777282', fontWeight: '600', marginTop: 7, textAlign: 'center' }, successSummary: { width: '100%', backgroundColor: '#F7F4FF', borderWidth: 1, borderColor: '#E6DEFF', borderRadius: 15, padding: 14, marginTop: 18, gap: 10 }, successHabitName: { fontSize: 16, color: '#302B3B', fontWeight: '900', marginBottom: 2 }, successSummaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, successSummaryText: { flex: 1, fontSize: 11, color: '#625B72', fontWeight: '700' }, successModalButton: { width: '100%', height: 46, borderRadius: 13, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }, successModalButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});

// Dark-mode overrides, layered over `styles` as [styles.x, dark.x]; same palette as the other screens.
const darkInk = { color: '#F2EFF8' };
const darkMuted = { color: '#AAA4B7' };
const darkLink = { color: '#C9BCFF' };
const darkCard = { backgroundColor: '#1D1A24', borderColor: '#302B3B' };
const darkField = { backgroundColor: '#25212E', borderColor: '#3B3647' };
const darkTint = { backgroundColor: '#2A2440' };
const darkSelected = { backgroundColor: '#2A2440', borderColor: '#7B63F0' };
const darkModal = { backgroundColor: '#1B1823', borderWidth: 1, borderColor: '#342C43' };
const darkStyles = StyleSheet.create({
  screen: { backgroundColor: '#111018' }, title: darkInk, subtitle: { color: '#A9A2B8' }, closeButton: { backgroundColor: '#221E2B' }, heroIcon: darkTint, stepTitle: { color: '#B9A9FF' }, stepLabel: { color: '#E6E1F0' },
  input: { ...darkField, color: '#F2EFF8' }, goalRow: darkField, goalInput: darkInk, goalUnit: darkMuted,
  optionCard: darkCard, optionActive: darkSelected, optionText: darkMuted, optionTextActive: darkLink, frequencyButton: darkCard, frequencyActive: darkSelected, frequencyText: darkMuted,
  customFrequencyCard: { backgroundColor: '#1D1A24' }, customFrequencyTitle: darkInk, customFrequencyInput: { ...darkField, color: '#F2EFF8' }, customFrequencyHint: darkMuted, customPreset: darkField, customPresetText: { color: '#D7D1E0' }, dayButton: { borderColor: '#3B3647' }, dayText: { color: '#D7D1E0' },
  startDateRow: darkCard, startDateTitle: darkInk, startDateHint: darkMuted, startDateButton: darkTint, startDateButtonText: darkLink,
  reminderSection: darkCard, reminderHeader: { borderBottomColor: '#302B3B' }, reminderIcon: darkTint, reminderTitle: darkInk, reminderDescription: darkMuted, reminderSubheaderText: darkInk, reminderHint: darkMuted,
  reminderTimeRow: { backgroundColor: '#25212E' }, reminderTimeIcon: darkTint, reminderTimeText: darkInk, reminderTimeHint: darkMuted, editTimeButton: darkTint, editTimeText: darkLink, removeTimeButton: { backgroundColor: '#3A2229' }, emptyReminderText: { backgroundColor: '#25212E', color: '#AAA4B7' },
  reminderOptionRow: { borderTopColor: '#302B3B' }, optionIcon: darkTint, optionTitle: darkInk, optionSubtitle: darkMuted, smartRow: { borderTopColor: '#302B3B' }, toggle: { backgroundColor: '#3B3647' }, soundToggle: { backgroundColor: '#3B3647' },
  popularItem: { backgroundColor: '#1D1A24' }, popularText: { color: '#D7D1E0' }, viewAll: darkLink, preview: { backgroundColor: '#221D33' }, previewIcon: { backgroundColor: '#2F2748' }, previewTitle: darkInk, previewMeta: darkMuted, previewReminder: darkLink, cancelText: darkLink,
  messageModalCard: darkModal, messageModalIcon: { backgroundColor: '#3A2C1C' }, messageModalTitle: darkInk, messageModalBody: darkMuted,
  cancelModalCard: darkModal, cancelModalIcon: darkTint, cancelModalTitle: darkInk, cancelModalBody: darkMuted, keepEditingButton: { borderColor: '#40365C' }, keepEditingText: darkLink,
  successModalCard: darkModal, successModalTitle: darkInk, successModalBody: darkMuted, successSummary: { backgroundColor: '#221D33', borderColor: '#3A3150' }, successHabitName: darkInk, successSummaryText: { color: '#CFC8DE' },
  smartModalCard: darkModal, smartModalIcon: darkTint, smartModalTitle: darkInk, smartModalBody: darkMuted, smartModalStatus: { backgroundColor: '#1D3028' }, smartModalStatusText: { color: '#7FD3A2' },
  timeModalCard: darkModal, timeWheelLabel: darkMuted, timeWheel: { backgroundColor: '#25212E' }, periodWheel: { backgroundColor: '#25212E' }, timeWheelText: darkMuted, timeWheelColon: { color: '#B9A9FF' },
  modalCard: darkModal, modalTitle: darkInk, modalSubtitle: darkMuted, modalHabit: { borderBottomColor: '#302B3B' }, modalHabitIcon: darkTint, modalHabitText: { color: '#E6E1F0' },
});
