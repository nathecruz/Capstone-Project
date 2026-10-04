// Home's Today: a hero card with today's progress and what to do next, then the rest of today's
// habits by time of day and what is already done. A tap checks a habit off (with a short Undo);
// the timer button starts a focus session. Home can put its tiles between the two (`middle`).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Animated, Platform, Pressable, type PressableStateCallbackType, Text, View } from 'react-native';
import type { Habit } from '@/hooks/app-state/types';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { TIME_OF_DAY, isHabitLate, plannedMinutes, timeOfDayFor, todayAgenda } from '@/utils/engagement';
import { CHECK_IN_UNDO_MS } from '@/utils/habit-visibility';

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const RING_DOTS = 36;

function formatMinutes(minutes: number) {
  const hour = Math.floor(minutes / 60);
  const minute = String(minutes % 60).padStart(2, '0');
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'AM' : 'PM'}`;
}

export function openFocus(habitId: string) {
  router.push({ pathname: '/focus', params: { id: habitId } });
}

/** A dotted ring that fills with today's share of done habits (white, for the purple hero). */
function ProgressRing({ share, label, size = 84 }: { share: number; label: string; size?: number }) {
  const styles = useThemedStyles(themedStyles);
  const center = size / 2;
  const radius = center - 7;
  const dots = Array.from({ length: RING_DOTS }, (_, index) => {
    const angle = (index / RING_DOTS) * Math.PI * 2;
    return { left: center + Math.sin(angle) * radius - 3, top: center - Math.cos(angle) * radius - 3, active: index < Math.round(share * RING_DOTS) };
  });
  return (
    <View style={[styles.ring, { width: size, height: size, borderRadius: center }]} accessible accessibilityLabel={`${label} of today's habits done`}>
      {dots.map((dot, index) => <View key={index} style={[styles.ringDot, { left: dot.left, top: dot.top }, dot.active && styles.ringDotActive]} />)}
      <Ionicons name={share >= 1 ? 'trophy' : 'sunny'} size={size * 0.3} color="#FFFFFF" />
    </View>
  );
}

/** A done habit; it pops in when it is checked off. */
function DoneChip({ habit }: { habit: Habit }) {
  const styles = useThemedStyles(themedStyles);
  const [scale] = useState(() => new Animated.Value(0.6));
  useEffect(() => {
    Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: Platform.OS !== 'web' }).start();
  }, [scale]);
  return (
    <Animated.View style={[styles.doneChip, { transform: [{ scale }] }]} accessible accessibilityLabel={`${habit.label} done today`}>
      <Ionicons name="checkmark-circle" size={15} color="#3BAA74" />
      <Text style={styles.doneChipText} numberOfLines={1}>{habit.label}</Text>
    </Animated.View>
  );
}

/** How long a row shows its check before it moves to Done today. */
const CHECK_ANIMATION_MS = 320;

function HabitRow({ habit, late, onCheck }: { habit: Habit; late: boolean; onCheck: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const planned = plannedMinutes(habit);
  // A tap fills the check with a little pop first, so finishing a habit feels like something.
  const [checking, setChecking] = useState(false);
  const [pop] = useState(() => new Animated.Value(0));
  const check = () => {
    if (checking) return;
    setChecking(true);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 180, useNativeDriver: Platform.OS !== 'web' }).start();
    setTimeout(onCheck, CHECK_ANIMATION_MS);
  };
  return (
    <View style={styles.row}>
      <Pressable
        style={({ hovered, pressed }: HoverState) => [styles.rowMain, late && styles.rowMainLate, (hovered || pressed) && styles.rowMainActive, checking && styles.rowMainDone]}
        onPress={check}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: checking }}
        aria-checked={checking}
        accessibilityLabel={`${habit.label} done today`}
      >
        {({ hovered, pressed }: HoverState) => (
          <>
            <View style={[styles.rowIcon, { backgroundColor: `${habit.color || '#5B42D8'}22` }]}>
              <Ionicons name={habit.icon} size={17} color={habit.color || themeColor('#5b42d8')} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={[styles.rowLabel, checking && styles.rowLabelDone]} numberOfLines={1}>{habit.label}</Text>
              {(planned !== null || habit.streak > 0) && (
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {planned !== null && <Text style={late && styles.lateText}>{late ? `Late · ${formatMinutes(planned)}` : formatMinutes(planned)}</Text>}
                  {planned !== null && habit.streak > 0 ? '  ·  ' : ''}
                  {habit.streak > 0 ? `🔥 ${habit.streak}-day streak` : ''}
                </Text>
              )}
            </View>
            <Animated.View style={[styles.check, (hovered || pressed || checking) && styles.checkActive, checking && styles.checkDone, checking && { transform: [{ scale: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [1, 1.35, 1] }) }] }]}>
              {(hovered || pressed || checking) && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </Animated.View>
          </>
        )}
      </Pressable>
      <Pressable
        style={({ hovered, pressed }: HoverState) => [styles.focusButton, (hovered || pressed) && styles.focusButtonActive]}
        onPress={() => openFocus(habit.id)}
        accessibilityRole="button"
        accessibilityLabel={`Start a focus session for ${habit.label}`}
        hitSlop={4}
      >
        <Ionicons name="timer-outline" size={18} color={themeColor('#5b42d8')} />
      </Pressable>
    </View>
  );
}

