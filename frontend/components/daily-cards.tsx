// Home's daily cards: the daily reward calendar (claim once a day, bigger each day in a row) and
// today's three daily quests (counted and paid by the server with every check-in), with the quest
// chest for finishing all of them, the quest streak, and Habi cheering them on.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { claimDailyReward, getDailyClaim, type DailyClaim } from '@/authentication';
import { BuddyAvatar } from '@/components/buddy';
import { Confetti } from '@/components/confetti';
import type { Habit } from '@/hooks/app-state/types';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useBuddy } from '@/hooks/use-buddy';
import { useDailyQuests } from '@/hooks/use-daily-challenges';
import { onLive } from '@/utils/live-events';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { buddyMood } from '@/utils/buddy';
import { formatTimeLeft, habiQuestLine, isQuestMissed, questChest, questHint, questsResetAt, questStreakLine } from '@/utils/daily-quests';
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

/**
 * Today's three daily quests with their progress, what is left (or that one was missed) and their
 * tokens; the quest chest that opens when all are done, the quest streak, when new quests come, and
 * Habi, who hops each time a quest is finished. `habits` are this week's habits.
 */
export function DailyChallengesCard({ habits, now, style }: { habits: Habit[]; now: Date; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { streakFreeze } = useAppColorScheme();
  const quests = useDailyQuests(habits.length);
  // Read only: Home's Habi tile loads the buddy.
  const { buddy } = useBuddy(false);
  const { challenges } = quests;
  if (!challenges.length) return null;
  const done = challenges.filter((challenge) => challenge.complete);
  const earned = done.reduce((sum, challenge) => sum + challenge.reward, 0);
  const total = challenges.reduce((sum, challenge) => sum + challenge.reward, 0);
  const chest = questChest(challenges, quests.chestReward, now);
  const resetIn = formatTimeLeft(questsResetAt(quests.resetsAt, now) - now.getTime());
  const name = buddy?.name ?? 'Habi';
  const mood = chest.complete ? 'ecstatic' : buddyMood(habits, name, now, streakFreeze?.frozenDays).mood;

  return (
    <View style={[styles.card, style]}>
      <View style={styles.questHeader}>
        <BuddyAvatar buddy={buddy} checkIns={buddy?.checkIns ?? 0} mood={mood} size={64} cheer={done.length} />
        <View style={styles.headerCopy}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Daily quests</Text>
            <View style={styles.earned} accessible accessibilityLabel={`${earned + (chest.complete ? chest.reward : 0)} of ${total + (chest.shown ? chest.reward : 0)} tokens earned`}>
              <Text style={styles.earnedText}>{earned + (chest.complete ? chest.reward : 0)}/{total + (chest.shown ? chest.reward : 0)}</Text>
              <Ionicons name="star" size={12} color={themeColor('#E6A617')} />
            </View>
          </View>
          <View style={styles.resetRow}>
            <Ionicons name="time-outline" size={12} color={themeColor('#6A6573')} />
            <Text style={styles.subtitle}>{done.length === challenges.length ? `All done! New quests in ${resetIn}` : `${done.length} of ${challenges.length} done · new quests in ${resetIn}`}</Text>
          </View>
          <View style={styles.habiSays}><Text style={styles.habiSaysText}>{habiQuestLine(chest)}</Text></View>
        </View>
      </View>
      {challenges.map((challenge) => {
        const missed = isQuestMissed(challenge, now);
        const hint = questHint(challenge, now);
        return (
          <View key={challenge.id} style={[styles.challenge, challenge.complete && styles.challengeDone, missed && styles.challengeMissed]} accessible accessibilityLabel={`${challenge.title}: ${challenge.progress} of ${challenge.target}, ${hint}, ${challenge.reward} tokens`}>
            <View style={[styles.challengeIcon, challenge.complete && styles.challengeIconDone, missed && styles.challengeIconMissed]}>
              <Ionicons name={(challenge.complete ? 'checkmark' : missed ? 'close' : challenge.icon) as keyof typeof Ionicons.glyphMap} size={16} color={challenge.complete ? '#FFFFFF' : themeColor(missed ? '#8A8492' : '#5B42D8')} />
            </View>
            <View style={styles.challengeCopy}>
              <Text style={[styles.challengeTitle, challenge.complete && styles.challengeTitleDone, missed && styles.challengeTitleMissed]} numberOfLines={2}>{challenge.title}</Text>
              <View style={styles.track}><View style={[styles.fill, challenge.complete && styles.fillDone, missed && styles.fillMissed, { width: `${Math.round((challenge.progress / challenge.target) * 100)}%` }]} /></View>
              <Text style={[styles.hint, challenge.complete && styles.hintDone]} numberOfLines={1}>{hint}</Text>
            </View>
            <View style={[styles.reward, challenge.complete && styles.rewardDone, missed && styles.rewardMissed]}>
              <Text style={[styles.rewardText, challenge.complete && styles.rewardTextDone, missed && styles.rewardTextMissed]}>+{challenge.reward}</Text>
            </View>
          </View>
        );
      })}
      {chest.shown && (
        <View
          style={[styles.chest, chest.complete && styles.chestOpen, chest.missed && styles.chestMissed]}
          accessible
          accessibilityLabel={chest.complete ? `Quest chest opened: ${chest.reward} bonus tokens` : chest.missed ? `Quest chest: closed for today, a quest was missed` : `Quest chest: finish all ${chest.total} quests for ${chest.reward} bonus tokens, ${chest.done} of ${chest.total} done`}
        >
          <View style={[styles.chestIcon, chest.complete && styles.chestIconOpen, chest.missed && styles.chestIconMissed]}>
            <Ionicons name={chest.complete ? 'gift' : 'gift-outline'} size={18} color={chest.complete ? '#FFFFFF' : themeColor(chest.missed ? '#8A8492' : '#B7791F')} />
          </View>
          <View style={styles.challengeCopy}>
            <Text style={[styles.challengeTitle, chest.missed && styles.challengeTitleMissed]}>{chest.complete ? 'Quest chest opened!' : 'Quest chest'}</Text>
            <Text style={styles.hint}>{chest.complete ? 'Every quest done today' : chest.missed ? 'Closed for today: a quest was missed' : `Finish all ${chest.total} quests to open it`}</Text>
          </View>
          <View style={styles.pips}>
            {challenges.map((challenge) => <View key={challenge.id} style={[styles.pip, challenge.complete && styles.pipDone]} />)}
          </View>
          <View style={[styles.reward, styles.chestReward, chest.complete && styles.rewardDone, chest.missed && styles.rewardMissed]}>
            <Text style={[styles.rewardText, chest.complete && styles.rewardTextDone, chest.missed && styles.rewardTextMissed]}>+{chest.reward}</Text>
          </View>
        </View>
      )}
      {chest.shown && (
        <View style={styles.streakRow}>
          <Ionicons name="flame" size={14} color={quests.streak || chest.complete ? '#F2A93B' : themeColor('#B9B4C4')} />
          <Text style={styles.streakText}>{questStreakLine(quests.streak, chest)}</Text>
        </View>
      )}
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
  // Daily quests: Habi beside the title, what it says, and when new quests come.
  questHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  resetRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  habiSays: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 12, borderTopLeftRadius: 4, backgroundColor: '#F7F4FF' },
  habiSaysText: { fontSize: 12, fontWeight: '700', color: '#4A4556' },
  challenge: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, backgroundColor: '#F8F6FD' },
  challengeDone: { backgroundColor: '#ECF8F1' },
  // A quest that can no longer be finished today: greyed, so the open ones stand out.
  challengeMissed: { backgroundColor: '#F4F3F6' },
  challengeIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE8FF' },
  challengeIconDone: { backgroundColor: '#2E9D5C' },
  challengeIconMissed: { backgroundColor: '#E6E4EA' },
  challengeCopy: { flex: 1, minWidth: 0, gap: 5 },
  challengeTitle: { fontSize: 13, fontWeight: '800', color: '#2F2D3C' },
  challengeTitleDone: { color: '#2C6B4C' },
  challengeTitleMissed: { color: '#8A8492' },
  track: { height: 6, borderRadius: 3, backgroundColor: '#E8E4F2', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: '#5B42D8' },
  fillDone: { backgroundColor: '#2E9D5C' },
  fillMissed: { backgroundColor: '#C9C5D1' },
  hint: { fontSize: 11, fontWeight: '700', color: '#6A6573' },
  hintDone: { color: '#2C6B4C' },
  reward: { minWidth: 40, alignItems: 'center', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 999, backgroundColor: '#FFF4D6' },
  rewardDone: { backgroundColor: '#2E9D5C' },
  rewardMissed: { backgroundColor: '#ECEAF0' },
  rewardText: { fontSize: 12, fontWeight: '900', color: '#8A5A00' },
  rewardTextDone: { color: '#FFFFFF' },
  rewardTextMissed: { color: '#8A8492', textDecorationLine: 'line-through' },
  // The quest chest: gold while it waits, green once opened.
  chest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#F2C94C', backgroundColor: '#FFFBEB' },
  chestOpen: { borderStyle: 'solid', borderColor: '#2E9D5C', backgroundColor: '#ECF8F1' },
  chestMissed: { borderColor: '#DAD6E2', backgroundColor: '#F7F6F9' },
  chestIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFEFC2' },
  chestIconOpen: { backgroundColor: '#2E9D5C' },
  chestIconMissed: { backgroundColor: '#E6E4EA' },
  chestReward: { minWidth: 44 },
  pips: { flexDirection: 'row', gap: 4 },
  pip: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E6DFC8' },
  pipDone: { backgroundColor: '#2E9D5C' },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 2 },
  streakText: { flex: 1, fontSize: 12, fontWeight: '700', color: '#6A6573' },
}, {
  dayCurrent: { backgroundColor: '#2A2440', borderColor: '#9C88FF' },
  // Dark mode: the chest keeps its gold edge on a dark fill.
  chest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#B8912E', backgroundColor: '#2B2618' },
});
