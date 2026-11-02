// Notifications > Settings: whether this device gets habit reminders while HabitAI is closed, a
// test reminder a minute later (close HabitAI and watch it arrive, as a reminder would), and what
// to change on the phone when it does not come. On the web, reminders come by Web Push from the
// server; in the Android app, they are set on the phone (hooks/app-state/native-reminders.ts).
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, Text, View } from 'react-native';
import {
  enableWebReminders, getNotificationsModule, getWebReminderStatus, isWebPushReadyOnServer, nextPhoneReminders,
  scheduleTestReminder, sendTestReminder, type WebReminderStatus,
} from '@/hooks/app-state/reminders';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const TEST_SECONDS = 60;

const WEB_DEVICE: Record<WebReminderStatus, { ok: boolean; text: string }> = {
  on: { ok: true, text: 'Reminders are on for this browser.' },
  off: { ok: false, text: 'Reminders are not on for this browser yet.' },
  blocked: { ok: false, text: 'This browser blocks HabitAI\'s notifications. Allow them in its site settings (the lock icon next to the address), then come back.' },
  'needs-home-screen': { ok: false, text: 'On iPhone, add HabitAI to the Home Screen and open it from there to get reminders.' },
  unsupported: { ok: false, text: 'This browser cannot get reminders. Use Chrome, or the HabitAI app on Android.' },
};

const WEB_TIPS = [
  'Let Chrome show notifications: Settings > Apps > Chrome > Notifications.',
  'Let Chrome run in the background: Settings > Apps > Chrome > Battery > Unrestricted. On Infinix, Tecno and itel phones, also allow Chrome in Phone Master\'s auto-start and turn off power saving for it.',
  'Keep Do Not Disturb off at your reminder times.',
];
const PHONE_TIPS = [
  'Let HabitAI run in the background: Settings > Apps > HabitAI > Battery > Unrestricted.',
  'On Infinix, Tecno, itel, Xiaomi, Oppo, realme and Vivo phones, also allow HabitAI to auto-start (Phone Master or Security > Autostart), or reminders can stop after HabitAI is swiped away.',
  'Keep Do Not Disturb off at your reminder times.',
];

const clock = (at: number) => new Date(at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

/** 'Today', 'Tomorrow' or the weekday of `at`. */
function dayOf(at: number, now: number) {
  const day = (time: number) => new Date(time).setHours(0, 0, 0, 0);
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : new Date(at).toLocaleDateString('en-US', { weekday: 'long' });
}

type Checked =
  | { web: true; status: WebReminderStatus; serverReady: boolean }
  | { web: false; permission: 'granted' | 'denied' | 'undetermined'; upcoming: { title: string; at: number }[]; checkedAt: number }
  | null;

/** What this device is set up for: the server and this browser on the web; on a phone, its permission and next reminders. */
async function checkDevice(web: boolean): Promise<Checked> {
  if (web) {
    const [status, serverReady] = await Promise.all([getWebReminderStatus(), isWebPushReadyOnServer()]);
    return { web: true, status, serverReady };
  }
  const Notifications = await getNotificationsModule();
  if (!Notifications) return null;
  const [current, upcoming] = await Promise.all([Notifications.getPermissionsAsync(), nextPhoneReminders(Notifications)]);
  const permission = current.status === 'granted' ? 'granted' : current.canAskAgain === false ? 'denied' : 'undetermined';
  return { web: false, permission, upcoming, checkedAt: Date.now() };
}

function StatusRow({ ok, text }: { ok: boolean | null; text: string }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View style={styles.statusRow}>
      <Ionicons name={ok === null ? 'ellipsis-horizontal-circle' : ok ? 'checkmark-circle' : 'alert-circle'} size={18} color={themeColor(ok === null ? '#9A94A4' : ok ? '#2E9D5C' : '#D9822B')} />
      <Text style={styles.statusText}>{text}</Text>
    </View>
  );
}