export function TodayAgenda({ habits, now, onCheck, middle, style }: { habits: Habit[]; now: Date; onCheck: (habit: Habit) => void; middle?: React.ReactNode; style?: object | false }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const agenda = todayAgenda(habits, now);
  const total = agenda.scheduled.length;
  const share = total ? agenda.done.length / total : 0;
  const { nextUp } = agenda;
  const nextPlanned = nextUp ? plannedMinutes(nextUp) : null;
  const nextLate = Boolean(nextUp && isHabitLate(nextUp, now));
  const dateLabel = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

  // The habit just checked off: its row leaves the list, so offer a short-lived Undo.
  const [justChecked, setJustChecked] = useState<Habit | null>(null);
  useEffect(() => {
    if (!justChecked) return;
    const timer = setTimeout(() => setJustChecked(null), CHECK_IN_UNDO_MS);
    return () => clearTimeout(timer);
  }, [justChecked]);
  const check = (habit: Habit) => {
    onCheck(habit);
    setJustChecked(habit);
  };
  const undo = () => {
    if (justChecked) onCheck(justChecked);
    setJustChecked(null);
  };

  const percent = Math.round(share * 100);
  const listSections = agenda.sections
    .map((section) => ({ ...section, rows: section.habits.filter((habit) => habit.id !== nextUp?.id) }))
    .filter((section) => section.rows.length > 0);
  const hasList = listSections.length > 0 || agenda.done.length > 0 || Boolean(justChecked) || agenda.notToday > 0;

  return (
    <View style={[styles.stack, style]}>
      <View style={styles.hero}>
        <View style={styles.heroGlow} />
        <View style={styles.heroTop}>
          <View style={styles.heroCopy}>
            <Text style={styles.heroEyebrow}>TODAY · {dateLabel.toUpperCase()}</Text>
            {total > 0 ? (
              <>
                <Text style={styles.heroPercent}>{percent}%</Text>
                <Text style={styles.heroHint}>
                  {agenda.open.length ? `${agenda.done.length} of ${total} done · ${agenda.open.length} to go` : `All ${total} done`}
                  {agenda.late.length > 0 && <Text style={styles.heroLate}>{` · ${agenda.late.length} late`}</Text>}
                </Text>
              </>
            ) : (
              <Text style={styles.heroEmptyTitle}>{habits.length ? 'Nothing scheduled today' : 'Start your first habit'}</Text>
            )}
          </View>
          <ProgressRing share={share} label={`${percent}%`} />
        </View>

        {habits.length === 0 && (
          <Pressable style={({ pressed }) => [styles.heroButton, pressed && styles.pressed]} onPress={() => router.push('/add')} accessibilityRole="button">
            <Ionicons name="add" size={18} color={themeColor('#5B42D8')} />
            <Text style={styles.heroButtonText}>Add your first habit</Text>
          </Pressable>
        )}

        {total > 0 && agenda.open.length === 0 && (
          <View style={styles.heroPanel} accessible accessibilityLabel="All habits done for today">
            <Text style={styles.heroPanelTitle}>All done for today! 🎉</Text>
            <Text style={styles.heroPanelText}>Every habit is checked off. Come back tomorrow to keep the streak going.</Text>
          </View>
        )}

        {nextUp && (
          <View style={styles.heroPanel}>
            <View style={styles.nextTop}>
              <View style={[styles.nextBadge, nextLate && styles.nextBadgeLate]}><Text style={styles.nextBadgeText}>{nextLate ? 'LATE' : 'NEXT UP'}</Text></View>
              <Text style={styles.nextWhen}>{nextPlanned !== null ? `${nextLate ? 'Was due ' : ''}${formatMinutes(nextPlanned)}` : TIME_OF_DAY[timeOfDayFor(nextUp)].label}</Text>
            </View>
            <View style={styles.nextBody}>
              <View style={styles.nextIcon}><Ionicons name={nextUp.icon} size={22} color="#FFFFFF" /></View>
              <View style={styles.nextCopy}>
                <Text style={styles.nextLabel} numberOfLines={2}>{nextUp.label}</Text>
                <Text style={styles.nextMeta}>{nextUp.streak > 0 ? `🔥 ${nextUp.streak}-day streak — keep it going` : 'Start a streak today'}</Text>
              </View>
            </View>
            <View style={styles.nextActions}>
              <Pressable style={({ pressed }) => [styles.nextDone, pressed && styles.pressed]} onPress={() => check(nextUp)} accessibilityRole="button" accessibilityLabel={`Mark ${nextUp.label} done`}>
                <Ionicons name="checkmark" size={17} color={themeColor('#5B42D8')} />
                <Text style={styles.nextDoneText}>Mark done</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.nextFocus, pressed && styles.pressed]} onPress={() => openFocus(nextUp.id)} accessibilityRole="button" accessibilityLabel={`Start a focus session for ${nextUp.label}`}>
                <Ionicons name="timer-outline" size={17} color="#FFFFFF" />
                <Text style={styles.nextFocusText}>Focus</Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {middle}

      {habits.length > 0 && (
        <View style={styles.card}>
          <View style={styles.listHeader}>
            <Text style={styles.listTitle}>Your habits today</Text>
            <Pressable style={({ pressed }) => [styles.addChip, pressed && styles.pressed]} onPress={() => router.push('/add')} accessibilityRole="button" accessibilityLabel="Add a habit">
              <Ionicons name="add" size={16} color={themeColor('#5B42D8')} />
              <Text style={styles.addChipText}>Add</Text>
            </Pressable>
          </View>

          {!hasList && <Text style={styles.empty}>{nextUp ? 'Only the habit above is left today.' : 'Nothing else for today.'}</Text>}

          {listSections.map((section) => (
            <View key={section.key} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={14} color={section.key === 'late' ? themeColor('#D9662B') : '#8A8492'} />
                <Text style={[styles.sectionTitle, section.key === 'late' && styles.lateText]}>{section.label}</Text>
                <Text style={styles.sectionCount}>{section.rows.length}</Text>
              </View>
              <View style={styles.rows}>
                {section.rows.map((habit) => <HabitRow key={habit.id} habit={habit} late={section.key === 'late'} onCheck={() => check(habit)} />)}
              </View>
            </View>
          ))}

          {justChecked && (
            <View style={styles.undoBar} accessibilityLiveRegion="polite">
              <Ionicons name="checkmark-circle" size={18} color="#3BAA74" />
              <Text style={styles.undoText} numberOfLines={1}>{justChecked.label} done · +20 XP</Text>
              <Pressable onPress={undo} accessibilityRole="button" accessibilityLabel={`Undo ${justChecked.label}`} hitSlop={8}>
                <Text style={styles.undoAction}>Undo</Text>
              </Pressable>
            </View>
          )}

          {agenda.done.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="checkmark-done" size={14} color="#3BAA74" />
                <Text style={styles.sectionTitle}>Done today</Text>
                <Text style={styles.sectionCount}>{agenda.done.length}</Text>
              </View>
              <View style={styles.doneWrap}>{agenda.done.map((habit) => <DoneChip key={habit.id} habit={habit} />)}</View>
            </View>
          )}

          {agenda.notToday > 0 && (
            <Text style={styles.restNote}>{agenda.notToday} habit{agenda.notToday === 1 ? '' : 's'} not scheduled today</Text>
          )}
        </View>
      )}
    </View>
  );
}

