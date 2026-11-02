// Walk: proves the check-in of a habit with steps (utils/habit-templates.ts). The phone's step
// counter (expo-sensors Pedometer) counts while this screen is open; it does not count in the
// background, so the screen stays awake meanwhile. The walk is a session that starts on the
// server, and the steps must also fit the time it took (backend/services/check-in-proof.js). Where
// steps cannot be counted (the web app, a phone without a step counter, or physical activity access
// turned off), a photo of the walk proves the check-in instead.
import { Ionicons } from '@expo/vector-icons';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { Pedometer } from 'expo-sensors';
import React, { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { startProofSession } from '@/authentication/authService';
import { Confetti } from '@/components/confetti';
import { ProgressRing } from '@/components/progress-ring';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';
import { isHabitLockedMissed } from '@/utils/engagement';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { takeProofPhoto } from '@/utils/proof-photo';

type Phase = 'idle' | 'starting' | 'walking' | 'done';
const KEEP_AWAKE_TAG = 'habitai-walk';

export default function WalkScreen() {
  const styles = useThemedStyles(themedStyles);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { currentHabits, checkInWithProof } = useAppColorScheme();
  const habit = currentHabits.find((item) => item.id === id) ?? null;
  const target = habit?.proof?.type === 'steps' ? habit.proof.steps : 0;
  const today = getLocalDateKey();
  const doneToday = Boolean(habit?.completionDates.includes(today));
  const missed = Boolean(habit && !doneToday && isHabitLockedMissed(habit, new Date()));

  const [phase, setPhase] = useState<Phase>('idle');
  const [steps, setSteps] = useState(0);
  const [message, setMessage] = useState('');
  // Steps cannot be counted here, so a photo proves the walk: always on the web, and on a phone
  // once it turns out to have no step counter or no permission to use it.
  const [noCounter, setNoCounter] = useState(Platform.OS === 'web');
  const [provenWith, setProvenWith] = useState<'steps' | 'photo'>('steps');
  const [photoBusy, setPhotoBusy] = useState(false);
  const subscription = useRef<{ remove: () => void } | null>(null);
  const sessionRef = useRef('');
  const finishedRef = useRef(false);

  const stop = () => {
    subscription.current?.remove();
    subscription.current = null;
    void deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
  };
  useEffect(() => stop, []);

  // The target reached: the walk is the proof of the check-in.
  const finish = (count: number) => {
    if (finishedRef.current || !habit) return;
    finishedRef.current = true;
    stop();
    setProvenWith('steps');
    setPhase('done');
    checkInWithProof(habit.id, { sessionId: sessionRef.current, steps: count });
  };

  // No step counter to use: the walk is proven with a photo taken now.
  const checkInWithPhoto = async () => {
    if (!habit || photoBusy || finishedRef.current) return;
    setMessage('');
    setPhotoBusy(true);
    const photo = await takeProofPhoto();
    setPhotoBusy(false);
    if (!photo) return;
    if (!photo.ok) {
      setMessage(photo.message);
      return;
    }
    finishedRef.current = true;
    setProvenWith('photo');
    setPhase('done');
    checkInWithProof(habit.id, photo.proof);
  };

  const startWalk = async () => {
    if (!habit) return;
    setMessage('');
    setPhase('starting');
    const available = Platform.OS !== 'web' && await Pedometer.isAvailableAsync().catch(() => false);
    if (!available) {
      setPhase('idle');
      setNoCounter(true);
      setMessage('This phone has no step counter HabitAI can use. Take your walk, then check in with a photo instead.');
      return;
    }
    const permission = await Pedometer.requestPermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      setPhase('idle');
      setNoCounter(true);
      setMessage('Allow HabitAI to use physical activity so it can count your steps, or check in with a photo instead.');
      return;
    }
    const session = await startProofSession(habit.id, today);
    if (!session.ok) {
      setPhase('idle');
      setMessage(session.message);
      return;
    }
    sessionRef.current = session.sessionId;
    finishedRef.current = false;
    setSteps(0);
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    subscription.current = Pedometer.watchStepCount((result) => {
      setSteps(result.steps);
      if (result.steps >= target) finish(result.steps);
    });
    setPhase('walking');
  };
  const cancel = () => {
    stop();
    setPhase('idle');
    setSteps(0);
  };
  const leave = () => {
    stop();
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  const share = target ? Math.min(100, Math.round((steps / target) * 100)) : 0;
  const closed = !habit || !target || doneToday || missed;
  return (
    <SafeAreaView style={styles.screen}>
      {phase === 'done' && <Confetti burstKey={`walk:${habit?.id}:${today}`} />}
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topBar}>
          <Pressable onPress={leave} style={styles.iconButton} accessibilityRole="button" accessibilityLabel="Close the walk" hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color="#FFFFFF" />
          </Pressable>
          <Text style={styles.topTitle}>Walk</Text>
          <View style={styles.iconButton} />
        </View>

        <Text style={styles.kicker}>{phase === 'walking' ? 'Counting your steps' : 'Walk to check in'}</Text>
        <Text style={styles.habitName} numberOfLines={2}>{habit?.label ?? 'Habit not found'}</Text>

        <View style={styles.ringWrap} accessible accessibilityLabel={`${steps.toLocaleString('en-US')} of ${target.toLocaleString('en-US')} steps`}>
          <ProgressRing value={phase === 'done' ? 100 : share} size={220} thickness={14} color="#7EE0A9" trackColor="rgba(255,255,255,0.18)" innerColor="#2B1C5C">
            {phase === 'done' ? (
              <>
                <Ionicons name="checkmark-circle" size={50} color="#7EE0A9" />
                <Text style={styles.ringLabel}>Walk complete</Text>
              </>
            ) : (
              <>
                <Ionicons name="footsteps" size={26} color="#D8D0FF" />
                <Text style={styles.ringValue}>{steps.toLocaleString('en-US')}</Text>
                <Text style={styles.ringLabel}>of {target.toLocaleString('en-US')} steps</Text>
              </>
            )}
          </ProgressRing>
        </View>

        {phase === 'done' ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{habit?.label} is checked off!</Text>
            <Text style={styles.cardText}>{provenWith === 'photo' ? 'Your photo was sent as proof of today\'s check-in.' : 'Your steps were counted as proof of today\'s check-in.'}</Text>
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={leave} accessibilityRole="button">
              <Text style={styles.primaryText}>Back to today</Text>
            </Pressable>
          </View>
        ) : closed ? (
          <View style={styles.card}>
            <Text style={styles.cardText}>
              {!habit ? 'This habit is not one of this week\'s.' : doneToday ? `${habit.label} is already done today.` : missed ? `${habit.label} is missed for today. It opens again on its next scheduled day.` : `${habit.label} is not checked in with steps.`}
            </Text>
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={leave} accessibilityRole="button">
              <Text style={styles.primaryText}>Back</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.actions}>
              {phase === 'walking' && (
                <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={cancel} accessibilityRole="button">
                  <Text style={styles.secondaryText}>Stop</Text>
                </Pressable>
              )}
              {phase !== 'walking' && Platform.OS !== 'web' && (
                <Pressable style={({ pressed }) => [noCounter ? styles.secondary : styles.primary, (pressed || phase === 'starting') && styles.pressed]} onPress={() => void startWalk()} disabled={phase === 'starting'} accessibilityRole="button" accessibilityState={{ busy: phase === 'starting' }}>
                  {!noCounter && <Ionicons name="walk" size={18} color="#3B2699" />}
                  <Text style={noCounter ? styles.secondaryText : styles.primaryText}>{phase === 'starting' ? 'Starting…' : noCounter ? 'Try again' : 'Start walking'}</Text>
                </Pressable>
              )}
              {phase !== 'walking' && noCounter && (
                <Pressable style={({ pressed }) => [styles.primary, (pressed || photoBusy) && styles.pressed]} onPress={() => void checkInWithPhoto()} disabled={photoBusy} accessibilityRole="button" accessibilityState={{ busy: photoBusy }}>
                  <Ionicons name="camera" size={18} color="#3B2699" />
                  <Text style={styles.primaryText}>Check in with a photo</Text>
                </Pressable>
              )}
            </View>
            {message ? <Text style={styles.note} accessibilityLiveRegion="polite">{message}</Text> : null}
            <Text style={styles.note}>
              {Platform.OS === 'web'
                ? `The web app cannot count steps. Walk ${target.toLocaleString('en-US')} steps, then take a photo of your walk to check off ${habit.label}. On an Android phone, the HabitAI app counts your steps instead.`
                : noCounter
                  ? `Walk ${target.toLocaleString('en-US')} steps, then take a photo of your walk to check off ${habit.label}.`
                  : `Keep HabitAI open on this screen while you walk: your phone counts the steps only while it is on. ${habit.label} is checked off when you reach ${target.toLocaleString('en-US')} steps.`}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#2B1C5C' },
  content: { padding: 20, paddingBottom: 60, alignItems: 'center', width: '100%', maxWidth: 560, alignSelf: 'center' },
  topBar: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  iconButton: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  topTitle: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  kicker: { fontSize: 12, fontWeight: '800', letterSpacing: 0.6, color: '#C9BEFF', textTransform: 'uppercase' },
  habitName: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', textAlign: 'center', marginTop: 6 },
  ringWrap: { marginVertical: 30, alignItems: 'center' },
  ringValue: { fontSize: 40, fontWeight: '900', color: '#FFFFFF', marginTop: 4 },
  ringLabel: { fontSize: 13, fontWeight: '700', color: '#D8D0FF', marginTop: 2 },
  actions: { flexDirection: 'row', gap: 12, justifyContent: 'center' },
  primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 50, paddingHorizontal: 24, borderRadius: 25, backgroundColor: '#FFFFFF', marginTop: 4 },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#3B2699' },
  secondary: { minHeight: 50, paddingHorizontal: 24, borderRadius: 25, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  note: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#D8D0FF', textAlign: 'center', marginTop: 16, maxWidth: 420 },
  card: { width: '100%', borderRadius: 20, padding: 18, gap: 10, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  cardTitle: { fontSize: 17, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  cardText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#D8D0FF', textAlign: 'center' },
  pressed: { opacity: 0.75 },
});
