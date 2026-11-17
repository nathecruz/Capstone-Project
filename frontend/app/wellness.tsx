// The Wellness Pack (a reward from the Rewards Shop): four guided breaks for students and faculty,
// each a few timed steps to follow. Before it is unlocked, the screen shows what it has and where to
// get it.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

type Step = { text: string; seconds: number };
type Routine = { id: string; title: string; detail: string; icon: keyof typeof Ionicons.glyphMap; color: string; steps: Step[] };

const breath = (round: number): Step[] => [
  { text: `Round ${round}: breathe in slowly through your nose`, seconds: 4 },
  { text: 'Hold your breath gently', seconds: 4 },
  { text: 'Breathe out slowly through your mouth', seconds: 4 },
  { text: 'Hold, and relax your shoulders', seconds: 4 },
];

export const ROUTINES: Routine[] = [
  { id: 'box-breathing', title: 'Box breathing', detail: 'About 1 minute · calms you before an exam or a class', icon: 'leaf-outline', color: '#2F9E6E', steps: [1, 2, 3, 4].flatMap(breath) },
  {
    id: 'desk-stretch',
    title: 'Desk stretch',
    detail: '2½ minutes · for long study or grading sessions',
    icon: 'body-outline',
    color: '#3564D8',
    steps: [
      { text: 'Roll your neck slowly, five times each way', seconds: 30 },
      { text: 'Lift your shoulders to your ears, then let them drop', seconds: 30 },
      { text: 'Clasp your hands behind you and open your chest', seconds: 30 },
      { text: 'Sit tall and twist gently to each side', seconds: 30 },
      { text: 'Stretch your wrists and fingers, palms up then down', seconds: 30 },
    ],
  },
  {
    id: 'eye-break',
    title: '20-20-20 eye break',
    detail: '30 seconds · rests your eyes after screens',
    icon: 'eye-outline',
    color: '#C98A0E',
    steps: [
      { text: 'Look at something about 20 feet (6 meters) away', seconds: 20 },
      { text: 'Close your eyes and blink slowly', seconds: 10 },
    ],
  },
  {
    id: 'mindful-minute',
    title: 'Mindful minute',
    detail: '1 minute · 5-4-3-2-1 grounding when you feel stressed',
    icon: 'sparkles-outline',
    color: '#C2549B',
    steps: [
      { text: 'Name 5 things you can see', seconds: 15 },
      { text: 'Name 4 things you can hear', seconds: 15 },
      { text: 'Name 3 things you can feel', seconds: 10 },
      { text: 'Name 2 things you can smell', seconds: 10 },
      { text: 'Name 1 thing you can taste, and take a deep breath', seconds: 10 },
    ],
  },
];

const minutesOf = (routine: Routine) => routine.steps.reduce((sum, step) => sum + step.seconds, 0);