const themedStyles = createThemedStyles({
  stack: { gap: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 24, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 16, shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 3 },
  // The hero: today's progress and the next habit, in the brand colour.
  hero: { borderRadius: 28, padding: 18, gap: 16, overflow: 'hidden', backgroundColor: '#5B42D8', shadowColor: '#5B42D8', shadowOpacity: 0.32, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: '#7A63F0', opacity: 0.55 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroCopy: { flex: 1 },
  heroEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#DCD5FF' },
  heroPercent: { marginTop: 2, fontSize: 44, lineHeight: 50, fontWeight: '900', color: '#FFFFFF', letterSpacing: -1 },
  heroHint: { fontSize: 14, fontWeight: '700', color: '#EEEAFF' },
  heroLate: { color: '#FFD3B5', fontWeight: '800' },
  heroEmptyTitle: { marginTop: 6, fontSize: 22, fontWeight: '900', color: '#FFFFFF' },
  heroButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 16, backgroundColor: '#FFFFFF' },
  heroButtonText: { fontSize: 15, fontWeight: '800', color: '#5B42D8' },
  heroPanel: { borderRadius: 20, padding: 14, backgroundColor: 'rgba(255,255,255,0.14)' },
  heroPanelTitle: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  heroPanelText: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#EEEAFF' },
  ring: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  ringDot: { position: 'absolute', width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' },
  ringDotActive: { backgroundColor: '#FFFFFF' },
  empty: { fontSize: 13, color: '#777282', fontWeight: '600', textAlign: 'center', paddingVertical: 10 },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.2)' },
  nextBadgeText: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#FFFFFF' },
  nextWhen: { fontSize: 12, fontWeight: '800', color: '#E4DDFF' },
  nextBody: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  nextIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  nextCopy: { flex: 1 },
  nextLabel: { fontSize: 18, fontWeight: '800', color: '#FFFFFF' },
  nextMeta: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#E4DDFF' },
  nextActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  nextDone: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF' },
  nextDoneText: { fontSize: 14, fontWeight: '800', color: '#5B42D8' },
  nextFocus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  nextFocusText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  listHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  listTitle: { flex: 1, fontSize: 18, fontWeight: '900', color: '#2F2D3C' },
  addChip: { flexDirection: 'row', alignItems: 'center', gap: 3, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#F1EDFF' },
  addChipText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  pressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  section: { marginTop: 14 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '800', color: '#6A6573', textTransform: 'uppercase', letterSpacing: 0.6 },
  sectionCount: { fontSize: 11, fontWeight: '800', color: '#8A8492', backgroundColor: '#F1EEF8', borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  rows: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#F7F4FF', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 9 },
  rowMainActive: { backgroundColor: '#EFE9FF' },
  // Late: its time has passed; it can still be done until midnight.
  rowMainLate: { backgroundColor: '#FFF3EA' },
  lateText: { color: '#D9662B', fontWeight: '800' },
  nextBadgeLate: { backgroundColor: '#F08A3C' },
  rowIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  rowCopy: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '700', color: '#2B2B35' },
  rowMeta: { marginTop: 1, fontSize: 11, fontWeight: '700', color: '#8A8492' },
  // An empty ring that fills on hover or press: the row checks the habit off for today.
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  checkActive: { backgroundColor: '#5B42D8' },
  checkDone: { backgroundColor: '#3BAA74', borderColor: '#3BAA74' },
  rowMainDone: { backgroundColor: '#ECF8F1' },
  rowLabelDone: { textDecorationLine: 'line-through', color: '#6F8F7D' },
  focusButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F4FF' },
  focusButtonActive: { backgroundColor: '#EFE9FF' },
  undoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: '#ECF8F1' },
  undoText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#2C6B4C' },
  undoAction: { fontSize: 13, fontWeight: '800', color: '#4F2AC8' },
  doneWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#ECF8F1' },
  doneChipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: '#2C6B4C' },
  restNote: { marginTop: 12, fontSize: 12, fontWeight: '700', color: '#8A8492', textAlign: 'center' },
}, {
  // Dark mode: the hero keeps its colour; the ring and panel stay translucent white.
  hero: { borderRadius: 28, padding: 18, gap: 16, overflow: 'hidden', backgroundColor: '#4A35B8', shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  heroGlow: { position: 'absolute', width: 220, height: 220, borderRadius: 110, right: -70, top: -90, backgroundColor: '#6A52E0', opacity: 0.45 },
  heroEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#DCD5FF' },
  heroHint: { fontSize: 14, fontWeight: '700', color: '#EEEAFF' },
  heroPanelText: { marginTop: 3, fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#EEEAFF' },
  nextWhen: { fontSize: 12, fontWeight: '800', color: '#E4DDFF' },
  nextMeta: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#E4DDFF' },
  nextDone: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 44, borderRadius: 14, backgroundColor: '#FFFFFF' },
  nextDoneText: { fontSize: 14, fontWeight: '800', color: '#4A35B8' },
  heroButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46, borderRadius: 16, backgroundColor: '#FFFFFF' },
  heroButtonText: { fontSize: 15, fontWeight: '800', color: '#4A35B8' },
});
