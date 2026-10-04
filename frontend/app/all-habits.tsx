import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FACULTY_HABIT_IDEAS } from '@/constants/faculty';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { getLocalDateKey, isHabitMissedYesterday } from '@/utils/habit-visibility';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { habitIcon } from '@/utils/habit-icons';

const HABIT_GROUPS = [
  { name: 'Health', description: 'Build habits for a stronger body and healthier life.', icon: 'heart', color: '#4B9FE8', items: ['Drink Water', 'Exercise / Workout', 'Eat Healthy', 'Sleep Early', 'Walk 10,000 Steps', 'No Sugar / Junk Food', 'Meditate', 'Stretch'] },
  { name: 'Mind', description: 'Strengthen your mental wellness and mindfulness.', icon: 'bulb', color: '#7865D8', items: ['Read a Book', 'Gratitude', 'Journal', 'Meditate', 'Mindful Breathing', 'Digital Detox', 'Positive Thinking', 'Affirmations'] },
  { name: 'Productivity', description: 'Get more done and build productive routines.', icon: 'locate', color: '#4B82D8', items: ['Plan Your Day', 'Do Homework', 'Take Notes', 'Focus Time', 'Manage Time', 'Track Habits', 'Prepare Materials', 'Give Feedback'] },
  { name: 'Lifestyle', description: 'Simple habits for a better everyday life.', icon: 'leaf', color: '#42A477', items: ['Save Money', 'Declutter Space', 'Practice Gratitude', 'Help Others', 'Walk More', 'No Plastic', 'Eat Mindfully', 'Screen Time Limit'] },
  { name: 'Academics', description: 'Build habits that support your learning journey.', icon: 'school', color: '#5B42D8', items: ['Study / Revise', 'Attend Classes', 'Plan Lessons', 'Grade Assignments'] },
  { name: 'Other', description: 'More habits to fit your unique goals.', icon: 'ellipsis-horizontal', color: '#E59B35', items: ['Learn Something New', 'Be Positive', 'More Habits'] },
];

// Faculty mode shows habits for a teacher's day first.
const FACULTY_GROUP = { name: 'For Faculty', description: 'Teaching, research, students and your own well-being.', icon: 'briefcase', color: '#5B42D8', items: FACULTY_HABIT_IDEAS };


