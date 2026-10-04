import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyLeaderboardRank } from '@/authentication';
import { BentoTile } from '@/components/bento-tiles';
import { ClassPulseCard } from '@/components/class-pulse-card';
import { FramedAvatar } from '@/components/framed-avatar';
import { FrameSheet, TitleBadge, TitleSheet } from '@/components/reward-sheets';
import { useAppDialog } from '@/components/ui/app-dialog';
import { badgeProgress, badgeRemaining, historyStats, nextBadge } from '@/utils/achievements';
import { askAi } from '@/utils/ai-client';
import { rankSummary } from '@/utils/rank';
import type { TranslationKey } from '@/constants/i18n';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';
import { CONTENT_MAX_WIDTH } from '@/hooks/use-responsive-layout';
import { useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const settings = [
  { key: 'personalInformation', icon: 'person-outline', route: '/personal-information' },
  { key: 'statsProgress', icon: 'stats-chart-outline', route: '/stats-progress' },
  { key: 'leaderboards', icon: 'trophy-outline', route: '/leaderboards' },
  { key: 'activityHistory', icon: 'time-outline', route: '/activity-history' },
  { key: 'achievementsBadges', icon: 'ribbon-outline', route: '/achievements' },
  { key: 'helpSupport', icon: 'help-circle-outline', route: '/help-support' },
] as const;

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
  const rankText = rankInfo ? rankSummary(rankInfo.rank, rankInfo.total) : null;
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
  const level = Math.floor(points / 100) + 1;
  const displayName = profile.fullName?.trim() || 'Your profile';
  const displayUsername = profile.username?.trim() ? `@${profile.username.trim()}` : '';
  // Without a photo the avatar shows the student's initial.
  const avatarInitial = (profile.firstName || profile.fullName || 'H').trim().charAt(0).toUpperCase();
  const [avatarModalOpen, setAvatarModalOpen] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachQuestion, setCoachQuestion] = useState('');
  const [coachReply, setCoachReply] = useState('');
  const [coachError, setCoachError] = useState('');
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachLockedOpen, setCoachLockedOpen] = useState(false);

  const askCoach = async () => {
    const question = coachQuestion.trim();
    if (!question) return;
    if (tokens < 10) {
      setCoachLockedOpen(true);
      return;
    }

    setCoachLoading(true);
    setCoachError('');
    try {
      // The server charges 10 tokens only when the coach actually answers.
      const result = await askAi('coach', question);
      if (result.ok) {
        applyWallet(result);
        setCoachReply(result.answer);
        setCoachQuestion('');
      } else {
        setCoachError(result.status === 402 ? result.message : `${result.message} Your tokens were not spent.`);
      }
    } finally {
      setCoachLoading(false);
    }
  };

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

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.container, width >= 700 && styles.wideContainer, { paddingHorizontal: compactLayout ? 12 : 20 }]}>
          <View style={styles.headerRow}>
            <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>{t('profile')}</Text>
            <Pressable style={styles.headerButton} onPress={() => router.push('/settings-preferences')} accessibilityLabel={t('profileSettings')}>
              <Ionicons name="options-outline" size={18} color={themeColor('#3B3548')} />
            </Pressable>
          </View>

          <View style={styles.profileHeader}>
            <Pressable style={styles.avatarPressable} onPress={openAvatarActions} accessibilityLabel="Change profile picture">
              {rewards.frame ? (
                <FramedAvatar frame={rewards.frame} size={78}>
                  <View style={styles.avatarCircle}>
                    {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>{avatarInitial}</Text>}
                  </View>
                </FramedAvatar>
              ) : (
                <View style={styles.avatarRing}>
                  <View style={styles.avatarCircle}>
                    {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>{avatarInitial}</Text>}
                  </View>
                </View>
              )}
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={12} color={themeColor('#FFFFFF')} />
              </View>
            </Pressable>
            <Text style={[styles.name, isDarkMode && styles.darkText]}>{displayName}</Text>
            {displayUsername ? <Text style={styles.username}>{displayUsername}</Text> : null}
            {rewards.owns('custom-title') && <TitleBadge title={rewards.title} onPress={() => setTitleOpen(true)} style={styles.titleBadge} />}
            {rewards.owns('profile-frames') && (
              <Pressable style={({ pressed }) => [styles.frameChip, pressed && styles.frameChipPressed]} onPress={() => setFrameOpen(true)} accessibilityRole="button" accessibilityLabel="Change profile frame">
                <Ionicons name="person-circle-outline" size={13} color={themeColor('#8A5A00')} />
                <Text style={styles.frameChipText}>{rewards.frame ? 'Change frame' : 'Add a frame'}</Text>
              </Pressable>
            )}
            <View style={styles.levelPill}>
              <Text style={styles.levelText}>Level {level}</Text>
              <Ionicons name="star" size={11} color={themeColor('#F2B94B')} />
              <Text style={styles.levelText}>{points ? 'Active' : 'Getting started'}</Text>
            </View>
            {isFaculty && (
              <View style={styles.facultyPill}>
                <Ionicons name="briefcase" size={11} color={themeColor('#FFFFFF')} />
                <Text style={styles.facultyPillText}>PSAU Faculty</Text>
              </View>
            )}
          </View>

          <View style={styles.bentoGrid}>
            <BentoTile
              tone="streak"
              label="Streak"
              value={String(maxStreak)}
              unit={maxStreak === 1 ? 'day' : 'days'}
              detail={`Best ${bestStreak} ${bestStreak === 1 ? 'day' : 'days'}`}
              onPress={() => router.push('/stats-progress')}
              accessibilityLabel={`${maxStreak}-day streak, best ${bestStreak}. Open stats`}
            />
            <BentoTile
              tone="level"
              label="Points"
              value={String(points)}
              detail={`Level ${level} · ${100 - (points % 100)} XP to next`}
              onPress={() => router.push('/achievements')}
              accessibilityLabel={`${points} points, level ${level}. Open badges`}
            />
            {isFaculty ? (
              <BentoTile
                tone="rank"
                label="Goals"
                value={String(goals.length)}
                detail={goals.length ? 'Plans in progress' : 'Turn an idea into a plan'}
                onPress={() => router.push('/goals')}
                accessibilityLabel={`${goals.length} goals. Open goals`}
              />
            ) : (
              <BentoTile
                tone="rank"
                label="Rank"
                value={rankInfo ? `#${rankInfo.rank}` : '—'}
                detail={rankText ? `${rankText.title} · ${rankText.of}` : 'Earn points to join the leaderboard'}
                onPress={() => router.push('/leaderboards')}
                accessibilityLabel={rankInfo ? `Rank ${rankInfo.rank} of ${rankInfo.total}. Open leaderboards` : 'Open leaderboards'}
              />
            )}
            <BentoTile
              tone="tokens"
              label="Tokens"
              value={String(tokens)}
              detail="Ask your AI Coach"
              onPress={() => setCoachOpen(true)}
              accessibilityLabel={`${tokens} tokens. Ask your AI Coach`}
            />
          </View>

          <Pressable style={styles.badgeStrip} onPress={() => router.push('/achievements')} accessibilityRole="button" accessibilityLabel={`Badges: ${earnedBadges} of ${badges.length} earned. Open achievements`}>
            <View style={styles.badgeStripHeader}>
              <Text style={styles.badgeStripTitle}>Badges</Text>
              <View style={styles.badgeStripCountRow}>
                <Text style={styles.badgeStripCount}>{earnedBadges}/{badges.length} earned</Text>
                <Ionicons name="chevron-forward" size={14} color={themeColor('#5B42D8')} />
              </View>
            </View>
            <View style={styles.badgeStripRow}>
              {badgeStrip.map((badge) => (
                <View key={badge.id} style={[styles.badgeStripIcon, { backgroundColor: themeColor(badge.earned ? badge.background : '#EEF0F4', 'backgroundColor') }]}>
                  <Ionicons name={badge.icon as keyof typeof Ionicons.glyphMap} size={18} color={badge.earned ? badge.color : themeColor('#A3A8B5')} />
                </View>
              ))}
            </View>
            {upcomingBadge && <Text style={styles.badgeStripNext}>Next: {upcomingBadge.title} · {badgeRemaining(upcomingBadge)}</Text>}
          </Pressable>

          <View style={styles.profileGoalsSection}>
            <View style={styles.profileGoalsHeader}>
              <View>
                <Text style={[styles.profileGoalsTitle, isDarkMode && styles.darkText]}>My Goals</Text>
                <Text style={[styles.profileGoalsSubtitle, isDarkMode && styles.darkMutedText]}>{goals.length ? 'Your plans and next steps.' : 'Turn an intention into a plan.'}</Text>
              </View>
              <Pressable onPress={() => router.push('/goals')} accessibilityRole="button" accessibilityLabel="View all goals">
                <View style={styles.profileGoalsViewAll}>
                  <Text style={styles.profileGoalsViewAllText}>View all</Text>
                  <Ionicons name="chevron-forward" size={15} color={themeColor('#5B42D8')} />
                </View>
              </Pressable>
            </View>
            {goals.length ? goals.slice(0, 2).map((goal) => (
              <Pressable
                key={goal.id}
                style={[styles.profileGoalCard, isDarkMode && styles.darkCard]}
                onPress={() => router.push('/goals')}
                accessibilityRole="button"
                accessibilityLabel={`Open goal ${goal.title}`}
              >
                <View style={styles.profileGoalHeader}>
                  <View style={styles.profileGoalCopy}>
                    <Text style={[styles.profileGoalCategory, isDarkMode && styles.darkMutedText]}>{goal.category}</Text>
                    <Text style={[styles.profileGoalTitle, isDarkMode && styles.darkText]} numberOfLines={2}>{goal.title}</Text>
                  </View>
                  <Text style={styles.profileGoalPercent}>{Math.max(0, Math.min(100, goal.progress))}%</Text>
                </View>
                <View style={styles.profileGoalTrack}>
                  <View style={[styles.profileGoalFill, { width: `${Math.max(0, Math.min(100, goal.progress))}%` }]} />
                </View>
                <Text style={[styles.profileGoalStatus, isDarkMode && styles.darkMutedText]}>{goal.status}</Text>
              </Pressable>
            )) : (
              <Pressable
                style={[styles.profileGoalsEmpty, isDarkMode && styles.darkCard]}
                onPress={() => router.push('/goals')}
                accessibilityRole="button"
                accessibilityLabel="Create your first goal"
              >
                <View style={styles.profileGoalsEmptyIcon}><Ionicons name="flag-outline" size={19} color={themeColor('#5B42D8')} /></View>
                <Text style={[styles.profileGoalsEmptyText, isDarkMode && styles.darkText]}>Create your first goal</Text>
                <Ionicons name="chevron-forward" size={17} color={themeColor('#8C8498')} />
              </Pressable>
            )}
          </View>

          {isFaculty && <ClassPulseCard style={styles.facultyClassCard} />}

          <Text style={styles.sectionLabel}>{t('account')} &amp; {t('preferences')}</Text>
          <View style={[styles.settingsCard, isDarkMode && styles.darkCard]}>
            {menuItems.map((item, index) => (
              <Pressable
                key={item.key}
                style={[styles.settingRow, index < menuItems.length - 1 && styles.settingBorder]}
                onPress={() => router.push(item.route)}
              >
                <View style={styles.settingIcon}>
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={17} color={themeColor('#5B42D8')} />
                </View>
                <Text style={styles.settingLabel}>{t(item.key as TranslationKey)}</Text>
                <Ionicons name="chevron-forward" size={16} color={themeColor('#A19CAA')} />
              </Pressable>
            ))}
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

      <Modal visible={coachOpen} animationType="slide" transparent onRequestClose={() => setCoachOpen(false)}>
        <View style={styles.coachBackdrop}>
          <View style={[styles.coachModal, isDarkMode && styles.darkCard]}>
            <View style={styles.coachHeader}>
              <View style={styles.coachHeaderText}>
                <Text style={[styles.coachTitle, isDarkMode && styles.darkText]}>{t('aiCoach')}</Text>
                <Text style={[styles.coachBody, isDarkMode && styles.darkMutedText]}>Ask for a focused habit suggestion. Each answer costs 10 tokens.</Text>
              </View>
              <Pressable onPress={() => { setCoachOpen(false); setCoachError(''); }} accessibilityLabel="Close AI Coach">
                <Ionicons name="close" size={24} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
            </View>

            <View style={styles.coachTokenPill}>
              <Ionicons name="sparkles" size={14} color={themeColor('#5B42D8')} />
              <Text style={styles.coachTokenText}>{tokens} tokens available</Text>
            </View>

            <Text style={[styles.coachFieldLabel, isDarkMode && styles.darkMutedText]}>What should I focus on today?</Text>
            <TextInput
              value={coachQuestion}
              onChangeText={setCoachQuestion}
              placeholder="Ask your coach..."
              placeholderTextColor={isDarkMode ? '#827C8C' : '#9A94A4'}
              multiline
              style={[styles.coachInput, isDarkMode && styles.darkInput]}
            />

            <View style={styles.quickPromptRow}>
              {['What should I do today?', 'How do I restart my streak?', 'What habit is most important?'].map((prompt) => (
                <Pressable key={prompt} style={[styles.quickPrompt, isDarkMode && styles.darkQuickPrompt]} onPress={() => setCoachQuestion(prompt)}>
                  <Text style={[styles.quickPromptText, isDarkMode && styles.darkText]}>{prompt}</Text>
                </Pressable>
              ))}
            </View>

            {coachError ? <Text style={styles.coachError}>{coachError}</Text> : null}

            {coachReply ? (
              <View style={[styles.coachReplyCard, isDarkMode && styles.darkReplyCard]}>
                <Text style={[styles.coachReplyLabel, isDarkMode && styles.darkMutedText]}>Coach response</Text>
                <Text style={[styles.coachReplyText, isDarkMode && styles.darkText]}>{coachReply}</Text>
              </View>
            ) : null}

            <Pressable
              style={({ pressed }) => [styles.primaryButton, pressed && styles.primaryButtonPressed, coachLoading && styles.primaryButtonDisabled]}
              onPress={askCoach}
              disabled={coachLoading}
            >
              <Text style={styles.primaryButtonText}>{coachLoading ? 'Thinking...' : t('askCoach')}</Text>
              <Ionicons name="sparkles" size={16} color={themeColor('#FFFFFF')} />
            </Pressable>
          </View>
        </View>
      </Modal>

      <Modal visible={coachLockedOpen} transparent animationType="fade" onRequestClose={() => setCoachLockedOpen(false)}>
        <View style={styles.coachLockBackdrop}>
          <View style={styles.coachLockCard}>
            <Text style={styles.coachLockTitle}>Not enough tokens</Text>
            <Text style={styles.coachLockText}>Complete more habits to unlock another AI Coach answer.</Text>
            <Pressable style={styles.coachLockButton} onPress={() => setCoachLockedOpen(false)}>
              <Text style={styles.coachLockButtonText}>OK</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
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
  darkInput: { borderColor: '#3B3647', color: '#F2EFF8', backgroundColor: '#25212E' },
  coachBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  coachModal: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '82%' },
  coachHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 },
  coachHeaderText: { flex: 1, paddingRight: 10 },
  coachTitle: { fontSize: 22, fontWeight: '800', color: '#24212D' },
  coachBody: { fontSize: 12, lineHeight: 18, color: '#827C8C', marginTop: 4 },
  coachFieldLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: '#5F596B', marginBottom: 8 },
  coachTokenPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', backgroundColor: '#F1ECFF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6, marginBottom: 14, gap: 6 },
  coachTokenText: { fontSize: 11, fontWeight: '700', color: '#4D3AA6' },
  coachInput: { minHeight: 58, borderWidth: 1, borderColor: '#E2DEEA', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, color: '#302B3B', marginBottom: 12, textAlignVertical: 'top' },
  quickPromptRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  quickPrompt: { backgroundColor: '#F5F1FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#E5DDFE' },
  quickPromptText: { color: '#4A3B8A', fontSize: 10.5, fontWeight: '700' },
  darkQuickPrompt: { backgroundColor: '#2A2337', borderColor: '#3B3547' },
  coachError: { color: '#C54F4F', fontSize: 11, lineHeight: 16, marginBottom: 12 },
  coachReplyCard: { backgroundColor: '#F7F4FF', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#E5DDFE', marginBottom: 12 },
  darkReplyCard: { backgroundColor: '#221D2A', borderColor: '#382F48' },
  coachReplyLabel: { fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1, color: '#72698B', marginBottom: 6 },
  coachReplyText: { fontSize: 12.5, lineHeight: 20, color: '#2C2737', fontWeight: '600' },
  coachLockBackdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(18, 18, 28, 0.42)', paddingHorizontal: 22 },
  coachLockCard: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 14, alignItems: 'center' },
  coachLockTitle: { fontSize: 24, lineHeight: 30, fontWeight: '800', color: '#2B2C36', textAlign: 'center', marginBottom: 10 },
  coachLockText: { fontSize: 18, lineHeight: 26, fontWeight: '400', color: '#2B2C36', textAlign: 'center', marginBottom: 18 },
  coachLockButton: { width: '100%', paddingVertical: 12, borderRadius: 12, backgroundColor: '#F5F2FF', alignItems: 'center', justifyContent: 'center' },
  coachLockButtonText: { fontSize: 18, fontWeight: '700', color: '#4B3AA7' },
  primaryButtonDisabled: { opacity: 0.75 },
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
  profileHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  avatarPressable: {
    position: 'relative',
    marginBottom: 10,
  },
  avatarRing: {
    width: 94,
    height: 94,
    borderRadius: 47,
    backgroundColor: '#E5D9FC',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  avatarCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#F3DAD5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 42,
    fontWeight: '800',
    color: '#5B42D8',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 39,
  },
  cameraBadge: {
    position: 'absolute',
    right: 0,
    bottom: 5,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#5B42D8',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  name: {
    fontSize: 18,
    fontWeight: '800',
    color: '#24212D',
  },
  username: {
    fontSize: 11,
    color: '#817B89',
    fontWeight: '600',
    marginTop: 3,
  },
  titleBadge: { alignSelf: 'center', marginTop: 7 },
  frameChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'center', marginTop: 6, minHeight: 30, paddingHorizontal: 10, borderRadius: 999, backgroundColor: '#FFF4D6' },
  frameChipPressed: { opacity: 0.85 },
  frameChipText: { fontSize: 11, fontWeight: '800', color: '#8A5A00' },
  bentoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  facultyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: '#5B42D8' },
  facultyPillText: { fontSize: 10, fontWeight: '800', color: '#FFFFFF' },
  facultyClassCard: { marginTop: 16 },
  levelPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EDE6FF',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 8,
  },
  levelText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#5639B8',
  },
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    marginBottom: 14,
  },
  statCell: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  statDivider: {
    width: 1,
    height: 42,
    backgroundColor: '#ECE9F0',
  },
  statValue: {
    fontSize: 19,
    fontWeight: '800',
    color: '#292531',
  },
  statLabel: {
    fontSize: 10,
    color: '#5F596B',
    fontWeight: '600',
  },
  badgeStrip: { width: '100%', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginBottom: 14, shadowColor: '#201444', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
  badgeStripHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  badgeStripTitle: { fontSize: 15, fontWeight: '800', color: '#2F2D3C' },
  badgeStripCountRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  badgeStripCount: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  badgeStripRow: { flexDirection: 'row', justifyContent: 'space-between' },
  badgeStripIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  badgeStripNext: { marginTop: 10, fontSize: 12, fontWeight: '700', color: '#6A6573' },
  firstActionCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#DDD4F7' },
  firstActionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  firstActionCopy: { marginBottom: 14 },
  profileGoalsSection: { marginBottom: 14 },
  profileGoalsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  profileGoalsTitle: { color: '#292531', fontSize: 15, fontWeight: '800' },
  profileGoalsSubtitle: { color: '#777180', fontSize: 10, lineHeight: 15, marginTop: 2 },
  profileGoalsViewAll: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 40, paddingLeft: 10 },
  profileGoalsViewAllText: { color: '#5B42D8', fontSize: 11, fontWeight: '800' },
  profileGoalCard: { backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: '#E8E4EF' },
  profileGoalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  profileGoalCopy: { flex: 1 },
  profileGoalCategory: { color: '#777180', fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  profileGoalTitle: { color: '#292531', fontSize: 12, fontWeight: '800', lineHeight: 17, marginTop: 3 },
  profileGoalPercent: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  profileGoalTrack: { height: 6, backgroundColor: '#E9E3F7', borderRadius: 3, overflow: 'hidden', marginTop: 10 },
  profileGoalFill: { height: '100%', backgroundColor: '#5B42D8', borderRadius: 3 },
  profileGoalStatus: { color: '#777180', fontSize: 9, fontWeight: '700', marginTop: 6 },
  profileGoalsEmpty: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#E8E4EF' },
  profileGoalsEmptyIcon: { width: 36, height: 36, borderRadius: 11, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  profileGoalsEmptyText: { flex: 1, color: '#292531', fontSize: 12, fontWeight: '800' },
  firstActionEyebrow: { color: '#7A6AE7', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 4 },
  firstActionTitle: { color: '#292531', fontSize: 16, fontWeight: '800', lineHeight: 21 },
  firstActionBody: { color: '#6E6878', fontSize: 11.5, lineHeight: 17, marginTop: 4 },
  firstActionButton: { minHeight: 46, borderRadius: 12, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  firstActionButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  dailyWinCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFBF0', borderRadius: 16, padding: 12, marginBottom: 20, borderWidth: 1, borderColor: '#F3E4B6' },
  dailyWinIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#FFF0C2', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  dailyWinCopy: { flex: 1 },
  dailyWinTitle: { color: '#463A1B', fontSize: 12, fontWeight: '900' },
  dailyWinBody: { color: '#786A43', fontSize: 10.5, lineHeight: 15, marginTop: 2 },
  dailyWinPoints: { color: '#B27A0B', fontSize: 11, fontWeight: '900', marginLeft: 7 },
  progressCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 20,
  },
  progressHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#302B3B',
  },
  cardSubtitle: {
    fontSize: 10,
    color: '#827C8C',
    fontWeight: '600',
    marginTop: 3,
  },
  progressPercent: {
    fontSize: 18,
    fontWeight: '800',
    color: '#5B42D8',
  },
  progressTrack: {
    height: 10,
    borderRadius: 5,
    backgroundColor: '#EAE4FB',
    marginTop: 14,
    overflow: 'hidden',
  },
  progressFill: {
    width: '75%',
    height: '100%',
    borderRadius: 5,
    backgroundColor: '#5B42D8',
  },
  progressMeta: {
    fontSize: 10,
    color: '#777181',
    fontWeight: '600',
    marginTop: 8,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '800',
    color: '#4A4553',
    marginBottom: 8,
  },
  leaderboardSection: {
    marginBottom: 18,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#2A2634',
  },
  linkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5B42D8',
  },
  leaderboardCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  leaderboardEmptyCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#E2DCF2' },
  leaderboardEmptyIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  leaderboardEmptyCopy: { flex: 1 },
  leaderboardEmptyTitle: { color: '#302B3B', fontSize: 12, fontWeight: '800' },
  leaderboardEmptyBody: { color: '#756F80', fontSize: 10.5, lineHeight: 15, marginTop: 3 },
  leaderboardColumn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderboardLabel: {
    fontSize: 12,
    color: '#5C5667',
    fontWeight: '700',
    alignSelf: 'flex-start',
    width: '100%',
  },
  rankRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    justifyContent: 'center',
  },
  rankValue: {
    fontSize: 24,
    color: '#2D2A38',
    fontWeight: '800',
    marginRight: 10,
  },
  badgeCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F7E3A8',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  trophyImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  scoreValue: {
    fontSize: 22,
    color: '#2D2A38',
    fontWeight: '800',
    marginTop: 8,
  },
  risingStarText: {
    fontSize: 10,
    color: '#5B42D8',
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 4,
  },
  rankMeta: {
    fontSize: 10,
    color: '#7B7585',
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
  leagueText: {
    fontSize: 10,
    color: '#7B7585',
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 2,
  },
  leaderboardDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#EEEAF5',
    marginHorizontal: 18,
  },
  primaryButton: {
    backgroundColor: '#7657E8',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  primaryButtonPressed: {
    backgroundColor: '#5B3BC7',
    transform: [{ scale: 0.98 }],
  },
  secondaryButton: { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#7657E8', borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  secondaryButtonPressed: { backgroundColor: '#F0EBFF', transform: [{ scale: 0.98 }] },
  secondaryButtonText: { fontSize: 12, color: '#5B42D8', fontWeight: '800' },
  primaryButtonText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '800',
  },
  tokenCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    marginBottom: 18,
  },
  tokenLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  tokenIconWrap: {
    width: 58,
    height: 58,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    backgroundColor: '#E9E5F8',
  },
  coachImage: {
    width: 58,
    height: 58,
    borderRadius: 18,
  },
  tokenTextWrap: {
    flex: 1,
    marginRight: 12,
  },
  tokenTitle: {
    fontSize: 12,
    color: '#2A2634',
    fontWeight: '800',
    marginBottom: 4,
  },
  tokenDescription: {
    fontSize: 10,
    color: '#7A7586',
    fontWeight: '600',
    lineHeight: 15,
  },
  tokenMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginBottom: 12,
    gap: 8,
  },
  tokenValueWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  tokenBadgeImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F5F0E8',
  },
  tokenValueLarge: {
    fontSize: 26,
    fontWeight: '800',
    color: '#2D2A38',
  },
  tokenLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#6E6579',
  },
  settingsCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    paddingHorizontal: 14,
  },
  settingRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0EEF3',
  },
  settingIcon: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#F1ECFF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  settingLabel: {
    flex: 1,
    fontSize: 12,
    color: '#393440',
    fontWeight: '700',
  },
});

