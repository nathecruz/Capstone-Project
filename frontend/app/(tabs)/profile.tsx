import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { getAuthenticatedHeaders } from '@/authentication';
import type { TranslationKey } from '@/constants/i18n';
import { getHabitProgressSummary, useAppColorScheme } from '@/hooks/color-scheme-context';

const settings = [
  { key: 'personalInformation', icon: 'person-outline', route: '/personal-information' },
  { key: 'statsProgress', icon: 'stats-chart-outline', route: '/stats-progress' },
  { key: 'leaderboards', icon: 'trophy-outline', route: '/leaderboards' },
  { key: 'activityHistory', icon: 'time-outline', route: '/activity-history' },
  { key: 'achievementsBadges', icon: 'ribbon-outline', route: '/achievements' },
  { key: 'helpSupport', icon: 'help-circle-outline', route: '/help-support' },
] as const;

export default function ProfileScreen() {
  const showAlert = useAppDialog();
  const { isDarkMode, avatarImage, setAvatarImage, habits, profile, points, tokens, addTokens, t } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const { averageProgress, maxStreak, completed } = getHabitProgressSummary(habits);
  const isNewUser = habits.length === 0 && points === 0;
  const firstActionLabel = isNewUser ? 'Start your first goal' : completed === 0 ? 'Complete a task' : 'Keep your momentum';
  const level = Math.floor(points / 100) + 1;
  const displayName = profile.fullName?.trim() || 'Zaira Samson';
  const displayUsername = profile.username?.trim() ? `@${profile.username.trim()}` : '@zai';
  const [avatar, setAvatar] = useState('A');
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
      const apiUrl = (process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_AI_API_URL)?.replace(/\/$/, '');
      const summary = {
        completionPercent: Math.round(habits.length ? habits.reduce((sum, habit) => sum + habit.progress, 0) / habits.length : 0),
        averageProgress: Math.round(habits.length ? habits.reduce((sum, habit) => sum + habit.progress, 0) / habits.length : 0),
        completed: habits.filter((habit) => habit.done).length,
        missedHabits: Math.max(0, habits.length - habits.filter((habit) => habit.done).length),
        maxStreak: Math.max(0, ...habits.map((habit) => habit.streak), 0),
        habits: habits.map((habit) => ({ label: habit.label, progress: habit.progress, streak: habit.streak, done: habit.done })),
      };

      if (!apiUrl) throw new Error('AI service unavailable');
      {
        const authHeaders = await getAuthenticatedHeaders();
        const response = await fetch(`${apiUrl}/api/insights/assistant`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            question,
            summary,
          }),
        });

        if (response.ok) {
          const result = (await response.json()) as { answer?: string };
          if (result.answer) {
            addTokens(-10, 'AI Coach');
            setCoachReply(result.answer);
            setCoachQuestion('');
            setCoachLoading(false);
            return;
          }
        }

        throw new Error('AI service unavailable');
      }

    } catch {
      setCoachError('The secure AI service is unavailable right now. Your tokens were not spent.');
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
        <View style={[styles.container, width >= 700 && styles.wideContainer]}>
          <View style={styles.headerRow}>
            <Text style={styles.headerTitle}>{t('profile')}</Text>
            <Pressable style={styles.headerButton} onPress={() => router.push('/settings-preferences')} accessibilityLabel={t('profileSettings')}>
              <Ionicons name="options-outline" size={18} color="#3B3548" />
            </Pressable>
          </View>

          <View style={styles.profileHeader}>
            <Pressable style={styles.avatarPressable} onPress={openAvatarActions} accessibilityLabel="Change profile picture">
              <View style={styles.avatarRing}>
              <View style={styles.avatarCircle}>
                  {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>{avatar}</Text>}
              </View>
              </View>
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={12} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.username}>{displayUsername}</Text>
            <View style={styles.levelPill}>
              <Text style={styles.levelText}>Level {level}</Text>
              <Ionicons name="star" size={11} color="#F2B94B" />
              <Text style={styles.levelText}>{points ? 'Active' : 'Getting started'}</Text>
            </View>
          </View>

          <View style={[styles.firstActionCard, isDarkMode && styles.darkCard]}>
            <View style={styles.firstActionIcon}><Ionicons name={isNewUser ? 'flag-outline' : 'checkmark-circle-outline'} size={21} color="#5B42D8" /></View>
            <View style={styles.firstActionCopy}>
              <Text style={[styles.firstActionEyebrow, isDarkMode && styles.darkMutedText]}>{isNewUser ? 'YOUR NEXT STEP' : 'TODAY&apos;S WIN'}</Text>
              <Text style={[styles.firstActionTitle, isDarkMode && styles.darkText]}>{isNewUser ? 'Build your first growth plan' : completed === 0 ? 'One completed task starts your streak' : 'You are building momentum'}</Text>
              <Text style={[styles.firstActionBody, isDarkMode && styles.darkMutedText]}>{isNewUser ? 'Turn one intention into a clear, doable plan.' : completed === 0 ? 'Choose one small task and earn your first points.' : 'Keep the loop going with one more focused action.'}</Text>
            </View>
            <Pressable style={styles.firstActionButton} onPress={() => router.push(isNewUser ? '/goals' : '/')} accessibilityRole="button">
              <Text style={styles.firstActionButtonText}>{firstActionLabel}</Text>
              <Ionicons name="arrow-forward" size={15} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={[styles.statsCard, isDarkMode && styles.darkCard]}>
            <View style={styles.statCell}>
              <Ionicons name="flame" size={17} color="#E68D3D" />
              <Text style={styles.statValue}>{maxStreak}</Text>
              <Text style={styles.statLabel}>{t('dayStreak')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statCell}>
              <Ionicons name="trophy" size={17} color="#E3A52E" />
              <Text style={styles.statValue}>{points}</Text>
              <Text style={styles.statLabel}>{t('totalPoints')}</Text>
            </View>
          </View>

          <View style={[styles.progressCard, isDarkMode && styles.darkCard]}>
            <View style={styles.progressHeader}>
              <View>
                <Text style={styles.cardTitle}>{t('currentProgress')}</Text>
                <Text style={styles.cardSubtitle}>{t('keepMomentum')}</Text>
              </View>
              <Text style={styles.progressPercent}>{averageProgress}%</Text>
            </View>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${averageProgress}%` }]} />
            </View>
            <Text style={styles.progressMeta}>{averageProgress === 0 ? 'Complete your first task to start your streak.' : `${completed} task${completed === 1 ? '' : 's'} completed. Keep the momentum going.`}</Text>
          </View>

          {completed > 0 ? (
            <View style={[styles.dailyWinCard, isDarkMode && styles.darkCard]}>
              <View style={styles.dailyWinIcon}><Ionicons name="sparkles" size={16} color="#E3A52E" /></View>
              <View style={styles.dailyWinCopy}>
                <Text style={[styles.dailyWinTitle, isDarkMode && styles.darkText]}>Daily win unlocked</Text>
                <Text style={[styles.dailyWinBody, isDarkMode && styles.darkMutedText]}>Every completed task adds points and strengthens your streak.</Text>
              </View>
              <Text style={styles.dailyWinPoints}>+20 pts</Text>
            </View>
          ) : null}

          <View style={styles.leaderboardSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>{t('leaderboards')}</Text>
            </View>

            {points === 0 ? (
              <View style={[styles.leaderboardEmptyCard, isDarkMode && styles.darkCard]}>
                <View style={styles.leaderboardEmptyIcon}><Ionicons name="trophy-outline" size={20} color="#5B42D8" /></View>
                <View style={styles.leaderboardEmptyCopy}>
                  <Text style={[styles.leaderboardEmptyTitle, isDarkMode && styles.darkText]}>Your leaderboard journey starts here</Text>
                  <Text style={[styles.leaderboardEmptyBody, isDarkMode && styles.darkMutedText]}>Complete tasks to earn points and join the leaderboard.</Text>
                </View>
              </View>
            ) : <View style={[styles.leaderboardCard, isDarkMode && styles.darkCard]}>
              <View style={styles.leaderboardColumn}>
                <Text style={styles.leaderboardLabel}>Your Rank</Text>
                <View style={styles.rankRow}>
                  <Text style={styles.rankValue}>#24</Text>
                  <View style={styles.badgeCircle}>
                    <Image
                      source={require('../../assets/images/trophy.jpg')}
                      style={styles.trophyImage}
                      resizeMode="cover"
                    />
                  </View>
                </View>
                <Text style={styles.risingStarText}>Rising Star</Text>
                <Text style={styles.leagueText}>League</Text>
                <Text style={styles.rankMeta}>Top 8%</Text>
              </View>

              <View style={styles.leaderboardDivider} />

              <View style={styles.leaderboardColumn}>
                <Text style={styles.leaderboardLabel}>Score</Text>
                <Text style={styles.scoreValue}>{points}</Text>
                <Text style={styles.rankMeta}>Total Points</Text>
              </View>
            </View>}

            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
              onPress={() => router.push('/leaderboards')}
              accessibilityRole="button"
              accessibilityLabel="View leaderboards"
            >
              <Text style={styles.secondaryButtonText}>{t('viewLeaderboards')}</Text>
              <Ionicons name="chevron-forward" size={16} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={[styles.tokenCard, isDarkMode && styles.darkCard]}>
            <View style={styles.tokenLeft}>
              <View style={styles.tokenIconWrap}>
                <Image
                  source={require('../../assets/images/coach.png')}
                  style={styles.coachImage}
                  resizeMode="cover"
                />
              </View>
              <View style={styles.tokenTextWrap}>
                <Text style={styles.tokenTitle}>Exchange Tokens for AI Coach</Text>
                <Text style={styles.tokenDescription}>Use your tokens to get personalized advice & motivation from your AI Coach!</Text>
              </View>
            </View>

            <View style={styles.tokenMetaRow}>
              <View style={styles.tokenValueWrap}>
                <Image
                  source={require('../../assets/images/token.jpg')}
                  style={styles.tokenBadgeImage}
                  resizeMode="cover"
                />
                <Text style={styles.tokenValueLarge}>{tokens}</Text>
              </View>
              <Text style={styles.tokenLabel}>{t('tokens')}</Text>
            </View>

            <Pressable
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.secondaryButtonPressed]}
              onPress={() => setCoachOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Go to AI Coach"
            >
              <Text style={styles.secondaryButtonText}>{t('goToAiCoach')}</Text>
            </Pressable>
          </View>

          <Text style={styles.sectionLabel}>{t('account')} &amp; {t('preferences')}</Text>
          <View style={[styles.settingsCard, isDarkMode && styles.darkCard]}>
            {settings.map((item, index) => (
              <Pressable
                key={item.key}
                style={[styles.settingRow, index < settings.length - 1 && styles.settingBorder]}
                onPress={() => router.push(item.route)}
              >
                <View style={styles.settingIcon}>
                  <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={17} color="#5B42D8" />
                </View>
                <Text style={styles.settingLabel}>{t(item.key as TranslationKey)}</Text>
                <Ionicons name="chevron-forward" size={16} color="#A19CAA" />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
      <Modal visible={avatarModalOpen} transparent animationType="fade" onRequestClose={closeAvatarActions}>
        <View style={styles.avatarModalBackdrop}>
          <View style={[styles.avatarModalCard, isDarkMode && styles.darkCard]}>
            <View style={styles.avatarModalIconWrap}>
              <Ionicons name="information-circle-outline" size={28} color="#5B42D8" />
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

              <Pressable style={[styles.avatarOption, styles.primaryOption]} onPress={() => { closeAvatarActions(); setAvatar('A'); setAvatarImage(null); }}>
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
              <Ionicons name="sparkles" size={14} color="#5B42D8" />
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
              <Ionicons name="sparkles" size={16} color="#FFFFFF" />
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
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
    paddingHorizontal: 20,
  },
  wideContainer: {
    width: '100%',
    maxWidth: 680,
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
  firstActionCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: '#DDD4F7' },
  firstActionIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 11 },
  firstActionCopy: { marginBottom: 14 },
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