function formatDateLabel(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

export default function AllHabitsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { isDarkMode, habits, isFaculty } = useAppColorScheme();
  const groups = useMemo(() => (isFaculty ? [FACULTY_GROUP, ...HABIT_GROUPS] : HABIT_GROUPS), [isFaculty]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('All');
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  const todayKey = getLocalDateKey(new Date(currentTime));
  useEffect(() => {
    const clock = setInterval(() => setCurrentTime(Date.now()), 60_000);
    return () => clearInterval(clock);
  }, []);

  // A habit only counts as missed once its day is over, so this panel lists yesterday's.
  const missedHabits = useMemo(() => habits.filter((habit) => isHabitMissedYesterday(habit, new Date(currentTime))), [currentTime, habits]);
  const completedHabits = useMemo(() => habits.filter((habit) => habit.completionDates.includes(todayKey)), [todayKey, habits]);
  const filteredGroups = useMemo(() => groups.filter((group) => category === 'All' || group.name === category).map((group) => ({ ...group, items: group.items.filter((item) => item.toLowerCase().includes(search.toLowerCase())) })).filter((group) => group.items.length > 0), [category, search, groups]);
  const accent = isDarkMode ? '#B9A9FF' : '#5B42D8';
  const chooseHabit = (habit: string) => router.replace({ pathname: '/(tabs)/add', params: { habit } });

  return <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={styles.container}>
    <View style={styles.headerRow}><Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={22} color={isDarkMode ? '#F2EFF8' : '#292633'} /></Pressable><View style={styles.headerCopy}><Text style={[styles.title, isDarkMode && styles.darkText]}>All Habits</Text><Text style={[styles.subtitle, isDarkMode && styles.darkMutedText]}>Explore habit ideas and add the ones that matter to you.</Text></View><Pressable style={[styles.searchButton, isDarkMode && styles.darkSurface]} onPress={() => setSearch('')} accessibilityLabel="Clear habit search"><Ionicons name="search-outline" size={22} color={isDarkMode ? '#F2EFF8' : '#292633'} /></Pressable></View>
    <View style={[styles.searchBox, isDarkMode && styles.darkInputBox]}><Ionicons name="search-outline" size={18} color={themeColor('#8A8492')} /><TextInput value={search} onChangeText={setSearch} placeholder="Search habits..." placeholderTextColor={themeColor('#9A94A4')} style={[styles.searchInput, isDarkMode && styles.darkText]} /></View>
    {habits.length > 0 && <View style={[styles.statusPanel, isDarkMode && styles.darkPanel]}><View style={styles.statusHeader}><View><Text style={[styles.statusTitle, isDarkMode && styles.darkText]}>Today&apos;s habit check</Text><Text style={[styles.statusDate, isDarkMode && styles.darkMutedText]}>{formatDateLabel(todayKey)}</Text><Text style={[styles.statusSubtitle, isDarkMode && styles.darkMutedText]}>{missedHabits.length ? 'Missed yesterday. Today is a fresh start.' : 'No habits were missed yesterday.'}</Text></View><View style={styles.statusCount}><Text style={styles.statusCountValue}>{completedHabits.length}/{habits.length}</Text><Text style={[styles.statusCountLabel, isDarkMode && styles.darkMutedText]}>complete</Text></View></View>{missedHabits.length > 0 && <View style={styles.missedList}>{missedHabits.slice(0, 3).map((habit) => <View key={habit.id} style={[styles.missedHabit, isDarkMode && styles.darkMissedHabit]}><View style={[styles.missedIcon, { backgroundColor: `${habit.color}20` }]}><Ionicons name="alert-circle-outline" size={17} color={themeColor('#D87832')} /></View><View style={styles.missedCopy}><Text style={[styles.missedTitle, isDarkMode && styles.darkText]}>{habit.label}</Text><Text style={[styles.missedMeta, isDarkMode && styles.darkMutedText]}>Missed yesterday · You can still do it today</Text></View></View>)}</View>}{missedHabits.length > 3 && <Text style={[styles.moreMissed, isDarkMode && styles.darkMutedText]}>+{missedHabits.length - 3} more missed habit{missedHabits.length - 3 === 1 ? '' : 's'}</Text>}</View>}
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRow}>{['All', ...groups.map((group) => group.name)].map((item) => <Pressable key={item} style={[styles.categoryButton, isDarkMode && styles.darkChip, category === item && styles.categoryActive]} onPress={() => setCategory(item)}><Text style={[styles.categoryText, isDarkMode && styles.darkMutedText, category === item && styles.categoryTextActive]}>{item}</Text></Pressable>)}</ScrollView>
    {filteredGroups.map((group) => <View key={group.name} style={[styles.groupCard, isDarkMode && styles.darkPanel]}><View style={styles.groupHeader}><View style={[styles.groupIcon, { backgroundColor: `${group.color}18` }]}><Ionicons name={group.icon as keyof typeof Ionicons.glyphMap} size={22} color={themeColor(group.color)} /></View><View style={styles.groupCopy}><Text style={[styles.groupTitle, isDarkMode && styles.darkText]}>{group.name}</Text><Text style={[styles.groupDescription, isDarkMode && styles.darkMutedText]}>{group.description}</Text></View><Ionicons name="arrow-forward" size={17} color={accent} /></View><View style={styles.habitGrid}>{group.items.map((habit) => <Pressable key={habit} style={[styles.habitCard, isDarkMode && styles.darkHabitCard]} onPress={() => chooseHabit(habit)}><Ionicons name={habitIcon(habit)} size={22} color={themeColor(group.color)} /><View style={styles.habitCopy}><Text style={[styles.habitTitle, isDarkMode && styles.darkText]}>{habit}</Text></View><Ionicons name="add-circle-outline" size={19} color={accent} /></Pressable>)}</View></View>)}
    {filteredGroups.length === 0 && <Text style={[styles.emptyText, isDarkMode && styles.darkMutedText]}>No habits found.</Text>}
    <Pressable style={styles.customButton} onPress={() => router.replace('/(tabs)/add')}><Ionicons name="add" size={23} color={themeColor('#FFFFFF')} /><View><Text style={styles.customTitle}>Custom Habit</Text><Text style={styles.customSubtitle}>Create your own habit</Text></View></Pressable>
  </View></ScrollView></SafeAreaView>;
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 }, darkScreen: { backgroundColor: '#111018' },
  content: { paddingBottom: 110 },
  container: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerCopy: { flex: 1, marginHorizontal: 10 },
  title: { fontSize: 23, fontWeight: '800', color: '#24212D' },
  subtitle: { fontSize: 10, lineHeight: 15, color: '#777282', fontWeight: '600', marginTop: 3 },
  searchButton: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 46, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 13, paddingHorizontal: 13, borderWidth: 1, borderColor: '#ECE8F4', marginBottom: 13 },
  searchInput: { flex: 1, marginLeft: 9, fontSize: 12, color: '#302B3B' },
  statusPanel: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: '#EEEAF5' },
  darkPanel: { backgroundColor: '#1B1824', borderColor: '#302B3B' },
  statusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusTitle: { fontSize: 14, fontWeight: '800', color: '#302B3B' },
  statusDate: { fontSize: 10, color: '#5B42D8', fontWeight: '700', marginTop: 3 },
  statusSubtitle: { fontSize: 10, color: '#827C8C', marginTop: 4 },
  statusCount: { alignItems: 'flex-end' },
  statusCountValue: { fontSize: 17, fontWeight: '800', color: '#42A477' },
  statusCountLabel: { fontSize: 8, color: '#827C8C', fontWeight: '700' },
  missedList: { gap: 8, marginTop: 12 },
  missedHabit: { minHeight: 50, borderRadius: 12, backgroundColor: '#FFF8F1', flexDirection: 'row', alignItems: 'center', padding: 8 },
  darkMissedHabit: { backgroundColor: '#2A211C' },
  missedIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  missedCopy: { flex: 1, marginHorizontal: 9 },
  missedTitle: { fontSize: 11, fontWeight: '800', color: '#393440' },
  missedMeta: { fontSize: 8, color: '#8A8492', marginTop: 2 },
  moreMissed: { fontSize: 9, color: '#827C8C', fontWeight: '700', marginTop: 10 },
  darkText: { color: '#F4F0FA' },
  darkMutedText: { color: '#AAA1B6' },
  darkSurface: { backgroundColor: '#221E2B' },
  darkInputBox: { backgroundColor: '#25212E', borderColor: '#3B3647' },
  darkChip: { backgroundColor: '#1D1A24', borderColor: '#302B3B' },
  darkHabitCard: { borderColor: '#302B3B' },
  categoryRow: { gap: 8, paddingBottom: 18 },
  categoryButton: { paddingHorizontal: 15, height: 34, borderRadius: 11, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ECE8F4' },
  categoryActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  categoryText: { fontSize: 10, color: '#777282', fontWeight: '700' },
  categoryTextActive: { color: '#FFFFFF' },
  groupCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginBottom: 14 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  groupIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  groupCopy: { flex: 1 },
  groupTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' },
  groupDescription: { fontSize: 9, color: '#827C8C', fontWeight: '600', marginTop: 3 },
  habitGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 9 },
  habitCard: { flexBasis: '48%', flexGrow: 1, minWidth: 140, minHeight: 70, borderRadius: 13, borderWidth: 1, borderColor: '#EEEAF5', padding: 10, flexDirection: 'row', alignItems: 'center' },
  habitCopy: { flex: 1, marginHorizontal: 7 },
  habitTitle: { fontSize: 10, fontWeight: '800', color: '#393440' },
  habitHint: { fontSize: 8, color: '#888291', marginTop: 3, lineHeight: 11 },
  emptyText: { textAlign: 'center', color: '#827C8C', fontSize: 12, padding: 30 },
  customButton: { minHeight: 54, borderRadius: 14, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 },
  customTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  customSubtitle: { color: '#E9E2FF', fontSize: 9, marginTop: 2 },
});

