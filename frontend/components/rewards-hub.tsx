// Home's rewards as tabs: the daily reward, today's challenges and the weekly quests, one at a time
// instead of three tall cards in a row. All three stay mounted (only the chosen one shows), so each
// keeps its own data and live updates, and the tabs can say where something is waiting.
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { DailyChallengesCard, DailyClaimCard } from '@/components/daily-cards';
import { WeeklyQuestsCard } from '@/components/engagement-cards';
import type { Habit } from '@/hooks/app-state/types';
import { useDailyChallenges } from '@/hooks/use-daily-challenges';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { weeklyQuests } from '@/utils/quests';

type Tab = 'daily' | 'challenges' | 'quests';

export function RewardsHub({ habits, now }: { habits: Habit[]; now: Date }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  // Read only: the challenges card below loads them.
  const challenges = useDailyChallenges(habits.length, false);
  const quests = weeklyQuests(habits, now);
  const [claimReady, setClaimReady] = useState<boolean | null>(null);
  // Whether the reward was waiting when Home opened: it picks the first tab, and claiming does not
  // switch tabs (the claimed card and its confetti stay in view).
  const [readyAtStart, setReadyAtStart] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab: Tab = picked ?? (readyAtStart === false ? 'challenges' : 'daily');
  const onReadyChange = useCallback((ready: boolean) => {
    setClaimReady(ready);
    setReadyAtStart((current) => current ?? ready);
  }, []);
  const challengesDone = challenges.filter((challenge) => challenge.complete).length;
  const questsDone = quests.filter((quest) => quest.complete).length;

  const tabs: { id: Tab; label: string; icon: keyof typeof Ionicons.glyphMap; status: string; waiting?: boolean }[] = [
    { id: 'daily', label: 'Daily', icon: 'gift', status: claimReady === true ? 'Ready to claim' : claimReady === false ? 'Claimed today' : '…', waiting: claimReady === true },
    { id: 'challenges', label: 'Challenges', icon: 'trophy', status: challenges.length ? `${challengesDone}/${challenges.length} done` : 'Today' },
    { id: 'quests', label: 'Quests', icon: 'flag', status: quests.length ? `${questsDone}/${quests.length} done` : 'This week' },
  ];

  return (
    <View style={styles.hub}>
      <View style={styles.header}>
        <Text style={styles.title}>Rewards</Text>
        <Text style={styles.subtitle}>Earn tokens every day</Text>
      </View>
      <View style={styles.tabs} accessibilityRole="tablist">
        {tabs.map((item) => {
          const active = item.id === tab;
          return (
            <Pressable
              key={item.id}
              style={({ pressed }) => [styles.tab, active && styles.tabActive, pressed && styles.pressed]}
              onPress={() => setPicked(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${item.label}: ${item.status}`}
            >
              <View style={styles.tabTop}>
                <Ionicons name={item.icon} size={15} color={active ? themeColor('#FFFFFF') : themeColor('#5B42D8')} />
                <Text style={[styles.tabText, active && styles.tabTextActive]} numberOfLines={1}>{item.label}</Text>
                {item.waiting ? <View style={styles.dot} /> : null}
              </View>
              <Text style={[styles.tabStatus, active && styles.tabStatusActive, item.waiting && !active && styles.tabStatusWaiting]} numberOfLines={1}>{item.status}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={tab === 'daily' ? null : styles.hidden}><DailyClaimCard onReadyChange={onReadyChange} /></View>
      <View style={tab === 'challenges' ? null : styles.hidden}><DailyChallengesCard habitCount={habits.length} /></View>
      <View style={tab === 'quests' ? null : styles.hidden}><WeeklyQuestsCard habits={habits} now={now} /></View>
    </View>
  );
}

const themedStyles = createThemedStyles({
  hub: { gap: 12 },
  header: { marginTop: 8 },
  title: { fontSize: 20, fontWeight: '900', color: '#1F1C26' },
  subtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#8A8492' },
  tabs: { flexDirection: 'row', gap: 8 },
  tab: { flex: 1, minWidth: 0, minHeight: 58, alignItems: 'center', justifyContent: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 8, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E2F3' },
  tabActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  tabTop: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%' },
  tabText: { flexShrink: 1, fontSize: 13, fontWeight: '900', color: '#3B3650' },
  tabTextActive: { color: '#FFFFFF' },
  tabStatus: { fontSize: 11, fontWeight: '700', color: '#7A7488' },
  tabStatusActive: { color: '#E3DCFF' },
  tabStatusWaiting: { color: '#C2412F' },
  // Something to collect: a small red dot, as on the bell.
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E5484D' },
  hidden: { display: 'none' },
  pressed: { opacity: 0.8 },
});
