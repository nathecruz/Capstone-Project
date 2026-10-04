// A new version of the web app: an open tab checks now and then whether a new version was
// published (the page names a new script) and updates itself, so nobody has to refresh. A hidden
// tab updates right away; a visible one says so first and waits until the student pauses (not
// typing, and no taps or keys for a few seconds), so a half-filled form is not lost.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';

const CHECK_EVERY_MS = 60_000;
const COUNTDOWN_SECONDS = 5;
/** Seconds without a tap or a key before the update may start. */
const IDLE_SECONDS = 8;
const ENTRY_SCRIPT = /\/_expo\/static\/js\/web\/entry-[^"']+\.js/;

/** The app script this tab is running (null on the development server, which has none). */
function runningEntry() {
  if (typeof document === 'undefined') return null;
  const script = Array.from(document.scripts).find((item) => ENTRY_SCRIPT.test(item.getAttribute('src') ?? ''));
  return script?.getAttribute('src')?.match(ENTRY_SCRIPT)?.[0] ?? null;
}

/** The app script the site serves now. */
async function publishedEntry() {
  try {
    const response = await fetch(`/?update-check=${Date.now()}`, { cache: 'no-store' });
    return (await response.text()).match(ENTRY_SCRIPT)?.[0] ?? null;
  } catch {
    return null;
  }
}

const isTyping = () => {
  const element = typeof document === 'undefined' ? null : document.activeElement as HTMLElement | null;
  return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
};

export function UpdateBanner() {
  const styles = useThemedStyles(themedStyles);
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [seconds, setSeconds] = useState(COUNTDOWN_SECONDS);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const running = runningEntry();
    if (!running) return;
    let stopped = false;
    const check = async () => {
      const latest = await publishedEntry();
      if (stopped || !latest || latest === running) return;
      if (document.hidden) window.location.reload();
      else setReady(true);
    };
    const checkWhenVisible = () => {
      if (!document.hidden) void check();
    };
    const timer = setInterval(() => void check(), CHECK_EVERY_MS);
    document.addEventListener('visibilitychange', checkWhenVisible);
    window.addEventListener('online', checkWhenVisible);
    return () => {
      stopped = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', checkWhenVisible);
      window.removeEventListener('online', checkWhenVisible);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let left = COUNTDOWN_SECONDS;
    let lastActive = Date.now();
    const active = () => {
      lastActive = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;
    events.forEach((name) => window.addEventListener(name, active, { passive: true }));
    const timer = setInterval(() => {
      const busy = isTyping() || Date.now() - lastActive < IDLE_SECONDS * 1000;
      setWaiting(busy);
      if (busy) return;
      left -= 1;
      setSeconds(left);
      if (left <= 0) window.location.reload();
    }, 1000);
    return () => {
      clearInterval(timer);
      events.forEach((name) => window.removeEventListener(name, active));
    };
  }, [ready]);

  if (!ready) return null;
  return (
    <View style={[styles.banner, { top: 12 + insets.top }]} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <View style={styles.icon}><Ionicons name="sparkles" size={18} color="#FFFFFF" /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>HabitAI was updated</Text>
        <Text style={styles.text}>{waiting ? 'Updating when you take a short pause…' : `Getting the new version in ${Math.max(0, seconds)}s…`}</Text>
      </View>
      <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => window.location.reload()} accessibilityRole="button">
        <Text style={styles.buttonText}>Update now</Text>
      </Pressable>
    </View>
  );
}

const themedStyles = createThemedStyles({
  banner: { position: 'absolute', left: 16, right: 16, alignSelf: 'center', maxWidth: 520, marginHorizontal: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: '#2C2564', shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12, zIndex: 60 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  text: { marginTop: 1, fontSize: 12, fontWeight: '600', color: '#D6D0F5' },
  button: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  buttonText: { fontSize: 13, fontWeight: '900', color: '#2C2564' },
  pressed: { opacity: 0.85 },
}, {
  banner: { position: 'absolute', left: 16, right: 16, alignSelf: 'center', maxWidth: 520, marginHorizontal: 'auto', flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: '#2C2564', shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12, zIndex: 60 },
  button: { minHeight: 38, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  buttonText: { fontSize: 13, fontWeight: '900', color: '#2C2564' },
});
