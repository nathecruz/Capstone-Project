// Picking a reminder time: quick picks (Morning, Lunch, ...), then the hour, the minute in
// 5-minute steps and AM/PM as buttons (wheels are hard to use with a mouse or a small screen).
// Any exact minute can be typed into the time at the top, or set with its - and + (one minute).
// It shows when the reminder will next ring. Render it only while it is open.
import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { formatReminderTime, MAX_REMINDER_TIMES, nextTimeFieldText, partOfDay, readTimeField, REMINDER_PRESETS, reminderParts, shiftReminderParts, sortReminderTimes, timeUntil, type Period } from '@/utils/reminder-time';

const HOURS = Array.from({ length: 12 }, (_, index) => index + 1);
const MINUTES = Array.from({ length: 12 }, (_, index) => index * 5);
// Web: the time fields show their own focus style instead of the browser's ring.
const WEB_NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const pad = (value: number) => String(value).padStart(2, '0');

export function ReminderTimeSheet({ initial, title, taken, onSave, onClose }: {
  initial: string;
  title: string;
  /** The habit's other reminder times: the same time cannot be added twice. */
  taken: string[];
  onSave: (time: string) => void;
  onClose: () => void;
}) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const start = reminderParts(initial);
  const [hour, setHour] = useState(start.hour);
  const [minute, setMinute] = useState(start.minute);
  const [period, setPeriod] = useState<Period>(start.period);
  const [now] = useState(() => new Date());
  // What is being typed into the hour or minute field; the time keeps its last valid value meanwhile.
  const [draft, setDraft] = useState<{ field: 'hour' | 'minute'; text: string } | null>(null);
  const minuteField = useRef<TextInput | null>(null);
  const time = formatReminderTime(hour, minute, period);
  const duplicate = taken.includes(time);
  const draftInvalid = draft !== null && draft.text !== '' && readTimeField(draft.text, draft.field) === null;
  const setParts = (parts: { hour: number; minute: number; period: Period }) => {
    setHour(parts.hour);
    setMinute(parts.minute);
    setPeriod(parts.period);
    setDraft(null);
  };
  const pick = (value: string) => setParts(reminderParts(value));
  const nudge = (minutes: number) => setParts(shiftReminderParts({ hour, minute, period }, minutes));
  const fieldText = (field: 'hour' | 'minute') => (draft?.field === field ? draft.text : pad(field === 'hour' ? hour : minute));
  const type = (field: 'hour' | 'minute', input: string) => {
    const text = nextTimeFieldText(fieldText(field), input);
    setDraft({ field, text });
    const value = readTimeField(text, field);
    if (value === null) return;
    if (field === 'minute') {
      setMinute(value);
      return;
    }
    setHour(value);
    // Two digits, or one that no second digit can follow (2 to 9): go on to the minutes.
    if (text.length === 2 || value >= 2) minuteField.current?.focus();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close reminder time">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{title}</Text>

            <View style={styles.display}>
              <View style={styles.displayRow}>
                <Pressable style={({ pressed }) => [styles.nudge, pressed && styles.pressed]} onPress={() => nudge(-1)} accessibilityRole="button" accessibilityLabel="One minute earlier">
                  <Ionicons name="remove" size={20} color={themeColor('#5B42D8')} />
                </Pressable>
                <View style={styles.timeFields}>
                  {(['hour', 'minute'] as const).map((field) => (
                    <React.Fragment key={field}>
                      {field === 'minute' && <Text style={styles.colon}>:</Text>}
                      <TextInput
                        ref={field === 'minute' ? minuteField : undefined}
                        value={fieldText(field)}
                        onChangeText={(text) => type(field, text)}
                        onFocus={() => setDraft({ field, text: pad(field === 'hour' ? hour : minute) })}
                        onBlur={() => setDraft((current) => (current?.field === field ? null : current))}
                        keyboardType="number-pad"
                        inputMode="numeric"
                        selectTextOnFocus
                        returnKeyType="done"
                        style={[styles.timeField, draft?.field === field && styles.timeFieldOn, WEB_NO_RING]}
                        accessibilityLabel={field === 'hour' ? 'Hour, 1 to 12' : 'Minutes, 00 to 59'}
                      />
                    </React.Fragment>
                  ))}
                  <Text style={styles.displayPeriod}>{period}</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.nudge, pressed && styles.pressed]} onPress={() => nudge(1)} accessibilityRole="button" accessibilityLabel="One minute later">
                  <Ionicons name="add" size={20} color={themeColor('#5B42D8')} />
                </Pressable>
              </View>
              <Text style={[styles.displayHint, draftInvalid && styles.fieldError]} accessibilityLiveRegion="polite">
                {draftInvalid
                  ? draft?.field === 'hour' ? 'Type an hour from 1 to 12.' : 'Type minutes from 00 to 59.'
                  : `${partOfDay(time)} reminder · next ${timeUntil(time, now)}`}
              </Text>
            </View>
            <Text style={styles.typeHint}>Tap the hour or minutes to type any time, or use − and + to move one minute.</Text>

            <View style={styles.presets}>
              {REMINDER_PRESETS.map((preset) => {
                const selected = preset.time === time;
                return (
                  <Pressable key={preset.label} style={({ pressed }) => [styles.preset, selected && styles.presetOn, pressed && styles.pressed]} onPress={() => pick(preset.time)} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${preset.label}, ${preset.time}`}>
                    <Ionicons name={preset.icon} size={16} color={selected ? '#FFFFFF' : themeColor('#5B42D8')} />
                    <View>
                      <Text style={[styles.presetLabel, selected && styles.presetTextOn]}>{preset.label}</Text>
                      <Text style={[styles.presetTime, selected && styles.presetTextOn]}>{preset.time.replace(/^0/, '')}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.label}>Hour</Text>
            <View style={styles.grid}>
              {HOURS.map((value) => (
                <Pressable key={value} style={({ pressed }) => [styles.cell, hour === value && styles.cellOn, pressed && styles.pressed]} onPress={() => setHour(value)} accessibilityRole="radio" accessibilityState={{ selected: hour === value }} accessibilityLabel={`${value} o'clock`}>
                  <Text style={[styles.cellText, hour === value && styles.cellTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>Minute</Text>
            <View style={styles.grid}>
              {MINUTES.map((value) => (
                <Pressable key={value} style={({ pressed }) => [styles.cell, minute === value && styles.cellOn, pressed && styles.pressed]} onPress={() => setMinute(value)} accessibilityRole="radio" accessibilityState={{ selected: minute === value }} accessibilityLabel={`${value} minutes`}>
                  <Text style={[styles.cellText, minute === value && styles.cellTextOn]}>:{String(value).padStart(2, '0')}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.periodRow}>
              {(['AM', 'PM'] as const).map((value) => (
                <Pressable key={value} style={({ pressed }) => [styles.periodButton, period === value && styles.cellOn, pressed && styles.pressed]} onPress={() => setPeriod(value)} accessibilityRole="radio" accessibilityState={{ selected: period === value }}>
                  <Ionicons name={value === 'AM' ? 'sunny-outline' : 'moon-outline'} size={16} color={period === value ? '#FFFFFF' : themeColor('#5B42D8')} />
                  <Text style={[styles.cellText, period === value && styles.cellTextOn]}>{value}</Text>
                </Pressable>
              ))}
            </View>

            {duplicate && <Text style={styles.error}>This habit already has a reminder at {time}. Pick another time.</Text>}

            <View style={styles.actions}>
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primary, (duplicate || draftInvalid) && styles.primaryOff, pressed && styles.pressed]} onPress={() => onSave(time)} disabled={duplicate || draftInvalid} accessibilityRole="button" accessibilityState={{ disabled: duplicate || draftInvalid }} accessibilityLabel={`Save reminder at ${time}`}>
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                <Text style={styles.primaryText}>Save time</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A habit's reminder times (up to MAX_REMINDER_TIMES), each with when it next rings, to add, change or remove. */
export function ReminderTimesEditor({ times, onChange }: { times: string[]; onChange: (times: string[]) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  // null: closed; 'new': adding; otherwise the time being changed.
  const [editing, setEditing] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const full = times.length >= MAX_REMINDER_TIMES;
  const suggestion = REMINDER_PRESETS.find((preset) => !times.includes(preset.time))?.time ?? '08:00 AM';
  const save = (time: string) => {
    onChange(sortReminderTimes(editing === 'new' ? [...times, time] : times.map((item) => (item === editing ? time : item))));
    setEditing(null);
  };

  return (
    <View style={styles.editor}>
      <View style={styles.editorHeader}>
        <View style={styles.editorCopy}>
          <Text style={styles.editorTitle}>Reminder times</Text>
          <Text style={styles.editorHint}>{full ? `Up to ${MAX_REMINDER_TIMES} a day` : `${times.length} of ${MAX_REMINDER_TIMES} added`}</Text>
        </View>
        {!full && (
          <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.pressed]} onPress={() => setEditing('new')} accessibilityRole="button" accessibilityLabel="Add reminder time">
            <Ionicons name="add" size={16} color="#FFFFFF" />
            <Text style={styles.addButtonText}>Add time</Text>
          </Pressable>
        )}
      </View>

      {times.length === 0 && <Text style={styles.editorEmpty}>No time yet. Add one so HabitAI can remind you.</Text>}
      {times.map((time) => (
        <View key={time} style={styles.timeRow}>
          <View style={styles.timeIcon}><Ionicons name={partOfDay(time) === 'Morning' ? 'sunny-outline' : partOfDay(time) === 'Afternoon' ? 'partly-sunny-outline' : 'moon-outline'} size={20} color={themeColor('#5B42D8')} /></View>
          <Pressable style={styles.timeCopy} onPress={() => setEditing(time)} accessibilityRole="button" accessibilityLabel={`Change reminder at ${time}`}>
            <Text style={styles.timeText}>{time}</Text>
            <Text style={styles.timeHint}>{partOfDay(time)} · next {timeUntil(time, now)}</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]} onPress={() => setEditing(time)} accessibilityRole="button" accessibilityLabel={`Edit reminder at ${time}`}>
            <Ionicons name="create-outline" size={18} color={themeColor('#5B42D8')} />
          </Pressable>
          <Pressable style={({ pressed }) => [styles.rowButton, styles.removeButton, pressed && styles.pressed]} onPress={() => onChange(times.filter((item) => item !== time))} accessibilityRole="button" accessibilityLabel={`Remove reminder at ${time}`}>
            <Ionicons name="trash-outline" size={18} color={themeColor('#D45A68')} />
          </Pressable>
        </View>
      ))}

      {editing !== null && (
        <ReminderTimeSheet
          initial={editing === 'new' ? suggestion : editing}
          title={editing === 'new' ? 'Add a reminder time' : 'Change reminder time'}
          taken={times.filter((item) => item !== editing)}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

const themedStyles = createThemedStyles({
  editor: { gap: 8 },
  editorHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  editorCopy: { flex: 1 },
  editorTitle: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  editorHint: { marginTop: 1, fontSize: 12, fontWeight: '600', color: '#827C8C' },
  editorEmpty: { fontSize: 13, fontWeight: '600', color: '#827C8C', backgroundColor: '#F8F7FC', borderRadius: 12, padding: 14, textAlign: 'center' },
  addButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#5B42D8' },
  addButtonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 62, paddingHorizontal: 10, borderRadius: 14, backgroundColor: '#F8F7FC' },
  timeIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE8FF' },
  timeCopy: { flex: 1, minWidth: 0 },
  timeText: { fontSize: 18, fontWeight: '900', color: '#2F2D3C' },
  timeHint: { marginTop: 1, fontSize: 12, fontWeight: '700', color: '#6A6573' },
  rowButton: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE8FF' },
  removeButton: { backgroundColor: '#FFF0F2' },
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', justifyContent: 'center', alignItems: 'center', padding: 16 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 26, overflow: 'hidden' },
  content: { padding: 18, gap: 10 },
  pressed: { opacity: 0.85 },
  title: { fontSize: 19, fontWeight: '900', color: '#1F1C26' },
  display: { alignItems: 'center', borderRadius: 20, paddingVertical: 14, backgroundColor: '#F4F0FF' },
  displayRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 12 },
  nudge: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  timeFields: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  timeField: { width: 72, height: 60, borderRadius: 14, borderWidth: 2, borderColor: 'transparent', padding: 0, textAlign: 'center', fontSize: 44, fontWeight: '900', color: '#3E2C9C', letterSpacing: -1 },
  timeFieldOn: { borderColor: '#8E7AE8', backgroundColor: '#FFFFFF' },
  colon: { fontSize: 40, fontWeight: '900', color: '#3E2C9C', marginTop: -6 },
  displayPeriod: { marginLeft: 6, fontSize: 20, fontWeight: '900', color: '#5B42D8' },
  displayHint: { marginTop: 2, fontSize: 13, fontWeight: '700', color: '#5642B8' },
  fieldError: { color: '#C24456' },
  typeHint: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#736D7D', textAlign: 'center' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  preset: { flexGrow: 1, flexBasis: '30%', flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: '#E4DDF4', backgroundColor: '#FFFFFF' },
  presetOn: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  presetLabel: { fontSize: 12, fontWeight: '800', color: '#2F2D3C' },
  presetTime: { fontSize: 12, fontWeight: '600', color: '#6A6573' },
  presetTextOn: { color: '#FFFFFF' },
  label: { marginTop: 4, fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#6A6573' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell: { flexGrow: 1, flexBasis: '14%', minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F3FA' },
  cellOn: { backgroundColor: '#5B42D8' },
  cellText: { fontSize: 15, fontWeight: '800', color: '#3B3647' },
  cellTextOn: { color: '#FFFFFF' },
  periodRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  periodButton: { flex: 1, flexDirection: 'row', gap: 6, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F5F3FA' },
  error: { fontSize: 13, fontWeight: '700', color: '#C24456', textAlign: 'center' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  secondary: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EEF7' },
  secondaryText: { fontSize: 14, fontWeight: '800', color: '#3B3746' },
  primary: { flex: 1.4, flexDirection: 'row', gap: 6, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryOff: { opacity: 0.45 },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
});
