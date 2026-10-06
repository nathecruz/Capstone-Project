// "Install HabitAI" for people using the web app in a browser: an Install button where the browser
// offers one (Android Chrome, Edge, desktop Chrome), and the Add to Home Screen steps on iPhone
// and iPad (and on browsers without the button). Hidden once HabitAI runs as an installed app.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { promptInstall, useInstallApp, type InstallPlatform } from '@/utils/install-app';

const LATER_KEY = 'habitai:install-later';
const LATER_DAYS = 7;

function hiddenUntil() {
  try {
    return Number(window.localStorage.getItem(LATER_KEY)) || 0;
  } catch {
    return 0;
  }
}

function hideForAWeek() {
  try {
    window.localStorage.setItem(LATER_KEY, String(Date.now() + LATER_DAYS * 24 * 60 * 60 * 1000));
  } catch {
    // Private window: the card simply comes back next time.
  }
}

type Step = { icon: keyof typeof Ionicons.glyphMap; title: string; text?: string };

function stepsFor(platform: InstallPlatform, inAppBrowser: boolean): Step[] {
  const openFirst: Step[] = inAppBrowser ? [{
    icon: 'open-outline',
    title: platform === 'ios' ? 'Open this page in Safari' : 'Open this page in Chrome',
    text: 'Apps like Messenger and Facebook cannot install websites. Tap ••• and choose "Open in browser", or copy the link below and paste it in the browser.',
  }] : [];
  if (platform === 'ios') {
    return [
      ...openFirst,
      { icon: 'share-outline', title: 'Tap Share', text: 'The square with an arrow, at the bottom of Safari (in Chrome, at the top right). On newer iPhones, tap ••• first.' },
      { icon: 'add-circle-outline', title: 'Tap "Add to Home Screen"', text: 'Scroll down the list if you do not see it. Keep "Open as Web App" on.' },
      { icon: 'checkmark-circle-outline', title: 'Tap Add', text: 'The HabitAI icon appears on your Home Screen.' },
      { icon: 'notifications-outline', title: 'Open HabitAI from the Home Screen', text: 'Sign in there and turn on reminders. On iPhone and iPad, reminders work only in the Home Screen app.' },
    ];
  }
  if (platform === 'android') {
    return [
      ...openFirst,
      { icon: 'ellipsis-vertical', title: 'Tap the menu ⋮', text: 'At the top right of Chrome (in other browsers, their menu button).' },
      { icon: 'download-outline', title: 'Tap "Install app" or "Add to Home screen"' },
      { icon: 'checkmark-circle-outline', title: 'Tap Install', text: 'HabitAI then opens from your home screen like any app. If it is already installed, open it from there.' },
    ];
  }
  return [
    { icon: 'download-outline', title: 'Chrome or Edge', text: 'Click the install icon at the right end of the address bar, or open the menu and choose "Install HabitAI".' },
    { icon: 'logo-apple', title: 'Safari on a Mac', text: 'Choose File, then "Add to Dock".' },
  ];
}