/** A routine's timed steps: start, pause, skip and start over. */
function Player({ routine, onClose }: { routine: Routine; onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  // Where the routine is: the step and the seconds left in it (index past the last step: done).
  const [progress, setProgress] = useState({ index: 0, left: routine.steps[0].seconds });
  const [running, setRunning] = useState(false);
  const { index, left } = progress;
  const done = index >= routine.steps.length;

  useEffect(() => {
    if (!running || done) return;
    const timer = setInterval(() => {
      setProgress((current) => {
        if (current.left > 1) return { ...current, left: current.left - 1 };
        const next = current.index + 1;
        return { index: next, left: next < routine.steps.length ? routine.steps[next].seconds : 0 };
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [running, done, routine]);

  const restart = () => {
    setProgress({ index: 0, left: routine.steps[0].seconds });
    setRunning(true);
  };
  const skip = () => setProgress((current) => {
    const next = current.index + 1;
    return { index: next, left: next < routine.steps.length ? routine.steps[next].seconds : 0 };
  });
  const step = routine.steps[Math.min(index, routine.steps.length - 1)];

  return (
    <View style={styles.player} accessibilityLiveRegion="polite">
      <View style={styles.playerTop}>
        <Text style={styles.playerTitle}>{routine.title}</Text>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${routine.title}`} hitSlop={10}>
          <Ionicons name="close" size={22} color={themeColor('#6A6580')} />
        </Pressable>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round((Math.min(index, routine.steps.length) / routine.steps.length) * 100)}%`, backgroundColor: routine.color }]} />
      </View>
      {done ? (
        <Text style={styles.stepText}>Well done. Take that calm back to your work.</Text>
      ) : (
        <>
          <Text style={styles.stepCount}>Step {index + 1} of {routine.steps.length}</Text>
          <Text style={styles.stepText}>{step.text}</Text>
          <Text style={[styles.seconds, { color: themeColor(routine.color) }]}>{left}s</Text>
        </>
      )}
      <View style={styles.playerButtons}>
        {done ? (
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={restart} accessibilityRole="button"><Text style={styles.primaryText}>Do it again</Text></Pressable>
        ) : (
          <>
            <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => setRunning((value) => !value)} accessibilityRole="button">
              <Text style={styles.primaryText}>{running ? 'Pause' : index === 0 && left === routine.steps[0].seconds ? 'Start' : 'Resume'}</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={skip} accessibilityRole="button"><Text style={styles.secondaryText}>Next step</Text></Pressable>
          </>
        )}
      </View>
    </View>
  );
}

export default function WellnessScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const catalog = useRewards();
  const unlocked = catalog.owns('wellness-pack');
  const [open, setOpen] = useState<Routine | null>(null);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={24} color={themeColor('#352B88')} /></Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Wellness Pack</Text>
            <Text style={styles.subtitle}>Short guided breaks for body and mind.</Text>
          </View>
        </View>
        {open && unlocked ? <Player key={open.id} routine={open} onClose={() => setOpen(null)} /> : null}
        {ROUTINES.map((routine) => (
          <Pressable
            key={routine.id}
            style={({ pressed }) => [styles.card, !unlocked && styles.cardLocked, pressed && unlocked && styles.pressed]}
            onPress={() => (unlocked ? setOpen(routine) : router.push('/rewards-shop?reward=wellness-pack'))}
            accessibilityRole="button"
            accessibilityLabel={unlocked ? `Start ${routine.title}, ${Math.round(minutesOf(routine) / 6) / 10} minutes` : `${routine.title}, unlock the Wellness Pack in the Rewards Shop`}
          >
            <View style={[styles.icon, { backgroundColor: `${routine.color}22` }]}><Ionicons name={routine.icon} size={22} color={themeColor(routine.color)} /></View>
            <View style={styles.cardCopy}>
              <Text style={styles.cardTitle}>{routine.title}</Text>
              <Text style={styles.cardDetail}>{routine.detail}</Text>
            </View>
            <Ionicons name={unlocked ? 'play-circle' : 'lock-closed'} size={26} color={themeColor(unlocked ? routine.color : '#9A94A4')} />
          </Pressable>
        ))}
        {!unlocked && (
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => router.push('/rewards-shop?reward=wellness-pack')} accessibilityRole="button">
            <Text style={styles.primaryText}>Unlock in the Rewards Shop</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F7F8FF' },
  content: { width: '100%', maxWidth: 640, alignSelf: 'center', padding: 16, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontWeight: '900', color: '#24212D' },
  subtitle: { fontSize: 13, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  cardLocked: { opacity: 0.75 },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '900', color: '#24212D' },
  cardDetail: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488' },
  player: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E0FB' },
  playerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  playerTitle: { fontSize: 17, fontWeight: '900', color: '#24212D' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#EEEAF5', overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3 },
  stepCount: { fontSize: 12, fontWeight: '800', color: '#7A7488' },
  stepText: { fontSize: 18, lineHeight: 25, fontWeight: '800', color: '#2D2A3D' },
  seconds: { fontSize: 40, fontWeight: '900' },
  playerButtons: { flexDirection: 'row', gap: 10 },
  primary: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  secondary: { flex: 1, minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DCD3F5' },
  secondaryText: { fontSize: 14, fontWeight: '800', color: '#5B42D8' },
  pressed: { opacity: 0.8 },
}, {
  screen: { flex: 1, backgroundColor: '#14121A' },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D1A24' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#2E2940' },
  player: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#352C52' },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#2E2940', overflow: 'hidden' },
});
