import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

export default function SyncCompleteScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { habits } = useAppColorScheme();
  const syncDate = new Date();
  const details = [
    { label: 'Date', value: syncDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), icon: 'calendar-outline' },
    { label: 'Time', value: syncDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }), icon: 'time-outline' },
    { label: 'Source', value: 'This device', icon: 'phone-portrait-outline' },
    { label: 'Data prepared', value: `${habits.length} habit${habits.length === 1 ? '' : 's'} included`, icon: 'server-outline' },
  ];
  return (
    <>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={21} color={themeColor('#292633')} /></Pressable>
              <Text style={styles.headerTitle}>Local Backup Ready</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.successArea}>
              <View style={styles.confetti}><Text style={[styles.confettiText, styles.confettiOne]}>+</Text><Text style={[styles.confettiText, styles.confettiTwo]}>*</Text><Text style={[styles.confettiText, styles.confettiThree]}>+</Text><Text style={[styles.confettiText, styles.confettiFour]}>*</Text><Text style={[styles.confettiText, styles.confettiFive]}>+</Text></View>
              <View style={styles.cloud}><Ionicons name="cloud" size={62} color={themeColor('#48B66E')} /><View style={styles.checkBadge}><Ionicons name="checkmark" size={20} color={themeColor('#FFFFFF')} /></View></View>
              <Text style={styles.successTitle}>All Set!</Text>
              <Text style={styles.successSubtitle}>Your local data snapshot is ready{`\n`}for export or review.</Text>
            </View>

            <View style={styles.detailsCard}>
              <Text style={styles.detailsTitle}>Last Sync Details</Text>
              {details.map((detail) => (
                <View key={detail.label} style={styles.detailRow}><Ionicons name={detail.icon as keyof typeof Ionicons.glyphMap} size={16} color={themeColor('#6C647A')} /><Text style={styles.detailText}>{detail.value}</Text></View>
              ))}
            </View>

            <Pressable style={styles.doneButton} onPress={() => router.replace('/')}><Text style={styles.doneText}>Done</Text></Pressable>
            <Pressable style={styles.historyButton} onPress={() => router.replace('/sync-activity')}><Text style={styles.historyText}>View Sync History</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 },
  content: { flexGrow: 1, paddingBottom: 110 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#24212D' },
  successArea: { alignItems: 'center', paddingVertical: 22, marginBottom: 12 },
  cloud: { width: 128, height: 100, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  checkBadge: { position: 'absolute', width: 38, height: 38, borderRadius: 19, backgroundColor: '#48B66E', borderWidth: 3, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 22, fontWeight: '800', color: '#302B3B', marginTop: 8 },
  successSubtitle: { fontSize: 11, lineHeight: 17, color: '#777282', fontWeight: '600', textAlign: 'center', marginTop: 6 },
  confetti: { position: 'absolute', width: '100%', height: 100, top: 4 },
  confettiText: { position: 'absolute', fontSize: 18, fontWeight: '800' },
  confettiOne: { left: 34, top: 20, color: '#E7A72F' },
  confettiTwo: { left: 10, top: 52, color: '#5B42D8' },
  confettiThree: { right: 34, top: 18, color: '#48A66A' },
  confettiFour: { right: 8, top: 55, color: '#E7A72F' },
  confettiFive: { left: 72, top: 2, color: '#5B42D8' },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, marginBottom: 16 },
  detailsTitle: { fontSize: 13, fontWeight: '800', color: '#302B3B', marginBottom: 10 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 },
  detailText: { fontSize: 11, color: '#625C6E', fontWeight: '600' },
  doneButton: { height: 45, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  doneText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
  historyButton: { alignItems: 'center', paddingVertical: 15 },
  historyText: { color: '#5B42D8', fontSize: 11, fontWeight: '800' },
});

