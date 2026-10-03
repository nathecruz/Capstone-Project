import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { badgeProgress, badgeRemaining, milestones, nextBadge, type BadgeProgress } from '@/utils/achievements';

type IconName = keyof typeof Ionicons.glyphMap;

function BadgeCard({ badge, wide }: { badge: BadgeProgress; wide: boolean }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View
      style={[styles.badgeCard, wide && styles.badgeCardWide, badge.earned && { borderColor: `${badge.color}55` }]}
      accessible
      accessibilityLabel={badge.earned ? `${badge.title}, earned` : `${badge.title}, locked: ${badge.goal}, ${badge.current} of ${badge.target}`}
    >
      <View style={[styles.badgeIcon, { backgroundColor: badge.earned ? themeColor(badge.background, 'backgroundColor') : themeColor('#EEF0F4', 'backgroundColor') }]}>
        <Ionicons name={badge.icon as IconName} size={26} color={badge.earned ? badge.color : themeColor('#A3A8B5')} />
        {!badge.earned && <View style={styles.lockDot}><Ionicons name="lock-closed" size={9} color="#FFFFFF" /></View>}
        {badge.earned && <View style={[styles.lockDot, styles.earnedDot]}><Ionicons name="checkmark" size={10} color="#FFFFFF" /></View>}
      </View>
      <Text style={styles.badgeTitle} numberOfLines={2}>{badge.title}</Text>
      {badge.earned ? (
        <Text style={[styles.badgeFlavor, { color: themeColor(badge.color) }]} numberOfLines={2}>{badge.flavor}</Text>
      ) : (
        <>
          <Text style={styles.badgeGoal} numberOfLines={2}>{badge.goal}</Text>
          <View style={styles.badgeTrack}><View style={[styles.badgeFill, { width: `${Math.round(badge.share * 100)}%`, backgroundColor: badge.color }]} /></View>
          <Text style={styles.badgeCount}>{Math.min(badge.current, badge.target)} / {badge.target}{badge.unit === '%' ? '%' : ''}</Text>
        </>
      )}
    </View>
  );
}

