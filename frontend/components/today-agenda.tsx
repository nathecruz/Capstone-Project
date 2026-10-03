// Home's Today card: what to do next, the rest of today's habits by time of day, and what is
// already done. A tap checks a habit off (with a short Undo); the timer button starts a focus session.
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

/** A dotted ring that fills with today's share of done habits. */
function ProgressRing({ share, label }: { share: number; label: string }) {
  const styles = useThemedStyles(themedStyles);
  const dots = Array.from({ length: RING_DOTS }, (_, index) => {
    const angle = (index / RING_DOTS) * Math.PI * 2;
    return { left: 30 + Math.sin(angle) * 24 - 2.5, top: 30 - Math.cos(angle) * 24 - 2.5, active: index < Math.round(share * RING_DOTS) };
  });
  return (
    <View style={styles.ring} accessible accessibilityLabel={`${label} of today's habits done`}>
      {dots.map((dot, index) => <View key={index} style={[styles.ringDot, { left: dot.left, top: dot.top }, dot.active && styles.ringDotActive]} />)}
      <Text style={styles.ringText}>{label}</Text>
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

function HabitRow({ habit, late, onCheck }: { habit: Habit; late: boolean; onCheck: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const planned = plannedMinutes(habit);
  return (
    <View style={styles.row}>
      <Pressable
        style={({ hovered, pressed }: HoverState) => [styles.rowMain, late && styles.rowMainLate, (hovered || pressed) && styles.rowMainActive]}
        onPress={onCheck}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: false }}
        aria-checked={false}
        accessibilityLabel={`${habit.label} done today`}
      >
        {({ hovered, pressed }: HoverState) => (
          <>
            <View style={[styles.rowIcon, { backgroundColor: `${habit.color || '#5B42D8'}22` }]}>
              <Ionicons name={habit.icon} size={17} color={habit.color || themeColor('#5b42d8')} />
            </View>
            <View style={styles.rowCopy}>
              <Text style={styles.rowLabel} numberOfLines={1}>{habit.label}</Text>
              {(planned !== null || habit.streak > 0) && (
                <Text style={styles.rowMeta} numberOfLines={1}>
                  {planned !== null && <Text style={late && styles.lateText}>{late ? `Late · ${formatMinutes(planned)}` : formatMinutes(planned)}</Text>}
                  {planned !== null && habit.streak > 0 ? '  ·  ' : ''}
                  {habit.streak > 0 ? `🔥 ${habit.streak}-day streak` : ''}
                </Text>
              )}
            </View>
            <View style={[styles.check, (hovered || pressed) && styles.checkActive]}>
              {(hovered || pressed) && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </View>
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

export function TodayAgenda({ habits, now, onCheck, style }: { habits: Habit[]; now: Date; onCheck: (habit: Habit) => void; style?: object | false }) {
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

  return (
    <View style={[styles.card, style]}>
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>Today</Text>
          <Text style={styles.subtitle}>{dateLabel}</Text>
          {total > 0 && (
            <Text style={styles.hint}>
              {agenda.open.length ? `${agenda.done.length} of ${total} done · ${agenda.open.length} to go` : `All ${total} done`}
              {agenda.late.length > 0 && <Text style={styles.lateText}>{` · ${agenda.late.length} late`}</Text>}
            </Text>
          )}
        </View>
        <ProgressRing share={share} label={`${Math.round(share * 100)}%`} />
      </View>

      {habits.length === 0 && <Text style={styles.empty}>No habits yet. Add your first habit below.</Text>}

      {total > 0 && agenda.open.length === 0 && (
        <View style={styles.allDone} accessible accessibilityLabel="All habits done for today">
          <View style={styles.allDoneIcon}><Ionicons name="trophy" size={22} color="#F2A93B" /></View>
          <View style={styles.allDoneCopy}>
            <Text style={styles.allDoneTitle}>All done for today!</Text>
            <Text style={styles.allDoneText}>Every habit is checked off. Come back tomorrow to keep the streak going.</Text>
          </View>
        </View>
      )}

      {nextUp && (
        <View style={styles.nextCard}>
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
              <Ionicons name="checkmark" size={17} color="#5B42D8" />
              <Text style={styles.nextDoneText}>Mark done</Text>
            </Pressable>
            <Pressable style={({ pressed }) => [styles.nextFocus, pressed && styles.pressed]} onPress={() => openFocus(nextUp.id)} accessibilityRole="button" accessibilityLabel={`Start a focus session for ${nextUp.label}`}>
              <Ionicons name="timer-outline" size={17} color="#FFFFFF" />
              <Text style={styles.nextFocusText}>Focus</Text>
            </Pressable>
          </View>
        </View>
      )}

      {agenda.sections.map((section) => {
        const rows = section.habits.filter((habit) => habit.id !== nextUp?.id);
        if (!rows.length) return null;
        return (
          <View key={section.key} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={14} color={section.key === 'late' ? themeColor('#D9662B') : '#8A8492'} />
              <Text style={[styles.sectionTitle, section.key === 'late' && styles.lateText]}>{section.label}</Text>
              <Text style={styles.sectionCount}>{rows.length}</Text>
            </View>
            <View style={styles.rows}>
              {rows.map((habit) => <HabitRow key={habit.id} habit={habit} late={section.key === 'late'} onCheck={() => check(habit)} />)}
            </View>
          </View>
        );
      })}

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

      <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.pressed]} onPress={() => router.push('/add')} accessibilityRole="button">
        <Ionicons name="add" size={18} color="#FFFFFF" />
        <Text style={styles.addButtonText}>Quick Add Habit</Text>
      </Pressable>
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { backgroundColor: '#FFFFFF', borderRadius: 26, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 14, shadowColor: '#201444', shadowOpacity: 0.08, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: '800', color: '#2F2D3C' },
  subtitle: { marginTop: 1, fontSize: 12, fontWeight: '700', color: '#8A8492' },
  hint: { marginTop: 4, fontSize: 12, fontWeight: '700', color: '#5B42D8' },
  ring: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F3FF' },
  ringDot: { position: 'absolute', width: 5, height: 5, borderRadius: 3, backgroundColor: '#EADDFF' },
  ringDotActive: { backgroundColor: '#5B42D8' },
  ringText: { fontSize: 13, fontWeight: '800', color: '#2D2A38' },
  empty: { fontSize: 13, color: '#777282', fontWeight: '600', textAlign: 'center', paddingVertical: 18 },
  allDone: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12, padding: 12, borderRadius: 16, backgroundColor: '#FFF7E8' },
  allDoneIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  allDoneCopy: { flex: 1 },
  allDoneTitle: { fontSize: 15, fontWeight: '800', color: '#2F2D3C' },
  allDoneText: { marginTop: 2, fontSize: 12, lineHeight: 17, color: '#6A6F7D', fontWeight: '600' },
  // The next habit stands out in the brand purple, with its two actions right there.
  nextCard: { marginTop: 14, borderRadius: 20, padding: 14, backgroundColor: '#5B42D8', shadowColor: '#5B42D8', shadowOpacity: 0.3, shadowRadius: 16, shadowOffset: { width: 0, height: 8 } },
  nextTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nextBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)' },
  nextBadgeText: { fontSize: 10, fontWeight: '900', letterSpacing: 1, color: '#FFFFFF' },
  nextWhen: { fontSize: 12, fontWeight: '800', color: '#E4DDFF' },
  nextBody: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  nextIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  nextCopy: { flex: 1 },
  nextLabel: { fontSize: 17, fontWeight: '800', color: '#FFFFFF' },
  nextMeta: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#E4DDFF' },
  nextActions: { flexDirection: 'row', gap: 8, marginTop: 14 },
  nextDone: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 14, backgroundColor: '#FFFFFF' },
  nextDoneText: { fontSize: 14, fontWeight: '800', color: '#5B42D8' },
  nextFocus: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 40, borderRadius: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.6)' },
  nextFocusText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
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
  focusButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F7F4FF' },
  focusButtonActive: { backgroundColor: '#EFE9FF' },
  undoBar: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: '#ECF8F1' },
  undoText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#2C6B4C' },
  undoAction: { fontSize: 13, fontWeight: '800', color: '#4F2AC8' },
  doneWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  doneChip: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '100%', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#ECF8F1' },
  doneChipText: { flexShrink: 1, fontSize: 12, fontWeight: '700', color: '#2C6B4C' },
  restNote: { marginTop: 12, fontSize: 11, fontWeight: '700', color: '#8A8492', textAlign: 'center' },
  addButton: { marginTop: 14, flexDirection: 'row', gap: 6, backgroundColor: '#5D42D8', borderRadius: 16, height: 42, alignItems: 'center', justifyContent: 'center' },
  addButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