/** The steps to install HabitAI on this device, in a sheet (`light` on the sign-in screens). */
export function InstallStepsSheet({ visible, onClose, light = false }: { visible: boolean; onClose: () => void; light?: boolean }) {
  const themed = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const styles = light ? lightSheetStyles : themed;
  const accent = light ? '#5B42D8' : themeColor('#5B42D8');
  const { platform, inAppBrowser, canPrompt } = useInstallApp();
  const [copied, setCopied] = React.useState(false);
  const steps = stepsFor(platform, inAppBrowser);
  const title = platform === 'ios' ? 'Add HabitAI to your Home Screen' : platform === 'android' ? 'Install HabitAI on your phone' : 'Install HabitAI on this computer';

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.origin);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const installNow = async () => {
    if ((await promptInstall()) === 'accepted') onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close install steps">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetIcon}><Ionicons name="phone-portrait" size={22} color="#FFFFFF" /></View>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>{title}</Text>
                <Text style={styles.sheetSubtitle}>Use HabitAI like any app: one tap from your home screen, full screen, with reminders.</Text>
              </View>
            </View>
            {steps.map((step, index) => (
              <View key={step.title} style={styles.step}>
                <View style={styles.stepNumber}><Text style={styles.stepNumberText}>{index + 1}</Text></View>
                <View style={styles.stepCopy}>
                  <View style={styles.stepTitleRow}>
                    <Ionicons name={step.icon} size={17} color={accent} />
                    <Text style={styles.stepTitle}>{step.title}</Text>
                  </View>
                  {step.text ? <Text style={styles.stepText}>{step.text}</Text> : null}
                </View>
              </View>
            ))}
            <View style={styles.sheetActions}>
              {canPrompt ? (
                <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={installNow} accessibilityRole="button">
                  <Text style={styles.primaryText}>Install now</Text>
                </Pressable>
              ) : inAppBrowser ? (
                <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={copyLink} accessibilityRole="button">
                  <Text style={styles.primaryText}>{copied ? 'Link copied' : 'Copy link'}</Text>
                </Pressable>
              ) : null}
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
                <Text style={styles.secondaryText}>Done</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Offers to install HabitAI while it is used in a browser tab: `auth` under the sign-in and
 * register forms, `home` as a banner on Home. "Not now" hides it on this device for a week.
 */
export function InstallAppCard({ variant }: { variant: 'auth' | 'home' }) {
  const themed = useThemedStyles(themedStyles);
  const { platform, installed, canPrompt } = useInstallApp();
  const [hidden, setHidden] = React.useState(() => Platform.OS === 'web' && hiddenUntil() > Date.now());
  const [stepsOpen, setStepsOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  if (Platform.OS !== 'web' || installed || hidden) return null;
  // On a computer, offer it only where the browser can install it directly.
  if (platform === 'desktop' && !canPrompt) return null;

  const install = async () => {
    if (!canPrompt) {
      setStepsOpen(true);
      return;
    }
    setBusy(true);
    const outcome = await promptInstall();
    setBusy(false);
    if (outcome === 'unavailable') setStepsOpen(true);
  };
  const later = () => {
    hideForAWeek();
    setHidden(true);
  };

  const title = platform === 'desktop' ? 'Install HabitAI on this computer' : platform === 'ios' ? 'Add HabitAI to your Home Screen' : 'Install HabitAI on your phone';
  const text = platform === 'ios'
    ? 'Open it from your Home Screen like any app. On iPhone, habit reminders work only in the Home Screen app.'
    : 'Open it from your home screen like any app, full screen, with your habit reminders.';
  const auth = variant === 'auth';
  const styles = auth ? authStyles : themed;

  return (
    <View style={[styles.card, auth && authStyles.cardSpacing]} accessibilityRole="summary">
      <View style={styles.row}>
        <View style={styles.icon}><Ionicons name={platform === 'desktop' ? 'desktop-outline' : 'phone-portrait-outline'} size={19} color="#FFFFFF" /></View>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.text}>{text}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed, busy && styles.busy]} onPress={install} disabled={busy} accessibilityRole="button" accessibilityLabel={canPrompt ? 'Install HabitAI' : 'How to install HabitAI'}>
          <Ionicons name={canPrompt ? 'download-outline' : 'help-circle-outline'} size={16} color="#FFFFFF" />
          <Text style={styles.buttonText}>{canPrompt ? (busy ? 'Opening…' : 'Install') : 'How to install'}</Text>
        </Pressable>
        <Pressable style={({ pressed }) => [styles.later, pressed && styles.pressed]} onPress={later} accessibilityRole="button" accessibilityLabel="Hide this for a week" hitSlop={6}>
          <Text style={styles.laterText}>Not now</Text>
        </Pressable>
      </View>
      <InstallStepsSheet visible={stepsOpen} onClose={() => setStepsOpen(false)} light={auth} />
    </View>
  );
}

const cardBase = {
  card: { padding: 14, borderRadius: 18, backgroundColor: '#F1EDFF', borderWidth: 1, borderColor: '#DCD3F7' },
  row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: '#5B42D8' },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, fontWeight: '800' as const, color: '#2F2D3C' },
  text: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '600' as const, color: '#5F596D' },
  actions: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 14, marginTop: 12, marginLeft: 48 },
  button: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, minHeight: 38, paddingHorizontal: 16, borderRadius: 12, backgroundColor: '#5B42D8' },
  buttonText: { fontSize: 13, fontWeight: '800' as const, color: '#FFFFFF' },
  busy: { opacity: 0.7 },
  later: { minHeight: 38, justifyContent: 'center' as const },
  laterText: { fontSize: 13, fontWeight: '800' as const, color: '#5B42D8' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
};

const sheetBase = {
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 18, backgroundColor: 'rgba(20, 14, 40, 0.55)' },
  sheet: { width: '100%', maxWidth: 440, maxHeight: '88%', borderRadius: 24, backgroundColor: '#FFFFFF' },
  sheetContent: { padding: 20, gap: 14 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 4 },
  sheetIcon: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  sheetHeaderCopy: { flex: 1, minWidth: 0 },
  sheetTitle: { fontSize: 18, fontWeight: '900', color: '#1F1C26' },
  sheetSubtitle: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#6A6573' },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFEBFD' },
  stepNumberText: { fontSize: 13, fontWeight: '900', color: '#4A33C2' },
  stepCopy: { flex: 1, minWidth: 0, paddingTop: 3 },
  stepTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepTitle: { flexShrink: 1, fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  stepText: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#5F596D' },
  sheetActions: { gap: 10, marginTop: 6 },
  primary: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  secondary: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EDFF' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#4A33C2' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
} as const;

// The sign-in screens stay light, like the rest of their design.
const authStyles = StyleSheet.create({ ...cardBase, cardSpacing: { marginTop: 16 } });
const lightSheetStyles = StyleSheet.create(sheetBase);
const themedStyles = createThemedStyles({ ...cardBase, ...sheetBase });