export default function AchievementsScreen() {
  const styles = useThemedStyles(themedStyles);
  const { isDarkMode, habits, goals, points } = useAppColorScheme();
  const { isCentered: wide } = useResponsiveLayout();
  const [activeTab, setActiveTab] = useState<'Badges' | 'Milestones'>('Badges');
  const badges = useMemo(() => badgeProgress(habits, goals), [habits, goals]);
  const rows = useMemo(() => milestones(habits, points), [habits, points]);
  // Earned first, then the ones closest to being earned.
  const ordered = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || b.share - a.share);
  const earnedCount = badges.filter((badge) => badge.earned).length;
  const next = nextBadge(badges);

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={21} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
              <Text style={styles.headerTitle}>Achievements &amp; Badges</Text>
              <View style={styles.headerSpacer} />
            </View>

            <View style={styles.hero}>
              <View style={styles.heroTop}>
                <View style={styles.heroTrophy}><Ionicons name="trophy" size={26} color="#FFD44D" /></View>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroValue}>{earnedCount} <Text style={styles.heroOf}>of {badges.length} badges</Text></Text>
                  <Text style={styles.heroText}>{earnedCount ? 'Every check-in counts toward the next one.' : 'Your first badge is closer than you think.'}</Text>
                </View>
              </View>
              <View style={styles.heroTrack}><View style={[styles.heroFill, { width: `${Math.round((earnedCount / badges.length) * 100)}%` }]} /></View>
              {next && (
                <Pressable style={styles.nextRow} onPress={() => router.push('/(tabs)')} accessibilityRole="button" accessibilityLabel={`Next badge ${next.title}: ${badgeRemaining(next)}`}>
                  <View style={[styles.nextIcon, { backgroundColor: next.background }]}><Ionicons name={next.icon as IconName} size={18} color={next.color} /></View>
                  <View style={styles.heroCopy}>
                    <Text style={styles.nextLabel}>NEXT BADGE</Text>
                    <Text style={styles.nextTitle}>{next.title} · {badgeRemaining(next)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color="#E4DDFF" />
                </Pressable>
              )}
            </View>

            <View style={styles.tabs}>
              {(['Badges', 'Milestones'] as const).map((tab) => (
                <Pressable key={tab} style={[styles.tab, activeTab === tab && styles.activeTab]} onPress={() => setActiveTab(tab)} accessibilityRole="tab" accessibilityState={{ selected: activeTab === tab }}>
                  <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            {activeTab === 'Badges' ? (
              <View style={styles.badgeGrid}>
                {ordered.map((badge) => <BadgeCard key={badge.id} badge={badge} wide={wide} />)}
              </View>
            ) : (
              <View style={styles.milestoneList}>
                {rows.map((row) => {
                  const previous = row.reached.at(-1) ?? 0;
                  const share = row.next ? Math.min(1, (row.current - previous) / (row.next - previous)) : 1;
                  return (
                    <View key={row.id} style={styles.milestoneCard}>
                      <View style={styles.milestoneTop}>
                        <View style={[styles.milestoneIcon, { backgroundColor: `${row.color}1F` }]}><Ionicons name={row.icon as IconName} size={20} color={row.color} /></View>
                        <View style={styles.heroCopy}>
                          <Text style={styles.milestoneTitle}>{row.title}</Text>
                          <Text style={styles.milestoneNext}>{row.next ? `Next: ${row.next} ${row.unit === 'level' ? '' : row.unit}`.trim() : 'All milestones reached!'}</Text>
                        </View>
                        <Text style={[styles.milestoneValue, { color: row.color }]}>{row.current}</Text>
                      </View>
                      <View style={styles.badgeTrack}><View style={[styles.badgeFill, { width: `${Math.round(share * 100)}%`, backgroundColor: row.color }]} /></View>
                      <View style={styles.stepRow}>
                        {row.steps.map((step) => {
                          const reached = row.current >= step;
                          return (
                            <View key={step} style={[styles.step, reached && { backgroundColor: row.color, borderColor: row.color }]}>
                              <Text style={[styles.stepText, reached && styles.stepTextReached]}>{step}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 },
  content: { paddingBottom: 110 },
  container: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#24212D' },
  // Summary: the brand purple stays in dark mode.
  hero: { backgroundColor: '#5B42D8', borderRadius: 24, padding: 18, marginBottom: 18, shadowColor: '#5B42D8', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  heroTrophy: { width: 52, height: 52, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  heroCopy: { flex: 1 },
  heroValue: { fontSize: 28, fontWeight: '900', color: '#FFFFFF' },
  heroOf: { fontSize: 15, fontWeight: '800', color: '#E4DDFF' },
  heroText: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#E4DDFF' },
  heroTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.2)', marginTop: 14, overflow: 'hidden' },
  heroFill: { height: '100%', borderRadius: 4, backgroundColor: '#FFD44D' },
  nextRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 10, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.12)' },
  nextIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#C9BFF7' },
  nextTitle: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 14, padding: 4, marginBottom: 16 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  activeTab: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 12, color: '#777283', fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10 },
  badgeCard: { width: '31.5%', minHeight: 150, backgroundColor: '#FFFFFF', borderRadius: 16, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 12, borderWidth: 1.5, borderColor: '#FFFFFF' },
  badgeCardWide: { width: '23.5%' },
  badgeIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  lockDot: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, backgroundColor: '#9BA1AE', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  earnedDot: { backgroundColor: '#3BAA74' },
  badgeTitle: { fontSize: 11, fontWeight: '800', color: '#36313F', textAlign: 'center' },
  badgeFlavor: { fontSize: 10, fontWeight: '800', textAlign: 'center', marginTop: 4 },
  badgeGoal: { fontSize: 9, color: '#8A8492', fontWeight: '600', textAlign: 'center', marginTop: 3, minHeight: 22 },
  badgeTrack: { alignSelf: 'stretch', height: 6, borderRadius: 3, backgroundColor: '#EFEBFA', marginTop: 8, overflow: 'hidden' },
  badgeFill: { height: '100%', borderRadius: 3 },
  badgeCount: { fontSize: 10, fontWeight: '800', color: '#6A6573', marginTop: 4 },
  milestoneList: { gap: 12 },
  milestoneCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14 },
  milestoneTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  milestoneIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  milestoneTitle: { fontSize: 14, fontWeight: '800', color: '#302B3B' },
  milestoneNext: { marginTop: 2, fontSize: 11, fontWeight: '700', color: '#8A8492' },
  milestoneValue: { fontSize: 24, fontWeight: '900' },
  stepRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  step: { minWidth: 36, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: '#DCD6EC', alignItems: 'center' },
  stepText: { fontSize: 11, fontWeight: '800', color: '#8A8492' },
  stepTextReached: { color: '#FFFFFF' },
});
