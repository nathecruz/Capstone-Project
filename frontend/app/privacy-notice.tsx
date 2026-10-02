import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { acceptPrivacyNotice } from '@/authentication';
import { AppDialog } from '@/components/ui/app-dialog';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

// Privacy Notice under the Data Privacy Act of 2012 (RA 10173). Opened from the sign-up
// form, from Settings, and (with ?accept=1) for accounts that have not accepted it yet.
const SECTIONS: { title: string; items: string[] }[] = [
  {
    title: 'Who we are',
    items: [
      'HabitAI is a habit-tracking app developed as a capstone project for PSAU students. The project team acts as the personal information controller for the data described here.',
    ],
  },
  {
    title: 'What we collect',
    items: [
      'Account details: full name, username, email address, date of birth, gender, region, and your password (stored only as a secure hash).',
      'App data you create: habits, check-ins, streaks, goals, reminders, preferences, points, tokens and rewards.',
      'Usage and security data: sign-in date, time and device name, and push-notification subscriptions for your devices.',
      'Support data: issue reports, feature suggestions, and any screenshot or video you attach.',
    ],
  },
  {
    title: 'Why we use it',
    items: [
      'To run the app: sign you in, sync your data across devices, send reminders and verification codes, and show progress, rewards and leaderboards.',
      'To give AI guidance: when you ask the AI Coach, assistants or goal planner, your question and a summary of your habits and check-ins (without your name or email) are sent to Google Gemini to generate the answer.',
      'To keep accounts secure and to answer support requests.',
      'For research on the app\'s effect on student habits: PSAU faculty only see aggregated, anonymized statistics. Groups too small to hide individuals are combined or withheld.',
    ],
  },
  {
    title: 'Who can see it',
    items: [
      'You can see all of your data in the app.',
      'Other students only see your first name and last initial on leaderboards, and you can hide yourself in Settings & Preferences.',
      'Authorized HabitAI administrators can view account and support details to manage accounts and help you. Their actions are logged.',
      'Service providers that host or process data for us: Neon (database), Render/Vercel (app hosting), Google (Gemini AI and email delivery). We do not sell your data.',
    ],
  },
  {
    title: 'How long we keep it',
    items: [
      'Your data is kept while your account exists. Deleting your account (Settings & Preferences > Delete Account) permanently removes your profile, habits, check-ins, goals, notifications and reports.',
      'Verification and password-reset codes expire within 15 minutes. Old copies of your synced app data are trimmed automatically.',
    ],
  },
  {
    title: 'Your rights',
    items: [
      'Under the Data Privacy Act you have the right to be informed, to access and correct your data, to object, to have your data erased or blocked, to data portability, and to file a complaint with the National Privacy Commission (privacy.gov.ph).',
      'You can edit your profile any time, and contact us through Help & Support > Report an Issue for any other request.',
    ],
  },
  {
    title: 'How we protect it',
    items: [
      'Encrypted connections (HTTPS), hashed passwords and sign-in tokens, limits on repeated attempts, and access restricted by role.',
    ],
  },
];

export default function PrivacyNoticeScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { accept } = useLocalSearchParams<{ accept?: string }>();
  const mustAccept = accept === '1';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agree = async () => {
    if (busy) return;
    setBusy(true);
    const result = await acceptPrivacyNotice();
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.replace('/(tabs)');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        {!mustAccept && (
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/login'))} style={styles.back} accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={22} color={themeColor('#1d1b26')} />
          </Pressable>
        )}
        <Text style={styles.headerTitle}>Privacy Notice</Text>
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {mustAccept && (
          <View style={styles.banner}>
            <Ionicons name="shield-checkmark-outline" size={20} color={themeColor('#5B42D8')} />
            <Text style={styles.bannerText}>We updated how HabitAI explains the data it uses. Please review and accept this notice to continue.</Text>
          </View>
        )}
        <Text style={styles.updated}>Effective September 30, 2026</Text>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.items.map((item) => (
              <View key={item} style={styles.itemRow}>
                <View style={styles.bullet} />
                <Text style={styles.itemText}>{item}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
      {mustAccept && (
        <View style={styles.footer}>
          <Pressable style={[styles.primaryButton, busy && styles.disabled]} onPress={() => void agree()} disabled={busy} accessibilityRole="button">
            {busy && <ActivityIndicator size="small" color={themeColor('#FFFFFF')} />}
            <Text style={styles.primaryText}>I agree and continue</Text>
          </Pressable>
          <Pressable onPress={() => router.replace('/logout')} style={styles.signOut}>
            <Text style={styles.signOutText}>I do not agree, sign me out</Text>
          </Pressable>
        </View>
      )}
      <AppDialog visible={error !== null} title="Something went wrong" message={error ?? ''} variant="error" onClose={() => setError(null)} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  safeArea: { flex: 1, backgroundColor: '#f4f7ff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  back: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#1d1b26' },
  content: { paddingHorizontal: 20, paddingBottom: 32, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  banner: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: '#EEEAFF', borderRadius: 14, padding: 14 },
  bannerText: { flex: 1, color: '#3B2F87', fontSize: 13.5, lineHeight: 20 },
  updated: { color: '#777282', fontSize: 12 },
  section: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, gap: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#1d1b26' },
  itemRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  bullet: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#5B42D8', marginTop: 8 },
  itemText: { flex: 1, color: '#3B3F4C', fontSize: 14, lineHeight: 21 },
  footer: { padding: 16, gap: 8, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: '#E6E8F0' },
  primaryButton: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8', borderRadius: 14, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.6 },
  signOut: { alignSelf: 'center', paddingVertical: 6 },
  signOutText: { color: '#777282', fontSize: 13, fontWeight: '600' },
});
