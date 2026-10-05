// Home, as a bento dashboard: a greeting, today's progress and next habit (the hero), tiles for
// streak, level, tokens and Habi, today's habits, then the rewards (as tabs) and progress. On laptops the
// hero, habits and progress sit on the left and the tiles and challenges on the right.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Image, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { BentoTiles } from '@/components/bento-tiles';
import { ClassPulseCard } from '@/components/class-pulse-card';
import { FramedAvatar } from '@/components/framed-avatar';
import { useRewards } from '@/hooks/use-rewards';
import { useUnreadCount } from '@/utils/live-events';
import { MysteryBoxCard, NextBadgeCard, StreakRiskBanner, WeeklyRecapCard } from '@/components/engagement-cards';
import { RewardsHub } from '@/components/rewards-hub';
import { StreakFreezeSheet } from '@/components/streak-freeze-sheet';
import { TodayAgenda } from '@/components/today-agenda';
import { WeekStrip } from '@/components/week-strip';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { greetingFor } from '@/utils/greeting';

function SectionTitle({ title, subtitle }: { title: string; subtitle: string }) {
  const styles = useThemedStyles(themedStyles);
  return (
    <View style={styles.sectionTitleWrap}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <Text style={styles.sectionSubtitle}>{subtitle}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { avatarImage, habits, profile, toggleHabit, isFaculty, goals, tokenHistory, applyWallet } = useAppColorScheme();
  const [freezeSheetVisible, setFreezeSheetVisible] = React.useState(false);
  const insets = useSafeAreaInsets();
  const { isDesktop } = useResponsiveLayout();
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    // Keeps the greeting and today's habits right when the app stays open all day.
    const clock = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(clock);
  }, []);
  const greeting = greetingFor(now);
  const firstName = profile.firstName || profile.fullName.split(' ')[0] || '';
  const openFreeze = () => setFreezeSheetVisible(true);
  const tiles = <BentoTiles habits={habits} onFreeze={openFreeze} />;
  const { frame } = useRewards();
  const unread = useUnreadCount();
  const progress = (
    <>
      <SectionTitle title="Your progress" subtitle="How your week is going" />
      {habits.length > 0 && <WeekStrip habits={habits} />}
      <NextBadgeCard habits={habits} goals={goals} />
      <WeeklyRecapCard habits={habits} now={now} />
      {isFaculty && <ClassPulseCard />}
      <Pressable style={({ pressed }) => [styles.progressLink, pressed && styles.pressed]} onPress={() => router.push('/progress')} accessibilityRole="button" accessibilityLabel="View habit progress">
        <Text style={styles.progressLinkText}>See all your progress</Text>
        <Ionicons name="arrow-forward" size={16} color={themeColor('#4F2AC8')} />
      </Pressable>
    </>
  );

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      {/* The page itself does not scroll on the web (overflow hidden), so Home scrolls here. */}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 18, paddingBottom: 112 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.greeting}>{firstName ? `${greeting},` : `${greeting}!`}</Text>
            {firstName ? <Text style={styles.name} numberOfLines={1}>{firstName} 👋</Text> : null}
            <Text style={styles.tagline}>Small habits, big progress.</Text>
            {isFaculty && (
              <View style={styles.facultyModePill} accessible accessibilityLabel="PSAU Faculty mode">
                <Ionicons name="briefcase" size={12} color="#FFFFFF" />
                <Text style={styles.facultyModeText}>PSAU Faculty mode</Text>
              </View>
            )}
          </View>
          <View style={styles.headerActions}>
            <Pressable style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} onPress={() => router.push('/notifications')} accessibilityRole="button" accessibilityLabel={unread ? `Notifications, ${unread} new` : 'Notifications'} hitSlop={6}>
              <Ionicons name={unread ? 'notifications' : 'notifications-outline'} size={20} color={themeColor('#2F2D3C')} />
              {unread > 0 && <View style={styles.bellBadge}><Text style={styles.bellBadgeText}>{unread > 9 ? '9+' : unread}</Text></View>}
            </Pressable>
            <Pressable style={({ pressed }) => pressed && styles.pressed} onPress={() => router.navigate('/(tabs)/profile')} accessibilityRole="button" accessibilityLabel="Open profile">
              <FramedAvatar frame={frame} size={frame ? 36 : 44}>
                <View style={[styles.avatar, frame ? styles.avatarFramed : null]}>
                  {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarInitial}>{(firstName.charAt(0) || 'H').toUpperCase()}</Text>}
                </View>
              </FramedAvatar>
            </Pressable>
          </View>
        </View>

        <View style={isDesktop ? styles.columns : styles.column}>
          <View style={[styles.column, isDesktop && styles.mainColumn]}>
            <StreakRiskBanner habits={habits} now={now} onFreeze={openFreeze} />
            <TodayAgenda habits={habits} now={now} onCheck={(habit) => toggleHabit(habit.id)} middle={isDesktop ? undefined : tiles} />
            {isDesktop && progress}
          </View>

          <View style={[styles.column, isDesktop && styles.sideColumn]}>
            {isDesktop && tiles}
            <RewardsHub habits={habits} now={now} />
            <MysteryBoxCard habits={habits} tokenHistory={tokenHistory} onWallet={applyWallet} />
            {!isDesktop && progress}
          </View>
        </View>
      </ScrollView>
      <StreakFreezeSheet visible={freezeSheetVisible} onClose={() => setFreezeSheetVisible(false)} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  // Same as the page behind centered screens, so no seam shows beside the content column.
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  scroll: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 18, gap: 18 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  greeting: { fontSize: 15, fontWeight: '700', color: '#6A6573' },
  name: { marginTop: 1, fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#1F1C26', letterSpacing: -0.8 },
  tagline: { marginTop: 3, fontSize: 13, fontWeight: '600', color: '#8A8492' },
  // Faculty mode is on: shown under the greeting so it is easy to spot.
  facultyModePill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, marginTop: 10, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: '#5B42D8' },
  facultyModeText: { fontSize: 11, fontWeight: '800', color: '#FFFFFF' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 4 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  bellBadge: { position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5484D', borderWidth: 2, borderColor: '#F5F4F9' },
  bellBadgeText: { fontSize: 11, lineHeight: 13, fontWeight: '900', color: '#FFFFFF' },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: '#FFFFFF' },
  avatarImage: { width: '100%', height: '100%' },
  // Inside a frame: the frame's own rings replace the white border.
  avatarFramed: { width: 36, height: 36, borderRadius: 18, borderWidth: 0 },
  avatarInitial: { fontSize: 18, fontWeight: '900', color: '#5B42D8' },
  column: { gap: 14 },
  // Laptops: two columns, the hero and habits wider than the side column.
  columns: { flexDirection: 'row', alignItems: 'flex-start', gap: 18 },
  mainColumn: { flex: 3, minWidth: 0 },
  sideColumn: { flex: 2, minWidth: 0 },
  sectionTitleWrap: { marginTop: 8 },
  sectionTitle: { fontSize: 20, fontWeight: '900', color: '#1F1C26' },
  sectionSubtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#8A8492' },
  progressLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48, borderRadius: 18, backgroundColor: '#FFFFFF' },
  progressLinkText: { fontSize: 15, fontWeight: '800', color: '#4F2AC8' },
}, {
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#2A2440', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', borderWidth: 2, borderColor: '#302B3B' },
});
