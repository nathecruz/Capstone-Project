import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { EditHabitSheet } from '@/components/edit-habit-sheet';
import { ProgressRing } from '@/components/progress-ring';
import { openFocus } from '@/components/today-agenda';
import { isHabitLate } from '@/utils/engagement';
import { FACULTY_HABIT_IDEAS } from '@/constants/faculty';
import { useAppDialog } from '@/components/ui/app-dialog';
import { isHabitMissedYesterday, useAppColorScheme } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { historyStats } from '@/utils/achievements';
import { filterHabitsByStatus } from '@/utils/habit-data';
import { createThemedStyles, themedColor, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const FREQUENCIES = ['All', 'Daily', 'Weekly', 'Monthly', 'Custom'];
type StatusMode = 'all' | 'active' | 'done';
type SortMode = 'custom' | 'progress' | 'streak' | 'name';
const SORT_LABELS: Record<SortMode, string> = { custom: 'My order', progress: 'Progress', streak: 'Longest streak', name: 'A to Z' };
const HABIT_IDEAS = ['Drink Water', 'Read for 10 Minutes', 'Take a Short Walk', 'Write in a Journal', 'Practice Gratitude', 'Plan Tomorrow', 'Stretch for 5 Minutes', 'Organize One Small Space', 'Learn Something New', 'Sleep 30 Minutes Earlier', 'Take a Screen Break'];

export default function HabitsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const appTheme = useAppTheme();
  const { isDarkMode, habits: habitList, toggleHabit, reorderHabits, canUndoCheckIn, isFaculty } = useAppColorScheme();
  const showAlert = useAppDialog();
  const [editingHabit, setEditingHabit] = useState<(typeof habitList)[number] | null>(null);
  const [selectedTab, setSelectedTab] = useState('All');
  // Completed habits stay visible (checked) so a mistaken check can be undone; to-dos come first.
  const [filterMode, setFilterMode] = useState<StatusMode>('all');
  const [sortMode, setSortMode] = useState<SortMode>('progress');
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    // Keeps "late" and "missed yesterday" current while the screen stays open.
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  // The hero is purple in both modes; its ring needs the same colour in the middle.
  const heroBackground = themedColor(isDarkMode ? '#30215A' : '#5B42D8', appTheme);

  // Habits stay on the list and can be checked in all day; one only counts as missed once its day is over.
  const completedCount = habitList.filter((habit) => habit.done).length;
  const openCount = habitList.length - completedCount;
  const donePercent = habitList.length ? Math.round((completedCount / habitList.length) * 100) : 0;
  const bestCurrentStreak = Math.max(0, ...habitList.map((habit) => habit.streak));
  // This week's real rate (check-ins done of those due so far), not today's progress.
  const weekRate = useMemo(() => historyStats(habitList).thisWeekRate, [habitList]);
  const frequencyCount = (tab: string) => (tab === 'All' ? habitList.length : habitList.filter((habit) => habit.frequency === tab).length);
  const getSuggestion = () => {
    const candidates = isFaculty ? FACULTY_HABIT_IDEAS : HABIT_IDEAS;
    setSuggestion(candidates[Math.floor(Math.random() * candidates.length)]);
  };

  const filteredHabits = useMemo(() => {
    let next = [...habitList];
    if (selectedTab !== 'All') next = next.filter((habit) => habit.frequency === selectedTab);

    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean);
      next = next.filter((habit) => {
        const searchableHabit = `${habit.label} ${habit.category} ${habit.frequency} ${habit.meta} ${habit.reminderTime}`.toLowerCase();
        return searchTerms.every((term) => searchableHabit.includes(term));
      });
    }

    next = filterHabitsByStatus(next, filterMode);
    if (sortMode === 'progress') next.sort((a, b) => b.progress - a.progress);
    if (sortMode === 'streak') next.sort((a, b) => b.streak - a.streak);
    if (sortMode === 'name') next.sort((a, b) => a.label.localeCompare(b.label));
    // Habits still to do come before the ones done today; "My order" keeps the dragged order.
    if (sortMode !== 'custom') next = [...next.filter((habit) => !habit.done), ...next.filter((habit) => habit.done)];
    return next;
  }, [habitList, selectedTab, filterMode, sortMode, search]);
  const filtersActive = selectedTab !== 'All' || filterMode !== 'all';

  const pressCheck = (item: (typeof habitList)[number]) => {
    // Done and past its Undo: locked for the day, so explain instead of doing nothing.
    if (item.done && !canUndoCheckIn(item.id)) showAlert('Already done today', 'A check-in locks a few seconds after you tap it, so streaks and tokens stay fair. This habit opens again tomorrow.');
    else toggleHabit(item.id);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <DraggableFlatList
        data={filteredHabits}
        keyExtractor={(item) => item.id}
        style={styles.draggableList}
        containerStyle={styles.draggableListContainer}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        activationDistance={Platform.OS === 'web' ? 1_000_000 : 10}
        autoscrollThreshold={20}
        autoscrollSpeed={40}
        onDragEnd={({ data }) => {
          reorderHabits(data);
          // Keep the order just dragged on screen instead of re-sorting it by progress.
          setSortMode('custom');
        }}
        renderItem={({ item, drag, isActive }) => {
          const late = !item.done && isHabitLate(item, currentTime);
          const missed = !item.done && !late && isHabitMissedYesterday(item, currentTime);
          const undoable = item.done && canUndoCheckIn(item.id);
          return (
            <ScaleDecorator>
              <Pressable
                onLongPress={Platform.OS === 'web' ? undefined : drag}
                style={[styles.card, item.done && styles.cardDone, isActive && styles.cardDragging]}
              >
                <View style={styles.cardTop}>
                  <View style={[styles.habitIcon, { backgroundColor: `${item.color}${isDarkMode ? '33' : '1F'}` }]}>
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={21} color={item.color} />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.habitTitle} numberOfLines={2}>{item.label}</Text>
                    <Text style={styles.metaText} numberOfLines={1}>{item.meta}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.check, item.done ? styles.checkDone : styles.checkEmpty, pressed && styles.pressed]}
                    onPress={() => pressCheck(item)}
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${item.label} done today`}
                    accessibilityState={{ checked: item.done }}
                    aria-checked={item.done}
                    hitSlop={6}
                  >
                    <Ionicons name="checkmark" size={22} color={item.done ? themeColor('#FFFFFF') : themeColor('#C9C4D6')} />
                  </Pressable>
                </View>

                {item.goal > 1 && (
                  <View style={styles.goalRow}>
                    <View style={styles.goalTrack}><View style={[styles.goalFill, { width: `${item.progress}%`, backgroundColor: item.color }]} /></View>
                    <Text style={styles.goalText}>{item.total}</Text>
                  </View>
                )}

                <View style={styles.cardBottom}>
                  <View style={styles.chips}>
                    {item.done ? (
                      <View style={[styles.chip, styles.chipDone]}>
                        <Ionicons name="checkmark-circle" size={13} color={themeColor('#23774A')} />
                        <Text style={[styles.chipText, styles.chipTextDone]}>{undoable ? 'Done · tap ✓ to undo' : 'Done today'}</Text>
                      </View>
                    ) : late ? (
                      <View style={[styles.chip, styles.chipLate]}>
                        <Ionicons name="time" size={13} color={themeColor('#C2541E')} />
                        <Text style={[styles.chipText, styles.chipTextLate]}>Late, still open</Text>
                      </View>
                    ) : missed ? (
                      <View style={[styles.chip, styles.chipMissed]}>
                        <Ionicons name="alert-circle" size={13} color={themeColor('#A0661A')} />
                        <Text style={[styles.chipText, styles.chipTextMissed]}>Missed yesterday</Text>
                      </View>
                    ) : (
                      <View style={styles.chip}>
                        <Ionicons name="ellipse-outline" size={12} color={themeColor('#6E6887')} />
                        <Text style={styles.chipText}>To do</Text>
                      </View>
                    )}
                    {item.streak > 0 && (
                      <View style={[styles.chip, styles.chipStreak]}>
                        <Ionicons name="flame" size={13} color={themeColor('#E07B1F')} />
                        <Text style={[styles.chipText, styles.chipTextStreak]}>{item.streak}-day streak</Text>
                      </View>
                    )}
                  </View>
                  {/* Not done yet: start a focus session that checks it off at the end. */}
                  {!item.done && (
                    <Pressable style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]} onPress={() => openFocus(item.id)} accessibilityRole="button" accessibilityLabel={`Start a focus session for ${item.label}`}>
                      <Ionicons name="timer-outline" size={18} color={themeColor('#5B42D8')} />
                    </Pressable>
                  )}
                  {/* Rename, recategorize, reschedule or delete: all in the edit sheet. */}
                  <Pressable style={({ pressed }) => [styles.smallButton, pressed && styles.pressed]} onPress={() => setEditingHabit(item)} accessibilityRole="button" accessibilityLabel={`Edit ${item.label}`}>
                    <Ionicons name="create-outline" size={18} color={themeColor('#5B42D8')} />
                  </Pressable>
                </View>
              </Pressable>
            </ScaleDecorator>
          );
        }}
        ListEmptyComponent={
          <View style={[styles.card, styles.emptyState]}>
            <View style={styles.emptyIcon}><Ionicons name={search.trim() || filtersActive ? 'search-outline' : 'leaf-outline'} size={28} color={themeColor('#5B42D8')} /></View>
            <Text style={styles.emptyTitle}>{search.trim() ? 'No matching habits' : habitList.length ? 'Nothing here' : 'No habits yet'}</Text>
            <Text style={styles.emptyText}>
              {search.trim()
                ? `Nothing matched "${search.trim()}". Try another name, schedule or reminder time.`
                : habitList.length
                  ? filterMode === 'done' ? 'No habit is done yet today. Check one off to see it here.' : 'No habit matches these filters.'
                  : 'Start with one small habit and build your rhythm from there.'}
            </Text>
            {search.trim() ? (
              <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => setSearch('')} accessibilityRole="button"><Ionicons name="close-circle-outline" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.primaryButtonText}>Clear search</Text></Pressable>
            ) : habitList.length ? (
              <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => { setSelectedTab('All'); setFilterMode('all'); }} accessibilityRole="button"><Ionicons name="list" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.primaryButtonText}>Show all habits</Text></Pressable>
            ) : (
              <Pressable style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]} onPress={() => router.push('/add')} accessibilityRole="button"><Ionicons name="add" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.primaryButtonText}>Create a habit</Text></Pressable>
            )}
          </View>
        }
        ListHeaderComponent={
          <View style={[styles.container]}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.title}>My Habits</Text>
                <Text style={styles.subtitle}>{habitList.length ? `${habitList.length} habit${habitList.length === 1 ? '' : 's'} · ${completedCount} done today` : 'Small steps, big change.'}</Text>
              </View>
              <Pressable style={({ pressed }) => [styles.iconButton, searchOpen && styles.iconButtonActive, pressed && styles.pressed]} onPress={() => { if (searchOpen) setSearch(''); setSearchOpen((open) => !open); }} accessibilityLabel="Search habits" accessibilityRole="button" accessibilityState={{ expanded: searchOpen }}>
                <Ionicons name={searchOpen ? 'close' : 'search'} size={19} color={searchOpen ? themeColor('#FFFFFF') : themeColor('#3B3650')} />
              </Pressable>
              <Pressable style={({ pressed }) => [styles.iconButton, styles.iconButtonPrimary, pressed && styles.pressed]} onPress={() => router.push('/add')} accessibilityLabel="Add a habit" accessibilityRole="button">
                <Ionicons name="add" size={22} color={themeColor('#FFFFFF')} />
              </Pressable>
            </View>

            {searchOpen && (
              <View style={styles.searchBox}>
                <Ionicons name="search-outline" size={17} color={themeColor('#8A8492')} />
                <TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search by name, schedule or time" placeholderTextColor={themeColor('#9A94A4')} style={[styles.searchInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]} returnKeyType="search" accessibilityLabel="Search text" />
                {search ? (
                  <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear habit search" accessibilityRole="button" hitSlop={8}>
                    <Ionicons name="close-circle" size={18} color={themeColor('#8A8492')} />
                  </Pressable>
                ) : null}
              </View>
            )}

            <View style={[styles.hero, isDarkMode && styles.heroDark]}>
              <View style={styles.heroTop}>
                <ProgressRing value={donePercent} size={92} thickness={9} color="#FFFFFF" trackColor="rgba(255,255,255,0.2)" innerColor={heroBackground}>
                  <Text style={styles.heroRingValue}>{completedCount}/{habitList.length}</Text>
                  <Text style={styles.heroRingLabel}>done</Text>
                </ProgressRing>
                <View style={styles.heroCopy}>
                  <Text style={styles.heroLabel}>TODAY</Text>
                  <Text style={styles.heroTitle}>{!habitList.length ? 'Add your first habit' : openCount === 0 ? 'Everything is done!' : `${openCount} habit${openCount === 1 ? '' : 's'} still open`}</Text>
                  <Text style={styles.heroSubtitle}>{!habitList.length ? 'Tap + to start small.' : openCount === 0 ? 'Great work. See you tomorrow.' : 'You can check in any time before midnight.'}</Text>
                </View>
              </View>
              <View style={styles.heroStats}>
                {[
                  { icon: 'flame' as const, value: `${bestCurrentStreak}`, label: 'day streak' },
                  { icon: 'stats-chart' as const, value: `${weekRate}%`, label: 'this week' },
                  { icon: 'layers' as const, value: `${habitList.length}`, label: 'habits' },
                ].map((stat) => (
                  <View key={stat.label} style={styles.heroStat}>
                    <View style={styles.heroStatTop}>
                      <Ionicons name={stat.icon} size={14} color="#D8D0FF" />
                      <Text style={styles.heroStatValue}>{stat.value}</Text>
                    </View>
                    <Text style={styles.heroStatLabel} numberOfLines={1}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.frequencyRow} accessibilityRole="tablist">
              {FREQUENCIES.filter((tab) => tab === 'All' || tab === selectedTab || frequencyCount(tab) > 0).map((tab) => {
                const active = selectedTab === tab;
                return (
                  <Pressable key={tab} style={({ pressed }) => [styles.frequencyChip, active && styles.frequencyChipActive, pressed && styles.pressed]} onPress={() => setSelectedTab(tab)} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={`${tab} habits, ${frequencyCount(tab)}`}>
                    <Text style={[styles.frequencyText, active && styles.frequencyTextActive]}>{tab}</Text>
                    <View style={[styles.countBadge, active && styles.countBadgeActive]}><Text style={[styles.countText, active && styles.countTextActive]}>{frequencyCount(tab)}</Text></View>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.controls}>
              <View style={styles.statusControl} accessibilityRole="radiogroup" accessibilityLabel="Show">
                {([['all', 'All'], ['active', `To do ${openCount}`], ['done', `Done ${completedCount}`]] as const).map(([mode, label]) => {
                  const active = filterMode === mode;
                  return (
                    <Pressable key={mode} style={[styles.statusOption, active && styles.statusOptionActive]} onPress={() => setFilterMode(mode)} accessibilityRole="radio" accessibilityState={{ checked: active }}>
                      <Text style={[styles.statusText, active && styles.statusTextActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable style={({ pressed }) => [styles.sortButton, showSortMenu && styles.sortButtonOpen, pressed && styles.pressed]} onPress={() => setShowSortMenu((open) => !open)} accessibilityRole="button" accessibilityLabel={`Sort: ${SORT_LABELS[sortMode]}`} accessibilityState={{ expanded: showSortMenu }}>
                <Ionicons name="swap-vertical" size={16} color={themeColor('#5B42D8')} />
                <Text style={styles.sortText} numberOfLines={1}>{SORT_LABELS[sortMode]}</Text>
              </Pressable>
            </View>

            {showSortMenu && (
              <View style={styles.sortMenu}>
                <Text style={styles.sortMenuTitle}>Sort habits by</Text>
                {(Object.keys(SORT_LABELS) as SortMode[]).map((mode) => {
                  const selected = sortMode === mode;
                  return (
                    <Pressable key={mode} style={[styles.sortOption, selected && styles.sortOptionSelected]} onPress={() => { setSortMode(mode); setShowSortMenu(false); }} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                      <Text style={[styles.sortOptionText, selected && styles.sortOptionTextSelected]}>{SORT_LABELS[mode]}</Text>
                      {selected && <Ionicons name="checkmark" size={17} color={themeColor('#5B42D8')} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            {search.trim() ? <Text style={styles.resultText}>{filteredHabits.length} result{filteredHabits.length === 1 ? '' : 's'} for &quot;{search.trim()}&quot;</Text> : null}
          </View>
        }
        ListFooterComponent={
          <View style={[styles.container]}>
            {/* Dragging works on phones only (web scrolls instead). */}
            {Platform.OS !== 'web' && filteredHabits.length > 1 ? (
              <View style={styles.dragHint}>
                <Ionicons name="reorder-three-outline" size={18} color={themeColor('#838AA1')} />
                <Text style={styles.dragHintText}>Hold and drag a habit to reorder</Text>
              </View>
            ) : null}

            <View style={styles.ideaCard}>
              <View style={styles.ideaRow}>
                <View style={styles.ideaIcon}><Ionicons name="bulb" size={20} color={themeColor('#5B42D8')} /></View>
                <View style={styles.ideaCopy}>
                  <Text style={styles.ideaTitle}>Need a habit idea?</Text>
                  <Text style={styles.ideaText}>Get a small one you can add in one tap.</Text>
                </View>
                <Pressable style={({ pressed }) => [styles.ideaButton, pressed && styles.pressed]} onPress={getSuggestion} accessibilityRole="button">
                  <Ionicons name="sparkles" size={15} color={themeColor('#5B42D8')} />
                  <Text style={styles.ideaButtonText}>{suggestion ? 'Another' : 'Suggest'}</Text>
                </Pressable>
              </View>
              {suggestion ? (
                <View style={styles.ideaResult}>
                  <Text style={styles.ideaResultTitle} numberOfLines={2}>{suggestion}</Text>
                  <Pressable style={({ pressed }) => [styles.useButton, pressed && styles.pressed]} onPress={() => router.push({ pathname: '/add', params: { habit: suggestion } })} accessibilityRole="button" accessibilityLabel={`Add the habit ${suggestion}`}>
                    <Ionicons name="add" size={16} color={themeColor('#FFFFFF')} />
                    <Text style={styles.useButtonText}>Add</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        }
      />
      <EditHabitSheet habit={editingHabit} onClose={() => setEditingHabit(null)} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  draggableList: { flex: 1, minHeight: 0 },
  draggableListContainer: { flex: 1 },
  content: { flexGrow: 1, paddingBottom: 24 },
  container: { paddingHorizontal: 16, paddingTop: 8 },
  pressed: { opacity: 0.75 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 28, fontWeight: '900', color: '#1B1A1F', letterSpacing: -0.5 },
  subtitle: { fontSize: 13, fontWeight: '600', color: '#6E6887', marginTop: 2 },
  iconButton: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', shadowColor: '#292047', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  iconButtonActive: { backgroundColor: '#3B3650' },
  iconButtonPrimary: { backgroundColor: '#5B42D8', shadowColor: '#5B42D8', shadowOpacity: 0.25 },
  searchBox: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, marginBottom: 12, borderWidth: 2, borderColor: '#DED6FA' },
  searchInput: { flex: 1, minHeight: 44, color: '#302B3B', fontSize: 16, fontWeight: '600' },
  resultText: { fontSize: 12, fontWeight: '700', color: '#6E6887', marginBottom: 10, paddingHorizontal: 2 },
  hero: { backgroundColor: '#5B42D8', borderRadius: 24, padding: 18, marginBottom: 14 },
  heroDark: { backgroundColor: '#30215A' },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  heroRingValue: { fontSize: 20, fontWeight: '900', color: '#FFFFFF' },
  heroRingLabel: { fontSize: 11, fontWeight: '700', color: '#D8D0FF' },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#D8D0FF' },
  heroTitle: { fontSize: 20, lineHeight: 25, fontWeight: '900', color: '#FFFFFF', marginTop: 3 },
  heroSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#D8D0FF', marginTop: 4 },
  heroStats: { flexDirection: 'row', gap: 8, marginTop: 16 },
  heroStat: { flex: 1, minWidth: 0, alignItems: 'center', gap: 2, paddingHorizontal: 6, paddingVertical: 9, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.12)' },
  heroStatTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  heroStatValue: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  heroStatLabel: { fontSize: 11, fontWeight: '700', color: '#D8D0FF' },
  frequencyRow: { gap: 8, paddingBottom: 12 },
  frequencyChip: { flexDirection: 'row', alignItems: 'center', gap: 7, minHeight: 40, paddingLeft: 14, paddingRight: 8, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E2F3' },
  frequencyChipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  frequencyText: { fontSize: 14, fontWeight: '800', color: '#4A4458' },
  frequencyTextActive: { color: '#FFFFFF' },
  countBadge: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EDF7' },
  countBadgeActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  countText: { fontSize: 12, fontWeight: '900', color: '#6E6887' },
  countTextActive: { color: '#FFFFFF' },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  statusControl: { flex: 1, flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 14, padding: 3 },
  statusOption: { flex: 1, minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 11, paddingHorizontal: 4 },
  statusOptionActive: { backgroundColor: '#FFFFFF', shadowColor: '#292047', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  statusText: { fontSize: 12, fontWeight: '700', color: '#777283' },
  statusTextActive: { color: '#5B42D8', fontWeight: '900' },
  sortButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 44, maxWidth: 140, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E2F3' },
  sortButtonOpen: { borderColor: '#8E7AE8' },
  sortText: { flexShrink: 1, fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  sortMenu: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 8, marginBottom: 12, borderWidth: 1, borderColor: '#E7E1F2', shadowColor: '#000000', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  sortMenuTitle: { fontSize: 12, fontWeight: '800', color: '#6E6887', paddingHorizontal: 8, paddingVertical: 6 },
  sortOption: { minHeight: 44, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sortOptionSelected: { backgroundColor: '#F0EBFF' },
  sortOptionText: { fontSize: 14, fontWeight: '700', color: '#3C3A4B' },
  sortOptionTextSelected: { color: '#5B42D8', fontWeight: '900' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 20, marginHorizontal: 16, padding: 14, marginBottom: 10, shadowColor: '#292047', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  cardDone: { opacity: 0.82 },
  cardDragging: { backgroundColor: '#F3EEFF', shadowColor: '#5B42D8', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  habitIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0 },
  habitTitle: { fontSize: 16, lineHeight: 21, fontWeight: '900', color: '#1E1D29' },
  metaText: { fontSize: 12, fontWeight: '600', color: '#6E6887', marginTop: 2 },
  check: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  checkEmpty: { borderWidth: 2, borderColor: '#D8D4E3', backgroundColor: '#FFFFFF' },
  checkDone: { backgroundColor: '#2E9D5C' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12, marginLeft: 56 },
  goalTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#ECEAF1' },
  goalFill: { height: '100%', borderRadius: 4 },
  goalText: { fontSize: 12, fontWeight: '900', color: '#3B3650' },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginLeft: 56 },
  chips: { flex: 1, minWidth: 0, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#F2F0F7' },
  chipText: { fontSize: 11, fontWeight: '800', color: '#6E6887' },
  chipDone: { backgroundColor: '#E6F6EC' },
  chipTextDone: { color: '#23774A' },
  chipLate: { backgroundColor: '#FDECE2' },
  chipTextLate: { color: '#B44A17' },
  chipMissed: { backgroundColor: '#FFF4DE' },
  chipTextMissed: { color: '#8F5A12' },
  chipStreak: { backgroundColor: '#FFF1E3' },
  chipTextStreak: { color: '#B45F12' },
  smallButton: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EEFF' },
  emptyState: { alignItems: 'center', paddingVertical: 28, paddingHorizontal: 22 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EEFF', marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '900', color: '#252331', marginBottom: 5 },
  emptyText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#6E6887', textAlign: 'center', marginBottom: 16 },
  primaryButton: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 46, paddingHorizontal: 18, borderRadius: 14, backgroundColor: '#5B42D8' },
  primaryButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  dragHint: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 14 },
  dragHintText: { fontSize: 13, fontWeight: '600', color: '#7A8195' },
  ideaCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, marginTop: 4, gap: 12, borderWidth: 1, borderColor: '#ECE6F8' },
  ideaRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  ideaIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1EEFF' },
  ideaCopy: { flex: 1, minWidth: 0 },
  ideaTitle: { fontSize: 15, fontWeight: '900', color: '#1D1C26' },
  ideaText: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#6E6887', marginTop: 2 },
  ideaButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#F1EEFF' },
  ideaButtonText: { fontSize: 13, fontWeight: '900', color: '#5B42D8' },
  ideaResult: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 14, backgroundColor: '#F7F4FF' },
  ideaResultTitle: { flex: 1, fontSize: 15, fontWeight: '900', color: '#302B3B' },
  useButton: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 40, paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#5B42D8' },
  useButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
}, {
  // Dark mode: the hero keeps its deep purple, the selected status sits a step above its track.
  hero: { backgroundColor: '#30215A', borderRadius: 24, padding: 18, marginBottom: 14 },
  statusOptionActive: { backgroundColor: '#3A3150', shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  checkEmpty: { borderWidth: 2, borderColor: '#4A4458', backgroundColor: '#1D1A24' },
  iconButtonActive: { backgroundColor: '#5B42D8' },
});
