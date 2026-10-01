import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';

const badges = [
  { title: '7 Day Streak', subtitle: 'Keep going!', icon: 'flame', color: '#48A66A', background: '#E6F6EA' },
  { title: 'Early Bird', subtitle: 'Morning master', icon: 'sunny', color: '#E7A72F', background: '#FFF4D9' },
  { title: 'Focus Master', subtitle: 'Stay focused', icon: 'eye', color: '#4F82D8', background: '#E7F0FF' },
  { title: 'Consistency Pro', subtitle: 'Build the habit', icon: 'ribbon', color: '#7A55D9', background: '#F0E9FF' },
  { title: 'Habit Hero', subtitle: 'All rounder', icon: 'shield-checkmark', color: '#3D83D8', background: '#E5F2FF' },
  { title: 'Strongest Legend', subtitle: 'Keep pushing', icon: 'trophy', color: '#E86842', background: '#FFE9E1' },
  { title: 'Hydration Hero', subtitle: 'Water champion', icon: 'water', color: '#3B9ED8', background: '#E2F5FF' },
  { title: 'Workout Warrior', subtitle: 'Move your body', icon: 'fitness', color: '#D85D70', background: '#FFE7EC' },
  { title: 'Bookworm', subtitle: 'Read every day', icon: 'book', color: '#9A6A3A', background: '#F6EBDD' },
  { title: 'Perfect Week', subtitle: 'Seven for seven', icon: 'calendar', color: '#6C58CE', background: '#EEE9FF' },
  { title: 'Goal Getter', subtitle: 'Aim higher', icon: 'locate', color: '#D48A28', background: '#FFF1D9' },
  { title: 'Early Finisher', subtitle: 'Ahead of schedule', icon: 'rocket', color: '#4D8C75', background: '#E3F4ED' },
];

