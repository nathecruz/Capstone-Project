// Edits a habit's name, category, schedule and reminder times in place, so fixing a typo or a
// reminder does not mean deleting the habit (and its check-ins) and creating it again. Deleting
// lives here too.
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ReminderTimesEditor } from '@/components/reminder-time-sheet';
import { useAppDialog } from '@/components/ui/app-dialog';
import { requestNotificationAccess, useAppColorScheme } from '@/hooks/color-scheme-context';
import type { Habit } from '@/hooks/app-state/types';
import { useHabitCategories } from '@/hooks/use-habit-categories';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { EDITABLE_FREQUENCIES, HABIT_NAME_MAX_LENGTH, editedHabitFields } from '@/utils/habit-edit';

export function EditHabitSheet({ habit, onClose }: { habit: Habit | null; onClose: () => void }) {
  return (
    <Modal visible={habit !== null} transparent animationType="fade" onRequestClose={onClose}>
      {/* Keyed by habit, so the form starts from that habit's values every time it opens. */}
      {habit ? <EditHabitForm key={habit.id} habit={habit} onClose={onClose} /> : null}
    </Modal>
  );
}

function EditHabitForm({ habit, onClose }: { habit: Habit; onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { updateHabit, deleteHabit } = useAppColorScheme();
  const categories = useHabitCategories();
  const [label, setLabel] = useState(habit.label);
  const [category, setCategory] = useState(habit.category);
  const [frequency, setFrequency] = useState(habit.frequency);
  const [startDate, setStartDate] = useState(habit.startDate || new Date().toISOString().slice(0, 10));
  const [startDatePickerVisible, setStartDatePickerVisible] = useState(false);
  const savedTimes = (habit.reminderTimes?.length ? habit.reminderTimes : [habit.reminderTime]).filter(Boolean);
  const [remindersOn, setRemindersOn] = useState(habit.reminderEnabled && savedTimes.length > 0);
  const [times, setTimes] = useState(savedTimes);
  const [asking, setAsking] = useState(false);
  // A habit can keep a category or schedule that is no longer offered (e.g. a custom schedule).
  const categoryOptions = categories.some((item) => item.label === habit.category)
    ? categories
    : [...categories, { label: habit.category, icon: habit.icon, color: habit.color }];
  const frequencyOptions = EDITABLE_FREQUENCIES.includes(habit.frequency) ? EDITABLE_FREQUENCIES : [...EDITABLE_FREQUENCIES, habit.frequency];
  const nameMissing = !label.trim();

  const save = () => {
    if (nameMissing) return;
    updateHabit(habit.id, editedHabitFields(habit, { label, category, frequency, startDate, reminders: remindersOn ? times : null }, categories));
    onClose();
  };

  // Turning reminders on asks for notification permission first (the browser's, on the web).
  const toggleReminders = async () => {
    if (remindersOn) {
      setRemindersOn(false);
      return;
    }
    setAsking(true);
    const allowed = await requestNotificationAccess().catch(() => false);
    setAsking(false);
    if (!allowed) {
      showAlert('Notifications are blocked', Platform.OS === 'web' ? 'Allow notifications for HabitAI in your browser, then try again. On iPhone, open HabitAI from your Home Screen.' : 'Allow notifications for HabitAI in your phone settings, then try again.');
      return;
    }
    if (!times.length) setTimes(['07:00 AM']);
    setRemindersOn(true);
  };

  const confirmDelete = () => {
    // Close this sheet first: a dialog opened over another modal does not show on every platform.
    onClose();
    showAlert('Delete habit?', `Remove ${habit.label} and its check-ins from your habits?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => deleteHabit(habit.id) },
    ]);
  };

  return (
    <View style={styles.backdrop}>
      <View style={styles.sheet} accessibilityViewIsModal>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.header}>
            <Text style={styles.title}>Edit habit</Text>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close without saving" hitSlop={8}>
              <Ionicons name="close" size={22} color={themeColor('#6B6377')} />
            </Pressable>
          </View>

          <Text style={styles.label}>Name</Text>
          <TextInput
            value={label}
            onChangeText={setLabel}
            maxLength={HABIT_NAME_MAX_LENGTH}
            placeholder="e.g., Drink Water"
            placeholderTextColor={themeColor('#9A94A4')}
            style={[styles.input, nameMissing && styles.inputError]}
            accessibilityLabel="Habit name"
            returnKeyType="done"
            onSubmitEditing={save}
          />
          {nameMissing ? <Text style={styles.errorText}>Give your habit a name.</Text> : null}

          <Text style={styles.label}>Category</Text>
          <View style={styles.chips}>
            {categoryOptions.map((item) => {
              const selected = category === item.label;
              return (
                <Pressable
                  key={item.label}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setCategory(item.label)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  aria-checked={selected}
                >
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={16} color={selected ? themeColor('#5B42D8') : themeColor('#85808D')} />
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{item.label}</Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={styles.label}>Schedule</Text>
          <View style={styles.chips}>
            {frequencyOptions.map((option) => {
              const selected = frequency === option;
              return (
                <Pressable
                  key={option}
                  style={[styles.chip, selected && styles.chipSelected]}
                  onPress={() => setFrequency(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  aria-checked={selected}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option}</Text>
                </Pressable>
              );
            })}
          </View>
          {frequency !== habit.frequency ? <Text style={styles.hint}>Your check-ins stay; the streak is recounted for the new schedule.</Text> : null}

          <Text style={styles.label}>Start date</Text>
          <Pressable style={styles.startDateButton} onPress={() => setStartDatePickerVisible(true)} accessibilityRole="button" accessibilityLabel={`Start date ${new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Change`}>
            <Text style={styles.startDateText}>{new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
            <Ionicons name="calendar-outline" size={16} color={themeColor('#5B42D8')} />
          </Pressable>
          {startDatePickerVisible && (
            <DateTimePicker
              value={new Date(`${startDate}T00:00:00`)}
              mode="date"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={(_event, date) => {
                setStartDatePickerVisible(false);
                if (date) setStartDate(date.toISOString().slice(0, 10));
              }}
            />
          )}

          <View style={styles.reminderHeader}>
            <View style={styles.reminderCopy}>
              <Text style={styles.label}>Reminders</Text>
              <Text style={styles.hint}>{remindersOn ? 'HabitAI reminds you at these times.' : 'Off. This habit is done any time of day.'}</Text>
            </View>
            <Pressable
              style={[styles.toggle, remindersOn && styles.toggleOn]}
              onPress={() => void toggleReminders()}
              disabled={asking}
              accessibilityRole="switch"
              accessibilityState={{ checked: remindersOn, busy: asking }}
              accessibilityLabel="Reminders"
            >
              <View style={[styles.knob, remindersOn && styles.knobOn]} />
            </Pressable>
          </View>
          {remindersOn && <ReminderTimesEditor times={times} onChange={setTimes} />}
          {remindersOn && habit.smartReminderEnabled ? <Text style={styles.hint}>Smart Reminder is on: you are reminded at this time with a tip from your check-ins, and 30 minutes earlier on days the habit is at risk.</Text> : null}

          <View style={styles.actions}>
            <Pressable style={styles.secondaryButton} onPress={onClose} accessibilityRole="button">
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>
            <Pressable style={[styles.primaryButton, nameMissing && styles.buttonDisabled]} onPress={save} disabled={nameMissing} accessibilityRole="button">
              <Text style={styles.primaryButtonText}>Save changes</Text>
            </Pressable>
          </View>

          <Pressable style={styles.deleteButton} onPress={confirmDelete} accessibilityRole="button" accessibilityLabel={`Delete ${habit.label}`}>
            <Ionicons name="trash-outline" size={16} color={themeColor('#D45A68')} />
            <Text style={styles.deleteText}>Delete habit</Text>
          </Pressable>
        </ScrollView>
      </View>
    </View>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 440, maxHeight: '90%', backgroundColor: '#FFFFFF', borderRadius: 24, overflow: 'hidden' },
  content: { padding: 20, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  title: { fontSize: 20, fontWeight: '800', color: '#1D1C26' },
  label: { marginTop: 8, fontSize: 13, fontWeight: '700', color: '#3B3746' },
  input: { borderWidth: 1, borderColor: '#E4E0EC', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1D1C26', backgroundColor: '#FAF9FD' },
  inputError: { borderColor: '#D45A68' },
  errorText: { fontSize: 12, fontWeight: '600', color: '#C24456' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: '#E4E0EC', backgroundColor: '#FFFFFF' },
  chipSelected: { borderColor: '#5B42D8', backgroundColor: '#F1EEFF' },
  chipText: { fontSize: 13, fontWeight: '600', color: '#5E5868' },
  chipTextSelected: { color: '#5B42D8', fontWeight: '800' },
  hint: { fontSize: 12, color: '#777282', fontWeight: '600' },
  startDateButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderWidth: 1, borderColor: '#E4E0EC', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: '#FAF9FD' },
  startDateText: { fontSize: 15, fontWeight: '700', color: '#1D1C26' },
  reminderHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  reminderCopy: { flex: 1 },
  toggle: { width: 48, height: 28, borderRadius: 14, padding: 3, justifyContent: 'center', backgroundColor: '#D8D4DF' },
  toggleOn: { backgroundColor: '#5B42D8' },
  knob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' },
  knobOn: { alignSelf: 'flex-end' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  secondaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14, backgroundColor: '#F1EEF7' },
  secondaryButtonText: { fontSize: 14, fontWeight: '700', color: '#3B3746' },
  primaryButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 14, backgroundColor: '#5B42D8' },
  primaryButtonText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  buttonDisabled: { opacity: 0.5 },
  deleteButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 6, paddingVertical: 10 },
  deleteText: { fontSize: 13, fontWeight: '700', color: '#C24456' },
});
