// Home: asks to turn on habit reminders on this browser when the student has reminders but this
// phone or laptop does not get them yet (each device has to allow notifications once).
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { enableWebReminders, getHabitReminderTimes, getWebReminderStatus, type WebReminderStatus } from '@/hooks/color-scheme-context';
import type { Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const SNOOZE_KEY = 'habitai:device-reminders-later';
const SNOOZE_DAYS = 7;

function snoozedUntil() {
  try {
    return Number(window.localStorage.getItem(SNOOZE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function snoozeBanner() {
  try {
    window.localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Private window: the banner simply comes back next time.
  }
}

const COPY: Partial<Record<WebReminderStatus, { title: string; text: string }>> = {
  off: {
    title: 'Get reminders on this device',
    text: 'Reminders arrive on every phone and laptop where you turn them on, right at the time you set.',
  },
  'needs-home-screen': {
    title: 'Get reminders on this iPhone',
    text: 'Tap Share, then Add to Home Screen, and open HabitAI from the Home Screen. Then turn reminders on there.',
  },
  blocked: {
    title: 'Reminders are blocked here',
    text: 'This browser blocks notifications from HabitAI. Allow them in the site settings (the lock icon next to the address), then reopen HabitAI.',
  },
};

export function DeviceRemindersBanner({ habits, notificationsEnabled }: { habits: Habit[]; notificationsEnabled: boolean }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [status, setStatus] = React.useState<WebReminderStatus | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [justEnabled, setJustEnabled] = React.useState(false);
  const [hidden, setHidden] = React.useState(() => Platform.OS === 'web' && snoozedUntil() > Date.now());
  const hasReminders = habits.some((habit) => habit.smartReminderEnabled || (habit.reminderEnabled && getHabitReminderTimes(habit).length > 0));
  const relevant = Platform.OS === 'web' && notificationsEnabled && hasReminders;

  React.useEffect(() => {
    if (!relevant) return;
    let active = true;
    const check = () => void getWebReminderStatus().then((value) => { if (active) setStatus(value); });
    check();
    // Coming back after allowing notifications in the browser's settings.
    const onVisible = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [relevant]);

  React.useEffect(() => {
    if (!justEnabled) return;
    const timer = setTimeout(() => setJustEnabled(false), 5000);
    return () => clearTimeout(timer);
  }, [justEnabled]);

  if (!relevant) return null;
  if (justEnabled) {
    return (
      <View style={[styles.banner, styles.done]} accessibilityRole="alert">
        <View style={[styles.icon, styles.doneIcon]}><Ionicons name="checkmark" size={20} color="#FFFFFF" /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>Reminders are on for this device</Text>
          <Text style={styles.text}>They will arrive here at the times you set, even with HabitAI closed.</Text>
        </View>
      </View>
    );
  }
  const copy = status ? COPY[status] : undefined;
  if (!copy || hidden) return null;

  const turnOn = async () => {
    setBusy(true);
    const enabled = await enableWebReminders({ prompt: true });
    const next = await getWebReminderStatus();
    setBusy(false);
    setStatus(next);
    if (enabled && next === 'on') setJustEnabled(true);
  };
  const later = () => {
    snoozeBanner();
    setHidden(true);
  };

  return (
    <View style={styles.banner} accessibilityRole="summary">
      <View style={styles.icon}><Ionicons name="notifications" size={19} color="#FFFFFF" /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.text}>{copy.text}</Text>
        <View style={styles.actions}>
          {status === 'off' && (
            <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.busy]} onPress={turnOn} disabled={busy} accessibilityRole="button" accessibilityLabel="Turn on reminders on this device">
              <Text style={styles.buttonText}>{busy ? 'Turning on…' : 'Turn on'}</Text>
            </Pressable>
          )}
          <Pressable style={({ pressed }) => [styles.later, pressed && styles.pressed]} onPress={later} accessibilityRole="button" accessibilityLabel="Hide this for a week" hitSlop={6}>
            <Text style={[styles.laterText, { color: themeColor('#5B42D8') }]}>Not now</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const themedStyles = createThemedStyles({
  banner: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 18, backgroundColor: '#F1EDFF', borderWidth: 1, borderColor: '#DCD3F7' },
  done: { alignItems: 'center', backgroundColor: '#E8F7EF', borderColor: '#BFE6D0' },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  doneIcon: { backgroundColor: '#2E9D66' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  text: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#5F596D' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 10 },
  button: { minHeight: 36, paddingHorizontal: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  buttonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  busy: { opacity: 0.7 },
  later: { minHeight: 36, justifyContent: 'center' },
  laterText: { fontSize: 13, fontWeight: '800' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
});
