// Small Home cards that give a reason to come back every day: the level bar, the evening
// streak alert, the daily challenge and the Monday recap of last week.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View } from 'react-native';
import { openMysteryBox } from '@/authentication/authService';
import { Confetti } from '@/components/confetti';
import { openFocus } from '@/components/today-agenda';
import type { Goal, Habit, TokenTransaction } from '@/hooks/app-state/types';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { badgeProgress, badgeRemaining, nextBadge } from '@/utils/achievements';
import { askAi } from '@/utils/ai-client';
import { computeStreak } from '@/utils/streaks';
import { dailyChallenge, habitsAtRisk, levelProgress, POINTS_PER_LEVEL, weeklyRecap } from '@/utils/engagement';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { daysLeftInWeek, weeklyQuests } from '@/utils/quests';

/** A bar that grows to `share` (0 to 1) whenever it changes. */
function GrowingBar({ share, trackStyle, fillStyle }: { share: number; trackStyle: object; fillStyle: object | object[] }) {
  const [width] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(width, { toValue: share, duration: 600, useNativeDriver: false }).start();
  }, [share, width]);
  return (
    <View style={trackStyle}>
      <Animated.View style={[fillStyle, { width: width.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

/** Level and XP: every check-in is 20 XP, every 100 XP is a level. */
export function LevelBar({ points, streak = 0, freezes, onPress, style }: { points: number; streak?: number; freezes?: number; onPress?: () => void; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const { level, xp, toNext, share } = levelProgress(points);
  return (
    <Pressable
      style={[styles.level, style]}
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`Level ${level}, ${xp} of ${POINTS_PER_LEVEL} XP, ${toNext} XP to the next level${streak ? `, ${streak}-day streak` : ''}${freezes !== undefined ? `, ${freezes} streak freeze${freezes === 1 ? '' : 's'}` : ''}`}
    >
      <View style={styles.levelBadge}>
        <Ionicons name="star" size={13} color="#FFD44D" />
        <Text style={styles.levelBadgeText}>Lv {level}</Text>
      </View>
      <View style={styles.levelCopy}>
        <GrowingBar share={share} trackStyle={styles.levelTrack} fillStyle={styles.levelFill} />
        <Text style={styles.levelText} numberOfLines={1}>{xp}/{POINTS_PER_LEVEL} XP</Text>
      </View>
      {streak > 0 && (
        <View style={styles.streakChip}>
          <Ionicons name="flame" size={13} color="#F08A3C" />
          <Text style={styles.streakChipText}>{streak}</Text>
        </View>
      )}
      {freezes !== undefined && (
        <View style={styles.freezeChip}>
          <Ionicons name="snow" size={12} color="#4BA3FF" />
          <Text style={styles.freezeChipText}>{freezes}</Text>
        </View>
      )}
    </Pressable>
  );
}

/** The badge closest to being earned, with what is left; opens Achievements. */
export function NextBadgeCard({ habits, goals, style }: { habits: Habit[]; goals: Goal[]; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const frozenDays = useAppColorScheme().streakFreeze?.frozenDays;
  const progress = useMemo(() => badgeProgress(habits, goals, new Date(), frozenDays), [frozenDays, goals, habits]);
  const next = nextBadge(progress);
  if (!habits.length || !next) return null;
  const earned = progress.filter((badge) => badge.earned).length;
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      onPress={() => router.push('/achievements')}
      accessibilityRole="button"
      accessibilityLabel={`Next badge ${next.title}: ${badgeRemaining(next)}. ${earned} of ${progress.length} badges earned.`}
    >
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, { backgroundColor: next.color }]}><Ionicons name={next.icon as keyof typeof Ionicons.glyphMap} size={17} color="#FFFFFF" /></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Next badge: {next.title}</Text>
          <Text style={styles.cardText} numberOfLines={1}>{next.goal}</Text>
        </View>
        <View style={styles.badgeTally}>
          <Ionicons name="ribbon" size={13} color="#7A55D9" />
          <Text style={styles.badgeTallyText}>{earned}/{progress.length}</Text>
        </View>
      </View>
      <GrowingBar share={next.share} trackStyle={styles.badgeTrack} fillStyle={[styles.badgeFill, { backgroundColor: next.color }]} />
      <Text style={styles.badgeLeft}>{badgeRemaining(next)} · {Math.min(next.current, next.target)} / {next.target}{next.unit === '%' ? '%' : ''}</Text>
    </Pressable>
  );
}

/** This week's three quests, their progress and the tokens they pay (the server pays them). */
export function WeeklyQuestsCard({ habits, now, style }: { habits: Habit[]; now: Date; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const quests = weeklyQuests(habits, now);
  if (!quests.length) return null;
  const left = daysLeftInWeek(now);
  const earned = quests.filter((quest) => quest.complete).reduce((sum, quest) => sum + quest.reward, 0);
  const total = quests.reduce((sum, quest) => sum + quest.reward, 0);
  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, styles.questIcon]}><Ionicons name="flag" size={16} color="#FFFFFF" /></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Weekly quests</Text>
          <Text style={styles.cardText}>{left} day{left === 1 ? '' : 's'} left · {earned}/{total} tokens earned</Text>
        </View>
      </View>
      <View style={styles.questList}>
        {quests.map((quest) => (
          <View key={quest.id} style={styles.questRow} accessible accessibilityLabel={`${quest.title}: ${quest.progress} of ${quest.target}${quest.complete ? ', done' : ''}, ${quest.reward} tokens`}>
            <View style={[styles.questBadge, quest.complete && styles.questBadgeDone]}>
              <Ionicons name={(quest.complete ? 'checkmark' : quest.icon) as keyof typeof Ionicons.glyphMap} size={14} color={quest.complete ? '#FFFFFF' : '#4BA3FF'} />
            </View>
            <View style={styles.questCopy}>
              <Text style={[styles.questTitle, quest.complete && styles.questTitleDone]} numberOfLines={1}>{quest.title}</Text>
              <View style={styles.questTrack}><View style={[styles.questFill, quest.complete && styles.questFillDone, { width: `${Math.round((quest.progress / quest.target) * 100)}%` }]} /></View>
            </View>
            <Text style={styles.questCount}>{quest.progress}/{quest.target}</Text>
            <View style={[styles.rewardChip, quest.complete && styles.rewardChipDone]}><Text style={[styles.rewardText, quest.complete && styles.rewardTextDone]}>+{quest.reward}</Text></View>
          </View>
        ))}
      </View>
    </View>
  );
}

