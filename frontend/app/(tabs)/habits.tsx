import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import DraggableFlatList, { ScaleDecorator } from 'react-native-draggable-flatlist';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { isHabitMissedYesterday, useAppColorScheme } from '@/hooks/color-scheme-context';
import { filterHabitsByStatus } from '@/utils/habit-data';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const tabs = ['All', 'Daily', 'Weekly', 'Monthly', 'Custom'];

export default function HabitsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { isDarkMode, habits: habitList, toggleHabit, deleteHabit, reorderHabits } = useAppColorScheme();
  const [selectedTab, setSelectedTab] = useState('All');
  const [filterMode, setFilterMode] = useState<'all' | 'active' | 'done'>('active');
  const [sortMode, setSortMode] = useState<'custom' | 'progress' | 'streak' | 'name'>('progress');
  const [showFilterMenu, setShowFilterMenu] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [suggestion, setSuggestion] = useState('');
  const [currentTime, setCurrentTime] = useState(() => new Date());
  useEffect(() => {
    // Keeps "missed yesterday" correct after midnight while the screen stays open.
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Habits stay on the list and can be checked in all day; one only counts as missed once its day is over.
  const visibleHabitList = habitList;
  const completedCount = visibleHabitList.filter((habit) => habit.done).length;
  const overallProgress = visibleHabitList.length
    ? Math.round(visibleHabitList.reduce((sum, habit) => sum + habit.progress, 0) / visibleHabitList.length)
    : 0;
  const getSuggestion = () => {
    const candidates = ['Drink Water', 'Read for 10 Minutes', 'Take a Short Walk', 'Write in a Journal', 'Practice Gratitude', 'Plan Tomorrow', 'Stretch for 5 Minutes', 'Organize One Small Space', 'Learn Something New', 'Sleep 30 Minutes Earlier', 'Take a Screen Break'];
    setSuggestion(candidates[Math.floor(Math.random() * candidates.length)]);
  };

  const filteredHabits = useMemo(() => {
    let next = [...visibleHabitList];

    if (selectedTab !== 'All') {
      next = next.filter((habit) => habit.frequency === selectedTab);
    }

    const normalizedSearch = search.trim().toLowerCase();
    if (normalizedSearch) {
      const searchTerms = normalizedSearch.split(/\s+/).filter(Boolean);
      next = next.filter((habit) => {
        const searchableHabit = `${habit.label} ${habit.category} ${habit.frequency} ${habit.meta} ${habit.reminderTime}`.toLowerCase();
        return searchTerms.every((term) => searchableHabit.includes(term));
      });
    }

    next = filterHabitsByStatus(next, filterMode);

    if (sortMode === 'progress') {
      next.sort((a, b) => b.progress - a.progress);
    }

    if (sortMode === 'streak') {
      next.sort((a, b) => b.streak - a.streak);
    }

    if (sortMode === 'name') {
      next.sort((a, b) => a.label.localeCompare(b.label));
    }

    return next;
  }, [visibleHabitList, selectedTab, filterMode, sortMode, search]);

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
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
        renderItem={({ item, drag, isActive }) => (
          <ScaleDecorator>
            <Pressable
              onLongPress={Platform.OS === 'web' ? undefined : drag}
              style={[styles.habitCard, isDarkMode && styles.darkCard, isActive && styles.habitCardDragging]}
            >
              <View style={styles.habitCardHeader}>
                <View style={styles.habitTitleWrap}>
                  <View style={[styles.habitIconWrap, { backgroundColor: `${item.color}22` }]}>
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={19} color={item.color} />
                  </View>
                  <Text style={[styles.habitTitle, isDarkMode && styles.darkText]}>{item.label}</Text>
                </View>
                <View style={[styles.progressPill, isDarkMode && styles.darkProgressPill]}>
                  <Text style={[styles.progressPillText, isDarkMode && styles.darkProgressPillText]}>{item.total}</Text>
                </View>
                <Pressable
                  style={[styles.deleteButton, isDarkMode && styles.darkDeleteButton]}
                  onPress={() => showAlert('Delete habit?', `Remove ${item.label} from your habits?`, [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Delete', style: 'destructive', onPress: () => deleteHabit(item.id) },
                  ])}
                  accessibilityLabel={`Delete ${item.label}`}
                >
                  <Ionicons name="trash-outline" size={17} color={themeColor('#D45A68')} />
                </Pressable>
              </View>

              <View style={styles.metaRow}>
                <Text style={[styles.metaText, isDarkMode && styles.darkMutedText]}>{isHabitMissedYesterday(item, currentTime) ? 'MISSED YESTERDAY · ' : ''}{item.meta}</Text>
                <View style={styles.streakRow}>
                  <Ionicons name="flame-outline" size={12} color={themeColor('#F29A3D')} />
                  <Text style={[styles.streakText, isDarkMode && styles.darkText]}>{item.streak}</Text>
                </View>
              </View>

              <View style={[styles.progressTrack, isDarkMode && styles.darkProgressTrack]}>
                <View
                  style={[
                    styles.progressFill,
                    {
                      width: `${item.progress}%`,
                      backgroundColor: item.color,
                    },
                  ]}
                />
              </View>

              <View style={styles.progressPercentRow}>
                <Text style={[styles.progressPercent, isDarkMode && styles.darkMutedText]}>{item.progress}%</Text>
                <Pressable
                  style={[styles.checkButton, item.done ? styles.checkButtonDone : [styles.checkButtonEmpty, isDarkMode && styles.darkCheckButtonEmpty]]}
                  onPress={() => {
                    toggleHabit(item.id);
                    setFilterMode('active');
                  }}
                  accessibilityRole="checkbox"
                  accessibilityLabel={`${item.label} done today`}
                  accessibilityState={{ checked: item.done }}
                >
                  {item.done ? <Ionicons name="checkmark" size={18} color={themeColor('#FFFFFF')} /> : null}
                </Pressable>
              </View>
            </Pressable>
          </ScaleDecorator>
        )}
        ListEmptyComponent={
          <View style={[styles.emptyState, isDarkMode && styles.darkCard]}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="leaf-outline" size={28} color={themeColor('#5B42D8')} />
            </View>
            <Text style={[styles.emptyTitle, isDarkMode && styles.darkText]}>{search.trim() ? 'No matching habits' : 'No habits here yet'}</Text>
            <Text style={[styles.emptyText, isDarkMode && styles.darkMutedText]}>{search.trim() ? `Nothing matched "${search.trim()}". Try another habit name, schedule, or reminder time.` : 'Start with one small habit and build your rhythm from there.'}</Text>
            {search.trim() ? <Pressable style={styles.emptyButton} onPress={() => setSearch('')}><Ionicons name="close-circle-outline" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.primaryButtonText}>Clear Search</Text></Pressable> : <Pressable style={styles.emptyButton} onPress={() => router.push('/add')}><Ionicons name="add" size={17} color={themeColor('#FFFFFF')} /><Text style={styles.primaryButtonText}>Create a habit</Text></Pressable>}
          </View>
        }
        ListHeaderComponent={
          <View style={styles.container}>
            <View style={styles.headerRow}>
              <View>
                <Text style={[styles.title, isDarkMode && styles.darkText]}>My Habits</Text>
                <View style={styles.subtitleRow}>
                  <Text style={[styles.subtitle, isDarkMode && styles.darkMutedText]}>Small steps, big change.</Text>
                  <Text style={styles.subtitleIcon}>♥</Text>
                </View>
              </View>

              <View style={styles.headerActions}>
                <Pressable style={[styles.iconButton, isDarkMode && styles.darkIconButton]} onPress={() => setSearchOpen((open) => !open)} accessibilityLabel="Search habits" accessibilityRole="button">
                  <Ionicons name="search-outline" size={18} color={isDarkMode ? '#F2EFF8' : '#1F1F2A'} />
                </Pressable>
                <Pressable style={styles.iconButtonAlt} onPress={() => { setShowSortMenu(false); setShowFilterMenu((prev) => !prev); }} accessibilityLabel="Filter habits" accessibilityRole="button">
                  <Ionicons name="options-outline" size={18} color={themeColor('#FFFFFF')} />
                </Pressable>
              </View>
            </View>

            {searchOpen && <><View style={[styles.searchBox, isDarkMode && styles.darkCard]}><Ionicons name="search-outline" size={17} color={themeColor('#8A8492')} /><TextInput autoFocus value={search} onChangeText={setSearch} placeholder="Search habits..." placeholderTextColor={themeColor('#9A94A4')} style={[styles.searchInput, isDarkMode && styles.darkText]} returnKeyType="search" accessibilityLabel="Search habits" /><Pressable onPress={() => { setSearch(''); setSearchOpen(false); }} accessibilityLabel="Clear habit search"><Ionicons name="close-circle" size={18} color={themeColor('#8A8492')} /></Pressable></View>{search.trim() ? <View style={styles.searchResultSummary}><Ionicons name="checkmark-circle-outline" size={15} color={themeColor('#46B883')} /><Text style={[styles.searchResultText, isDarkMode && styles.darkMutedText]}>{filteredHabits.length} result{filteredHabits.length === 1 ? '' : 's'} for &quot;{search.trim()}&quot;</Text></View> : null}</>}

            <View style={styles.segmentRow}>
              {tabs.map((tab) => (
                <Pressable
                  key={tab}
                  style={[styles.segmentButton, isDarkMode && styles.darkSegmentButton, selectedTab === tab && styles.segmentButtonActive]}
                  onPress={() => setSelectedTab(tab)}
                >
                  <Text style={[styles.segmentText, isDarkMode && styles.darkMutedText, selectedTab === tab && styles.segmentTextActive]}>{tab}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.actionRow}>
              <Pressable
                style={[styles.actionButton, styles.actionButtonPrimary]}
                onPress={() => router.push('/add')}
              >
                <Ionicons name="add-outline" size={16} color={themeColor('#FFFFFF')} />
                <Text style={[styles.actionText, styles.actionTextPrimary]}>Add Habit</Text>
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.actionButtonSecondary, isDarkMode && styles.darkIconButton]}
                onPress={() => {
                  setShowSortMenu(false);
                  setShowFilterMenu((prev) => !prev);
                }}
              >
                <Ionicons name="filter-outline" size={16} color={isDarkMode ? '#F2EFF8' : '#2C2B34'} />
                <Text style={[styles.actionText, isDarkMode && styles.darkText]}>Filter</Text>
              </Pressable>

              <Pressable
                style={[styles.actionButton, styles.actionButtonSecondary, isDarkMode && styles.darkIconButton]}
                onPress={() => {
                  setShowFilterMenu(false);
                  setShowSortMenu((prev) => !prev);
                }}
              >
                <Ionicons name="swap-vertical-outline" size={16} color={isDarkMode ? '#F2EFF8' : '#2C2B34'} />
                <Text style={[styles.actionText, isDarkMode && styles.darkText]}>Sort</Text>
              </Pressable>
            </View>

            {(showFilterMenu || showSortMenu) && (
              <View style={[styles.dropdownPanel, isDarkMode && styles.darkCard]}>
                <View style={styles.dropdownHeader}>
                  <Text style={[styles.dropdownTitle, isDarkMode && styles.darkText]}>{showFilterMenu ? 'Filter Habits' : 'Sort Habits'}</Text>
                  <Pressable onPress={() => { setShowFilterMenu(false); setShowSortMenu(false); }} accessibilityLabel="Close dropdown">
                    <Ionicons name="close-circle-outline" size={18} color={isDarkMode ? '#AAA4B7' : '#85808D'} />
                  </Pressable>
                </View>
                {(showFilterMenu ? ['all', 'active', 'done'] : ['custom', 'progress', 'streak', 'name']).map((option) => {
                  const selected = showFilterMenu ? filterMode === option : sortMode === option;
                  const label = option === 'all' ? 'All Habits' : option === 'active' ? 'Active Only' : option === 'done' ? 'Completed Only' : option === 'custom' ? 'My Order' : option === 'progress' ? 'Progress' : option === 'streak' ? 'Longest Streak' : 'A to Z';
                  return (
                    <Pressable
                      key={option}
                      style={[styles.dropdownOption, selected && styles.dropdownOptionSelected]}
                      onPress={() => {
                        if (showFilterMenu) setFilterMode(option as 'all' | 'active' | 'done');
                        else setSortMode(option as 'custom' | 'progress' | 'streak' | 'name');
                        setShowFilterMenu(false);
                        setShowSortMenu(false);
                      }}
                    >
                      <Text style={[styles.dropdownOptionText, isDarkMode && styles.darkMutedText, selected && styles.dropdownOptionTextSelected]}>{label}</Text>
                      {selected && <Ionicons name="checkmark" size={16} color={themeColor('#5B42D8')} />}
                    </Pressable>
                  );
                })}
              </View>
            )}

            <View style={[styles.overviewCard, isDarkMode && styles.darkCard]}>
              <View style={styles.overviewHeader}>
                <View>
                  <Text style={[styles.overviewTitle, isDarkMode && styles.darkText]}>Today&apos;s rhythm</Text>
                  <Text style={[styles.overviewSubtitle, isDarkMode && styles.darkMutedText]}>{completedCount} of {habitList.length} habits completed</Text>
                </View>
                <Text style={styles.overviewPercent}>{overallProgress}%</Text>
              </View>
              <View style={[styles.overviewTrack, isDarkMode && styles.darkTrack]}>
                <View style={[styles.overviewFill, { width: `${overallProgress}%` }]} />
              </View>
            </View>

            <View style={styles.statsRow}>
              {[{ label: 'Completed', value: `${completedCount} / ${habitList.length}`, sub: 'Today', color: '#5EC09A', icon: 'checkmark-circle-outline', bg: '#EAFBF2' }, { label: 'Current Streak', value: String(Math.max(0, ...habitList.map((habit) => habit.streak))), sub: 'days', color: '#4DA3FF', icon: 'flame-outline', bg: '#EAF4FF' }, { label: 'Success Rate', value: `${overallProgress}%`, sub: 'This week', color: '#9B6BF2', icon: 'sparkles-outline', bg: '#F2EBFF' }, { label: 'Total Habits', value: String(habitList.length), sub: 'Active', color: '#F2A95B', icon: 'trophy-outline', bg: '#FFF3E7' }].map((card) => (
                <View key={card.label} style={[styles.statCard, isDarkMode && styles.darkCard]}>
                  <View style={[styles.statIconWrap, { backgroundColor: themeColor(card.bg, 'backgroundColor') }]}>
                    <Ionicons name={card.icon as keyof typeof Ionicons.glyphMap} size={18} color={card.color} />
                  </View>
                  <Text style={[styles.statLabel, isDarkMode && styles.darkMutedText]}>{card.label}</Text>
                  <Text style={[styles.statValue, isDarkMode && styles.darkText]}>{card.value}</Text>
                  <Text style={[styles.statSub, isDarkMode && styles.darkMutedText]}>{card.sub}</Text>
                </View>
              ))}
            </View>
          </View>
        }
        ListFooterComponent={
          <View style={styles.container}>
            <View style={styles.dragHint}>
              <Ionicons name="reorder-three-outline" size={18} color={themeColor('#838AA1')} />
              <Text style={styles.dragHintText}>Hold & drag to reorder</Text>
            </View>

            <View style={styles.suggestionCard}>
              <View style={styles.suggestionArt}>
                <View style={styles.robotBadge} />
              </View>

              <View style={styles.suggestionTextWrap}>
                <Text style={styles.suggestionTitle}>Create a new habit in seconds!</Text>
                <Text style={styles.suggestionText}>Let AI suggest habits personalized just for you.</Text>
              </View>

              <Pressable style={styles.primaryButton} onPress={getSuggestion} accessibilityRole="button">
                <Text style={styles.primaryButtonText}>Get Suggestions</Text>
                <Ionicons name="sparkles-outline" size={16} color={themeColor('#FFFFFF')} />
              </Pressable>
              {suggestion ? (
                <View style={[styles.suggestionResult, isDarkMode && styles.darkCard]}>
                  <View style={styles.suggestionResultCopy}>
                    <Text style={[styles.suggestionResultLabel, isDarkMode && styles.darkMutedText]}>Suggested habit</Text>
                    <Text style={[styles.suggestionResultTitle, isDarkMode && styles.darkText]}>{suggestion}</Text>
                  </View>
                  <Pressable style={styles.useSuggestionButton} onPress={() => router.push({ pathname: '/add', params: { habit: suggestion } })} accessibilityRole="button">
                    <Text style={styles.useSuggestionText}>Use This</Text>
                    <Ionicons name="arrow-forward" size={14} color={themeColor('#FFFFFF')} />
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>
        }
      />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: {
    flex: 1,
    backgroundColor: '#F5F4F9',
  },
  darkScreen: {
    backgroundColor: '#111018',
  },
  darkCard: {
    backgroundColor: '#1D1A24',
    borderColor: '#2C2935',
  },
  darkText: {
    color: '#F2EFF8',
  },
  darkMutedText: {
    color: '#AAA4B7',
  },
  darkIconButton: { backgroundColor: '#221E2B' },
  darkProgressPill: { backgroundColor: '#2A2440' },
  darkProgressPillText: { color: '#C9BCFF' },
  darkDeleteButton: { backgroundColor: '#3A2229' },
  darkProgressTrack: { backgroundColor: '#2C2935' },
  darkCheckButtonEmpty: { backgroundColor: '#1D1A24', borderColor: '#4A4458' },
  darkSegmentButton: {
    backgroundColor: '#211D2B',
  },
  draggableList: {
    flex: 1,
    minHeight: 0,
  },
  draggableListContainer: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  container: {
    paddingHorizontal: 18,
    paddingTop: 6,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#1B1A1F',
    letterSpacing: -1,
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  subtitle: {
    fontSize: 16,
    fontWeight: '500',
    color: '#4C5362',
  },
  subtitleIcon: {
    fontSize: 14,
    color: '#8B6EF9',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  iconButtonAlt: {
    width: 38,
    height: 38,
    borderRadius: 18,
    backgroundColor: '#5B42D8',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#5B42D8',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  searchBox: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: '#FFFFFF',
    borderRadius: 13,
    paddingHorizontal: 12,
    marginTop: 12,
    marginBottom: 4,
  },
  searchInput: { flex: 1, minHeight: 42, color: '#302B3B', fontSize: 13, fontWeight: '600' },
  searchResultSummary: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -5, marginBottom: 10, paddingHorizontal: 4 },
  searchResultText: { fontSize: 11, color: '#777282', fontWeight: '700' },
  segmentRow: {
    flexDirection: 'row',
    backgroundColor: '#EFEAF8',
    borderRadius: 18,
    padding: 4,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentButtonActive: {
    backgroundColor: '#5B42D8',
    shadowColor: '#4A36B4',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  segmentText: {
    fontSize: 15,
    color: '#60697C',
    fontWeight: '700',
  },
  segmentTextActive: {
    color: '#FFFFFF',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 14,
  },
  actionButtonPrimary: {
    backgroundColor: '#5B42D8',
  },
  actionButtonSecondary: {
    backgroundColor: '#FFFFFF',
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  actionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2C2B34',
  },
  actionTextPrimary: {
    color: '#FFFFFF',
  },
  dropdownPanel: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E7E1F2',
    shadowColor: '#000000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dropdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingBottom: 6,
  },
  dropdownTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#302B3B',
  },
  dropdownOption: {
    minHeight: 40,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dropdownOptionSelected: {
    backgroundColor: '#F0EBFF',
  },
  dropdownOptionText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3C3A4B',
  },
  dropdownOptionTextSelected: {
    color: '#5B42D8',
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 12,
    gap: 10,
  },
  overviewCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  overviewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  overviewTitle: {
    fontSize: 15,
    fontWeight: '800',
    color: '#252331',
  },
  overviewSubtitle: {
    fontSize: 11,
    color: '#777387',
    fontWeight: '600',
    marginTop: 3,
  },
  overviewPercent: {
    fontSize: 20,
    fontWeight: '800',
    color: '#5B42D8',
  },
  overviewTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#ECEAF1',
    overflow: 'hidden',
  },
  darkTrack: {
    backgroundColor: '#302B3B',
  },
  overviewFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#5B42D8',
  },
  statCard: {
    width: '48%',
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  statIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  statLabel: {
    fontSize: 12,
    color: '#4B5263',
    fontWeight: '700',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#21222D',
    marginTop: 4,
  },
  statSub: {
    marginTop: 2,
    fontSize: 11,
    color: '#5C6272',
  },
  habitList: {
    gap: 10,
  },
  habitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginHorizontal: 14,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 12,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    marginBottom: 10,
  },
  habitCardDragging: {
    backgroundColor: '#F3EEFF',
    shadowColor: '#5B42D8',
    shadowOpacity: 0.14,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  emptyState: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginHorizontal: 14,
    paddingHorizontal: 24,
    paddingVertical: 28,
    marginBottom: 10,
  },
  emptyIconWrap: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1EEFF',
    marginBottom: 12,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#252331',
    marginBottom: 5,
  },
  emptyText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#777387',
    textAlign: 'center',
    fontWeight: '600',
    marginBottom: 16,
  },
  emptyButton: {
    backgroundColor: '#5B42D8',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  habitCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  habitTitleWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    paddingRight: 12,
  },
  habitIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  habitTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: '#1E1D29',
  },
  progressPill: {
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: '#F1EEFF',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteButton: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#FFF0F2',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  progressPillText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#5B42D8',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  metaText: {
    fontSize: 12,
    color: '#555E70',
    fontWeight: '600',
  },
  streakRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  streakText: {
    fontSize: 12,
    color: '#2F2E39',
    fontWeight: '700',
  },
  progressTrack: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#E7E7ED',
    overflow: 'hidden',
    marginBottom: 10,
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
  },
  progressPercentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  progressPercent: {
    fontSize: 12,
    fontWeight: '800',
    color: '#4A5367',
  },
  checkButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkButtonDone: {
    backgroundColor: '#5B42D8',
  },
  checkButtonEmpty: {
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#D8D7DF',
  },
  dragHint: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 18,
  },
  dragHintText: {
    fontSize: 13,
    color: '#7A8195',
    fontWeight: '600',
  },
  suggestionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 16,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 12,
  },
  suggestionArt: {
    width: 62,
    height: 62,
    borderRadius: 18,
    backgroundColor: '#EEF2FF',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  robotBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#5B42D8',
    position: 'absolute',
    bottom: 8,
    left: 14,
  },
  suggestionTextWrap: {
    paddingRight: 0,
  },
  suggestionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1D1C26',
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 12,
    lineHeight: 18,
    color: '#585F70',
    fontWeight: '600',
  },
  primaryButton: {
    backgroundColor: '#5B42D8',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  suggestionResult: {
    borderRadius: 14,
    padding: 12,
    backgroundColor: '#F7F4FF',
    borderWidth: 1,
    borderColor: '#E5DCFF',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  suggestionResultCopy: {
    flex: 1,
  },
  suggestionResultLabel: {
    fontSize: 10,
    color: '#777282',
    fontWeight: '700',
    marginBottom: 3,
  },
  suggestionResultTitle: {
    fontSize: 14,
    color: '#302B3B',
    fontWeight: '800',
  },
  useSuggestionButton: {
    backgroundColor: '#5B42D8',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  useSuggestionText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 12, 24, 0.28)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -5 },
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#201F2A',
    marginBottom: 10,
  },
  optionItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: '#F6F4FA',
    marginBottom: 8,
  },
  optionItemSelected: {
    backgroundColor: '#EEE9FF',
  },
  darkOptionItem: {
    backgroundColor: '#25212E',
  },
  optionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#3C3A4B',
  },
  optionTextSelected: {
    color: '#5B42D8',
  },
});

