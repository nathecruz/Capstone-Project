import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { ThemeSheet, TitleSheet } from '@/components/reward-sheets';
import { StreakFreezeSheet } from '@/components/streak-freeze-sheet';
import { getApiBaseUrl, getAuthenticatedHeaders, redeemReward } from '@/authentication';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { loadRewards, markRewardOwned, useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

// Every reward here does something. 'permanent' ones (from the server's catalog) are bought once
// and then opened from their card; Streak Freeze and Buddy Outfits have their own screens.
type Reward = {
  id: string;
  title: string;
  detail: string;
  description?: string;
  cost: number;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  kind: 'permanent' | 'freeze' | 'shop';
};

const REWARD_LOOKS: Record<string, { detail: string; icon: keyof typeof Ionicons.glyphMap; color: string; action: string }> = {
  'premium-theme': { detail: 'Ocean, Sunset, Forest and Midnight colours', icon: 'color-palette-outline', color: '#EEE5FF', action: 'Choose theme' },
  'custom-title': { detail: 'Your title on your profile and the leaderboard', icon: 'ribbon-outline', color: '#FBE3F1', action: 'Edit title' },
};
const BUDDY_SHOP_FROM = 40;

type Leader = { rank: number; name: string; points: number; avatar: string; title?: string; isYou?: boolean };
type Spotlight = Leader & { tone: 'gold' | 'silver' | 'bronze' };
type LeaderboardPeriod = 'This Week' | 'This Month' | 'All Time';
type LeaderboardSort = 'points-desc' | 'points-asc' | 'rank';
type LeaderboardResponse = { date: string; leaders: Leader[] };

export default function LeaderboardsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const [period, setPeriod] = useState<LeaderboardPeriod>('This Week');
  const [dateDropdownOpen, setDateDropdownOpen] = useState(false);
  const [sortMode, setSortMode] = useState<LeaderboardSort>('points-desc');
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [showAllRankings, setShowAllRankings] = useState(false);
  const [deviceDate, setDeviceDate] = useState(() => new Date());
  const [openSheet, setOpenSheet] = useState<'freeze' | 'theme' | 'title' | null>(null);
  const [showTokenHistory, setShowTokenHistory] = useState(false);
  const [pendingReward, setPendingReward] = useState<Reward | null>(null);
  const [redeeming, setRedeeming] = useState(false);
  const [toast, setToast] = useState('');
  const [leaderboardStatus, setLeaderboardStatus] = useState<'idle' | 'loading' | 'connected' | 'unavailable'>('idle');
  const [refreshKey, setRefreshKey] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardResponse>({ date: '', leaders: [] });
  const { tokens, applyWallet, points, profile, tokenHistory, isFaculty, streakFreeze } = useAppColorScheme();
  const catalog = useRewards();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const compact = width < 375;
  // The "Earn more tokens" list needs room; on phones the balance keeps the space.
  const showTokenRules = width >= 440;

  useEffect(() => {
    const refreshDate = () => setDeviceDate(new Date());
    const interval = setInterval(refreshDate, 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2600);
    return () => clearTimeout(timeout);
  }, [toast]);

  const apiUrl = getApiBaseUrl();
  useEffect(() => {
    if (!profile.fullName.trim()) {
      return;
    }
    const syncAndLoadLeaderboard = async () => {
      setLeaderboardStatus('loading');
      try {
        const authHeaders = await getAuthenticatedHeaders();
        if (!authHeaders.Authorization) throw new Error('Leaderboard authentication required');
        const syncResponse = await fetch(`${apiUrl}/api/leaderboard/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({
            avatar: profile.fullName.charAt(0).toUpperCase(),
          }),
        });
        if (!syncResponse.ok) throw new Error('Leaderboard sync failed');
        const response = await fetch(`${apiUrl}/api/leaderboard?period=${encodeURIComponent(period)}`, { headers: authHeaders });
        if (!response.ok) throw new Error('Leaderboard service unavailable');
        setLeaderboard(await response.json() as LeaderboardResponse);
        setLeaderboardStatus('connected');
      } catch {
        setLeaderboard({ date: '', leaders: [] });
        setLeaderboardStatus('unavailable');
      }
    };
    void syncAndLoadLeaderboard();
  }, [apiUrl, period, points, profile.email, profile.fullName, profile.username, refreshKey]);

  const { leaders } = leaderboard;
  const podium: Spotlight[] = leaders.slice(0, 3).map((leader, index) => ({
    ...leader,
    tone: index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze',
  }));
  const rankingByRank = new Map<number, Leader>([
    ...podium.map((player) => ({ rank: player.rank, name: player.name, points: player.points, avatar: player.avatar })),
    ...leaders,
  ].map((leader) => [leader.rank, leader]));
  const allLeaders = Array.from(rankingByRank.values());
  const getDateLabel = (selectedPeriod: LeaderboardPeriod) => {
    if (selectedPeriod === 'All Time') return 'Since joining';
    if (selectedPeriod === 'This Month') {
      const start = new Date(deviceDate.getFullYear(), deviceDate.getMonth(), 1);
      const end = new Date(deviceDate.getFullYear(), deviceDate.getMonth() + 1, 0);
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    }
    const start = new Date(deviceDate);
    const day = start.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    start.setDate(start.getDate() + mondayOffset);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  };
  const liveDate = getDateLabel(period);
  // The server marks the signed-in student's row (other students only see initials).
  const userStanding = allLeaders.find((entry) => entry.isYou) ?? allLeaders.find((entry) => entry.name === profile.fullName) ?? { rank: 0, name: '', points: 0, avatar: '' };
  const effectiveLeaderboardStatus = !profile.fullName.trim() ? 'unavailable' : leaderboardStatus;
  const hasLeaderboard = effectiveLeaderboardStatus === 'connected';
  const hasUserPosition = hasLeaderboard && points > 0 && Boolean(userStanding);
  const nextLeader = userStanding ? allLeaders.find((entry) => entry.rank === userStanding.rank - 1) : null;
  const pointsToNextRank = nextLeader ? Math.max(nextLeader.points - points, 0) : 0;
  const rankProgress = nextLeader && nextLeader.points > 0 ? Math.min(100, Math.round((points / nextLeader.points) * 100)) : 0;
  const sortedLeaders = [...allLeaders].sort((left, right) => {
    if (sortMode === 'points-asc') return left.points - right.points || left.rank - right.rank;
    if (sortMode === 'rank') return left.rank - right.rank;
    return right.points - left.points || left.rank - right.rank;
  });
  const sortLabel = sortMode === 'points-desc' ? 'Points: high to low' : sortMode === 'points-asc' ? 'Points: low to high' : 'Sort by rank';
  const pointsSortIndicator = sortMode === 'points-desc' ? ' ↓' : sortMode === 'points-asc' ? ' ↑' : '';
  const visibleRankingCount = showAllRankings ? sortedLeaders.length : Math.min(5, sortedLeaders.length);
  const earnedTokens = tokenHistory.filter((entry) => entry.amount > 0).reduce((total, entry) => total + entry.amount, 0);
  const spentTokens = Math.abs(tokenHistory.filter((entry) => entry.amount < 0).reduce((total, entry) => total + entry.amount, 0));
  const formatTransactionDate = (date: string) => new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // --- Token rewards -------------------------------------------------------
  // Names and prices come from the server's catalog, so a redeem always matches what it charges.
  const freezeCost = streakFreeze?.cost ?? 30;
  const freezesHeld = streakFreeze?.available ?? 0;
  const freezeMax = streakFreeze?.max ?? 2;
  const rewards = useMemo<Reward[]>(() => {
    const permanent = catalog.rewards.filter((reward) => reward.permanent && REWARD_LOOKS[reward.id]).map((reward) => ({
      id: reward.id,
      title: reward.name,
      description: reward.description,
      cost: reward.cost,
      kind: 'permanent' as const,
      ...REWARD_LOOKS[reward.id],
    }));
    return [
      { id: 'streak-freeze', title: 'Streak Freeze', detail: 'Saves your streaks on a day you miss', cost: freezeCost, icon: 'snow-outline', color: '#DDF0FF', kind: 'freeze' },
      { id: 'buddy-shop', title: 'Buddy Outfits', detail: 'Hats and items for your Habit Buddy', cost: BUDDY_SHOP_FROM, icon: 'shirt-outline', color: '#FFF0C9', kind: 'shop' },
      ...permanent,
    ];
  }, [catalog.rewards, freezeCost]);
  const isOwned = (reward: Reward) => reward.kind === 'permanent' && catalog.owns(reward.id);
  const nextGoal = rewards.find((reward) => reward.kind === 'permanent' && !isOwned(reward) && tokens < reward.cost);

  const openReward = (reward: Reward) => {
    if (reward.kind === 'freeze') setOpenSheet('freeze');
    else if (reward.kind === 'shop') router.push('/buddy');
    else if (isOwned(reward)) setOpenSheet(reward.id === 'premium-theme' ? 'theme' : 'title');
    else setPendingReward(reward);
  };

  const confirmRedeem = async () => {
    const reward = pendingReward;
    if (!reward || redeeming) return;
    // Re-validate at commit time: balance may have changed while the sheet was
    // open, and this also absorbs a double tap on the confirm button.
    if (tokens < reward.cost || isOwned(reward)) {
      setPendingReward(null);
      setToast('That reward is no longer available.');
      return;
    }
    setRedeeming(true);
    const result = await redeemReward(reward);
    setRedeeming(false);
    setPendingReward(null);
    if (result.ok) {
      // The server deducted the tokens; show its balance and history, then let them use it.
      if ('tokens' in result) applyWallet(result as { tokens?: number; tokenHistory?: object[]; points?: number });
      markRewardOwned(reward.id);
      setToast(`${reward.title} unlocked!`);
      setOpenSheet(reward.id === 'premium-theme' ? 'theme' : 'title');
    } else {
      setToast(result.message || 'Redeem failed. Your tokens were not spent.');
    }
  };

  // Faculty mode: leaderboards and rewards are the students' own competition.
  if (isFaculty) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.facultyNotice}>
          <Ionicons name="trophy-outline" size={28} color={themeColor('#5B42D8')} />
          <Text style={styles.facultyNoticeTitle}>Leaderboards are for students</Text>
          <Text style={styles.facultyNoticeText}>Your habits stay private to you. See how your students are doing in Class Pulse.</Text>
          <Pressable style={styles.facultyNoticeButton} onPress={() => router.back()} accessibilityRole="button">
            <Text style={styles.facultyNoticeButtonText}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar barStyle="dark-content" backgroundColor="#F7F8FF" />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={[styles.container, compact && styles.compactContainer]}>
          <View style={styles.headerRow}>
            <Pressable onPress={() => router.back()} style={styles.backButton} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={24} color={themeColor('#352B88')} /></Pressable>
            <View style={styles.headerCopy}><Text style={styles.eyebrow}>COMMUNITY</Text><Text style={styles.headerTitle}>Leaderboards</Text><Text style={styles.headerSubtitle}>A little friendly competition goes a long way.</Text></View>
            <View style={styles.headerActions}><View style={styles.trophyBadge}><Ionicons name="trophy" size={22} color={themeColor('#F2B632')} /></View><Pressable style={styles.infoButton} accessibilityLabel="Leaderboard information" onPress={() => showAlert('Leaderboards', 'Complete habits to earn points and tokens. Redeem tokens for rewards.') }><Ionicons name="information-circle-outline" size={23} color={themeColor('#4C43A2')} /></Pressable></View>
          </View>

          <View style={[styles.tokenBanner, compact && styles.compactTokenBanner]}>
            <View style={styles.tokenGlow} />
            <View style={styles.tokenCoin}><Ionicons name="star" size={27} color={themeColor('#FFF5A5')} /></View>
            <View style={styles.tokenCopy}><View style={styles.tokenTopline}><Text style={styles.tokenLabel}>TOKEN BALANCE</Text><View style={styles.activeBadge}><View style={styles.activeDot} /><Text style={styles.activeText}>ACTIVE</Text></View></View><Text style={styles.tokenValue} numberOfLines={1}>{tokens}</Text><Text style={styles.tokenHint}>{points} total points</Text><Pressable style={styles.historyButton} onPress={() => setShowTokenHistory(true)}><Text style={styles.historyText}>View History</Text><Ionicons name="chevron-forward" size={15} color={themeColor('#FFFFFF')} /></Pressable></View>
            <View style={styles.giftWrap}><View style={styles.giftGlow} /><Ionicons name="gift" size={54} color={themeColor('#FFD75A')} /></View>
            {showTokenRules && <View style={styles.tokenRules}><Text style={styles.rulesTitle}>Earn more tokens</Text><Text style={styles.rule}><Text style={styles.ruleIcon}>✓</Text> Daily habits</Text><Text style={styles.rule}><Text style={styles.ruleIcon}>🔥</Text> Join challenges</Text><Text style={styles.rule}><Text style={styles.ruleIcon}>★</Text> Rank up</Text></View>}
          </View>

          {/* ---------------- Token rewards ---------------- */}
          <View style={styles.rewardsSection}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.sectionKicker}>REDEEM YOUR TOKENS</Text>
                <Text style={styles.sectionTitle}>Token Rewards</Text>
                <Text style={styles.sectionSubtitle}>Spend them on things you will actually use.</Text>
              </View>
            </View>

            {nextGoal && (
              <View style={styles.nextGoalRow}>
                <Ionicons name="flag-outline" size={13} color={themeColor('#6249C9')} />
                <Text style={styles.nextGoalText}>
                  {nextGoal.cost - tokens} tokens to {nextGoal.title}
                </Text>
              </View>
            )}

            <ScrollView
              horizontal
              showsHorizontalScrollIndicator
              contentContainerStyle={styles.rewardRow}
              accessibilityLabel="Token rewards, scroll sideways for more"
            >
              {rewards.map((reward) => {
                const owned = isOwned(reward);
                const freezesFull = reward.kind === 'freeze' && freezesHeld >= freezeMax;
                const affordable = tokens >= reward.cost;
                // Owned rewards, the freeze sheet and the buddy shop always open; the rest need the tokens.
                const enabled = owned || reward.kind !== 'permanent' || affordable;
                const progress = Math.min(100, Math.round((tokens / reward.cost) * 100));
                const status = owned
                  ? 'Yours to keep'
                  : reward.kind === 'freeze'
                    ? `${freezesHeld} of ${freezeMax} held`
                    : affordable ? (reward.kind === 'shop' ? 'Ready to shop' : 'Ready to redeem') : `${tokens} / ${reward.cost}`;
                const action = owned
                  ? REWARD_LOOKS[reward.id]?.action ?? 'Open'
                  : reward.kind === 'freeze'
                    ? freezesFull ? 'View' : 'Get one'
                    : reward.kind === 'shop' ? 'Open shop' : affordable ? 'Redeem' : `${reward.cost - tokens} more`;
                return (
                  <View key={reward.id} style={[styles.rewardCard, { backgroundColor: themeColor(reward.color, 'backgroundColor') }]}>
                    {owned && <View style={styles.ownedTag}><Ionicons name="checkmark-circle" size={11} color={themeColor('#2E9D5C')} /><Text style={styles.ownedTagText}>Owned</Text></View>}
                    <View style={styles.rewardIcon}>
                      <Ionicons name={reward.icon} size={29} color={themeColor(reward.kind === 'freeze' ? '#2F86D8' : '#7048D9')} />
                    </View>
                    <Text style={styles.rewardTitle}>{reward.title}</Text>
                    <Text style={styles.rewardDetail}>{reward.detail}</Text>
                    <View style={styles.rewardCostPill}>
                      <Ionicons name="star" size={12} color={themeColor('#E6A617')} />
                      <Text style={styles.rewardCost}>{reward.kind === 'shop' ? `from ${reward.cost}` : reward.cost} tokens{reward.kind === 'freeze' ? ' each' : ''}</Text>
                    </View>

                    {/* Track always renders so the card height never jumps. */}
                    <View style={styles.rewardProgressTrack}>
                      {reward.kind === 'permanent' && !owned && !affordable && <View style={[styles.rewardProgressFill, { width: `${progress}%` }]} />}
                    </View>
                    <Text style={styles.rewardProgressLabel}>{status}</Text>

                    <Pressable
                      disabled={!enabled}
                      style={({ pressed }) => [styles.claimButton, owned && styles.claimButtonOwned, !enabled && styles.claimButtonDisabled, pressed && styles.claimButtonPressed]}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !enabled }}
                      accessibilityLabel={owned ? `${reward.title}: ${action}` : reward.kind === 'permanent' ? (affordable ? `Redeem ${reward.title} for ${reward.cost} tokens` : `${reward.title} locked, needs ${reward.cost - tokens} more tokens`) : `${reward.title}: ${action}`}
                      onPress={() => openReward(reward)}
                    >
                      <Text style={[styles.claimText, owned && styles.claimTextOwned, !enabled && styles.claimTextDisabled]}>{action}</Text>
                      {enabled && <Ionicons name="arrow-forward" size={14} color={themeColor(owned ? '#5B42D8' : '#FFFFFF')} />}
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>

            {catalog.status === 'error' && (
              <Pressable style={styles.rewardsRetry} onPress={() => void loadRewards()} accessibilityRole="button">
                <Ionicons name="refresh" size={13} color={themeColor('#6249C9')} />
                <Text style={styles.rewardsFootnote}>Could not load Premium Themes and Custom Title. Tap to retry.</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.podiumHeader}><View><Text style={styles.sectionKicker}>LEADERBOARD SPOTLIGHT</Text><Text style={styles.sectionTitle}>Top 3 {period}</Text><Text style={styles.sectionSubtitle}>Consistency gets rewarded. Keep climbing!</Text></View><Pressable style={styles.datePill} onPress={() => setDateDropdownOpen((open) => !open)} accessibilityRole="button" accessibilityLabel="Choose leaderboard date" accessibilityState={{ expanded: dateDropdownOpen }}><Ionicons name="calendar-outline" size={12} color={themeColor('#6B60B8')} /><Text style={styles.datePillText}>{liveDate}</Text><Ionicons name={dateDropdownOpen ? 'chevron-up' : 'chevron-down'} size={12} color={themeColor('#6B60B8')} /></Pressable></View>
          {dateDropdownOpen && <View style={styles.dateDropdown}>{(['This Week', 'This Month', 'All Time'] as LeaderboardPeriod[]).map((option) => <Pressable key={option} style={[styles.dateOption, period === option && styles.dateOptionActive]} onPress={() => { setPeriod(option); setDateDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: period === option }}><View><Text style={[styles.dateOptionTitle, period === option && styles.dateOptionTextActive]}>{option}</Text><Text style={[styles.dateOptionSubtitle, period === option && styles.dateOptionTextActive]}>{getDateLabel(option)}</Text></View>{period === option && <Ionicons name="checkmark-circle" size={16} color={themeColor('#FFFFFF')} />}</Pressable>)}</View>}
          {podium.length && hasLeaderboard ? <View style={[styles.podiumRow, compact && styles.compactPodium]}>{podium.map((player) => <View key={player.name} style={[styles.podiumPlayer, styles[player.tone]]}><Text style={styles.podiumRank}>{player.rank === 1 ? '1ST' : player.rank === 2 ? '2ND' : '3RD'}</Text><Text style={styles.medal}>{player.tone === 'gold' ? '♛' : '◆'}</Text><View style={styles.podiumAvatar}><Text style={styles.avatarText}>{player.avatar}</Text></View><Text style={styles.podiumName}>{player.name}</Text>{player.title ? <Text style={styles.podiumTitle} numberOfLines={1}>{player.title}</Text> : null}<Text style={styles.podiumPoints}>✦ {player.points} pts</Text></View>)}</View> : <View style={styles.noCommunityCard}><Ionicons name={effectiveLeaderboardStatus === 'loading' ? 'sync-outline' : 'people-outline'} size={25} color={themeColor('#6249C9')} /><Text style={styles.noCommunityTitle}>{effectiveLeaderboardStatus === 'loading' ? 'Connecting to the community...' : 'Community rankings are unavailable'}</Text><Text style={styles.noCommunityText}>{effectiveLeaderboardStatus === 'loading' ? 'We are checking the leaderboard service.' : 'Start a daily habit to earn your first points, then connect to compare with other members.'}</Text><Pressable style={styles.connectButton} onPress={() => { if (!apiUrl) showAlert('Connect Leaderboard Service', 'Set EXPO_PUBLIC_AI_API_URL and start the backend service to enable community rankings.'); else setRefreshKey((key) => key + 1); } }><Ionicons name="link-outline" size={15} color={themeColor('#FFFFFF')} /><Text style={styles.connectButtonText}>{apiUrl ? 'Retry connection' : 'Connect Leaderboard Service'}</Text></Pressable></View>}

          {hasUserPosition ? <View style={styles.positionCard}><View style={styles.positionAvatar}><Text style={styles.avatarText}>{userStanding.avatar}</Text></View><View style={styles.positionCopy}><Text style={styles.positionLabel}>Your Position</Text><Text style={styles.positionRank}>#{userStanding.rank}</Text><View style={styles.risingPill}><Ionicons name="star" size={12} color={themeColor('#FFFFFF')} /><Text style={styles.risingText}>Keep climbing</Text></View><View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${rankProgress}%` }]} /></View><Text style={styles.progressNote}>{nextLeader ? `${pointsToNextRank} points to reach #${nextLeader.rank}` : 'You are at the top of this community.'}</Text></View><View style={styles.positionScore}><Text style={styles.scoreValue}>{points}</Text><Text style={styles.scoreLabel}>points</Text><Text style={styles.weekMuted}>Live total</Text></View></View> : null}

          {hasLeaderboard && <>
          <View style={styles.rankingHeader}><View style={styles.rankingTitleBlock}><Text style={styles.sectionKicker}>FULL STANDINGS</Text><Text style={styles.sectionTitle}>Rankings</Text><Text style={styles.sectionSubtitle}>Your place among the most consistent.</Text><View style={styles.risingSmall}><Ionicons name="swap-vertical" size={11} color={themeColor('#6249C9')} /><Text style={styles.risingSmallText}>Showing: {sortLabel}</Text></View></View><View style={styles.rankingActions}><Pressable style={[styles.sortButton, styles.sortButtonTouch]} onPress={() => setSortDropdownOpen((open) => !open)} accessibilityRole="button" accessibilityLabel="Sort full standings" accessibilityState={{ expanded: sortDropdownOpen }}><Ionicons name="swap-vertical" size={15} color={themeColor('#5F55B4')} /><Text style={styles.sortText}>{sortLabel}</Text><Ionicons name={sortDropdownOpen ? 'chevron-up' : 'chevron-down'} size={13} color={themeColor('#5F55B4')} /></Pressable><Pressable style={[styles.sortButton, styles.sortButtonTouch]} onPress={() => setShowAllRankings((visible) => !visible)} accessibilityRole="button" accessibilityLabel={showAllRankings ? 'Show fewer rankings' : 'View all rankings'} accessibilityState={{ expanded: showAllRankings }}><Text style={styles.sortText}>{showAllRankings ? 'View less' : 'View all'}</Text><Ionicons name={showAllRankings ? 'chevron-up' : 'chevron-down'} size={13} color={themeColor('#6249C9')} /></Pressable></View></View>
          {sortDropdownOpen && <View style={styles.dateDropdown}>{([{ value: 'points-desc', label: 'Points: high to low' }, { value: 'points-asc', label: 'Points: low to high' }, { value: 'rank', label: 'Sort by rank' }] as const).map((option) => <Pressable key={option.value} style={[styles.dateOption, sortMode === option.value && styles.dateOptionActive]} onPress={() => { setSortMode(option.value); setSortDropdownOpen(false); }} accessibilityRole="button" accessibilityState={{ selected: sortMode === option.value }}><Text style={[styles.dateOptionTitle, sortMode === option.value && styles.dateOptionTextActive]}>{option.label}</Text>{sortMode === option.value && <Ionicons name="checkmark-circle" size={16} color={themeColor('#FFFFFF')} />}</Pressable>)}</View>}
          <View style={styles.rankingMetaRow}><View style={styles.rankingCount}><Ionicons name="people-outline" size={14} color={themeColor('#6249C9')} /><Text style={styles.rankingMetaText}>{visibleRankingCount} of {sortedLeaders.length} members</Text></View><Text style={styles.rankingMetaHint}>{showAllRankings ? 'Complete leaderboard' : 'Top results'}</Text></View>
          <View style={styles.rankingTable}><View style={styles.rankingColumns}><Text style={styles.columnRank}>RANK</Text><Text style={styles.columnMember}>MEMBER</Text><Text style={styles.columnPoints}>POINTS{pointsSortIndicator}</Text></View><View style={styles.rankingList}>{sortedLeaders.slice(0, visibleRankingCount).map((leader, index) => <View key={leader.name} style={[styles.rankingRow, index % 2 === 1 && styles.alternateRow, leader.name === profile.fullName && styles.currentRow]}><Text style={[styles.rankCircle, leader.name === profile.fullName && styles.currentRank]}>{leader.rank}</Text><View style={styles.memberCell}><View style={[styles.listAvatarWrap, leader.name === profile.fullName && styles.currentAvatarWrap]}><Text style={styles.listAvatar}>{leader.avatar}</Text></View><View style={styles.memberCopy}><Text style={[styles.playerName, leader.name === profile.fullName && styles.currentPlayerName]}>{leader.name}</Text>{leader.title ? <Text style={styles.playerTitle} numberOfLines={1}>{leader.title}</Text> : null}{leader.name === profile.fullName && <View style={styles.risingSmall}><Ionicons name="star" size={10} color={themeColor('#6248D7')} /><Text style={styles.risingSmallText}>You</Text></View>}</View></View><View style={styles.pointsCell}><Text style={styles.playerPoints}>{leader.points}</Text><Ionicons name="chevron-forward" size={16} color={themeColor('#7E74BF')} /></View></View>)}</View></View></>}
        </View>
      </ScrollView>

      {/* Toast — replaces Alert so it also works on web and does not block. */}
      {Boolean(toast) && (
        <View style={[styles.toast, { bottom: 20 + insets.bottom }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle" size={17} color={themeColor('#FFFFFF')} />
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* Redeem confirmation */}
      <Modal visible={Boolean(pendingReward)} transparent animationType="fade" onRequestClose={() => setPendingReward(null)}>
        <View style={styles.confirmOverlay}>
          <Pressable style={styles.historyBackdrop} onPress={() => setPendingReward(null)} accessibilityLabel="Cancel redeem" />
          {pendingReward && (
            <View style={styles.confirmCard}>
              <View style={[styles.confirmIcon, { backgroundColor: themeColor(pendingReward.color, 'backgroundColor') }]}>
                <Ionicons name={pendingReward.icon} size={30} color={themeColor('#7048D9')} />
              </View>
              <Text style={styles.confirmTitle}>Redeem {pendingReward.title}?</Text>
              <Text style={styles.confirmDetail}>{pendingReward.description ?? pendingReward.detail}</Text>
              <View style={styles.confirmMath}>
                <View style={styles.confirmMathRow}><Text style={styles.confirmMathLabel}>Balance</Text><Text style={styles.confirmMathValue}>{tokens}</Text></View>
                <View style={styles.confirmMathRow}><Text style={styles.confirmMathLabel}>Cost</Text><Text style={[styles.confirmMathValue, styles.confirmMathCost]}>-{pendingReward.cost}</Text></View>
                <View style={styles.confirmMathDivider} />
                <View style={styles.confirmMathRow}><Text style={styles.confirmMathLabelStrong}>Remaining</Text><Text style={styles.confirmMathValueStrong}>{tokens - pendingReward.cost}</Text></View>
              </View>
              <Text style={styles.confirmNote}>
                One-time purchase. Yours to keep.
              </Text>
              <Pressable style={[styles.confirmButton, redeeming && styles.confirmButtonBusy]} disabled={redeeming} onPress={confirmRedeem} accessibilityRole="button">
                <Text style={styles.confirmButtonText}>{redeeming ? 'Redeeming...' : `Redeem for ${pendingReward.cost}`}</Text>
              </Pressable>
              <Pressable style={styles.cancelButton} onPress={() => setPendingReward(null)} accessibilityRole="button">
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </Pressable>
            </View>
          )}
        </View>
      </Modal>

      <StreakFreezeSheet visible={openSheet === 'freeze'} onClose={() => setOpenSheet(null)} />
      <ThemeSheet visible={openSheet === 'theme'} onClose={() => setOpenSheet(null)} />
      {openSheet === 'title' && <TitleSheet current={catalog.title} onClose={() => setOpenSheet(null)} onSaved={(title) => { setToast(title ? `Your title is now "${title}".` : 'Title removed.'); setRefreshKey((key) => key + 1); }} />}

      <Modal visible={showTokenHistory} transparent animationType="slide" onRequestClose={() => setShowTokenHistory(false)}>
        <View style={styles.historyOverlay}>
          <Pressable style={styles.historyBackdrop} onPress={() => setShowTokenHistory(false)} accessibilityLabel="Close token history" />
          <View style={styles.historySheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.historyHeader}><View><Text style={styles.historyKicker}>TOKEN ACTIVITY</Text><Text style={styles.historyTitle}>Token History</Text><Text style={styles.historySubtitle}>See how your balance has changed.</Text></View><Pressable style={styles.closeHistoryButton} onPress={() => setShowTokenHistory(false)} accessibilityLabel="Close token history"><Ionicons name="close" size={20} color={themeColor('#4F438F')} /></Pressable></View>
            <View style={styles.historyBalance}><View><Text style={styles.balanceLabel}>CURRENT BALANCE</Text><Text style={styles.balanceValue}>{tokens} <Text style={styles.balanceUnit}>tokens</Text></Text></View><Ionicons name="star" size={30} color={themeColor('#EFB332')} /></View>
            <View style={styles.historyStats}><View style={styles.historyStat}><Text style={styles.historyStatValue}>+{earnedTokens}</Text><Text style={styles.historyStatLabel}>Earned</Text></View><View style={styles.historyDivider} /><View style={styles.historyStat}><Text style={styles.historyStatValue}>-{spentTokens}</Text><Text style={styles.historyStatLabel}>Spent</Text></View></View>
            <Text style={styles.activityLabel}>RECENT ACTIVITY</Text>
            <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>{tokenHistory.length ? tokenHistory.slice(0, 12).map((entry) => <View key={entry.id} style={styles.historyRow}><View style={[styles.activityIcon, entry.amount > 0 ? styles.earnedIcon : styles.spentIcon]}><Ionicons name={entry.amount > 0 ? 'arrow-down' : 'arrow-up'} size={16} color={entry.amount > 0 ? themeColor('#249B6B') : themeColor('#D16A5D')} /></View><View style={styles.activityCopy}><Text style={styles.activityTitle}>{entry.label}</Text><Text style={styles.activityDate}>{formatTransactionDate(entry.date)}</Text></View><Text style={[styles.activityAmount, entry.amount < 0 && styles.spentAmount]}>{entry.amount > 0 ? '+' : ''}{entry.amount}</Text></View>) : <View style={styles.emptyHistory}><View style={styles.emptyHistoryIcon}><Ionicons name="time-outline" size={25} color={themeColor('#765BD4')} /></View><Text style={styles.emptyHistoryTitle}>No activity yet</Text><Text style={styles.emptyHistoryText}>Complete a habit or redeem a reward to see your token activity here.</Text></View>}</ScrollView>
            <Pressable style={styles.doneHistoryButton} onPress={() => setShowTokenHistory(false)}><Text style={styles.doneHistoryText}>Done</Text></Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F7F8FF' },
  facultyNotice: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  facultyNoticeTitle: { fontSize: 18, fontWeight: '800', color: '#2D2A3D', textAlign: 'center' },
  facultyNoticeText: { fontSize: 13, lineHeight: 19, color: '#6B6377', textAlign: 'center', maxWidth: 320 },
  facultyNoticeButton: { marginTop: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, backgroundColor: '#5B42D8' },
  facultyNoticeButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 }, content: { paddingTop: 8 }, container: { width: '100%', maxWidth: 920, alignSelf: 'center', paddingHorizontal: 14 }, compactContainer: { paddingHorizontal: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 }, backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 3 }, headerCopy: { flex: 1 }, eyebrow: { color: '#7967D6', fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginBottom: 2 }, headerTitle: { fontSize: 24, color: '#131B47', fontWeight: '900' }, headerSubtitle: { fontSize: 11, color: '#69708B', marginTop: 2 }, headerActions: { alignItems: 'center', gap: 8 }, trophyBadge: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFF4CF', alignItems: 'center', justifyContent: 'center' }, infoButton: { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  // elevation lowered from 5 -> 2 so the banner stops drawing over the rewards card on Android
  tokenBanner: { minHeight: 158, flexDirection: 'row', alignItems: 'center', backgroundColor: '#6044DD', borderRadius: 20, padding: 14, overflow: 'hidden', elevation: 2, zIndex: 1, shadowColor: '#4C37B8', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } }, compactTokenBanner: { minHeight: 145 }, tokenGlow: { position: 'absolute', width: 160, height: 160, borderRadius: 80, backgroundColor: '#8069F0', opacity: 0.38, right: 82, top: -56 }, tokenCoin: { width: 62, height: 62, borderRadius: 31, backgroundColor: '#F5A91B', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#FFD95B', shadowColor: '#F5A91B', shadowOpacity: 0.35, shadowRadius: 9, shadowOffset: { width: 0, height: 3 } }, tokenCopy: { marginLeft: 10, flex: 1 }, tokenTopline: { flexDirection: 'row', alignItems: 'center', gap: 7 }, tokenLabel: { color: '#DCD5FF', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.13)', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 3 }, activeDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#7FF0B0' }, activeText: { color: '#D9FFE7', fontSize: 7, fontWeight: '900', letterSpacing: 0.5 }, tokenValue: { color: '#FFFFFF', fontSize: 34, lineHeight: 38, fontWeight: '900' }, tokenHint: { color: '#CFC7FF', fontSize: 10, marginTop: 1 }, historyButton: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', borderWidth: 1, borderColor: '#CFC4FF', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, marginTop: 7 }, historyText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' }, giftWrap: { width: 62, height: 62, borderRadius: 31, backgroundColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center', marginRight: 8 }, giftGlow: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFD75A', opacity: 0.16 }, tokenRules: { width: 137, borderLeftWidth: 1, borderLeftColor: '#8D78ED', paddingLeft: 12 }, rulesTitle: { color: '#FFFFFF', fontSize: 11, fontWeight: '900', marginBottom: 8 }, rule: { color: '#F3EFFF', fontSize: 10, marginBottom: 7 }, ruleIcon: { color: '#FFE27A', fontWeight: '900' },

  // zIndex + elevation raised above the banner so the kicker is never clipped
  rewardsSection: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 12, marginTop: 18, borderWidth: 1, borderColor: '#ECEBFA', zIndex: 2, elevation: 3, shadowColor: '#4A3B9A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  sectionHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 10 },
  sectionHeadingCopy: { flex: 1, minWidth: 0 },
  sectionKicker: { color: '#8A7BD5', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginBottom: 3 },
  sectionTitle: { color: '#18204E', fontSize: 16, fontWeight: '900' },
  sectionSubtitle: { color: '#747B94', fontSize: 11, marginTop: 3 },
  viewAllButton: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 44, paddingHorizontal: 8, flexShrink: 0 },
  viewAll: { color: '#6249C9', fontSize: 11, fontWeight: '800' },
  nextGoalRow: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#F4F1FF', borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7, marginBottom: 10 },
  nextGoalText: { color: '#554899', fontSize: 11, fontWeight: '700' },
  // trailing padding gives the last card a peek edge so the row reads as scrollable
  rewardRow: { gap: 10, paddingBottom: 6, paddingRight: 16 },
  rewardCard: { width: 150, minHeight: 236, borderRadius: 17, padding: 11, alignItems: 'center', elevation: 2, shadowColor: '#4A3B9A', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  ownedTag: { position: 'absolute', top: 8, right: 8, flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 9, paddingHorizontal: 6, paddingVertical: 3 },
  ownedTagText: { color: '#2E7D50', fontSize: 9, fontWeight: '900' },
  rewardIcon: { width: 64, height: 52, alignItems: 'center', justifyContent: 'center' },
  rewardTitle: { color: '#242951', fontSize: 12, fontWeight: '900', textAlign: 'center' },
  rewardDetail: { color: '#69708A', fontSize: 10, lineHeight: 13, textAlign: 'center', minHeight: 26, marginTop: 3 },
  rewardCostPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: 'rgba(255,255,255,0.72)', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, marginVertical: 7 },
  rewardCost: { color: '#35416D', fontSize: 10, fontWeight: '900' },
  rewardProgressTrack: { width: '100%', height: 4, backgroundColor: 'rgba(255,255,255,0.65)', borderRadius: 4, overflow: 'hidden' },
  rewardProgressFill: { height: '100%', backgroundColor: '#6747DD', borderRadius: 4 },
  rewardProgressLabel: { color: '#5D6480', fontSize: 10, fontWeight: '700', marginTop: 5, marginBottom: 7 },
  claimButton: { width: '100%', minHeight: 44, flexDirection: 'row', justifyContent: 'center', gap: 5, backgroundColor: '#6747DD', borderRadius: 13, paddingVertical: 8, alignItems: 'center', marginTop: 'auto' },
  claimButtonDisabled: { backgroundColor: 'rgba(255,255,255,0.6)' },
  claimButtonOwned: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderColor: '#6747DD' },
  claimButtonPressed: { opacity: 0.85 },
  claimTextOwned: { color: '#5B42D8' },
  claimText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800', textAlign: 'center' },
  claimTextDisabled: { color: '#756D8B' },
  rewardsFootnote: { color: '#8B83AE', fontSize: 10, fontWeight: '700', textAlign: 'center', flexShrink: 1 },
  rewardsRetry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 36, marginTop: 4 },
  podiumTitle: { color: '#7A4FB0', fontSize: 9, fontWeight: '800', textAlign: 'center', marginTop: 2, maxWidth: '92%' },
  playerTitle: { color: '#7A4FB0', fontSize: 10, fontWeight: '800', marginTop: 1 },

  toast: { position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#2C2564', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12, elevation: 8, shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  toastText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', flex: 1 },

  confirmOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: 'rgba(18, 20, 54, 0.42)' },
  confirmCard: { width: '100%', maxWidth: 340, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, alignItems: 'center' },
  confirmIcon: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center' },
  confirmTitle: { color: '#18204E', fontSize: 17, fontWeight: '900', textAlign: 'center', marginTop: 12 },
  confirmDetail: { color: '#747B94', fontSize: 12, textAlign: 'center', marginTop: 4 },
  confirmMath: { width: '100%', backgroundColor: '#F7F6FC', borderRadius: 14, padding: 13, marginTop: 16 },
  confirmMathRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 },
  confirmMathLabel: { color: '#747B94', fontSize: 12 },
  confirmMathLabelStrong: { color: '#27305C', fontSize: 12, fontWeight: '900' },
  confirmMathValue: { color: '#27305C', fontSize: 13, fontWeight: '800' },
  confirmMathValueStrong: { color: '#27305C', fontSize: 15, fontWeight: '900' },
  confirmMathCost: { color: '#D16A5D' },
  confirmMathDivider: { height: 1, backgroundColor: '#E2E0EE', marginVertical: 6 },
  confirmNote: { color: '#8B83AE', fontSize: 11, textAlign: 'center', marginTop: 10 },
  confirmButton: { width: '100%', minHeight: 48, backgroundColor: '#6747DD', borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  confirmButtonBusy: { opacity: 0.6 },
  confirmButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  cancelButton: { width: '100%', minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  cancelButtonText: { color: '#747B94', fontSize: 12, fontWeight: '800' },

  historyOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18, 20, 54, 0.34)' }, historyBackdrop: { ...StyleSheet.absoluteFill }, historySheet: { maxHeight: '78%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 22 }, sheetHandle: { alignSelf: 'center', width: 42, height: 4, borderRadius: 2, backgroundColor: '#D9D5EC', marginBottom: 15 }, historyHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, historyKicker: { color: '#8A7BD5', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 }, historyTitle: { color: '#18204E', fontSize: 22, fontWeight: '900', marginTop: 3 }, historySubtitle: { color: '#747B94', fontSize: 11, marginTop: 3 }, closeHistoryButton: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1EEFF', alignItems: 'center', justifyContent: 'center' }, historyBalance: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#6044DD', borderRadius: 18, padding: 15, marginTop: 16 }, balanceLabel: { color: '#DCD5FF', fontSize: 9, fontWeight: '900', letterSpacing: 1 }, balanceValue: { color: '#FFFFFF', fontSize: 28, fontWeight: '900', marginTop: 3 }, balanceUnit: { color: '#DCD5FF', fontSize: 11, fontWeight: '700' }, historyStats: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F6FC', borderRadius: 15, paddingVertical: 11, marginTop: 10 }, historyStat: { flex: 1, alignItems: 'center' }, historyStatValue: { color: '#27305C', fontSize: 15, fontWeight: '900' }, historyStatLabel: { color: '#8589A0', fontSize: 10, marginTop: 2 }, historyDivider: { width: 1, height: 25, backgroundColor: '#E2E0EE' }, activityLabel: { color: '#8A7BD5', fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 18, marginBottom: 7 }, historyList: { minHeight: 100 }, historyRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#F0EFF7' }, activityIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' }, earnedIcon: { backgroundColor: '#E0F8EC' }, spentIcon: { backgroundColor: '#FDE8E4' }, activityCopy: { flex: 1, marginLeft: 10 }, activityTitle: { color: '#2A3058', fontSize: 12, fontWeight: '800' }, activityDate: { color: '#9699AA', fontSize: 10, marginTop: 3 }, activityAmount: { color: '#249B6B', fontSize: 13, fontWeight: '900' }, spentAmount: { color: '#D16A5D' }, emptyHistory: { alignItems: 'center', paddingVertical: 22, paddingHorizontal: 25 }, emptyHistoryIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F0ECFF', alignItems: 'center', justifyContent: 'center' }, emptyHistoryTitle: { color: '#30265F', fontSize: 13, fontWeight: '900', marginTop: 9 }, emptyHistoryText: { color: '#716B87', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 5 }, doneHistoryButton: { backgroundColor: '#6747DD', borderRadius: 14, alignItems: 'center', paddingVertical: 12, marginTop: 12 }, doneHistoryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  periodTabs: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 3, marginTop: 17, borderWidth: 1, borderColor: '#E5E6F4' }, periodTab: { flex: 1, height: 47, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6 }, periodTabActive: { backgroundColor: '#6744DF' }, periodText: { color: '#6D7187', fontSize: 11, fontWeight: '800' }, periodTextActive: { color: '#FFFFFF' }, podiumHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 19, marginBottom: 9, gap: 8 }, datePill: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 150, backgroundColor: '#F0EDFF', borderRadius: 13, paddingHorizontal: 8, paddingVertical: 7 }, datePillText: { color: '#6B60B8', fontSize: 9, fontWeight: '800', flexShrink: 1 }, dateDropdown: { backgroundColor: '#FFFFFF', borderRadius: 15, padding: 7, marginBottom: 9, borderWidth: 1, borderColor: '#E2DDF5', shadowColor: '#4A3B9A', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 3 }, dateOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 9 }, dateOptionActive: { backgroundColor: '#6744DF' }, dateOptionTitle: { color: '#30365D', fontSize: 11, fontWeight: '900' }, dateOptionSubtitle: { color: '#8589A0', fontSize: 9, fontWeight: '600', marginTop: 2 }, dateOptionTextActive: { color: '#FFFFFF' },
  podiumRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, backgroundColor: '#FBFAFF', borderRadius: 18, padding: 9, borderWidth: 1, borderColor: '#E7E4F7', minHeight: 205, shadowColor: '#4A3B9A', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }, compactPodium: { gap: 3, paddingHorizontal: 5 }, podiumPlayer: { flex: 1, alignItems: 'center', borderRadius: 15, paddingTop: 13, minHeight: 150 }, gold: { minHeight: 180, backgroundColor: '#FFE6A0' }, silver: { backgroundColor: '#DDE9FF' }, bronze: { backgroundColor: '#FFE0D5' }, podiumRank: { color: '#6D5F9F', fontSize: 9, fontWeight: '900', letterSpacing: 0.8 }, medal: { position: 'absolute', top: -22, fontSize: 25, color: '#EDB329' }, podiumAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginBottom: 7, borderWidth: 3, borderColor: '#FFFFFF' }, avatarText: { fontSize: 28, fontWeight: '800', color: '#5B42D8' }, podiumName: { color: '#25305B', fontSize: 10, fontWeight: '900', textAlign: 'center' }, podiumPoints: { color: '#5943BE', fontSize: 11, fontWeight: '900', marginTop: 6, backgroundColor: '#FFFFFF', borderRadius: 12, paddingHorizontal: 6, paddingVertical: 5 },
  noCommunityCard: { alignItems: 'center', backgroundColor: '#F3F0FF', borderRadius: 18, padding: 22, marginBottom: 14 }, noCommunityTitle: { color: '#30265F', fontSize: 13, fontWeight: '900', marginTop: 8, textAlign: 'center' }, noCommunityText: { color: '#716B87', fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 5 }, connectButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#6744DF', borderRadius: 12, paddingHorizontal: 14, marginTop: 14 }, connectButtonText: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  positionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#E9E4FF', borderRadius: 18, padding: 12, marginTop: 14, borderWidth: 1, borderColor: '#D5CDFB' }, positionAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' }, positionCopy: { flex: 1, marginLeft: 11 }, positionLabel: { color: '#62668A', fontSize: 11, fontWeight: '700' }, positionRank: { color: '#20275C', fontSize: 25, fontWeight: '900' }, risingPill: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', backgroundColor: '#6744DD', borderRadius: 12, paddingHorizontal: 7, paddingVertical: 4 }, risingText: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' }, progressTrack: { height: 6, backgroundColor: '#FFFFFF', borderRadius: 4, marginTop: 8, width: '95%' }, progressFill: { height: '100%', backgroundColor: '#6744DD', borderRadius: 4 }, progressNote: { color: '#6C6D88', fontSize: 9, marginTop: 4 }, positionScore: { alignItems: 'flex-end', paddingLeft: 9, borderLeftWidth: 1, borderLeftColor: '#D1C9F1' }, scoreValue: { color: '#192052', fontSize: 24, fontWeight: '900' }, scoreLabel: { color: '#707594', fontSize: 10 }, weekChange: { color: '#28A76F', fontSize: 11, fontWeight: '900', marginTop: 9 }, weekMuted: { color: '#7C829A', fontSize: 9 },
  rankingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 8 }, sortButton: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: '#E0DDF3', borderRadius: 14, paddingHorizontal: 9, paddingVertical: 7 }, sortText: { color: '#625A9D', fontSize: 10, fontWeight: '800' }, rankingTable: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 8, borderWidth: 1, borderColor: '#ECECF5' }, rankingColumns: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingBottom: 7, borderBottomWidth: 1, borderBottomColor: '#F0EFF7' }, columnRank: { width: 64, color: '#9A9DB0', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 }, columnMember: { flex: 1, color: '#9A9DB0', fontSize: 9, fontWeight: '900', letterSpacing: 0.7 }, columnPoints: { width: 66, color: '#9A9DB0', fontSize: 9, fontWeight: '900', textAlign: 'right', letterSpacing: 0.7 }, rankingList: { gap: 5, paddingTop: 7 }, rankingRow: { minHeight: 60, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FBFBFE', borderRadius: 13, paddingHorizontal: 7, borderWidth: 1, borderColor: '#F0F0F7' }, currentRow: { backgroundColor: '#EAE5FF', borderColor: '#B9AAFF' }, rankCircle: { width: 29, height: 29, borderRadius: 15, textAlign: 'center', textAlignVertical: 'center', color: '#67708B', backgroundColor: '#F1F3FA', fontSize: 11, fontWeight: '900', marginRight: 7 }, currentRank: { color: '#6645D5', backgroundColor: '#D6CBFF' }, memberCell: { flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }, listAvatarWrap: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0F1FA', marginRight: 8 }, currentAvatarWrap: { backgroundColor: '#D6CBFF' }, listAvatar: { fontSize: 23 }, memberCopy: { flex: 1, minWidth: 0 }, playerName: { color: '#222951', fontSize: 12, fontWeight: '800' }, currentPlayerName: { color: '#5940C7' }, risingSmall: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 3, backgroundColor: '#F1EEFF', borderRadius: 10, paddingHorizontal: 6, paddingVertical: 4, marginTop: 3 }, risingSmallText: { color: '#6248C3', fontSize: 9, fontWeight: '800' }, pointsCell: { width: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 3 }, playerPoints: { color: '#1D2357', backgroundColor: '#F0F1F8', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 5, fontSize: 11, fontWeight: '900', textAlign: 'right' },
  rankingTitleBlock: { flex: 1, minWidth: 0 }, rankingActions: { alignItems: 'flex-end', gap: 6 }, rankingMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#F4F1FF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 8 }, rankingCount: { flexDirection: 'row', alignItems: 'center', gap: 5 }, rankingMetaText: { color: '#554899', fontSize: 10, fontWeight: '800' }, rankingMetaHint: { color: '#8B83AE', fontSize: 10, fontWeight: '700' }, alternateRow: { backgroundColor: '#F8F8FD' },
  sortButtonTouch: { minHeight: 44 },
});
