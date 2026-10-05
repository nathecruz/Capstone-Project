import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyLeaderboardRank } from '@/authentication';
import { AiChatSheet, useAiChat, type ChatAnswer } from '@/components/ai-chat';
import { ClassPulseCard } from '@/components/class-pulse-card';
import { FramedAvatar } from '@/components/framed-avatar';
import { FrameSheet, TitleBadge, TitleSheet } from '@/components/reward-sheets';
import { useAppDialog } from '@/components/ui/app-dialog';
import { badgeProgress, badgeRemaining, historyStats, nextBadge } from '@/utils/achievements';
import { askAi } from '@/utils/ai-client';
import { levelProgress } from '@/utils/engagement';
import type { TranslationKey } from '@/constants/i18n';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';
import { CONTENT_MAX_WIDTH } from '@/hooks/use-responsive-layout';
import { useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

/** The menu, in two groups: what you have done, and your account. */
const settings = [
  { key: 'statsProgress', icon: 'stats-chart-outline', route: '/stats-progress', group: 'progress', color: '#3564D8', tint: '#E8EEFF' },
  { key: 'leaderboards', icon: 'trophy-outline', route: '/leaderboards', group: 'progress', color: '#C98A0E', tint: '#FFF4D9' },
  { key: 'activityHistory', icon: 'time-outline', route: '/activity-history', group: 'progress', color: '#5B42D8', tint: '#EEE9FF' },
  { key: 'achievementsBadges', icon: 'ribbon-outline', route: '/achievements', group: 'progress', color: '#C2549B', tint: '#FCE7F1' },
  { key: 'personalInformation', icon: 'person-outline', route: '/personal-information', group: 'account', color: '#5B42D8', tint: '#EEE9FF' },
  { key: 'settingsPreferences', icon: 'settings-outline', route: '/settings-preferences', group: 'account', color: '#4A4458', tint: '#F0EEF5' },
  { key: 'helpSupport', icon: 'help-circle-outline', route: '/help-support', group: 'account', color: '#2E9D5C', tint: '#E3F6EC' },
] as const;

/** Tokens one AI Coach answer costs (the server charges it). */
const COACH_COST = 10;

export default function ProfileScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  // The Custom Title reward: shown under the name once bought.
  const rewards = useRewards();
  const [titleOpen, setTitleOpen] = useState(false);
  const [frameOpen, setFrameOpen] = useState(false);
  const { isDarkMode, avatarImage, setAvatarImage, habits, goals, profile, points, tokens, applyWallet, t, isFaculty, streakFreeze } = useAppColorScheme();
  // Faculty mode: no student leaderboards; a shortcut to their class's Class Pulse instead.
  const menuItems = isFaculty ? settings.filter((item) => item.key !== 'leaderboards') : settings;
  // The student's real place on the All Time leaderboard (it used to be a fixed "#24, Top 8%").
  const [rankInfo, setRankInfo] = useState<{ rank: number; total: number } | null>(null);
  useEffect(() => {
    if (isFaculty || points === 0) return;
    let active = true;
    void getMyLeaderboardRank().then((result) => {
      if (active) setRankInfo(result);
    });
    return () => {
      active = false;
    };
  }, [isFaculty, points]);
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const { maxStreak } = getHabitProgressSummary(habits);
  // Badges from the whole history: earned first, and the one closest to being earned.
  const frozenDays = streakFreeze?.frozenDays;
  const badges = useMemo(() => badgeProgress(habits, goals, new Date(), frozenDays), [frozenDays, habits, goals]);
  const earnedBadges = badges.filter((badge) => badge.earned).length;
  const badgeStrip = [...badges].sort((a, b) => Number(b.earned) - Number(a.earned) || b.share - a.share).slice(0, 6);
  const upcomingBadge = nextBadge(badges);
  const bestStreak = useMemo(() => historyStats(habits, new Date(), frozenDays).bestStreak, [frozenDays, habits]);
  const displayName = profile.fullName?.trim() || 'Your profile';
  const displayUsername = profile.username?.trim() ? `@${profile.username.trim()}` : '';
  // Without a photo the avatar shows the student's initial.
  const avatarInitial = (profile.firstName || profile.fullName || 'H').trim().charAt(0).toUpperCase();
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  // AI Coach: each answer costs COACH_COST tokens, charged by the server only when it answers.
  const coachChat = useAiChat(async (question): Promise<ChatAnswer> => {
    if (tokens < COACH_COST) {
      return { ok: false, tone: 'warning', message: `A Coach answer costs ${COACH_COST} tokens and you have ${tokens}. Check in your habits or claim your daily reward to earn more.` };
    }
    const result = await askAi('coach', question);
    if (!result.ok) return { ok: false, message: result.status === 402 ? result.message : `${result.message} Your tokens were not spent.` };
    applyWallet(result);
    return { ok: true, answer: result.answer, note: `${COACH_COST} tokens used` };
  });

  const chooseFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Allow photo library access to choose a profile picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });

    if (!result.canceled) setAvatarImage(result.assets[0].uri);
  };

  const takePhoto = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      showAlert('Permission needed', 'Allow camera access to take a profile picture.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (!result.canceled) setAvatarImage(result.assets[0].uri);
  };

  const openAvatarActions = () => {
    setAvatarModalOpen(true);
  };

  const closeAvatarActions = () => {
    setAvatarModalOpen(false);
  };

  const { level: xpLevel, xp, toNext, share: levelShare } = levelProgress(points);
  const stats: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap; color: string; onPress: () => void; accessibilityLabel: string }[] = [
    { label: 'day streak', value: String(maxStreak), icon: 'flame', color: '#E8862A', onPress: () => router.push('/stats-progress'), accessibilityLabel: `${maxStreak}-day streak, best ${bestStreak}. Open stats` },
    { label: 'points', value: String(points), icon: 'star', color: '#5B42D8', onPress: () => router.push('/achievements'), accessibilityLabel: `${points} points, level ${xpLevel}. Open badges` },
    isFaculty
      ? { label: 'goals', value: String(goals.length), icon: 'flag', color: '#C98A0E', onPress: () => router.push('/goals'), accessibilityLabel: `${goals.length} goals. Open goals` }
      : { label: rankInfo ? `rank of ${rankInfo.total}` : 'rank', value: rankInfo ? `#${rankInfo.rank}` : '—', icon: 'trophy', color: '#C98A0E', onPress: () => router.push('/leaderboards'), accessibilityLabel: rankInfo ? `Rank ${rankInfo.rank} of ${rankInfo.total}. Open leaderboards` : 'Open leaderboards' },
    { label: 'tokens', value: String(tokens), icon: 'diamond', color: '#2E9D5C', onPress: () => setCoachOpen(true), accessibilityLabel: `${tokens} tokens. Ask your AI Coach` },
  ];
  const progressItems = menuItems.filter((item) => item.group === 'progress');
  const accountItems = menuItems.filter((item) => item.group === 'account');
  const confirmLogOut = () => showAlert('Log Out?', 'Are you sure you want to log out?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Log Out', style: 'destructive', onPress: () => router.replace('/logout') },
  ]);
  const renderMenu = (items: readonly (typeof settings)[number][]) => items.map((item, index) => (
    <Pressable
      key={item.key}
      style={({ pressed }) => [styles.menuRow, index < items.length - 1 && styles.menuBorder, pressed && styles.pressed]}
      onPress={() => router.push(item.route)}
      accessibilityRole="button"
      accessibilityLabel={t(item.key as TranslationKey)}
    >
      <View style={[styles.menuIcon, { backgroundColor: themeColor(item.tint, 'backgroundColor') }]}>
        <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={themeColor(item.color)} />
      </View>
      <Text style={styles.menuLabel}>{t(item.key as TranslationKey)}</Text>
      <Ionicons name="chevron-forward" size={16} color={themeColor('#A19CAA')} />
    </Pressable>
  ));

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.container, width >= 700 && styles.wideContainer, { paddingHorizontal: compactLayout ? 12 : 18 }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>{t('profile')}</Text>
            <Pressable style={styles.headerButton} onPress={() => router.push('/settings-preferences')} accessibilityRole="button" accessibilityLabel={t('profileSettings')}>
              <Ionicons name="settings-outline" size={19} color={themeColor('#3B3548')} />
            </Pressable>
          </View>

          <View style={styles.profileCard}>
            <View style={[styles.banner, isDarkMode && styles.bannerDark]}>
              <View style={styles.bannerCircleOne} />
              <View style={styles.bannerCircleTwo} />
              {isFaculty && (
                <View style={styles.facultyPill}>
                  <Ionicons name="briefcase" size={11} color="#FFFFFF" />
                  <Text style={styles.facultyPillText}>PSAU Faculty</Text>
                </View>
              )}
            </View>
            <View style={styles.identityRow}>
              <Pressable style={styles.avatarPressable} onPress={openAvatarActions} accessibilityRole="button" accessibilityLabel="Change profile picture">
                {rewards.frame ? (
                  <FramedAvatar frame={rewards.frame} size={78}>
                    <View style={styles.avatarCircle}>
                      {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarInitial}>{avatarInitial}</Text>}
                    </View>
                  </FramedAvatar>
                ) : (
                  <View style={styles.avatarRing}>
                    <View style={styles.avatarCircle}>
                      {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarInitial}>{avatarInitial}</Text>}
                    </View>
                  </View>
                )}
                <View style={styles.cameraBadge}>
                  <Ionicons name="camera" size={12} color={themeColor('#FFFFFF')} />
                </View>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.editButton, pressed && styles.pressed]} onPress={() => router.push('/personal-information')} accessibilityRole="button" accessibilityLabel="Edit profile">
                <Ionicons name="create-outline" size={15} color={themeColor('#5B42D8')} />
                <Text style={styles.editButtonText}>Edit profile</Text>
              </Pressable>
            </View>

            <View style={styles.identityCopy}>
              <Text style={styles.name} numberOfLines={2}>{displayName}</Text>
              {displayUsername ? <Text style={styles.username}>{displayUsername}</Text> : null}
              {(rewards.owns('custom-title') || rewards.owns('profile-frames')) && (
                <View style={styles.rewardRow}>
                  {rewards.owns('custom-title') && <TitleBadge title={rewards.title} onPress={() => setTitleOpen(true)} />}
                  {rewards.owns('profile-frames') && (
                    <Pressable style={({ pressed }) => [styles.frameChip, pressed && styles.pressed]} onPress={() => setFrameOpen(true)} accessibilityRole="button" accessibilityLabel="Change profile frame">
                      <Ionicons name="person-circle-outline" size={13} color={themeColor('#8A5A00')} />
                      <Text style={styles.frameChipText}>{rewards.frame ? 'Change frame' : 'Add a frame'}</Text>
                    </Pressable>
                  )}
                </View>
              )}
            </View>

            <Pressable style={({ pressed }) => [styles.levelBox, pressed && styles.pressed]} onPress={() => router.push('/achievements')} accessibilityRole="button" accessibilityLabel={`Level ${xpLevel}, ${xp} of ${xp + toNext} XP. Open badges`}>
              <View style={styles.levelTop}>
                <View style={styles.levelBadge}><Ionicons name="star" size={12} color="#FFFFFF" /><Text style={styles.levelBadgeText}>Level {xpLevel}</Text></View>
                <Text style={styles.levelXp}>{xp}/{xp + toNext} XP</Text>
              </View>
              <View style={styles.levelTrack}><View style={[styles.levelFill, { width: `${Math.round(levelShare * 100)}%` }]} /></View>
              <Text style={styles.levelHint}>{toNext} XP to level {xpLevel + 1} · 20 XP for each check-in</Text>
            </Pressable>

            <View style={styles.statsRow}>
              {stats.map((stat, index) => (
                <Pressable key={stat.label + index} style={({ pressed }) => [styles.stat, index > 0 && styles.statDivider, pressed && styles.pressed]} onPress={stat.onPress} accessibilityRole="button" accessibilityLabel={stat.accessibilityLabel}>
                  <View style={styles.statTop}>
                    <Ionicons name={stat.icon} size={14} color={themeColor(stat.color)} />
                    <Text style={styles.statValue} numberOfLines={1}>{stat.value}</Text>
                  </View>
                  <Text style={styles.statLabel} numberOfLines={1}>{stat.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <Pressable style={({ pressed }) => [styles.coachCard, isDarkMode && styles.coachCardDark, pressed && styles.pressed]} onPress={() => setCoachOpen(true)} accessibilityRole="button" accessibilityLabel={`Ask your AI Coach. ${COACH_COST} tokens per answer, ${tokens} tokens left`}>
            <View style={styles.coachIcon}><Ionicons name="sparkles" size={20} color="#FFFFFF" /></View>
            <View style={styles.coachCopy}>
              <Text style={styles.coachTitle}>{t('aiCoach')}</Text>
              <Text style={styles.coachText}>One specific next step from your habits · {COACH_COST} tokens per answer</Text>
            </View>
            <View style={styles.coachButton}><Text style={styles.coachButtonText}>Ask</Text></View>
          </Pressable>

          <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed]} onPress={() => router.push('/achievements')} accessibilityRole="button" accessibilityLabel={`Badges: ${earnedBadges} of ${badges.length} earned. Open achievements`}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Badges</Text>
              <View style={styles.cardLink}>
                <Text style={styles.cardLinkText}>{earnedBadges}/{badges.length} earned</Text>
                <Ionicons name="chevron-forward" size={14} color={themeColor('#5B42D8')} />
              </View>
            </View>
            <View style={styles.badgeRow}>
              {badgeStrip.map((badge) => (
                <View key={badge.id} style={[styles.badgeIcon, { backgroundColor: themeColor(badge.earned ? badge.background : '#EEF0F4', 'backgroundColor') }]}>
                  <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={19} color={badge.earned ? badge.color : themeColor('#A3A8B5')} />
                </View>
              ))}
            </View>
            {upcomingBadge && (
              <View style={styles.nextBadge}>
                <Ionicons name="ribbon-outline" size={14} color={themeColor('#5B42D8')} />
                <Text style={styles.nextBadgeText} numberOfLines={1}>Next: {upcomingBadge.title} · {badgeRemaining(upcomingBadge)}</Text>
              </View>
            )}
          </Pressable>

          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View>
                <Text style={styles.cardTitle}>My Goals</Text>
                <Text style={styles.cardSubtitle}>{goals.length ? 'Your plans and next steps' : 'Turn an intention into a plan'}</Text>
              </View>
              <Pressable onPress={() => router.push('/goals')} accessibilityRole="button" accessibilityLabel="View all goals" hitSlop={8}>
                <View style={styles.cardLink}>
                  <Text style={styles.cardLinkText}>View all</Text>
                  <Ionicons name="chevron-forward" size={14} color={themeColor('#5B42D8')} />
                </View>
              </Pressable>
            </View>
            {goals.length ? goals.slice(0, 2).map((goal) => {
              const progress = Math.max(0, Math.min(100, goal.progress));
              return (
                <Pressable key={goal.id} style={({ pressed }) => [styles.goalRow, pressed && styles.pressed]} onPress={() => router.push('/goals')} accessibilityRole="button" accessibilityLabel={`Open goal ${goal.title}, ${progress}% done`}>
                  <View style={styles.goalTop}>
                    <Text style={styles.goalTitle} numberOfLines={2}>{goal.title}</Text>
                    <Text style={styles.goalPercent}>{progress}%</Text>
                  </View>
                  <View style={styles.goalTrack}><View style={[styles.goalFill, progress >= 100 && styles.goalFillDone, { width: `${progress}%` }]} /></View>
                  <Text style={styles.goalMeta}>{goal.category} · {goal.status}</Text>
                </Pressable>
              );
            }) : (
              <Pressable style={({ pressed }) => [styles.goalEmpty, pressed && styles.pressed]} onPress={() => router.push('/goals')} accessibilityRole="button" accessibilityLabel="Create your first goal">
                <View style={styles.goalEmptyIcon}><Ionicons name="flag-outline" size={18} color={themeColor('#5B42D8')} /></View>
                <Text style={styles.goalEmptyText}>Create your first goal</Text>
                <Ionicons name="chevron-forward" size={16} color={themeColor('#8C8498')} />
              </Pressable>
            )}
          </View>

          {isFaculty && <ClassPulseCard style={styles.facultyClassCard} />}

          <Text style={styles.groupLabel}>Your progress</Text>
          <View style={styles.menuCard}>{renderMenu(progressItems)}</View>

          <Text style={styles.groupLabel}>{t('account')}</Text>
          <View style={styles.menuCard}>
            {renderMenu(accountItems)}
            <Pressable style={({ pressed }) => [styles.menuRow, styles.menuBorderTop, pressed && styles.pressed]} onPress={confirmLogOut} accessibilityRole="button" accessibilityLabel={t('logOut')}>
              <View style={[styles.menuIcon, { backgroundColor: themeColor('#FFECEF', 'backgroundColor') }]}>
                <Ionicons name="log-out-outline" size={18} color={themeColor('#D94868')} />
              </View>
              <Text style={[styles.menuLabel, styles.logOutText]}>{t('logOut')}</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
      <Modal visible={avatarModalOpen} transparent animationType="fade" onRequestClose={closeAvatarActions}>
        <View style={styles.avatarModalBackdrop}>
          <View style={[styles.avatarModalCard, isDarkMode && styles.darkCard]}>
            <View style={styles.avatarModalIconWrap}>
              <Ionicons name="information-circle-outline" size={28} color={themeColor('#5B42D8')} />
            </View>

            <Text style={[styles.avatarModalTitle, isDarkMode && styles.darkText]}>Profile Picture</Text>
            <Text style={[styles.avatarModalSubtitle, isDarkMode && styles.darkMutedText]}>Choose an avatar for your profile.</Text>

            <View style={styles.avatarOptionGrid}>
              <Pressable style={[styles.avatarOption, styles.cancelOption]} onPress={closeAvatarActions}>
                <Text style={[styles.avatarOptionText, styles.cancelOptionText, isDarkMode && styles.darkText]}>Cancel</Text>
              </Pressable>

              <Pressable style={[styles.avatarOption, styles.primaryOption]} onPress={() => { closeAvatarActions(); chooseFromGallery(); }}>
                <Text style={[styles.avatarOptionText, isDarkMode && styles.darkText]}>Choose from Gallery</Text>
              </Pressable>

              <Pressable style={[styles.avatarOption, styles.primaryOption]} onPress={() => { closeAvatarActions(); takePhoto(); }}>
                <Text style={[styles.avatarOptionText, isDarkMode && styles.darkText]}>Take a Photo</Text>
              </Pressable>

              <Pressable style={[styles.avatarOption, styles.primaryOption]} onPress={() => { closeAvatarActions(); setAvatarImage(null); }}>
                <Text style={[styles.avatarOptionText, isDarkMode && styles.darkText]}>Use default avatar</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <AiChatSheet
        chat={coachChat}
        visible={coachOpen}
        onClose={() => setCoachOpen(false)}
        title={t('aiCoach')}
        subtitle="One specific next step, from your own habits"
        greeting={`Hi ${profile.firstName?.trim() || 'there'}! I'm your AI Coach. Ask what to focus on and I'll give you one specific next step based on your habits and streaks.`}
        suggestions={['What should I do today?', 'How do I restart my streak?', 'What habit is most important?']}
        placeholder="Ask your coach..."
        costLabel={`${COACH_COST} tokens per answer · ${tokens} left`}
        footnote="Tokens are used only when the Coach answers. Answers can be wrong."
        autoFocus
      />
      {titleOpen && <TitleSheet current={rewards.title} onClose={() => setTitleOpen(false)} />}
      <FrameSheet visible={frameOpen} onClose={() => setFrameOpen(false)} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: {
    flex: 1,
    backgroundColor: '#F5F4F9',
  },
  darkScreen: {
    backgroundColor: '#111018',
  },
  darkCard: {
    backgroundColor: '#1D1A24',
  },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  avatarModalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(20, 16, 32, 0.38)',
    paddingHorizontal: 18,
  },
  avatarModalCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#F7F4FB',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    alignItems: 'center',
  },
  avatarModalIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: '#EAE4FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  avatarModalTitle: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    color: '#1F1E2B',
    textAlign: 'center',
  },
  avatarModalSubtitle: {
    fontSize: 15,
    lineHeight: 22,
    color: '#5A586A',
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 16,
  },
  avatarOptionGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 12,
  },
  avatarOption: {
    width: '47%',
    minHeight: 82,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 10,
  },
  cancelOption: {
    backgroundColor: '#EAE7F2',
  },
  primaryOption: {
    backgroundColor: '#5B42D8',
  },
  avatarOptionText: {
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '700',
    color: '#FFFFFF',
    textAlign: 'center',
  },
  cancelOptionText: {
    color: '#2F2B3B',
  },
  content: {
    paddingBottom: 110,
  },
  container: {
    width: '100%',
    // Same width as the other tabs, so switching tabs does not resize the page.
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  wideContainer: {
    width: '100%',
    // Same width as the other tabs, so switching tabs does not resize the page.
    maxWidth: CONTENT_MAX_WIDTH,
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  headerTitle: {
    fontSize: 21,
    fontWeight: '800',
    color: '#24212D',
  },
  headerButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  facultyClassCard: { marginTop: 16 },
  banner: { height: 92, backgroundColor: '#5B42D8', overflow: 'hidden', alignItems: 'flex-end', padding: 12 },
  bannerDark: { backgroundColor: '#30215A' },
  bannerCircleOne: { position: 'absolute', width: 180, height: 180, borderRadius: 90, right: -40, top: -90, backgroundColor: 'rgba(255,255,255,0.12)' },
  bannerCircleTwo: { position: 'absolute', width: 120, height: 120, borderRadius: 60, left: -30, bottom: -70, backgroundColor: 'rgba(255,255,255,0.08)' },
  profileCard: { backgroundColor: '#FFFFFF', borderRadius: 26, overflow: 'hidden', marginBottom: 14, shadowColor: '#292047', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 3 },
  identityRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: 18, marginTop: -44 },
  avatarPressable: { position: 'relative' },
  avatarRing: { width: 88, height: 88, borderRadius: 44, padding: 4, backgroundColor: '#FFFFFF' },
  avatarCircle: { width: '100%', height: '100%', borderRadius: 999, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 32, fontWeight: '900', color: '#5B42D8' },
  cameraBadge: { position: 'absolute', right: 2, bottom: 2, width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8', borderWidth: 2, borderColor: '#FFFFFF' },
  editButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#F1EDFF', marginBottom: 6 },
  editButtonText: { fontSize: 13, fontWeight: '900', color: '#5B42D8' },
  identityCopy: { paddingHorizontal: 18, paddingTop: 10 },
  name: { fontSize: 22, lineHeight: 27, fontWeight: '900', color: '#1F1C26' },
  username: { fontSize: 13, fontWeight: '700', color: '#7A7488', marginTop: 2 },
  rewardRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  frameChip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 30, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#FFF4D9' },
  frameChipText: { fontSize: 12, fontWeight: '800', color: '#8A5A00' },
  facultyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  facultyPillText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
  levelBox: { marginHorizontal: 18, marginTop: 14, padding: 12, borderRadius: 16, backgroundColor: '#F6F3FF' },
  levelTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: '#5B42D8' },
  levelBadgeText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  levelXp: { fontSize: 13, fontWeight: '900', color: '#3B3650' },
  levelTrack: { height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#E4DEF7', marginTop: 10 },
  levelFill: { height: '100%', borderRadius: 4, backgroundColor: '#5B42D8' },
  levelHint: { fontSize: 12, fontWeight: '600', color: '#6E6887', marginTop: 7 },
  statsRow: { flexDirection: 'row', marginTop: 14, borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  stat: { flex: 1, minWidth: 0, alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4 },
  statDivider: { borderLeftWidth: 1, borderLeftColor: '#F0EEF5' },
  statTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statValue: { fontSize: 18, fontWeight: '900', color: '#1F1C26' },
  statLabel: { fontSize: 11, fontWeight: '700', color: '#7A7488', marginTop: 2 },
  coachCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, marginBottom: 14, backgroundColor: '#F1EDFF', borderWidth: 1, borderColor: '#E1D9FB' },
  coachCardDark: { backgroundColor: '#241D3A', borderColor: '#352C52' },
  coachIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  coachCopy: { flex: 1, minWidth: 0 },
  coachTitle: { fontSize: 16, fontWeight: '900', color: '#24212D' },
  coachText: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#6E6887', marginTop: 2 },
  coachButton: { minHeight: 38, paddingHorizontal: 16, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  coachButtonText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, marginBottom: 14, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 12 },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#1F1C26' },
  cardSubtitle: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  cardLink: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 24 },
  cardLinkText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  badgeIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  nextBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F6F3FF' },
  nextBadgeText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#4A4458' },
  goalRow: { paddingVertical: 10, borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  goalTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  goalTitle: { flex: 1, fontSize: 14, lineHeight: 19, fontWeight: '800', color: '#2D2A3D' },
  goalPercent: { fontSize: 14, fontWeight: '900', color: '#5B42D8' },
  goalTrack: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: '#EEEAF6', marginTop: 8 },
  goalFill: { height: '100%', borderRadius: 4, backgroundColor: '#5B42D8' },
  goalFillDone: { backgroundColor: '#2E9D5C' },
  goalMeta: { fontSize: 12, fontWeight: '600', color: '#7A7488', marginTop: 6 },
  goalEmpty: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#F6F3FF' },
  goalEmptyIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  goalEmptyText: { flex: 1, fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  groupLabel: { fontSize: 12, fontWeight: '900', letterSpacing: 0.8, textTransform: 'uppercase', color: '#7A7488', marginTop: 6, marginBottom: 8, marginLeft: 4 },
  menuCard: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 14, marginBottom: 14, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 58 },
  menuBorder: { borderBottomWidth: 1, borderBottomColor: '#F0EEF5' },
  menuBorderTop: { borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  menuIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontSize: 15, fontWeight: '700', color: '#2D2A3D' },
  logOutText: { color: '#D94868', fontWeight: '800' },
  pressed: { opacity: 0.8 },
});