export default function AchievementsScreen() {
  const { isDarkMode, habits } = useAppColorScheme();
  const [activeTab, setActiveTab] = useState<'Badges' | 'Milestones'>('Badges');
  const { maxStreak, completionPercent } = getHabitProgressSummary(habits);
  const earnedBadges = new Set([
    ...(maxStreak >= 7 ? ['7 Day Streak'] : []),
    ...(habits.some((habit) => habit.reminderEnabled && /AM/i.test(habit.reminderTime)) ? ['Early Bird'] : []),
    ...(habits.some((habit) => habit.category === 'Mind' && habit.done) ? ['Focus Master'] : []),
    ...(completionPercent >= 80 ? ['Consistency Pro'] : []),
    ...(habits.length >= 5 ? ['Habit Hero'] : []),
    ...(habits.some((habit) => habit.category === 'Health' && habit.done) ? ['Hydration Hero'] : []),
    ...(habits.some((habit) => /exercise|workout/i.test(habit.label) && habit.done) ? ['Workout Warrior'] : []),
    ...(habits.some((habit) => /read|book/i.test(habit.label) && habit.done) ? ['Bookworm'] : []),
  ]);
  const earnedCount = earnedBadges.size;

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={21} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkHeaderTitle]}>Achievements &amp; Badges</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={[styles.tabs, isDarkMode && styles.darkTabs]}>
              {(['Badges', 'Milestones'] as const).map((tab) => (
                <Pressable key={tab} style={[styles.tab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)}>
                  <Text style={[styles.tabText, isDarkMode && styles.darkMutedText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            {activeTab === 'Badges' ? (
              <>
                <View style={styles.sectionHeader}>
                  <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Your Badges</Text>
                  <Text style={[styles.sectionCount, isDarkMode && styles.darkMutedText]}>{earnedCount} / {badges.length} earned</Text>
                </View>
                <View style={styles.badgeGrid}>
                  {badges.map((badge) => {
                    const earned = earnedBadges.has(badge.title);
                    return <Pressable key={badge.title} style={[styles.badgeCard, isDarkMode && styles.darkCard, !earned && styles.lockedBadgeCard]} onPress={() => router.push('/(tabs)/habits')} accessibilityRole="button">
                      <View style={[styles.badgeIcon, { backgroundColor: earned ? (isDarkMode ? `${badge.color}2E` : badge.background) : (isDarkMode ? '#2A2635' : '#EEF0F4') }]}>
                        <Ionicons name={earned ? badge.icon as keyof typeof Ionicons.glyphMap : 'lock-closed'} size={28} color={earned ? badge.color : isDarkMode ? '#8C8599' : '#9BA1AE'} />
                      </View>
                      <Text style={[styles.badgeTitle, isDarkMode && styles.darkText]}>{badge.title}</Text>
                      <Text style={[styles.badgeSubtitle, isDarkMode && styles.darkMutedText]}>{earned ? 'Earned' : badge.subtitle}</Text>
                    </Pressable>
                  })}
                </View>

                <View style={styles.sectionHeaderRecent}>
                  <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Recent Unlocks</Text>
                  <Pressable onPress={() => setActiveTab('Badges')}><Text style={[styles.viewAll, isDarkMode && styles.darkLink]}>View all</Text></Pressable>
                </View>
                <View style={[styles.recentCard, isDarkMode && styles.darkCard]}>
                  {badges.filter((badge) => earnedBadges.has(badge.title)).slice(0, 2).map((item, index) => <View key={item.title} style={[styles.recentRow, index === 0 && styles.recentBorder, index === 0 && isDarkMode && styles.darkDivider]}><View style={[styles.recentIcon, { backgroundColor: `${item.color}20` }]}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={item.color} /></View><View style={styles.recentText}><Text style={[styles.recentTitle, isDarkMode && styles.darkText]}>{item.title}</Text><Text style={[styles.recentDate, isDarkMode && styles.darkMutedText]}>Earned from your current habit progress</Text></View><Ionicons name="checkmark-circle" size={18} color="#48A66A" /></View>)}
                  {!earnedCount && <Text style={[styles.emptyRecent, isDarkMode && styles.darkMutedText]}>Complete habits to unlock your first badge.</Text>}
                </View>
              </>
            ) : (
              <View style={[styles.milestoneCard, isDarkMode && styles.darkCard]}>
                <Ionicons name="flag-outline" size={32} color={isDarkMode ? '#B9A9FF' : '#5B42D8'} />
                <Text style={[styles.milestoneTitle, isDarkMode && styles.darkText]}>Your milestones are on the way</Text>
                <Text style={[styles.milestoneBody, isDarkMode && styles.darkMutedText]}>Complete more habits to unlock new milestones and celebrate your progress.</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 }, darkScreen: { backgroundColor: '#111018' },
  content: { paddingBottom: 110 },
  container: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#24212D' },
  darkHeaderTitle: { color: '#F2EFF8' },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  darkLink: { color: '#C9BCFF' },
  darkCard: { backgroundColor: '#1D1A24' },
  darkTabs: { backgroundColor: '#1F1B28' },
  darkDivider: { borderBottomColor: '#302B3B' },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 14, padding: 4, marginBottom: 20 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  activeTab: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 12, color: '#777283', fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' },
  sectionCount: { fontSize: 10, color: '#827C8C', fontWeight: '700' },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 24 },
  badgeCard: { width: '31.5%', minHeight: 128, backgroundColor: '#FFFFFF', borderRadius: 15, alignItems: 'center', justifyContent: 'center', padding: 8 },
  lockedBadgeCard: { opacity: 0.72 },
  badgeIcon: { width: 58, height: 58, borderRadius: 29, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  badgeTitle: { fontSize: 10, fontWeight: '800', color: '#36313F', textAlign: 'center' },
  badgeSubtitle: { fontSize: 8, color: '#8A8492', fontWeight: '600', textAlign: 'center', marginTop: 3 },
  sectionHeaderRecent: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  viewAll: { fontSize: 10, color: '#5B42D8', fontWeight: '800' },
  recentCard: { backgroundColor: '#FFFFFF', borderRadius: 17, paddingHorizontal: 14 },
  recentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  recentBorder: { borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  recentIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  recentText: { flex: 1 },
  recentTitle: { fontSize: 12, fontWeight: '800', color: '#393440' },
  recentDate: { fontSize: 9, color: '#888291', fontWeight: '600', marginTop: 3 },
  emptyRecent: { color: '#888291', fontSize: 11, fontWeight: '600', paddingVertical: 18, textAlign: 'center' },
  milestoneCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 28, alignItems: 'center' },
  milestoneTitle: { fontSize: 17, fontWeight: '800', color: '#302B3B', textAlign: 'center', marginVertical: 12 },
  milestoneBody: { fontSize: 12, lineHeight: 18, color: '#777282', textAlign: 'center' },
});

