// Tokens: the balance and this week's flow, every way to earn with today's progress, everything to
// buy with what is affordable now, and the whole token history. Every number is the server's own
// (GET /api/wallet/summary and /api/wallet/history), so this screen cannot drift from what pays.
// /wallet?section=history opens on the history. Tokens are the students' own: faculty are sent back.
import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import type { WalletHistoryFilter, WalletHistoryItem, WalletSpendRow, WalletSpendStatus } from '@/authentication/authService';
import { StreakFreezeSheet } from '@/components/streak-freeze-sheet';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { loadMoreWalletHistory, loadWallet, loadWalletHistory, reloadWallet, useWallet, useWalletHistory } from '@/hooks/use-wallet';
import { getLocalDateKey } from '@/utils/habit-visibility';
import { EARN_HREFS, EARN_ICONS, earnStatus, goalLine, historyGroups, historyTime, KIND_ICONS, SPEND_ICONS, spendStatus, spendTarget } from '@/utils/wallet';

/** The rows of the history shown before 'See all'. */
const HISTORY_PREVIEW = 5;
const FILTERS: { id: WalletHistoryFilter; label: string }[] = [{ id: 'all', label: 'All' }, { id: 'earned', label: 'Earned' }, { id: 'spent', label: 'Spent' }];
const EMPTY_HISTORY: Record<WalletHistoryFilter, string> = {
  all: 'No token activity yet. Check in a habit to earn your first tokens.',
  earned: 'Nothing earned yet. Check in a habit to earn your first tokens.',
  spent: 'Nothing spent yet.',
};

/**
 * The tabs are one screen already open below this one: go back to them instead of stacking another
 * (router.navigate would push a second copy of the tabs above this screen).
 */
const open = (href: Href) => (String(href).startsWith('/(tabs)') ? router.dismissTo(href) : router.push(href));
const signed = (amount: number) => (amount > 0 ? `+${amount}` : String(amount));

