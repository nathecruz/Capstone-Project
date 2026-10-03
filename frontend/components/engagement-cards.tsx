// Small Home cards that give a reason to come back every day: the level bar, the evening
// streak alert, the daily challenge and the Monday recap of last week.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, Text, View } from 'react-native';
import { openFocus } from '@/components/today-agenda';
import type { Goal, Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';
import { badgeProgress, badgeRemaining, nextBadge } from '@/utils/achievements';
import { askAi } from '@/utils/ai-client';
import { computeStreak } from '@/utils/streaks';
import { dailyChallenge, habitsAtRisk, levelProgress, POINTS_PER_LEVEL, weeklyRecap } from '@/utils/engagement';
import { getLocalDateKey } from '@/utils/habit-visibility';

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
export function LevelBar({ points, streak = 0, style }: { points: number; streak?: number; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const { level, xp, toNext, share } = levelProgress(points);
  return (
    <View style={[styles.level, style]} accessible accessibilityLabel={`Level ${level}, ${xp} of ${POINTS_PER_LEVEL} XP, ${toNext} XP to the next level${streak ? `, ${streak}-day streak` : ''}`}>
      <View style={styles.levelBadge}>
        <Ionicons name="star" size={13} color="#FFD44D" />
        <Text style={styles.levelBadgeText}>Lv {level}</Text>
      </View>
      <View style={styles.levelCopy}>
        <GrowingBar share={share} trackStyle={styles.levelTrack} fillStyle={styles.levelFill} />
        <Text style={styles.levelText} numberOfLines={1}>{xp}/{POINTS_PER_LEVEL} XP · {toNext} to Lv {level + 1}</Text>
      </View>
      {streak > 0 && (
        <View style={styles.streakChip}>
          <Ionicons name="flame" size={13} color="#F08A3C" />
          <Text style={styles.streakChipText}>{streak}</Text>
        </View>
      )}
    </View>
  );
}

/** The badge closest to being earned, with what is left; opens Achievements. */
export function NextBadgeCard({ habits, goals, style }: { habits: Habit[]; goals: Goal[]; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const progress = useMemo(() => badgeProgress(habits, goals), [habits, goals]);
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

/** In the evening: habits still open today whose streak breaks at midnight. */
export function StreakRiskBanner({ habits, now, style }: { habits: Habit[]; now: Date; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const atRisk = habitsAtRisk(habits, now);
  if (!atRisk.length) return null;
  const today = getLocalDateKey(now);
  const [first] = [...atRisk].sort((a, b) => computeStreak(b, b.completionDates, today) - computeStreak(a, a.completionDates, today));
  const days = computeStreak(first, first.completionDates, today);
  const others = atRisk.length - 1;
  return (
    <View style={[styles.risk, style]} accessibilityRole="alert">
      <View style={styles.riskIcon}><Ionicons name="flame" size={20} color="#FFFFFF" /></View>
      <View style={styles.riskCopy}>
        <Text style={styles.riskTitle}>Keep your streak alive tonight</Text>
        <Text style={styles.riskText}>
          {first.label} ({days} day{days === 1 ? '' : 's'}){others > 0 ? ` and ${others} more` : ''} will reset at midnight if not done.
        </Text>
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
        <Pressable onPress={dismiss} hitSlop={10} accessibilityRole="button" accessibilityLabel="Hide the weekly recap">
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
        <View style={styles.tip}><Ionicons name="sparkles" size={14} color="#5B42D8" /><Text style={styles.tipText}>{tip.text}</Text></View>
      ) : (
        <Pressable style={({ pressed }) => [styles.tipButton, pressed && styles.pressed]} onPress={getTip} disabled={tip.loading} accessibilityRole="button">
          {tip.loading ? <ActivityIndicator size="small" color="#5B42D8" /> : <Ionicons name="sparkles" size={15} color="#5B42D8" />}
          <Text style={styles.tipButtonText}>{tip.loading ? 'Thinking…' : 'Get an AI tip for this week'}</Text>
        </Pressable>
      )}
      {tip.error && <Text style={styles.tipError}>{tip.error}</Text>}
    </View>
  );
}

const themedStyles = createThemedStyles({
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  level: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.72)', borderWidth: 1, borderColor: '#ECE6FB' },
  levelBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#4327A0' },
  levelBadgeText: { fontSize: 12, fontWeight: '900', color: '#FFFFFF' },
  levelCopy: { flex: 1, gap: 4 },
  levelTrack: { height: 8, borderRadius: 4, backgroundColor: '#E6DFFA', overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 4, backgroundColor: '#7B5CF0' },
  levelText: { fontSize: 11, fontWeight: '700', color: '#6A6573' },
  streakChip: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#FFF1E6' },
  streakChipText: { fontSize: 12, fontWeight: '900', color: '#C9661F' },
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
