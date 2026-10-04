// Home's bento grid: streak, level, tokens and Habi at a glance. Each tile opens where you act on it.
import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { BuddyAvatar } from '@/components/buddy';
import type { Habit } from '@/hooks/app-state/types';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useBuddy } from '@/hooks/use-buddy';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { historyStats } from '@/utils/achievements';
import { buddyGrowth, buddyMood } from '@/utils/buddy';
import { levelProgress } from '@/utils/engagement';

type TileProps = {
  tone: 'streak' | 'level' | 'tokens' | 'buddy' | 'rank';
  label: string;
  value: string;
  unit?: string;
  detail: string;
  icon?: React.ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
  children?: React.ReactNode;
};

/** One bento tile: a label and icon, a big value, and a short detail. Also used on Profile. */
export function BentoTile({ tone, label, value, unit, detail, icon, onPress, accessibilityLabel, children }: TileProps) {
  const styles = useThemedStyles(themedStyles);
  return (
    <Pressable style={({ pressed }) => [styles.tile, styles[tone], pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
      <View style={styles.tileTop}>
        <Text style={[styles.label, styles[`${tone}Ink`]]}>{label}</Text>
        {icon}
      </View>
      <View style={styles.valueRow}>
        <Text style={[styles.value, styles[`${tone}Ink`]]} numberOfLines={1}>{value}</Text>
        {unit ? <Text style={[styles.unit, styles[`${tone}Ink`]]} numberOfLines={1}>{unit}</Text> : null}
      </View>
      {children}
      <Text style={[styles.detail, styles[`${tone}Soft`]]} numberOfLines={2}>{detail}</Text>
    </Pressable>
  );
}

export function BentoTiles({ habits, onFreeze, style }: { habits: Habit[]; onFreeze: () => void; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { points, tokens, streakFreeze, isFaculty } = useAppColorScheme();
  const { buddy } = useBuddy();
  const frozenDays = streakFreeze?.frozenDays;
  const history = useMemo(() => historyStats(habits, new Date(), frozenDays), [frozenDays, habits]);
  const streak = Math.max(0, ...habits.map((habit) => habit.streak));
  const freezes = streakFreeze?.available ?? 0;
  const { level, xp, toNext, share } = levelProgress(points);
  const name = buddy?.name ?? 'Habi';
  const checkIns = buddy?.checkIns ?? history.totalCheckIns;
  const { mood, line } = buddyMood(habits, name, new Date(), frozenDays);
  const growth = buddyGrowth(checkIns, buddy?.stages);
  const go = (href: Href) => () => router.push(href);
  const iconBubble = (name: keyof typeof Ionicons.glyphMap, color: string) => (
    <View style={styles.iconBubble}><Ionicons name={name} size={16} color={themeColor(color)} /></View>
  );

  return (
    <View style={[styles.grid, style]}>
      <BentoTile
        tone="streak"
        label="Streak"
        value={String(streak)}
        unit={streak === 1 ? 'day' : 'days'}
        detail={`Best ${history.bestStreak} · ${freezes} 🧊 ${freezes === 1 ? 'freeze' : 'freezes'}`}
        icon={iconBubble('flame', '#E8862A')}
        onPress={onFreeze}
        accessibilityLabel={`${streak}-day streak, best ${history.bestStreak}, ${freezes} streak freezes. Open Streak Freeze`}
      />
      <BentoTile
        tone="level"
        label="Level"
        value={String(level)}
        unit={`${xp}/${xp + toNext} XP`}
        detail={`${toNext} XP to level ${level + 1}`}
        icon={iconBubble('star', '#5B42D8')}
        onPress={go('/achievements')}
        accessibilityLabel={`Level ${level}, ${toNext} XP to the next level. Open badges`}
      >
        <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(share * 100)}%` }]} /></View>
      </BentoTile>
      {isFaculty ? (
        <BentoTile
          tone="tokens"
          label="Check-ins"
          value={String(history.totalCheckIns)}
          detail="All the days you showed up"
          icon={iconBubble('checkmark-done', '#2E9D5C')}
          onPress={go('/progress')}
          accessibilityLabel={`${history.totalCheckIns} check-ins. Open progress`}
        />
      ) : (
        <BentoTile
          tone="tokens"
          label="Tokens"
          value={String(tokens)}
          detail="Spend on themes, freezes and more"
          icon={iconBubble('wallet', '#2E9D5C')}
          onPress={go('/leaderboards')}
          accessibilityLabel={`${tokens} tokens. Open token rewards`}
        />
      )}
      <BentoTile
        tone="buddy"
        label={`Buddy · ${growth.stage.name}`}
        value={name}
        detail={line}
        icon={<BuddyAvatar buddy={buddy} checkIns={checkIns} mood={mood} size={40} />}
        onPress={go('/buddy')}
        accessibilityLabel={`${name}, ${growth.stage.name} stage: ${line}`}
      />
    </View>
  );
}

const themedStyles = createThemedStyles({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { flexGrow: 1, flexBasis: '45%', minHeight: 124, borderRadius: 22, padding: 14, justifyContent: 'space-between', gap: 6 },
  pressed: { opacity: 0.88, transform: [{ scale: 0.98 }] },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, minHeight: 32 },
  label: { flexShrink: 1, fontSize: 12, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  iconBubble: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.75)', alignItems: 'center', justifyContent: 'center' },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 5 },
  value: { flexShrink: 1, fontSize: 28, fontWeight: '900', letterSpacing: -0.5 },
  unit: { flexShrink: 1, fontSize: 13, fontWeight: '800' },
  detail: { fontSize: 12, lineHeight: 16, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.8)', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3, backgroundColor: '#5B42D8' },
  streak: { backgroundColor: '#FFF1E0' },
  streakInk: { color: '#7A4508' },
  streakSoft: { color: '#9A5A10' },
  level: { backgroundColor: '#EEE9FF' },
  levelInk: { color: '#33248A' },
  levelSoft: { color: '#5642B8' },
  tokens: { backgroundColor: '#E2F5EA' },
  tokensInk: { color: '#145234' },
  tokensSoft: { color: '#1F7A4D' },
  buddy: { backgroundColor: '#FCE7F1' },
  buddyInk: { color: '#73244A' },
  buddySoft: { color: '#9C3768' },
  rank: { backgroundColor: '#FFF5D4' },
  rankInk: { color: '#664700' },
  rankSoft: { color: '#875F00' },
}, {
  iconBubble: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  track: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden' },
});
