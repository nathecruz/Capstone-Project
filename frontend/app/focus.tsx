// Focus timer: a countdown for one habit. When it ends the habit is checked off for today, so
// "Read for 20 minutes" is done by doing it here. The time left is worked out from the end time,
// so it stays right when the browser slows timers in a background tab.
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti } from '@/components/confetti';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { focusMinutesFor, todayAgenda } from '@/utils/engagement';
import { getLocalDateKey } from '@/utils/habit-visibility';

const PRESETS = [5, 15, 25, 45];
const RING_DOTS = 60;
const RING_RADIUS = 104;

type Phase = 'idle' | 'running' | 'paused' | 'finished';

function clock(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  return `${String(minutes).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

export default function FocusScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const { habits, toggleHabit } = useAppColorScheme();
  const [habitId, setHabitId] = useState(typeof params.id === 'string' ? params.id : '');
  const habit = habits.find((item) => item.id === habitId) ?? null;
  const today = getLocalDateKey();
  const doneToday = Boolean(habit?.completionDates.includes(today));
  const openToday = useMemo(() => todayAgenda(habits).open, [habits]);

  const [minutes, setMinutes] = useState(() => focusMinutesFor(habit?.label ?? ''));
  const [phase, setPhase] = useState<Phase>('idle');
  const [endAt, setEndAt] = useState(0);
  const [leftMs, setLeftMs] = useState(minutes * 60_000);
  const [checkedOff, setCheckedOff] = useState(false);
  const [nowMs, setNowMs] = useState(0);

  // A new habit picked from the list starts with its own suggested length.
  const choose = (id: string) => {
    const next = habits.find((item) => item.id === id);
    setHabitId(id);
    const length = focusMinutesFor(next?.label ?? '');
    setMinutes(length);
    setLeftMs(length * 60_000);
    setPhase('idle');
    setCheckedOff(false);
  };
  const pickLength = (length: number) => {
    setMinutes(length);
    setLeftMs(length * 60_000);
  };

  const totalMs = minutes * 60_000;
  const remaining = phase === 'running' ? Math.min(totalMs, Math.max(0, endAt - nowMs)) : leftMs;
  const share = 1 - remaining / totalMs;

  // Ticks while running; at the end the habit is checked off (once) and celebrated.
  const finishedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current < endAt || finishedRef.current) return;
      finishedRef.current = true;
      setPhase('finished');
      setLeftMs(0);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (habit && !habit.completionDates.includes(getLocalDateKey())) {
        toggleHabit(habit.id);
        setCheckedOff(true);
      }
    }, 250);
    return () => clearInterval(timer);
  }, [endAt, habit, phase, toggleHabit]);

  // Web: the time left shows in the browser tab, so it can be seen from another tab.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const previous = document.title;
    if (phase === 'running' || phase === 'paused') document.title = `${clock(remaining)} · Focus`;
    return () => { document.title = previous; };
  }, [phase, remaining]);

  // A slow "breathing" glow while the timer runs.
  const [breath] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (phase !== 'running') {
      breath.stopAnimation();
      breath.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(breath, { toValue: 0, duration: 2000, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [breath, phase]);

  const start = () => {
    finishedRef.current = false;
    const current = Date.now();
    setNowMs(current);
    setEndAt(current + (phase === 'paused' ? leftMs : totalMs));
    setPhase('running');
    setCheckedOff(false);
  };
  const pause = () => {
    setLeftMs(Math.max(0, endAt - Date.now()));
    setPhase('paused');
  };
  const reset = () => {
    setPhase('idle');
    setLeftMs(minutes * 60_000);
    setCheckedOff(false);
  };
  const leave = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));

  const dots = Array.from({ length: RING_DOTS }, (_, index) => {
    const angle = (index / RING_DOTS) * Math.PI * 2;
    return { left: RING_RADIUS + 14 + Math.sin(angle) * RING_RADIUS - 4, top: RING_RADIUS + 14 - Math.cos(angle) * RING_RADIUS - 4, active: index < Math.round(share * RING_DOTS) };
  });

  return (
    <SafeAreaView style={styles.screen}>
      {phase === 'finished' && <Confetti burstKey={`focus:${habitId}:${endAt}`} />}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={leave} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close focus timer" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.topTitle}>Focus</Text>
          <View style={styles.iconButton} />
        </View>

        <View style={styles.habitHeader}>
          <Text style={styles.kicker}>{habit ? (doneToday && !checkedOff ? 'Already done today · extra focus' : 'Focusing on') : 'Free focus session'}</Text>
          <Text style={styles.habitName} numberOfLines={2}>{habit?.label ?? 'Pick a habit below, or just focus'}</Text>
        </View>

        <View style={styles.ringWrap}>
          <Animated.View style={[styles.glow, { opacity: breath.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0.6] }), transform: [{ scale: breath.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] }) }] }]} />
          {dots.map((dot, index) => <View key={index} style={[styles.dot, { left: dot.left, top: dot.top }, dot.active && styles.dotActive]} />)}
          <View style={styles.ringCenter} accessible accessibilityRole="timer" accessibilityLabel={`${clock(remaining)} left`}>
            {phase === 'finished' ? (
              <>
                <Ionicons name="checkmark-circle" size={54} color="#7EE0A9" />
                <Text style={styles.doneText}>Session complete</Text>
              </>
            ) : (
              <>
                <Text style={styles.time}>{clock(remaining)}</Text>
                <Text style={styles.timeHint}>{phase === 'running' ? 'Stay with it' : phase === 'paused' ? 'Paused' : `${minutes} min session`}</Text>
              </>
            )}
          </View>
        </View>

        {phase === 'finished' ? (
          <View style={styles.finishCard}>
            <Text style={styles.finishTitle}>{checkedOff ? `${habit?.label} is checked off! +20 XP` : 'Nice work!'}</Text>
            <Text style={styles.finishText}>{checkedOff ? 'Your streak and progress were updated.' : `You focused for ${minutes} minutes.`}</Text>
            <View style={styles.actions}>
              <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={reset} accessibilityRole="button">
                <Ionicons name="refresh" size={18} color="#FFFFFF" />
                <Text style={styles.secondaryText}>Again</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={leave} accessibilityRole="button">
                <Text style={styles.primaryText}>Back to today</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <>
            {phase === 'idle' && (
              <View style={styles.presets}>
                {[...new Set([...PRESETS, focusMinutesFor(habit?.label ?? '')])].sort((a, b) => a - b).map((length) => (
                  <Pressable key={length} style={[styles.preset, minutes === length && styles.presetActive]} onPress={() => pickLength(length)} accessibilityRole="button" accessibilityState={{ selected: minutes === length }}>
                    <Text style={[styles.presetText, minutes === length && styles.presetTextActive]}>{length} min</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <View style={styles.actions}>
              {phase !== 'idle' && (
                <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={reset} accessibilityRole="button" accessibilityLabel="Reset the timer">
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.secondaryText}>Reset</Text>
                </Pressable>
              )}
              <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={phase === 'running' ? pause : start} accessibilityRole="button">
                <Ionicons name={phase === 'running' ? 'pause' : 'play'} size={18} color="#3B2699" />
                <Text style={styles.primaryText}>{phase === 'running' ? 'Pause' : phase === 'paused' ? 'Resume' : 'Start focus'}</Text>
              </Pressable>
            </View>
            {habit && !doneToday && <Text style={styles.note}>When the timer ends, {habit.label} is checked off for today.</Text>}
          </>
        )}

        {phase === 'idle' && openToday.length > 0 && (
          <View style={styles.pickList}>
            <Text style={styles.pickTitle}>Still to do today</Text>
            <View style={styles.pickWrap}>
              {openToday.map((item) => (
                <Pressable key={item.id} style={[styles.pick, item.id === habitId && styles.pickActive]} onPress={() => choose(item.id)} accessibilityRole="button" accessibilityState={{ selected: item.id === habitId }}>
                  <Ionicons name={item.icon} size={14} color="#FFFFFF" />
                  <Text style={styles.pickText} numberOfLines={1}>{item.label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const RING_SIZE = (RING_RADIUS + 14) * 2;

// The focus screen is dark in both themes, so it uses one style sheet.
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#1E1547' },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 20, paddingBottom: 40, width: '100%', maxWidth: 520, alignSelf: 'center' },
  topBar: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  topTitle: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  habitHeader: { alignItems: 'center', marginTop: 22, gap: 4 },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', color: '#B9ACF5' },
  habitName: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  ringWrap: { width: RING_SIZE, height: RING_SIZE, marginTop: 26, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: RING_SIZE - 40, height: RING_SIZE - 40, borderRadius: RING_SIZE, backgroundColor: '#6C4FF0' },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.14)' },
  dotActive: { backgroundColor: '#FFD44D' },
  ringCenter: { alignItems: 'center', justifyContent: 'center', gap: 4 },
  time: { fontSize: 54, fontWeight: '900', color: '#FFFFFF', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  timeHint: { fontSize: 13, fontWeight: '700', color: '#C9BFF7' },
  doneText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 26 },
  preset: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  presetActive: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  presetText: { fontSize: 13, fontWeight: '800', color: '#E4DDFF' },
  presetTextActive: { color: '#3B2699' },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22, width: '100%', maxWidth: 360 },
  primary: { flex: 1, height: 50, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#FFFFFF' },
  primaryText: { fontSize: 16, fontWeight: '900', color: '#3B2699' },
  secondary: { height: 50, paddingHorizontal: 18, borderRadius: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.12)' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  note: { marginTop: 14, fontSize: 12, fontWeight: '700', color: '#B9ACF5', textAlign: 'center' },
  finishCard: { alignItems: 'center', marginTop: 22, width: '100%' },
  finishTitle: { fontSize: 18, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  finishText: { marginTop: 4, fontSize: 13, fontWeight: '700', color: '#C9BFF7', textAlign: 'center' },
  pickList: { width: '100%', marginTop: 30 },
  pickTitle: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase', color: '#B9ACF5', marginBottom: 10, textAlign: 'center' },
  pickWrap: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8 },
  pick: { flexDirection: 'row', alignItems: 'center', gap: 6, maxWidth: '100%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  pickActive: { backgroundColor: '#6C4FF0', borderColor: '#8C74FF' },
  pickText: { flexShrink: 1, fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
});
