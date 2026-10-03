// Habit Buddy pieces: the avatar (the hamster with what it wears and how it feels) and the Home card.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, Pressable, Text, View } from 'react-native';
import type { Habit } from '@/hooks/app-state/types';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useBuddy } from '@/hooks/use-buddy';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';
import { buddyGrowth, buddyMood, MOOD_FACE, type Buddy, type BuddyMood } from '@/utils/buddy';

/** Background and ring per stage: the buddy looks a little grander as it grows. */
const STAGE_LOOK = [
  { background: '#FFF1DC', ring: '#F7C98B' },
  { background: '#E3F4FF', ring: '#8CC8F2' },
  { background: '#ECE6FF', ring: '#A996F2' },
  { background: '#FFF4C7', ring: '#F2C94C' },
  { background: '#FFE3EF', ring: '#F28DB8' },
];

const itemEmoji = (buddy: Buddy | null, id: string) => buddy?.items.find((item) => item.id === id)?.emoji ?? '';

/** The hamster with its stage, outfit and mood; it bobs gently, more when happy, slowly when sleepy. */
export function BuddyAvatar({ buddy, checkIns, mood, size = 120 }: { buddy: Buddy | null; checkIns: number; mood: BuddyMood; size?: number }) {
  const styles = useThemedStyles(themedStyles);
  const { index } = buddyGrowth(checkIns, buddy?.stages);
  const look = STAGE_LOOK[index] ?? STAGE_LOOK[0];
  const [bob] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (mood === 'sad') {
      bob.setValue(0);
      return;
    }
    const duration = mood === 'sleepy' ? 2400 : mood === 'ecstatic' ? 600 : 1300;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bob, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(bob, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [bob, mood]);
  const lift = mood === 'ecstatic' ? -8 : -4;
  const head = itemEmoji(buddy, buddy?.head ?? '');
  const hand = itemEmoji(buddy, buddy?.hand ?? '');
  return (
    <View style={{ width: size, height: size }} accessible accessibilityLabel={`${buddy?.name ?? 'Your buddy'}, feeling ${mood}`}>
      <View style={[styles.circle, { width: size, height: size, borderRadius: size / 2, backgroundColor: look.background, borderColor: look.ring, borderWidth: Math.max(3, size * 0.035) }]} />
      <Animated.View style={[styles.body, { transform: [{ translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, lift] }) }, { scale: 0.82 + index * 0.05 }] }]}>
        <Text style={{ fontSize: size * 0.52, lineHeight: size * 0.62 }}>🐹</Text>
        {head ? <Text style={[styles.head, { fontSize: size * 0.26, top: -size * 0.13 }]}>{head}</Text> : null}
        {hand ? <Text style={[styles.hand, { fontSize: size * 0.22, right: -size * 0.12, bottom: -size * 0.02 }]}>{hand}</Text> : null}
      </Animated.View>
      <View style={[styles.moodBubble, { width: size * 0.3, height: size * 0.3, borderRadius: size * 0.15 }]}>
        <Text style={{ fontSize: size * 0.17 }}>{MOOD_FACE[mood]}</Text>
      </View>
    </View>
  );
}

/** Home: the buddy, how it feels about today, and a way to visit it. */
export function BuddyCard({ habits, style }: { habits: Habit[]; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const { buddy } = useBuddy();
  const name = buddy?.name ?? 'Habi';
  const checkIns = buddy?.checkIns ?? habits.reduce((sum, habit) => sum + habit.completionDates.length, 0);
  const { mood, line, energy } = buddyMood(habits, name, new Date(), useAppColorScheme().streakFreeze?.frozenDays);
  const growth = buddyGrowth(checkIns, buddy?.stages);
  return (
    <Pressable style={({ pressed }) => [styles.card, pressed && styles.pressed, style]} onPress={() => router.push('/buddy')} accessibilityRole="button" accessibilityLabel={`Visit ${name}: ${line}`}>
      <BuddyAvatar buddy={buddy} checkIns={checkIns} mood={mood} size={76} />
      <View style={styles.copy}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <View style={styles.stagePill}><Text style={styles.stageText}>{growth.stage.name}</Text></View>
        </View>
        <View style={styles.speech}><Text style={styles.speechText} numberOfLines={2}>{line}</Text></View>
        <View style={styles.energyRow}>
          <Ionicons name="flash" size={12} color="#F2A93B" />
          <View style={styles.energyTrack}><View style={[styles.energyFill, { width: `${Math.round(energy * 100)}%` }]} /></View>
          <Ionicons name="chevron-forward" size={16} color="#8A8492" />
        </View>
      </View>
    </Pressable>
  );
}

const themedStyles = createThemedStyles({
  circle: { position: 'absolute', left: 0, top: 0 },
  body: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  head: { position: 'absolute', alignSelf: 'center' },
  hand: { position: 'absolute' },
  moodBubble: { position: 'absolute', right: -2, top: -2, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#201444', shadowOpacity: 0.12, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  copy: { flex: 1, gap: 6 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { flexShrink: 1, fontSize: 16, fontWeight: '900', color: '#2F2D3C' },
  stagePill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: '#F0E9FF' },
  stageText: { fontSize: 11, fontWeight: '800', color: '#5B42D8' },
  speech: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, borderTopLeftRadius: 4, backgroundColor: '#F7F4FF' },
  speechText: { fontSize: 12, fontWeight: '700', color: '#4A4556' },
  energyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  energyTrack: { flex: 1, height: 7, borderRadius: 4, backgroundColor: '#FFF1DC', overflow: 'hidden' },
  energyFill: { height: '100%', borderRadius: 4, backgroundColor: '#F2A93B' },
});
