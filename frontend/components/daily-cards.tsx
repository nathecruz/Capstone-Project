// Home's daily cards: the daily reward calendar (claim once a day, bigger each day in a row) and
// today's three challenges (counted and paid by the server with every check-in).
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { claimDailyReward, getDailyClaim, type DailyClaim } from '@/authentication';
import { Confetti } from '@/components/confetti';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useDailyChallenges } from '@/hooks/use-daily-challenges';
import { onLive } from '@/utils/live-events';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { getLocalDateKey } from '@/utils/habit-visibility';

/** The 7-day reward calendar with today's claim. */
/** onReadyChange: told whether today's reward is waiting to be claimed (for the Rewards tabs). */
export function DailyClaimCard({ style, onReadyChange }: { style?: object | false; onReadyChange?: (ready: boolean) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { applyWallet } = useAppColorScheme();
  const [claim, setClaim] = useState<DailyClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [burst, setBurst] = useState(0);
  const today = getLocalDateKey();

  useEffect(() => {
    let active = true;
    const load = () => void getDailyClaim(today).then((result) => {
      if (active && result.ok) setClaim(result);
    });
    load();
    // Claimed on another device: show it here too.
    const unsubscribe = onLive('claims', load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [today]);

  useEffect(() => {
    if (claim) onReadyChange?.(!claim.claimedToday);
  }, [claim, onReadyChange]);

  if (!claim) return null;
  const { day, claimedToday, rewards } = claim;
  const next = rewards[day % rewards.length];

  const collect = async () => {
    setBusy(true);
    setError('');
    const result = await claimDailyReward(today);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyWallet(result);
    setClaim(result);
    if (!result.alreadyClaimed) setBurst((count) => count + 1);
  };

  return (
    <View style={[styles.card, style]}>
      {burst > 0 && <Confetti burstKey={`claim-${burst}`} />}
      <View style={styles.header}>
        <View style={[styles.icon, styles.giftIcon]}><Ionicons name="gift" size={17} color="#FFFFFF" /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Daily reward</Text>
          <Text style={styles.subtitle}>{claimedToday ? `Day ${day} claimed. Tomorrow: +${next} tokens` : `Day ${day} of 7 · come back every day for more`}</Text>
        </View>
      </View>

      <View style={styles.days} accessibilityLabel={`Daily reward calendar, day ${day} of 7`}>
        {rewards.map((amount, index) => {
          const number = index + 1;
          const claimed = number < day || (claimedToday && number === day);
          const current = !claimedToday && number === day;
          const big = number === rewards.length;
          return (
            <View key={number} style={[styles.day, big && styles.dayBig, claimed && styles.dayClaimed, current && styles.dayCurrent]} accessible accessibilityLabel={`Day ${number}: ${amount} tokens${claimed ? ', claimed' : current ? ', ready' : ''}`}>
              <Text style={[styles.dayLabel, (claimed || current) && styles.dayLabelOn]}>Day {number}</Text>
              {claimed ? <Ionicons name="checkmark-circle" size={18} color={themeColor('#2E9D5C')} /> : <Text style={styles.dayEmoji}>{big ? '🎁' : '🪙'}</Text>}
              <Text style={[styles.dayAmount, current && styles.dayAmountOn]}>+{amount}</Text>
            </View>
          );
        })}
      </View>

      {!claimedToday && (
        <Pressable style={({ pressed }) => [styles.claimButton, pressed && styles.pressed, busy && styles.busy]} onPress={() => void collect()} disabled={busy} accessibilityRole="button" accessibilityLabel={`Claim ${claim.amount} tokens`}>
          {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="sparkles" size={17} color="#FFFFFF" />}
          <Text style={styles.claimText}>Claim +{claim.amount} tokens</Text>
        </Pressable>
      )}
      {Boolean(error) && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

/** Today's three challenges, with their progress and rewards. */
export function DailyChallengesCard({ habitCount, style }: { habitCount: number; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const challenges = useDailyChallenges(habitCount);
  if (!challenges.length) return null;
  const done = challenges.filter((challenge) => challenge.complete);
  const earned = done.reduce((sum, challenge) => sum + challenge.reward, 0);
  const total = challenges.reduce((sum, challenge) => sum + challenge.reward, 0);

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={[styles.icon, styles.trophyIcon]}><Ionicons name="trophy" size={17} color="#FFFFFF" /></View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Today&apos;s challenges</Text>
          <Text style={styles.subtitle}>{done.length === challenges.length ? 'All done! See you tomorrow.' : `${done.length} of ${challenges.length} done · new ones every day`}</Text>
        </View>
        <View style={styles.earned} accessible accessibilityLabel={`${earned} of ${total} tokens earned`}>
          <Text style={styles.earnedText}>{earned}/{total}</Text>
          <Ionicons name="star" size={12} color={themeColor('#E6A617')} />
        </View>
      </View>
      {challenges.map((challenge) => (
        <View key={challenge.id} style={[styles.challenge, challenge.complete && styles.challengeDone]} accessible accessibilityLabel={`${challenge.title}: ${challenge.progress} of ${challenge.target}${challenge.complete ? ', done' : ''}, ${challenge.reward} tokens`}>
          <View style={[styles.challengeIcon, challenge.complete && styles.challengeIconDone]}>
            <Ionicons name={(challenge.complete ? 'checkmark' : challenge.icon) as keyof typeof Ionicons.glyphMap} size={16} color={challenge.complete ? '#FFFFFF' : themeColor('#5B42D8')} />
          </View>
          <View style={styles.challengeCopy}>
            <Text style={[styles.challengeTitle, challenge.complete && styles.challengeTitleDone]} numberOfLines={2}>{challenge.title}</Text>
            <View style={styles.track}><View style={[styles.fill, challenge.complete && styles.fillDone, { width: `${Math.round((challenge.progress / challenge.target) * 100)}%` }]} /></View>
          </View>
          <View style={[styles.reward, challenge.complete && styles.rewardDone]}>
            <Text style={[styles.rewardText, challenge.complete && styles.rewardTextDone]}>+{challenge.reward}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 16, gap: 12, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  giftIcon: { backgroundColor: '#E58BB0' },
  trophyIcon: { backgroundColor: '#F2A93B' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 16, fontWeight: '900', color: '#24212D' },
  subtitle: { marginTop: 1, fontSize: 12, fontWeight: '600', color: '#6A6573' },
  days: { flexDirection: 'row', gap: 5 },
  day: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 8, borderRadius: 12, backgroundColor: '#F7F5FC', borderWidth: 1.5, borderColor: '#F7F5FC' },
  dayBig: { flex: 1.25, backgroundColor: '#FFF4D6', borderColor: '#FFF4D6' },
  dayClaimed: { backgroundColor: '#E6F6EC', borderColor: '#E6F6EC' },
  dayCurrent: { backgroundColor: '#F1EDFF', borderColor: '#5B42D8' },
  dayLabel: { fontSize: 11, fontWeight: '800', color: '#8A8492' },
  dayLabelOn: { color: '#3B3647' },
  dayEmoji: { fontSize: 16, lineHeight: 20 },
  dayAmount: { fontSize: 12, fontWeight: '900', color: '#6A6573' },
  dayAmountOn: { color: '#5B42D8' },
  claimButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 46, borderRadius: 14, backgroundColor: '#5B42D8' },
  claimText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
  busy: { opacity: 0.7 },
  error: { fontSize: 12, fontWeight: '700', color: '#C24456', textAlign: 'center' },
  earned: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFF4D6' },
  earnedText: { fontSize: 12, fontWeight: '900', color: '#8A5A00' },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: '#F8F6FD' },
  challengeDone: { backgroundColor: '#ECF8F1' },
  challengeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE8FF' },
  challengeIconDone: { backgroundColor: '#2E9D5C' },
  challengeCopy: { flex: 1, minWidth: 0, gap: 6 },
  challengeTitle: { fontSize: 13, fontWeight: '800', color: '#2F2D3C' },
  challengeTitleDone: { color: '#2C6B4C' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E8E4F2', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: '#5B42D8' },
  fillDone: { backgroundColor: '#2E9D5C' },
  reward: { minWidth: 40, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFF4D6' },
  rewardDone: { backgroundColor: '#2E9D5C' },
  rewardText: { fontSize: 12, fontWeight: '900', color: '#8A5A00' },
  rewardTextDone: { color: '#FFFFFF' },
}, {
  dayCurrent: { backgroundColor: '#2A2440', borderColor: '#9C88FF' },
});
