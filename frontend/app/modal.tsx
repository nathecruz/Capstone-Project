import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

export default function ModalScreen() {
  const { isDarkMode, habits } = useAppColorScheme();
  const actions = [
    { title: 'Create a habit', subtitle: 'Start tracking something new', icon: 'add-circle-outline', route: '/add' },
    { title: 'Review goals', subtitle: `${habits.length} habit${habits.length === 1 ? '' : 's'} in your routine`, icon: 'flag-outline', route: '/goals' },
    { title: 'Open settings', subtitle: 'Manage your preferences', icon: 'settings-outline', route: '/settings-preferences' },
  ] as const;

  return <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}><View style={[styles.container, isDarkMode && styles.darkCard]}><View style={styles.handle} /><View style={styles.header}><View><Text style={[styles.eyebrow, isDarkMode && styles.darkMutedText]}>QUICK ACTIONS</Text><Text style={[styles.title, isDarkMode && styles.darkText]}>What would you like to do?</Text></View><Pressable style={styles.closeButton} onPress={() => router.back()} accessibilityLabel="Close quick actions"><Ionicons name="close" size={20} color="#6A6580" /></Pressable></View>{actions.map((action) => <Pressable key={action.title} style={[styles.actionRow, isDarkMode && styles.darkActionRow]} onPress={() => router.replace(action.route)}><View style={styles.actionIcon}><Ionicons name={action.icon} size={21} color="#5B42D8" /></View><View style={styles.actionCopy}><Text style={[styles.actionTitle, isDarkMode && styles.darkText]}>{action.title}</Text><Text style={[styles.actionSubtitle, isDarkMode && styles.darkMutedText]}>{action.subtitle}</Text></View><Ionicons name="chevron-forward" size={18} color="#8A8492" /></Pressable>)}</View></SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(20, 16, 32, 0.5)', justifyContent: 'flex-end' },
  darkScreen: { backgroundColor: 'rgba(10, 8, 16, 0.65)' },
  container: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 26, borderTopRightRadius: 26, padding: 20 },
  darkCard: { backgroundColor: '#1D1A24' },
  handle: { alignSelf: 'center', width: 48, height: 5, borderRadius: 3, backgroundColor: '#C8C4D1', marginBottom: 17 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  eyebrow: { color: '#8A8492', fontSize: 10, fontWeight: '900', letterSpacing: 1 },
  title: { color: '#24212D', fontSize: 20, fontWeight: '900', marginTop: 4 },
  darkText: { color: '#F2EFF8' }, darkMutedText: { color: '#AAA4B7' },
  closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F0EFF5', alignItems: 'center', justifyContent: 'center' },
  actionRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#ECE9F3', borderRadius: 15, paddingHorizontal: 12, marginBottom: 10 },
  darkActionRow: { borderColor: '#3B3647' },
  actionIcon: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F0ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  actionCopy: { flex: 1 }, actionTitle: { color: '#302B3B', fontSize: 13, fontWeight: '900' }, actionSubtitle: { color: '#827C8C', fontSize: 11, fontWeight: '600', marginTop: 3 },
});
