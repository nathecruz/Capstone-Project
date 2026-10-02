import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

export default function SyncActivityScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { habits, preferences, profile, syncAppState } = useAppColorScheme();
  const showAlert = useAppDialog();
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const syncTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const remoteSyncComplete = useRef(false);
  const [spinValue] = useState(() => new Animated.Value(0));
  const syncItems = [
    { title: 'Habits & Progress', detail: `${habits.length} habit${habits.length === 1 ? '' : 's'}`, icon: 'stats-chart-outline' },
    { title: 'Profile Information', detail: profile.fullName || 'Profile not completed', icon: 'person-outline' },
    { title: 'Settings & Preferences', detail: preferences.notificationsEnabled ? 'Notifications enabled' : 'Notifications disabled', icon: 'settings-outline' },
    { title: 'Activity History', detail: `${habits.filter((habit) => habit.done).length} completed today`, icon: 'time-outline' },
  ];

  useEffect(() => {
    if (!syncing && progress >= 100) {
      router.replace('/sync-complete');
    }
  }, [progress, syncing]);

  useEffect(() => {
    Animated.timing(spinValue, {
      toValue: (progress / 100) * 360,
      duration: 350,
      useNativeDriver: true,
    }).start();
  }, [progress, spinValue]);

  useEffect(() => () => {
    if (syncTimer.current) {
      clearInterval(syncTimer.current);
      syncTimer.current = null;
    }
  }, []);

  const syncNow = async () => {
    if (syncing) return;
    setSyncing(true);
    setProgress(0);
    remoteSyncComplete.current = false;
    if (syncTimer.current) clearInterval(syncTimer.current);
    syncTimer.current = setInterval(() => {
      setProgress((current) => {
        if (current >= 100) {
          if (!remoteSyncComplete.current) return 99;
          if (syncTimer.current) {
            clearInterval(syncTimer.current);
            syncTimer.current = null;
          }
          setSyncing(false);
          return 100;
        }
        return Math.min(current + 20, 100);
      });
    }, 350);
    const result = await syncAppState();
    if (!result.ok) {
      if (syncTimer.current) clearInterval(syncTimer.current);
      syncTimer.current = null;
      setSyncing(false);
      setProgress(0);
      showAlert('Sync unavailable', 'The server could not save your latest app state. Check your connection and try again.');
      return;
    }
    remoteSyncComplete.current = true;
    setProgress(100);
    setSyncing(false);
    if (syncTimer.current) {
      clearInterval(syncTimer.current);
      syncTimer.current = null;
    }
    try {
      await Share.share({ title: 'HabitAI backup', message: JSON.stringify(result.state, null, 2) });
    } catch {
      // The remote backup is already saved even if the device share sheet is dismissed.
    }
  };

  return (
    <>
      <StatusBar style="dark" />
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={21} color={themeColor('#292633')} /></Pressable>
              <Text style={styles.headerTitle}>Sync Activity</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.progressCard}>
              <View style={styles.progressCopy}><Text style={styles.progressTitle}>{syncing ? 'Preparing Local Backup...' : progress >= 100 ? 'Backup Ready' : 'Ready to prepare'}</Text><Text style={styles.progressSubtitle}>{syncing ? 'Collecting your current app data' : progress >= 100 ? 'Your local data is ready to export' : 'Prepare a local snapshot of your data'}</Text></View>
              <View style={styles.progressRingOuter}>
                <Animated.View
                  style={[
                    styles.progressRing,
                    {
                      transform: [{ rotate: spinValue.interpolate({ inputRange: [0, 360], outputRange: ['0deg', '360deg'] }) }],
                    },
                  ]}
                />
                <View style={styles.progressRingInner}><Text style={styles.progressValue}>{progress}%</Text></View>
              </View>
            </View>

            <View style={styles.itemsCard}>
              {syncItems.map((item, index) => {
                const itemComplete = progress >= (index + 1) * (100 / syncItems.length);
                const itemActive = !itemComplete && progress >= index * (100 / syncItems.length);
                const itemSubtitle = itemComplete ? item.detail : itemActive && syncing ? 'Preparing...' : 'Waiting...';
                const itemColor = themeColor(itemComplete ? '#48A66A' : itemActive ? '#5B42D8' : '#8B8495');
                return (
                <View key={item.title} style={[styles.syncRow, index < syncItems.length - 1 && styles.rowBorder]}>
                  <View style={[styles.itemIcon, { backgroundColor: `${itemColor}20` }]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={17} color={itemColor} /></View>
                  <View style={styles.itemCopy}><Text style={styles.itemTitle}>{item.title}</Text><Text style={[styles.itemSubtitle, { color: itemColor }]}>{itemSubtitle}</Text></View>
                  {itemComplete ? <View style={styles.doneIcon}><Ionicons name="checkmark" size={13} color={themeColor('#FFFFFF')} /></View> : itemActive && syncing ? <View style={styles.spinner}><Ionicons name="sync-outline" size={16} color={themeColor('#5B42D8')} /></View> : <Ionicons name="time-outline" size={18} color={themeColor('#B1ABB8')} />}
                </View>
                );
              })}
            </View>

            <View style={styles.tipCard}><Ionicons name="information-circle" size={18} color={themeColor('#5B42D8')} /><Text style={styles.tipText}>Keep the app open on both devices for a successful sync.</Text></View>
            <Pressable style={styles.syncButton} onPress={syncNow}><Ionicons name="sync-outline" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.buttonText}>{syncing ? 'Syncing...' : progress >= 100 ? 'Sync Again' : 'Start Sync'}</Text></Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 },
  content: { paddingBottom: 110 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 18, fontWeight: '800', color: '#24212D' },
  progressCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  progressCopy: { flex: 1 },
  progressTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' },
  progressSubtitle: { fontSize: 10, color: '#827C8C', fontWeight: '600', marginTop: 5 },
  progressRingOuter: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  progressRing: {
    position: 'absolute',
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 7,
    borderColor: 'transparent',
    borderTopColor: '#5B42D8',
    borderRightColor: '#5B42D8',
    borderBottomColor: '#E9E2FF',
    borderLeftColor: '#E9E2FF',
  },
  progressRingInner: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#F7F3FF', alignItems: 'center', justifyContent: 'center' },
  progressValue: { fontSize: 13, color: '#302B3B', fontWeight: '800' },
  itemsCard: { backgroundColor: '#FFFFFF', borderRadius: 20, paddingHorizontal: 15, marginBottom: 14 },
  syncRow: { flexDirection: 'row', alignItems: 'center', minHeight: 60, paddingVertical: 9 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  itemIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  itemCopy: { flex: 1 },
  itemTitle: { fontSize: 12, fontWeight: '800', color: '#393440' },
  itemSubtitle: { fontSize: 9, fontWeight: '700', marginTop: 3 },
  doneIcon: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#48A66A', alignItems: 'center', justifyContent: 'center' },
  spinner: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center' },
  tipCard: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#F0EAFF', borderRadius: 15, padding: 13, marginBottom: 16 },
  tipText: { flex: 1, fontSize: 10, lineHeight: 15, color: '#655F70', fontWeight: '600' },
  syncButton: { height: 45, borderRadius: 12, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  buttonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});