export function ReminderCheck() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const web = Platform.OS === 'web';
  const [checked, setChecked] = useState<Checked>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const webStatus = checked?.web ? checked.status : null;
  const serverReady = checked?.web ? checked.serverReady : null;
  const permission = checked && !checked.web ? checked.permission : null;
  const upcoming = checked && !checked.web ? checked.upcoming : null;

  useEffect(() => {
    let active = true;
    void checkDevice(web).then((result) => {
      if (active) setChecked(result);
    });
    return () => {
      active = false;
    };
  }, [web]);
  const check = async () => setChecked(await checkDevice(web));

  const turnOn = async () => {
    setBusy(true);
    setMessage(null);
    if (web) {
      const enabled = await enableWebReminders({ prompt: true });
      if (!enabled) setMessage({ ok: false, text: serverReady === false ? 'HabitAI\'s server cannot send reminders yet.' : 'Reminders could not be turned on. Allow notifications when the browser asks.' });
    } else {
      const Notifications = await getNotificationsModule();
      const asked = permission === 'denied' ? null : await Notifications?.requestPermissionsAsync().catch(() => null);
      if (!asked || asked.status !== 'granted') void Linking.openSettings().catch(() => undefined);
    }
    setBusy(false);
    await check();
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    const at = Date.now() + TEST_SECONDS * 1000;
    if (web) {
      const result = await sendTestReminder({ delaySeconds: TEST_SECONDS });
      setMessage({ ok: result.ok, text: result.ok ? `Test reminder set for ${clock(at)}. Close HabitAI now: it should appear then.` : result.message });
    } else {
      const Notifications = await getNotificationsModule();
      const scheduled = Notifications ? await scheduleTestReminder(Notifications, TEST_SECONDS).then(() => true).catch(() => false) : false;
      setMessage(scheduled
        ? { ok: true, text: `Test reminder set for ${clock(at)}. Close HabitAI now (swipe it away too): it should appear then.` }
        : { ok: false, text: 'The test reminder could not be set. Allow notifications for HabitAI first.' });
    }
    setBusy(false);
  };

  const canTest = web ? webStatus === 'on' && serverReady === true : permission === 'granted';
  const needsTurnOn = web ? webStatus === 'off' : permission !== null && permission !== 'granted';

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.headerIcon}><Ionicons name="alarm-outline" size={19} color={themeColor('#5B42D8')} /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Reminders while HabitAI is closed</Text>
          <Text style={styles.subtitle}>{web ? 'On the web, HabitAI\'s server sends each reminder at its time.' : 'This phone shows each reminder at its time, even without internet.'}</Text>
        </View>
      </View>

      {web ? (
        <>
          <StatusRow ok={serverReady} text={serverReady === null ? 'Checking HabitAI\'s server…' : serverReady ? 'HabitAI\'s server is ready to send reminders.' : 'HabitAI\'s server could not be reached, or cannot send reminders yet. Try again later.'} />
          <StatusRow ok={webStatus ? WEB_DEVICE[webStatus].ok : null} text={webStatus ? WEB_DEVICE[webStatus].text : 'Checking this browser…'} />
        </>
      ) : (
        <>
          <StatusRow ok={permission === null ? null : permission === 'granted'} text={permission === null ? 'Checking this phone…' : permission === 'granted' ? 'HabitAI may show notifications on this phone.' : 'HabitAI is not allowed to show notifications on this phone.'} />
          {upcoming ? (
            upcoming.length ? (
              <View style={styles.upcoming} accessibilityLabel="Next reminders on this phone">
                <Text style={styles.upcomingTitle}>Next reminders on this phone</Text>
                {upcoming.map((item) => <Text key={`${item.title}-${item.at}`} style={styles.upcomingItem}>{`${dayOf(item.at, checked && !checked.web ? checked.checkedAt : item.at)} · ${item.title}`}</Text>)}
              </View>
            ) : <StatusRow ok={false} text="No reminders are set on this phone. Turn on a habit's reminder, and keep Show notifications on." />
          ) : null}
        </>
      )}

      <View style={styles.actions}>
        {needsTurnOn && (
          <Pressable style={({ pressed }) => [styles.primary, (pressed || busy) && styles.pressed]} onPress={() => void turnOn()} disabled={busy} accessibilityRole="button">
            <Text style={styles.primaryText}>{web ? 'Turn on reminders' : permission === 'denied' ? 'Open settings' : 'Allow notifications'}</Text>
          </Pressable>
        )}
        <Pressable style={({ pressed }) => [styles.secondary, !canTest && styles.disabled, (pressed || busy) && styles.pressed]} onPress={() => void test()} disabled={!canTest || busy} accessibilityRole="button" accessibilityLabel="Send a test reminder in 1 minute" accessibilityState={{ disabled: !canTest || busy }}>
          <Ionicons name="paper-plane-outline" size={15} color={themeColor('#5B42D8')} />
          <Text style={styles.secondaryText}>Send a test reminder in 1 minute</Text>
        </Pressable>
      </View>
      {message ? <Text style={[styles.message, !message.ok && styles.messageError]} accessibilityLiveRegion="polite">{message.text}</Text> : null}

      <Text style={styles.tipsTitle}>If a reminder does not appear</Text>
      {(web ? WEB_TIPS : PHONE_TIPS).map((tip) => <Text key={tip} style={styles.tip}>{`• ${tip}`}</Text>)}
      {!web && (
        <Pressable style={({ pressed }) => [styles.link, pressed && styles.pressed]} onPress={() => void Linking.openSettings().catch(() => undefined)} accessibilityRole="button">
          <Text style={styles.linkText}>{"Open HabitAI's settings"}</Text>
          <Ionicons name="open-outline" size={14} color={themeColor('#5B42D8')} />
        </Pressable>
      )}
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, gap: 10, marginBottom: 14 },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  headerIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#EEEAFE', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontSize: 15, fontWeight: '900', color: '#1F1C26' },
  subtitle: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  statusRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },
  statusText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#3B3650' },
  upcoming: { gap: 4, paddingLeft: 26 },
  upcomingTitle: { fontSize: 12, fontWeight: '800', color: '#5C5670' },
  upcomingItem: { fontSize: 12, fontWeight: '600', color: '#3B3650' },
  actions: { gap: 8, marginTop: 4 },
  primary: { minHeight: 44, borderRadius: 13, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  secondary: { minHeight: 44, borderRadius: 13, borderWidth: 1.5, borderColor: '#DCD3F5', flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  secondaryText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.75 },
  message: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#2E7D4F' },
  messageError: { color: '#C2412F' },
  tipsTitle: { fontSize: 12, fontWeight: '900', color: '#5C5670', marginTop: 4 },
  tip: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#625B72' },
  link: { flexDirection: 'row', gap: 6, alignItems: 'center', alignSelf: 'flex-start', minHeight: 32 },
  linkText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
});