export default function WalletScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const insets = useSafeAreaInsets();
  const { tokens, isFaculty, accountReady } = useAppColorScheme();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const wantsHistory = section === 'history';
  const today = getLocalDateKey();
  // Until the account is loaded its role is not known: nothing is asked for (a faculty account
  // opened at /wallet would only get 403s), and the screen shows that it is loading.
  const student = !isFaculty && accountReady;
  const { summary, status } = useWallet(today, student);
  const history = useWalletHistory(student);
  const [showAll, setShowAll] = useState(wantsHistory);
  const [freezeOpen, setFreezeOpen] = useState(false);
  // Where the history starts, once the rows above it show the summary (for ?section=history).
  const [historyY, setHistoryY] = useState<number | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrolledRef = useRef(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!isFaculty) return;
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  }, [isFaculty]);

  // Back from a screen or sheet where tokens were spent or earned: the numbers load again at once,
  // not at the next live pulse (the first focus is the opening, which loads them already).
  useFocusEffect(useCallback(() => {
    if (focusedRef.current && student) reloadWallet();
    focusedRef.current = true;
  }, [student]));

  useEffect(() => {
    if (!wantsHistory || scrolledRef.current || historyY === null) return;
    scrolledRef.current = true;
    scrollRef.current?.scrollTo({ y: historyY, animated: true });
  }, [wantsHistory, historyY]);

  if (isFaculty) return null;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/(tabs)'));
  const openSpend = (row: WalletSpendRow) => {
    const target = spendTarget(row.target);
    if (target === 'freeze') setFreezeOpen(true);
    else if (target) open(target);
  };
  const pickFilter = (filter: WalletHistoryFilter) => void loadWalletHistory(filter);
  const showLess = () => {
    setShowAll(false);
    if (history.filter !== 'all') void loadWalletHistory('all');
  };

  const balance = summary?.tokens ?? (accountReady ? tokens : '…');
  const statusStyle: Record<WalletSpendStatus, object> = { owned: styles.statusOwned, ready: styles.statusReady, short: styles.statusShort, locked: styles.statusLocked, full: styles.statusFull };
  const visibleHistory: WalletHistoryItem[] = showAll ? history.items : history.items.slice(0, HISTORY_PREVIEW);

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <ScrollView ref={scrollRef} contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={22} color={themeColor('#352B88')} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>YOUR WALLET</Text>
              <Text style={styles.title}>Tokens</Text>
            </View>
          </View>

          <View style={styles.balanceCard}>
            <View style={styles.balanceTop}>
              <View style={styles.coin}><Ionicons name="star" size={24} color="#FFF5A5" /></View>
              <View style={styles.balanceCopy}>
                <Text style={styles.balanceValue} numberOfLines={1} accessibilityLabel={`${balance} tokens`}>{balance}</Text>
                <Text style={styles.balanceUnit}>tokens</Text>
              </View>
            </View>
            {summary ? (
              <View style={styles.balanceLines}>
                <Text style={styles.balanceLine}>{`This week: +${summary.week.earned} earned · -${Math.abs(summary.week.spent)} spent`}</Text>
                <Text style={styles.balanceLine}>{`You can still earn up to ${summary.today.canStillEarn} today`}</Text>
              </View>
            ) : null}
            {summary && summary.balance < 0 ? (
              <View style={styles.debtNote}>
                <Ionicons name="information-circle" size={15} color="#FFE27A" />
                <Text style={styles.debtText}>{`You undid a check-in after spending. Your next ${-summary.balance} tokens pay this back.`}</Text>
              </View>
            ) : null}
          </View>

          {summary && summary.today.date !== today ? (
            <Text style={styles.dayNote}>{`Showing your HabitAI day, ${summary.today.date}. Your phone is on another day because its time zone changed.`}</Text>
          ) : null}

          {summary?.nextGoal ? (
            <View style={styles.goalRow}>
              <Ionicons name="flag-outline" size={14} color={themeColor('#5B42D8')} />
              <Text style={styles.goalText}>{goalLine(summary.nextGoal)}</Text>
            </View>
          ) : null}

          {!summary ? (
            <View style={styles.card}>
              {status === 'error' ? (
                <Pressable style={styles.retry} onPress={() => void loadWallet(today)} accessibilityRole="button">
                  <Ionicons name="refresh" size={15} color={themeColor('#5B42D8')} />
                  <Text style={styles.retryText}>Could not load your tokens. Tap to retry.</Text>
                </Pressable>
              ) : (
                <View style={styles.loading}><ActivityIndicator color="#5B42D8" /><Text style={styles.loadingText}>Counting your tokens...</Text></View>
              )}
            </View>
          ) : (
            <>
              <Text style={styles.sectionTitle}>Ways to earn</Text>
              <View style={styles.card}>
                {summary.earn.map((row, index) => {
                  const href = EARN_HREFS[row.id];
                  const progress = earnStatus(row.id, summary);
                  return (
                    <View key={row.id} style={[styles.row, index > 0 && styles.rowDivider]}>
                      <View style={[styles.rowIcon, styles.earnIcon]}><Ionicons name={EARN_ICONS[row.id] ?? 'star'} size={18} color={themeColor('#2E9D5C')} /></View>
                      <View style={styles.rowCopy}>
                        <View style={styles.rowTitleLine}>
                          <Text style={styles.rowTitle}>{row.title}</Text>
                          <View style={styles.amountPill}><Text style={styles.amountText}>{row.amount}</Text></View>
                        </View>
                        {progress ? <Text style={styles.rowStatus}>{progress}</Text> : null}
                        <Text style={styles.rowDetail}>{row.detail}</Text>
                      </View>
                      {href ? (
                        <Pressable style={({ pressed }) => [styles.goButton, pressed && styles.pressed]} onPress={() => open(href)} accessibilityRole="button" accessibilityLabel={`${row.title}: Go`}>
                          <Text style={styles.goText}>Go</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              <Text style={styles.sectionTitle}>Ways to spend</Text>
              <View style={styles.card}>
                {summary.spend.map((row, index) => {
                  const label = spendStatus(row, summary.tokens);
                  const cost = row.from ? `from ${row.cost}` : String(row.cost);
                  return (
                    <Pressable
                      key={row.id}
                      style={({ pressed }) => [styles.row, index > 0 && styles.rowDivider, pressed && styles.pressed]}
                      onPress={() => openSpend(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`${row.title}, ${cost} tokens: ${label}`}
                    >
                      <View style={[styles.rowIcon, styles.spendIcon]}><Ionicons name={SPEND_ICONS[row.id] ?? 'star'} size={18} color={themeColor('#5B42D8')} /></View>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{row.title}</Text>
                        <Text style={styles.rowDetail}>{row.detail}</Text>
                      </View>
                      <View style={styles.spendSide}>
                        <View style={styles.costPill}>
                          <Ionicons name="star" size={11} color={themeColor('#E6A617')} />
                          <Text style={styles.costText}>{cost}</Text>
                        </View>
                        <Text style={[styles.statusText, statusStyle[row.status]]}>{label}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <View onLayout={(event) => { if (summary) setHistoryY(event.nativeEvent.layout.y); }}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>History</Text>
              {showAll ? (
                <Pressable style={styles.linkButton} onPress={showLess} accessibilityRole="button"><Text style={styles.linkText}>Show less</Text></Pressable>
              ) : history.items.length > 0 ? (
                <Pressable style={styles.linkButton} onPress={() => setShowAll(true)} accessibilityRole="button"><Text style={styles.linkText}>See all</Text></Pressable>
              ) : null}
            </View>
            {showAll ? (
              <View style={styles.chips} accessibilityRole="tablist">
                {FILTERS.map((filter) => {
                  const selected = history.filter === filter.id;
                  return (
                    <Pressable key={filter.id} style={[styles.chip, selected && styles.chipOn]} onPress={() => pickFilter(filter.id)} accessibilityRole="tab" accessibilityState={{ selected }}>
                      <Text style={[styles.chipText, selected && styles.chipTextOn]}>{filter.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {showAll && history.totals ? (
              <Text style={styles.totals}>{`In all: +${history.totals.earned} earned · -${Math.abs(history.totals.spent)} spent`}</Text>
            ) : null}
            <View style={styles.card}>
              {history.status === 'loading' || history.status === 'idle' ? (
                <View style={styles.loading}><ActivityIndicator color="#5B42D8" /></View>
              ) : history.status === 'error' ? (
                <Pressable style={styles.retry} onPress={() => pickFilter(history.filter)} accessibilityRole="button">
                  <Ionicons name="refresh" size={15} color={themeColor('#5B42D8')} />
                  <Text style={styles.retryText}>Could not load your history. Tap to retry.</Text>
                </Pressable>
              ) : visibleHistory.length === 0 ? (
                <Text style={styles.emptyText}>{EMPTY_HISTORY[history.filter]}</Text>
              ) : (
                historyGroups(visibleHistory).map((group) => (
                  <View key={group.key}>
                    <Text style={styles.groupTitle}>{group.title}</Text>
                    {group.items.map((item) => (
                      <View key={item.id} style={styles.historyRow}>
                        <View style={[styles.historyIcon, item.amount < 0 ? styles.spentIcon : styles.earnedIcon]}>
                          <Ionicons name={KIND_ICONS[item.kind] ?? 'ellipse'} size={15} color={themeColor(item.amount < 0 ? '#D16A5D' : '#249B6B')} />
                        </View>
                        <View style={styles.rowCopy}>
                          <Text style={styles.historyLabel} numberOfLines={2}>{item.label}</Text>
                          <Text style={styles.historyTime}>{new Date(historyTime(item)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text>
                        </View>
                        <Text style={[styles.historyAmount, item.amount < 0 && styles.spentAmount]}>{signed(item.amount)}</Text>
                      </View>
                    ))}
                  </View>
                ))
              )}
            </View>
            {showAll && history.nextCursor && history.status === 'ready' ? (
              <Pressable style={[styles.moreButton, history.loadingMore && styles.busy]} disabled={history.loadingMore} onPress={() => void loadMoreWalletHistory()} accessibilityRole="button">
                {history.loadingMore ? <ActivityIndicator color="#5B42D8" size="small" /> : null}
                <Text style={styles.moreText}>{history.loadingMore ? 'Loading...' : 'Load more'}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </ScrollView>
      <StreakFreezeSheet visible={freezeOpen} onClose={() => setFreezeOpen(false)} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  content: { paddingTop: 8 },
  container: { width: '100%', maxWidth: 720, alignSelf: 'center', paddingHorizontal: 16, gap: 12 },
  pressed: { opacity: 0.85 },
  busy: { opacity: 0.7 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 2 },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrow: { color: '#5B42D8', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#1F1C26', fontSize: 26, fontWeight: '900' },

  balanceCard: { backgroundColor: '#5B42D8', borderRadius: 22, padding: 16, gap: 10, overflow: 'hidden' },
  balanceTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  coin: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F5A91B', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFD95B' },
  balanceCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'baseline', gap: 6 },
  balanceValue: { flexShrink: 1, color: '#FFFFFF', fontSize: 42, lineHeight: 48, fontWeight: '900', letterSpacing: -1 },
  balanceUnit: { color: '#DCD5FF', fontSize: 14, fontWeight: '800' },
  balanceLines: { gap: 3 },
  balanceLine: { color: '#F3EFFF', fontSize: 13, fontWeight: '700' },
  debtNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: 'rgba(255,255,255,0.14)', borderRadius: 12, padding: 10 },
  debtText: { flex: 1, color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '700' },
  dayNote: { color: '#6A6573', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  goalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#EFEBFF', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 9 },
  goalText: { flex: 1, color: '#4C37B8', fontSize: 12, fontWeight: '800' },

  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: '#1F1C26', fontSize: 17, fontWeight: '900', marginTop: 6 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 4, borderWidth: 1, borderColor: '#ECEBFA' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11 },
  rowDivider: { borderTopWidth: 1, borderTopColor: '#F0EFF7' },
  rowIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  earnIcon: { backgroundColor: '#E2F5EA' },
  spendIcon: { backgroundColor: '#EFEBFF' },
  rowCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  rowTitle: { flexShrink: 1, color: '#1F1C26', fontSize: 14, fontWeight: '900' },
  amountPill: { backgroundColor: '#E2F5EA', borderRadius: 9, paddingHorizontal: 7, paddingVertical: 2 },
  amountText: { color: '#1F7A4D', fontSize: 11, fontWeight: '900' },
  rowStatus: { color: '#4C37B8', fontSize: 12, fontWeight: '800' },
  rowDetail: { color: '#6A6573', fontSize: 11, lineHeight: 15, fontWeight: '600' },
  goButton: { minWidth: 48, minHeight: 36, borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  goText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  spendSide: { alignItems: 'flex-end', gap: 5, flexShrink: 0 },
  costPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#FFF4D9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  costText: { color: '#7A5410', fontSize: 11, fontWeight: '900' },
  statusText: { fontSize: 11, fontWeight: '900' },
  statusOwned: { color: '#2E7D50' },
  statusReady: { color: '#5B42D8' },
  statusShort: { color: '#8A6A12' },
  statusLocked: { color: '#8A8492' },
  statusFull: { color: '#2F86D8' },

  linkButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 6, marginTop: 6 },
  linkText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { minHeight: 36, paddingHorizontal: 14, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4DDF4', alignItems: 'center', justifyContent: 'center' },
  chipOn: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  chipText: { color: '#5B42D8', fontSize: 13, fontWeight: '800' },
  chipTextOn: { color: '#FFFFFF' },
  totals: { color: '#6A6573', fontSize: 12, fontWeight: '700', marginTop: 8 },
  groupTitle: { color: '#8A7BD5', fontSize: 11, fontWeight: '900', letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 10, marginBottom: 2 },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  historyIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  earnedIcon: { backgroundColor: '#E0F8EC' },
  spentIcon: { backgroundColor: '#FDE8E4' },
  historyLabel: { color: '#1F1C26', fontSize: 13, fontWeight: '800' },
  historyTime: { color: '#8A8492', fontSize: 11, fontWeight: '600' },
  historyAmount: { color: '#249B6B', fontSize: 14, fontWeight: '900' },
  spentAmount: { color: '#D16A5D' },
  emptyText: { color: '#6A6573', fontSize: 12, lineHeight: 17, textAlign: 'center', paddingVertical: 18 },
  moreButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 44, marginTop: 10, borderRadius: 14, borderWidth: 1, borderColor: '#D9D2F5', backgroundColor: '#FFFFFF' },
  moreText: { color: '#5B42D8', fontSize: 13, fontWeight: '900' },

  loading: { alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 22 },
  loadingText: { color: '#6A6573', fontSize: 12, fontWeight: '700' },
  retry: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48 },
  retryText: { color: '#5B42D8', fontSize: 12, fontWeight: '800', flexShrink: 1 },
}, {
  balanceCard: { backgroundColor: '#3A2C8F' },
  goalRow: { backgroundColor: '#2A2440' },
});
