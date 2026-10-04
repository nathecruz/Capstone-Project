// Cookies and storage: HabitAI keeps only what it needs on this device (no ads, analytics or
// tracking cookies). The web shows a notice once; "What is stored" lists each item and why.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const NOTICE_KEY = 'habitai_storage_notice';

/** What HabitAI keeps on this device, and for how long. */
export const STORED_ON_DEVICE = [
  { icon: 'key-outline', title: 'Sign-in session', detail: 'Keeps you signed in. On the web it lasts for this browser tab only and is deleted when you sign out.' },
  { icon: 'person-circle-outline', title: 'Account and settings', detail: 'A copy of your habits, theme and preferences, so the app opens quickly. Removed from this device when you sign out.' },
  { icon: 'cloud-offline-outline', title: 'Habits not yet synced', detail: 'Check-ins made offline wait here until they reach the server, even after you sign out.' },
  { icon: 'mail-outline', title: 'Remembered email', detail: 'Only if you ask HabitAI to remember it on the sign-in screen.' },
  { icon: 'notifications-outline', title: 'Reminders', detail: 'Only if you turn reminders on: lets this browser show habit reminders.' },
] as const;

function readNoticeSeen() {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(NOTICE_KEY) === '1';
  } catch {
    return false;
  }
}

/** The list of what is stored, in a sheet. Render it only while it is open. */
export function StorageDetailsSheet({ onClose }: { onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close cookies and storage">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
            <View style={styles.sheetHeader}>
              <View style={styles.shield}><Ionicons name="shield-checkmark" size={24} color="#FFFFFF" /></View>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetTitle}>Cookies and storage</Text>
                <Text style={styles.sheetSubtitle}>Only what HabitAI needs to work.</Text>
              </View>
            </View>
            <View style={styles.noTracking}>
              <Ionicons name="ban-outline" size={18} color={themeColor('#2E7D50')} />
              <Text style={styles.noTrackingText}>No advertising, analytics or tracking cookies, and nothing is shared with other sites.</Text>
            </View>
            {STORED_ON_DEVICE.map((item) => (
              <View key={item.title} style={styles.item}>
                <View style={styles.itemIcon}><Ionicons name={item.icon} size={18} color={themeColor('#5B42D8')} /></View>
                <View style={styles.itemCopy}>
                  <Text style={styles.itemTitle}>{item.title}</Text>
                  <Text style={styles.itemDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.footnote}>Your habits and account are kept on HabitAI&apos;s server so they follow you to other devices. You can download or delete them in Settings → Privacy &amp; Data.</Text>
            <View style={styles.sheetActions}>
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => { onClose(); router.push('/privacy-notice'); }} accessibilityRole="button">
                <Text style={styles.secondaryText}>Privacy Notice</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
                <Text style={styles.primaryText}>Done</Text>
              </Pressable>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Web: a one-time notice about cookies and storage, at the bottom of the screen. */
export function StorageNotice() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const insets = useSafeAreaInsets();
  const [hidden, setHidden] = useState(() => Platform.OS !== 'web' || readNoticeSeen());
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (hidden) return null;
  const accept = () => {
    try {
      window.localStorage.setItem(NOTICE_KEY, '1');
    } catch {
      // Storage blocked (private mode): the notice simply shows again next time.
    }
    setHidden(true);
  };
  return (
    <>
      <View style={[styles.banner, { bottom: 16 + insets.bottom }]} accessibilityRole="alert" accessibilityLabel="Cookies and privacy notice">
        <View style={styles.bannerTop}>
          <View style={styles.bannerIcon}><Ionicons name="shield-checkmark-outline" size={20} color={themeColor('#5B42D8')} /></View>
          <View style={styles.bannerCopy}>
            <Text style={styles.bannerTitle}>Your privacy</Text>
            <Text style={styles.bannerText}>HabitAI uses only essential storage to keep you signed in and remember your settings. No ads or tracking cookies.</Text>
          </View>
        </View>
        <View style={styles.bannerActions}>
          <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => setDetailsOpen(true)} accessibilityRole="button">
            <Text style={styles.secondaryText}>What is stored</Text>
          </Pressable>
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={accept} accessibilityRole="button">
            <Text style={styles.primaryText}>Got it</Text>
          </Pressable>
        </View>
      </View>
      {detailsOpen && <StorageDetailsSheet onClose={() => setDetailsOpen(false)} />}
    </>
  );
}

const themedStyles = createThemedStyles({
  pressed: { opacity: 0.85 },
  banner: { position: 'absolute', left: 16, right: 16, alignSelf: 'center', maxWidth: 520, marginHorizontal: 'auto', gap: 12, padding: 16, borderRadius: 22, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E2F5', shadowColor: '#201444', shadowOpacity: 0.18, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 12, zIndex: 50 },
  bannerTop: { flexDirection: 'row', gap: 12 },
  bannerIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE9FF' },
  bannerCopy: { flex: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '900', color: '#1F1C26' },
  bannerText: { marginTop: 2, fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#5E5868' },
  bannerActions: { flexDirection: 'row', gap: 10 },
  secondary: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EEF7' },
  secondaryText: { fontSize: 14, fontWeight: '800', color: '#3B3746' },
  primary: { flex: 1, minHeight: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.5)', justifyContent: 'center', alignItems: 'center', padding: 18 },
  sheet: { width: '100%', maxWidth: 440, maxHeight: '90%', backgroundColor: '#FFFFFF', borderRadius: 26, overflow: 'hidden' },
  sheetContent: { padding: 20, gap: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shield: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  sheetHeaderCopy: { flex: 1 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: '#1F1C26' },
  sheetSubtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#6A6573' },
  noTracking: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 14, backgroundColor: '#E8F6EE' },
  noTrackingText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#235C3D' },
  item: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  itemIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EDFF' },
  itemCopy: { flex: 1 },
  itemTitle: { fontSize: 14, fontWeight: '800', color: '#1F1C26' },
  itemDetail: { marginTop: 2, fontSize: 13, lineHeight: 18, fontWeight: '500', color: '#5E5868' },
  footnote: { fontSize: 12, lineHeight: 17, color: '#7A7E8A' },
  sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
});