/** The daily mystery box: unlocked by the day's first check-in, opened once for 3 to 20 tokens. */
export function MysteryBoxCard({ habits, tokenHistory, onWallet, style }: { habits: Habit[]; tokenHistory: TokenTransaction[]; onWallet: (wallet: { tokens?: number; points?: number; tokenHistory?: object[] }) => void; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const today = getLocalDateKey();
  const [opening, setOpening] = useState(false);
  const [revealed, setRevealed] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [shake] = useState(() => new Animated.Value(0));
  const [pop] = useState(() => new Animated.Value(1));
  const opened = tokenHistory.find((entry) => entry.id === `mystery:${today}`);
  const amount = revealed ?? (opened ? Number(opened.amount) : null);
  const ready = habits.some((habit) => habit.completionDates.includes(today));
  // A ready box wiggles now and then to ask to be opened.
  useEffect(() => {
    if (!ready || amount !== null) return;
    const wiggle = Animated.loop(Animated.sequence([
      Animated.delay(1600),
      ...[1, -1, 1, -1, 0].map((toValue) => Animated.timing(shake, { toValue, duration: 90, useNativeDriver: false })),
    ]));
    wiggle.start();
    return () => wiggle.stop();
  }, [amount, ready, shake]);
  if (!habits.length) return null;

  const open = async () => {
    if (opening || amount !== null || !ready) return;
    setOpening(true);
    setError('');
    const rattle = Animated.loop(Animated.sequence([1, -1].map((toValue) => Animated.timing(shake, { toValue, duration: 70, useNativeDriver: false }))));
    rattle.start();
    const [result] = await Promise.all([openMysteryBox(today), new Promise((resolve) => setTimeout(resolve, 900))]);
    rattle.stop();
    shake.setValue(0);
    setOpening(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onWallet(result);
    setRevealed(result.amount);
    pop.setValue(0.3);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 140, useNativeDriver: false }).start();
  };

  const title = amount !== null ? `You got +${amount} tokens!` : ready ? 'Your mystery box is ready' : 'Daily mystery box';
  const text = amount !== null ? 'A new box waits after tomorrow\'s first check-in.' : ready ? (opening ? 'Opening...' : 'Tap to open it. Up to 20 tokens inside!') : 'Check in one habit today to unlock it.';
  return (
    <Pressable style={({ pressed }) => [styles.card, styles.boxCard, ready && amount === null && styles.boxReady, pressed && ready && styles.pressed, style]} onPress={open} disabled={!ready || amount !== null || opening} accessibilityRole="button" accessibilityLabel={`${title}. ${text}`}>
      {revealed !== null && <Confetti burstKey={`box-${today}`} />}
      <View style={styles.cardHeader}>
        <Animated.View style={[styles.boxIcon, !ready && styles.boxIconLocked, { transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-12deg', '12deg'] }) }] }]}>
          <Text style={styles.boxEmoji}>{amount !== null ? '🎉' : ready ? '🎁' : '🔒'}</Text>
        </Animated.View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.cardText}>{error || text}</Text>
        </View>
        {amount !== null ? (
          <Animated.View style={[styles.boxAmount, { transform: [{ scale: pop }] }]}><Text style={styles.boxAmountText}>+{amount}</Text></Animated.View>
        ) : ready ? (
          <View style={styles.boxOpen}><Text style={styles.boxOpenText}>Open</Text></View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** In the evening: habits still open today whose streak breaks at midnight. */
export function StreakRiskBanner({ habits, now, onFreeze, style }: { habits: Habit[]; now: Date; onFreeze?: () => void; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const { streakFreeze } = useAppColorScheme();
  const frozenDays = streakFreeze?.frozenDays ?? [];
  const atRisk = habitsAtRisk(habits, now, 18, frozenDays);
  if (!atRisk.length) return null;
  const today = getLocalDateKey(now);
  const streakOf = (habit: Habit) => computeStreak(habit, habit.completionDates, today, frozenDays);
  const [first] = [...atRisk].sort((a, b) => streakOf(b) - streakOf(a));
  const days = streakOf(first);
  const held = streakFreeze?.available ?? 0;
  const others = atRisk.length - 1;
  return (
    <View style={[styles.risk, style]} accessibilityRole="alert">
      <View style={styles.riskIcon}><Ionicons name="flame" size={20} color="#FFFFFF" /></View>
      <View style={styles.riskCopy}>
        <Text style={styles.riskTitle}>Keep your streak alive tonight</Text>
        <Text style={styles.riskText}>
          {first.label} ({days} day{days === 1 ? '' : 's'}){others > 0 ? ` and ${others} more` : ''} will reset at midnight if not done.
        </Text>
        {held > 0 ? (
          <Text style={styles.riskFreeze}>🧊 Your streak freeze covers you if you miss tonight.</Text>
        ) : onFreeze ? (
          <Pressable onPress={onFreeze} accessibilityRole="button" hitSlop={6}>
            <Text style={styles.riskFreezeLink}>🧊 Or protect it with a streak freeze</Text>
          </Pressable>
        ) : null}
      </View>
      <Pressable style={({ pressed }) => [styles.riskButton, pressed && styles.pressed]} onPress={() => openFocus(first.id)} accessibilityRole="button" accessibilityLabel={`Start a focus session for ${first.label}`}>
        <Text style={styles.riskButtonText}>Do it now</Text>
      </Pressable>
    </View>
  );
}

/** Today's challenge: finish up to 3 scheduled habits for bonus tokens (paid by the server). */
export function DailyChallengeCard({ habits, now, style }: { habits: Habit[]; now: Date; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const challenge = dailyChallenge(habits, now);
  if (!challenge.target) return null;
  return (
    <View style={[styles.card, challenge.complete && styles.challengeDone, style]} accessible accessibilityLabel={`Daily challenge: ${challenge.done} of ${challenge.target} habits done${challenge.complete ? `, ${challenge.bonus} bonus tokens earned` : ''}`}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, styles.challengeIcon]}><Ionicons name="trophy" size={17} color="#FFFFFF" /></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Daily challenge</Text>
          <Text style={styles.cardText}>
            {challenge.complete ? `Done! +${challenge.bonus} tokens earned` : `Finish ${challenge.target} habit${challenge.target === 1 ? '' : 's'} today · +${challenge.bonus} tokens`}
          </Text>
        </View>
        <Text style={styles.challengeCount}>{challenge.done}/{challenge.target}</Text>
      </View>
      <View style={styles.pips}>
        {Array.from({ length: challenge.target }, (_, index) => (
          <View key={index} style={[styles.pip, index < challenge.done && styles.pipDone]} />
        ))}
      </View>
    </View>
  );
}

const RECAP_KEY = 'habitai:recap-dismissed';
const dayName = (dateKey: string) => new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' });

/** Last week in numbers, with one AI tip on request; hidden for the rest of the week once closed. */
export function WeeklyRecapCard({ habits, now, style }: { habits: Habit[]; now: Date; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const recap = weeklyRecap(habits, now);
  const [dismissedWeek, setDismissedWeek] = useState<string | null | undefined>(undefined);
  const [tip, setTip] = useState<{ loading: boolean; text?: string; error?: string }>({ loading: false });

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(RECAP_KEY)
      .then((value) => { if (active) setDismissedWeek(value); })
      .catch(() => { if (active) setDismissedWeek(null); });
    return () => { active = false; };
  }, []);

  const { lastWeek, change } = recap;
  if (dismissedWeek === undefined || dismissedWeek === recap.weekKey || !lastWeek.scheduled) return null;

  const percent = Math.round((lastWeek.rate ?? 0) * 100);
  const changePoints = change === null ? null : Math.round(change * 100);
  const dismiss = () => {
    setDismissedWeek(recap.weekKey);
    AsyncStorage.setItem(RECAP_KEY, recap.weekKey).catch(() => undefined);
  };
  const getTip = async () => {
    setTip({ loading: true });
    const result = await askAi('assistant', `Weekly recap: last week I completed ${lastWeek.done} of ${lastWeek.scheduled} scheduled habit check-ins (${percent}%)${lastWeek.bestDay ? `, best day ${dayName(lastWeek.bestDay)}` : ''}. Give me one short, specific tip to do better this week.`);
    setTip(result.ok ? { loading: false, text: result.answer } : { loading: false, error: result.message });
  };

  return (
    <View style={[styles.card, style]}>
      <View style={styles.cardHeader}>
        <View style={[styles.cardIcon, styles.recapIcon]}><Ionicons name="calendar" size={16} color="#FFFFFF" /></View>
        <View style={styles.cardCopy}>
          <Text style={styles.cardTitle}>Your week in review</Text>
          <Text style={styles.cardText}>Last week, Monday to Sunday</Text>
        </View>
        <Pressable onPress={dismiss} hitSlop={10} style={styles.closeTap} accessibilityRole="button" accessibilityLabel="Hide the weekly recap">
          <Ionicons name="close" size={18} color="#8A8492" />
        </Pressable>
      </View>
      <View style={styles.recapStats}>
        <View style={styles.recapStat}>
          <Text style={styles.recapValue}>{percent}%</Text>
          <Text style={styles.recapLabel}>{lastWeek.done}/{lastWeek.scheduled} done</Text>
        </View>
        <View style={styles.recapStat}>
          <Text style={[styles.recapValue, changePoints !== null && changePoints > 0 && styles.up, changePoints !== null && changePoints < 0 && styles.down]}>
            {changePoints === null ? '—' : `${changePoints > 0 ? '▲' : changePoints < 0 ? '▼' : ''}${Math.abs(changePoints)}`}
          </Text>
          <Text style={styles.recapLabel}>vs week before</Text>
        </View>
        <View style={styles.recapStat}>
          <Text style={styles.recapValue} numberOfLines={1}>{lastWeek.bestDay ? dayName(lastWeek.bestDay).slice(0, 3) : '—'}</Text>
          <Text style={styles.recapLabel}>best day</Text>
        </View>
      </View>
      {tip.text ? (
        <View style={styles.tip}><Ionicons name="sparkles" size={14} color={themeColor('#5B42D8')} /><Text style={styles.tipText}>{tip.text}</Text></View>
      ) : (
        <Pressable style={({ pressed }) => [styles.tipButton, pressed && styles.pressed]} onPress={getTip} disabled={tip.loading} accessibilityRole="button">
          {tip.loading ? <ActivityIndicator size="small" color={themeColor('#5B42D8')} /> : <Ionicons name="sparkles" size={15} color={themeColor('#5B42D8')} />}
          <Text style={styles.tipButtonText}>{tip.loading ? 'Thinking…' : 'Get an AI tip for this week'}</Text>
        </Pressable>
      )}
      {tip.error && <Text style={styles.tipError}>{tip.error}</Text>}
    </View>
  );
}

const themedStyles = createThemedStyles({
  closeTap: { width: 40, height: 40, marginTop: -8, marginRight: -8, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  level: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: '#ECE6FB' },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#4327A0' },
  levelBadgeText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  levelCopy: { flex: 1, gap: 4 },
  levelTrack: { height: 8, borderRadius: 4, backgroundColor: '#E6DFFA', overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 4, backgroundColor: '#7B5CF0' },
  levelText: { fontSize: 11, fontWeight: '700', color: '#6A6573' },
  questIcon: { backgroundColor: '#4BA3FF' },
  questList: { gap: 10, marginTop: 12 },
  questRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  questBadge: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F3FF' },
  questBadgeDone: { backgroundColor: '#3BAA74' },
  questCopy: { flex: 1, gap: 5 },
  questTitle: { fontSize: 12, fontWeight: '800', color: '#2F2D3C' },
  questTitleDone: { color: '#2C6B4C' },
  questTrack: { height: 6, borderRadius: 3, backgroundColor: '#EEF3FA', overflow: 'hidden' },
  questFill: { height: '100%', borderRadius: 3, backgroundColor: '#4BA3FF' },
  questFillDone: { backgroundColor: '#3BAA74' },
  questCount: { width: 34, textAlign: 'right', fontSize: 11, fontWeight: '800', color: '#6A6573' },
  rewardChip: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999, backgroundColor: '#FFF4D9' },
  rewardChipDone: { backgroundColor: '#ECF8F1' },
  rewardText: { fontSize: 11, fontWeight: '900', color: '#9A6A12' },
  rewardTextDone: { color: '#2C6B4C' },
  boxCard: { overflow: 'visible' },
  boxReady: { borderWidth: 1.5, borderColor: '#F2C94C' },
  boxIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF4D9' },
  boxIconLocked: { backgroundColor: '#F1EEF8' },
  boxEmoji: { fontSize: 24 },
  boxAmount: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F2A93B' },
  boxAmountText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  boxOpen: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: '#5B42D8' },
  boxOpenText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#FFF1E6' },
  streakChipText: { fontSize: 12, fontWeight: '900', color: '#C9661F' },
  freezeChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#E7F3FF' },
  freezeChipText: { fontSize: 12, fontWeight: '900', color: '#2F7CC4' },
  riskFreeze: { marginTop: 4, fontSize: 11, fontWeight: '800', color: '#2F7CC4' },
  riskFreezeLink: { marginTop: 4, fontSize: 11, fontWeight: '800', color: '#2F7CC4', textDecorationLine: 'underline' },
  badgeTally: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#F0E9FF' },
  badgeTallyText: { fontSize: 11, fontWeight: '900', color: '#5B42D8' },
  badgeTrack: { height: 8, borderRadius: 4, backgroundColor: '#EFEBFA', marginTop: 12, overflow: 'hidden' },
  badgeFill: { height: '100%', borderRadius: 4 },
  badgeLeft: { marginTop: 6, fontSize: 11, fontWeight: '800', color: '#6A6573' },
  risk: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: '#FFF1E6', borderWidth: 1, borderColor: '#FBD9BD' },
  riskIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F08A3C' },
  riskCopy: { flex: 1 },
  riskTitle: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  riskText: { marginTop: 2, fontSize: 12, lineHeight: 16, fontWeight: '600', color: '#7A5A44' },
  riskButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F08A3C' },
  riskButtonText: { fontSize: 12, fontWeight: '800', color: '#FFFFFF' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 14, shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1 },
  cardTitle: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  cardText: { marginTop: 1, fontSize: 12, fontWeight: '600', color: '#777282' },
  challengeIcon: { backgroundColor: '#F2A93B' },
  challengeDone: { borderWidth: 1.5, borderColor: '#9FDDBC' },
  challengeCount: { fontSize: 16, fontWeight: '900', color: '#2F2D3C' },
  pips: { flexDirection: 'row', gap: 6, marginTop: 12 },
  pip: { flex: 1, height: 8, borderRadius: 4, backgroundColor: '#EFEBFA' },
  pipDone: { backgroundColor: '#3BAA74' },
  recapIcon: { backgroundColor: '#5B42D8' },
  recapStats: { flexDirection: 'row', gap: 8, marginTop: 12 },
  recapStat: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 14, backgroundColor: '#F7F4FF' },
  recapValue: { fontSize: 18, fontWeight: '900', color: '#2F2D3C' },
  recapLabel: { marginTop: 2, fontSize: 10, fontWeight: '700', color: '#8A8492' },
  up: { color: '#2E8F5E' },
  down: { color: '#C2543E' },
  tipButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 10, height: 38, borderRadius: 12, borderWidth: 1, borderColor: '#DCD3F7' },
  tipButtonText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  tip: { flexDirection: 'row', gap: 8, marginTop: 10, padding: 10, borderRadius: 12, backgroundColor: '#F4F0FF' },
  tipText: { flex: 1, fontSize: 12, lineHeight: 18, fontWeight: '600', color: '#3A3546' },
  tipError: { marginTop: 6, fontSize: 11, fontWeight: '700', color: '#C2543E' },
});
