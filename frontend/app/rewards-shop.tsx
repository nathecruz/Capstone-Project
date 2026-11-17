// The Rewards Shop: one place to spend tokens, for students and faculty. Most rewards help with
// school, work or health (an AI study or work plan, a practice quiz, a weekly report, a certificate,
// guided wellness breaks, a Streak Freeze); the looks (themes, frames, a title, Habi) are here too.
// A plan, quiz, report or certificate is made when it is redeemed and kept in My Rewards; the rest
// are kept for good and used from their card. Prices and names come from the server's catalog.
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { redeemReward, type ServerReward } from '@/authentication';
import { RewardItemView } from '@/components/reward-item-view';
import { FrameSheet, ShowcaseSheet, ThemeSheet, TitleSheet } from '@/components/reward-sheets';
import { StreakFreezeSheet } from '@/components/streak-freeze-sheet';
import { useAppDialog } from '@/components/ui/app-dialog';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { loadRewards, markRewardOwned, useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { deleteRewardItem, getRewardItems, redeemMadeReward, type RewardItem, type RewardRequest } from '@/utils/rewards-client';

type Kind = 'made' | 'permanent' | 'freeze' | 'link';
type Entry = { id: string; title: string; detail: string; cost: number; kind: Kind; icon: keyof typeof Ionicons.glyphMap; color: string; costLabel?: string };
type UseSheet = 'theme' | 'title' | 'frame' | 'showcase' | 'freeze';

const LOOKS: Record<string, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  'study-planner': { icon: 'calendar-outline', color: '#3564D8' },
  'practice-quiz': { icon: 'school-outline', color: '#5B42D8' },
  'weekly-report': { icon: 'analytics-outline', color: '#2F9E6E' },
  certificate: { icon: 'ribbon-outline', color: '#C98A0E' },
  'wellness-pack': { icon: 'leaf-outline', color: '#2F9E6E' },
  'premium-theme': { icon: 'color-palette-outline', color: '#7C64E6' },
  'profile-frames': { icon: 'person-circle-outline', color: '#C98A0E' },
  'custom-title': { icon: 'pricetag-outline', color: '#C2549B' },
  'buddy-showcase': { icon: 'paw-outline', color: '#2E9D5C' },
};
/** What a reward kept for good opens. */
const USE: Record<string, UseSheet | 'wellness'> = { 'premium-theme': 'theme', 'custom-title': 'title', 'profile-frames': 'frame', 'buddy-showcase': 'showcase', 'wellness-pack': 'wellness' };
const SECTIONS: { id: string; title: string; subtitle: string; ids: string[] }[] = [
  { id: 'study', title: 'Study and work', subtitle: 'Plans, practice and reviews made for you by the AI.', ids: ['study-planner', 'practice-quiz', 'weekly-report', 'coach'] },
  { id: 'health', title: 'Health and focus', subtitle: 'Breaks that rest body and mind, and a day off for your streak.', ids: ['wellness-pack', 'streak-freeze'] },
  { id: 'recognition', title: 'Recognition', subtitle: 'Proof of the work you put in.', ids: ['certificate'] },
  { id: 'looks', title: 'Make it yours', subtitle: 'Colours, a frame, a title and Habi.', ids: ['premium-theme', 'profile-frames', 'custom-title', 'buddy-showcase', 'buddy-shop'] },
];
const KIND_LABEL: Record<RewardItem['rewardId'], string> = { 'study-planner': 'Plan', 'practice-quiz': 'Quiz', 'weekly-report': 'Weekly report', certificate: 'Certificate' };
const MINUTE_CHOICES = [30, 60, 90, 120];

const dateKeyOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const inDays = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return dateKeyOf(date);
};
const shortDate = (time: number) => new Date(time).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function RewardsShopScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const insets = useSafeAreaInsets();
  const { tokens, applyWallet, isFaculty, streakFreeze } = useAppColorScheme();
  const catalog = useRewards();
  const params = useLocalSearchParams<{ reward?: string; tab?: string }>();
  const [tab, setTab] = useState<'shop' | 'mine'>(params.tab === 'mine' ? 'mine' : 'shop');
  const [items, setItems] = useState<RewardItem[] | null>(null);
  const [itemsFailed, setItemsFailed] = useState(false);
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const [making, setMaking] = useState<Entry | null>(null);
  const [viewing, setViewing] = useState<RewardItem | null>(null);
  const [sheet, setSheet] = useState<UseSheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [linkHandled, setLinkHandled] = useState(false);

  useEffect(() => {
    let active = true;
    void getRewardItems().then((result) => {
      if (!active) return;
      setItems(result ?? []);
      setItemsFailed(result === null);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timeout);
  }, [toast]);

  // The catalog as the shop shows it: the server's names, prices and descriptions.
  const fromServer = (reward: ServerReward): Entry => ({ id: reward.id, title: reward.name, detail: reward.description, cost: reward.cost, kind: reward.made ? 'made' : 'permanent', ...(LOOKS[reward.id] ?? { icon: 'gift-outline', color: '#5B42D8' }) });
  const extras: Record<string, Entry> = {
    coach: { id: 'coach', title: 'AI Coach', detail: 'Ask the AI Coach on your Profile for advice from your own habits.', cost: 10, costLabel: '10 tokens an answer', kind: 'link', icon: 'chatbubbles-outline', color: '#C2549B' },
    'streak-freeze': { id: 'streak-freeze', title: 'Streak Freeze', detail: `Covers a day you miss, so your streak stays. ${streakFreeze?.available ?? 0} of ${streakFreeze?.max ?? 2} held.`, cost: streakFreeze?.cost ?? 30, kind: 'freeze', icon: 'snow-outline', color: '#2F86D8' },
    'buddy-shop': { id: 'buddy-shop', title: "Habi's shop", detail: 'Hats, items and rooms for your Habit Buddy.', cost: 40, costLabel: 'From 40 tokens', kind: 'link', icon: 'shirt-outline', color: '#C98A0E' },
  };
  const entryOf = (id: string): Entry | undefined => {
    if (extras[id]) return extras[id];
    const reward = catalog.rewards.find((entry) => entry.id === id);
    return reward ? fromServer(reward) : undefined;
  };
  const sections = SECTIONS.map((section) => ({ ...section, entries: section.ids.map(entryOf).filter((entry): entry is Entry => Boolean(entry)) })).filter((section) => section.entries.length);
  const owned = (entry: Entry) => entry.kind === 'permanent' && catalog.owns(entry.id);

  const openKept = (entry: Entry) => {
    const target = USE[entry.id];
    if (target === 'wellness') router.push('/wellness');
    else if (target) setSheet(target);
  };
  const open = (entry: Entry) => {
    if (entry.kind === 'link') router.push(entry.id === 'coach' ? '/(tabs)/profile' : '/buddy');
    else if (entry.kind === 'freeze') setSheet('freeze');
    else if (owned(entry)) openKept(entry);
    else if (tokens < entry.cost) setToast(`${entry.cost - tokens} more tokens for ${entry.title}. Check in your habits to earn them.`);
    else if (entry.kind === 'made') setMaking(entry);
    else setConfirm(entry);
  };

  // /rewards-shop?reward=<id> (from the Tokens screen or the Wellness screen) opens that reward once the catalog is in.
  if (params.reward && !linkHandled && catalog.status === 'ready') {
    setLinkHandled(true);
    const entry = entryOf(params.reward);
    if (entry) open(entry);
  }

  const buyKept = async () => {
    const entry = confirm;
    if (!entry || busy) return;
    setBusy(true);
    const result = await redeemReward({ id: entry.id, title: entry.title, cost: entry.cost });
    setBusy(false);
    setConfirm(null);
    if (!result.ok) {
      setToast(result.message || 'Redeem failed. Your tokens were not spent.');
      return;
    }
    if ('tokens' in result) applyWallet(result as { tokens?: number; tokenHistory?: object[]; points?: number });
    markRewardOwned(entry.id);
    setToast(`${entry.title} is yours!`);
    openKept(entry);
  };

  const made = (item: RewardItem) => {
    setItems((current) => [item, ...(current ?? [])]);
    setMaking(null);
    setTab('mine');
    setViewing(item);
  };

  const remove = (item: RewardItem) => {
    showAlert('Delete this reward?', item.rewardId === 'certificate' ? 'Its link will stop working for everyone. This cannot be undone.' : 'It will be removed from My Rewards. This cannot be undone.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void deleteRewardItem(item.id).then((deleted) => {
            if (!deleted) {
              setToast('Could not delete it. Try again.');
              return;
            }
            setItems((current) => (current ?? []).filter((entry) => entry.id !== item.id));
            setViewing(null);
            setToast('Deleted.');
          });
        },
      },
    ]);
  };

  const keptForGood = catalog.rewards.filter((reward) => reward.permanent && catalog.owns(reward.id)).map(fromServer);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back"><Ionicons name="chevron-back" size={24} color={themeColor('#352B88')} /></Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Rewards Shop</Text>
            <Text style={styles.subtitle}>Spend your tokens on things that help with school, work and health.</Text>
          </View>
        </View>

        <View style={styles.balance}>
          <Ionicons name="star" size={22} color={themeColor('#F2B632')} />
          <View style={styles.balanceCopy}>
            <Text style={styles.balanceValue}>{tokens} tokens</Text>
            <Text style={styles.balanceHint}>Check in your habits to earn more.</Text>
          </View>
          <Pressable onPress={() => router.push('/wallet')} accessibilityRole="button" hitSlop={8}><Text style={styles.link}>How to earn</Text></Pressable>
        </View>

        <View style={styles.tabs} accessibilityRole="tablist">
          {([['shop', 'Shop'], ['mine', 'My Rewards']] as const).map(([id, label]) => (
            <Pressable key={id} style={[styles.tab, tab === id && styles.tabActive]} onPress={() => setTab(id)} accessibilityRole="tab" accessibilityState={{ selected: tab === id }}>
              <Text style={[styles.tabText, tab === id && styles.tabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {tab === 'shop' ? (
          <>
            {catalog.status === 'error' && (
              <Pressable style={styles.notice} onPress={() => void loadRewards()} accessibilityRole="button">
                <Ionicons name="refresh" size={15} color={themeColor('#5B42D8')} />
                <Text style={styles.noticeText}>Could not load the rewards. Tap to try again.</Text>
              </Pressable>
            )}
            {catalog.status !== 'ready' && catalog.status !== 'error' ? <ActivityIndicator color={themeColor('#5B42D8')} style={styles.loading} /> : null}
            {sections.map((section) => (
              <View key={section.id} style={styles.section}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionSubtitle}>{section.subtitle}</Text>
                {section.entries.map((entry) => {
                  const isOwned = owned(entry);
                  const full = entry.kind === 'freeze' && (streakFreeze?.available ?? 0) >= (streakFreeze?.max ?? 2);
                  const short = entry.kind !== 'link' && !isOwned && entry.kind !== 'freeze' && tokens < entry.cost;
                  const action = isOwned ? 'Use' : entry.kind === 'link' ? 'Open' : entry.kind === 'freeze' ? (full ? 'View' : 'Get') : short ? `${entry.cost - tokens} more` : 'Redeem';
                  return (
                    <View key={entry.id} style={styles.card}>
                      <View style={[styles.icon, { backgroundColor: `${entry.color}1F` }]}><Ionicons name={entry.icon} size={22} color={themeColor(entry.color)} /></View>
                      <View style={styles.cardCopy}>
                        <Text style={styles.cardTitle}>{entry.title}</Text>
                        <Text style={styles.cardDetail}>{entry.detail}</Text>
                        <View style={styles.costRow}>
                          {isOwned ? (
                            <Text style={styles.ownedText}>Yours to keep</Text>
                          ) : (
                            <>
                              <Ionicons name="star" size={12} color={themeColor('#E6A617')} />
                              <Text style={styles.costText}>{entry.costLabel ?? `${entry.cost} tokens${entry.kind === 'made' ? ' each time' : ''}`}</Text>
                            </>
                          )}
                        </View>
                      </View>
                      <Pressable
                        style={({ pressed }) => [styles.action, isOwned && styles.actionOwned, short && styles.actionShort, pressed && styles.pressed]}
                        onPress={() => open(entry)}
                        accessibilityRole="button"
                        accessibilityLabel={isOwned ? `Use ${entry.title}` : short ? `${entry.title}: ${entry.cost - tokens} more tokens needed` : `${action} ${entry.title}${entry.kind === 'link' ? '' : ` for ${entry.cost} tokens`}`}
                      >
                        <Text style={[styles.actionText, (isOwned || short) && styles.actionTextQuiet]}>{action}</Text>
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            ))}
          </>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Made for you</Text>
              <Text style={styles.sectionSubtitle}>Your plans, quizzes, reports and certificates. Open one any time.</Text>
              {items === null ? <ActivityIndicator color={themeColor('#5B42D8')} style={styles.loading} /> : null}
              {itemsFailed ? <Text style={styles.empty}>Could not load them. Open this screen again to retry.</Text> : null}
              {items?.length === 0 && !itemsFailed ? <Text style={styles.empty}>Nothing yet. Redeem a plan, a quiz, a report or a certificate in the Shop.</Text> : null}
              {items?.map((item) => (
                <Pressable key={item.id} style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]} onPress={() => setViewing(item)} accessibilityRole="button" accessibilityLabel={`Open ${KIND_LABEL[item.rewardId]}: ${item.title}`}>
                  <View style={[styles.iconSmall, { backgroundColor: `${LOOKS[item.rewardId].color}1F` }]}><Ionicons name={LOOKS[item.rewardId].icon} size={18} color={themeColor(LOOKS[item.rewardId].color)} /></View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.itemTitle} numberOfLines={2}>{item.title}</Text>
                    <Text style={styles.cardDetail}>{KIND_LABEL[item.rewardId]} · {shortDate(item.createdAt)}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={themeColor('#9A94A4')} />
                </Pressable>
              ))}
            </View>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Kept for good</Text>
              {keptForGood.length === 0 ? <Text style={styles.empty}>Rewards you keep, like the Wellness Pack or Premium Themes, show here.</Text> : null}
              {keptForGood.map((entry) => (
                <Pressable key={entry.id} style={({ pressed }) => [styles.itemRow, pressed && styles.pressed]} onPress={() => openKept(entry)} accessibilityRole="button" accessibilityLabel={`Use ${entry.title}`}>
                  <View style={[styles.iconSmall, { backgroundColor: `${entry.color}1F` }]}><Ionicons name={entry.icon} size={18} color={themeColor(entry.color)} /></View>
                  <Text style={[styles.itemTitle, styles.cardCopy]}>{entry.title}</Text>
                  <Text style={styles.link}>Use</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {Boolean(toast) && (
        <View style={[styles.toast, { bottom: 20 + insets.bottom }]} pointerEvents="none" accessibilityLiveRegion="polite">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      )}

      {/* A reward kept for good: what it costs against the balance. */}
      <Modal visible={Boolean(confirm)} transparent animationType="fade" onRequestClose={() => setConfirm(null)}>
        <View style={styles.overlay}>
          {confirm && (
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle}>Redeem {confirm.title}?</Text>
              <Text style={styles.cardDetail}>{confirm.detail}</Text>
              <Text style={styles.math}>{tokens} − {confirm.cost} = {tokens - confirm.cost} tokens left. Yours to keep.</Text>
              <Pressable style={({ pressed }) => [styles.primary, (busy || pressed) && styles.pressed]} onPress={() => void buyKept()} disabled={busy} accessibilityRole="button">
                <Text style={styles.primaryText}>{busy ? 'Redeeming…' : `Redeem for ${confirm.cost}`}</Text>
              </Pressable>
              <Pressable style={styles.cancel} onPress={() => setConfirm(null)} accessibilityRole="button"><Text style={styles.link}>Cancel</Text></Pressable>
            </View>
          )}
        </View>
      </Modal>

      {making && <MakeSheet entry={making} tokens={tokens} isFaculty={isFaculty} onClose={() => setMaking(null)} onMade={made} onWallet={applyWallet} />}

      {/* A made reward, opened from My Rewards. */}
      <Modal visible={Boolean(viewing)} animationType="slide" onRequestClose={() => setViewing(null)}>
        <SafeAreaView style={styles.screen}>
          {viewing && (
            <ScrollView contentContainerStyle={[styles.content, { paddingBottom: 28 + insets.bottom }]}>
              <View style={styles.header}>
                <Pressable onPress={() => setViewing(null)} style={styles.back} accessibilityRole="button" accessibilityLabel="Close"><Ionicons name="close" size={22} color={themeColor('#352B88')} /></Pressable>
                <View style={styles.headerCopy}>
                  <Text style={styles.eyebrow}>{KIND_LABEL[viewing.rewardId].toUpperCase()} · {shortDate(viewing.createdAt)}</Text>
                  <Text style={styles.viewTitle}>{viewing.title}</Text>
                </View>
              </View>
              <RewardItemView item={viewing} isFaculty={isFaculty} />
              <Pressable style={styles.deleteRow} onPress={() => remove(viewing)} accessibilityRole="button">
                <Ionicons name="trash-outline" size={16} color={themeColor('#C2412F')} />
                <Text style={styles.deleteText}>Delete</Text>
              </Pressable>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <StreakFreezeSheet visible={sheet === 'freeze'} onClose={() => setSheet(null)} />
      <ThemeSheet visible={sheet === 'theme'} onClose={() => setSheet(null)} />
      <FrameSheet visible={sheet === 'frame'} onClose={() => setSheet(null)} />
      <ShowcaseSheet visible={sheet === 'showcase'} onClose={() => setSheet(null)} />
      {sheet === 'title' && <TitleSheet current={catalog.title} onClose={() => setSheet(null)} onSaved={(title) => setToast(title ? `Your title is now "${title}".` : 'Title removed.')} />}
    </SafeAreaView>
  );
}

/**
 * What a made reward is made from, then redeeming it: a task and a due date for a plan, a topic for
 * a quiz, nothing more for a report or a certificate. The server charges, makes it and keeps it.
 */
function MakeSheet({ entry, tokens, isFaculty, onClose, onMade, onWallet }: { entry: Entry; tokens: number; isFaculty: boolean; onClose: () => void; onMade: (item: RewardItem) => void; onWallet: (wallet: { tokens?: number; tokenHistory?: object[] }) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [task, setTask] = useState('');
  const [topic, setTopic] = useState('');
  const [dueDate, setDueDate] = useState(() => inDays(7));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [minutes, setMinutes] = useState(60);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request: RewardRequest | null = entry.id === 'study-planner'
    ? (task.trim().length >= 3 ? { rewardId: 'study-planner', task: task.trim(), dueDate, minutesPerDay: minutes } : null)
    : entry.id === 'practice-quiz'
      ? (topic.trim().length >= 3 ? { rewardId: 'practice-quiz', topic: topic.trim() } : null)
      : entry.id === 'weekly-report' ? { rewardId: 'weekly-report' } : { rewardId: 'certificate' };
  const intro: Record<string, string> = {
    'study-planner': isFaculty ? 'Grading, lesson preparation, research or any big task: the AI splits it into a step for each day until it is due.' : 'An exam, a project or any big task: the AI splits it into a step for each day until it is due.',
    'practice-quiz': isFaculty ? 'Five multiple-choice questions on a lesson topic, with the answers explained, to use in class.' : 'Five multiple-choice questions on what you are studying, with the answers explained.',
    'weekly-report': 'The AI reads your last 7 days of check-ins: what went well, what slipped, and three steps for the week ahead.',
    certificate: 'A certificate with your check-ins, active days and streak. Anyone with its link can open it to check it, until you delete it.',
  };

  const submit = async () => {
    if (!request || busy) return;
    setBusy(true);
    setError('');
    const result = await redeemMadeReward(request);
    setBusy(false);
    if (result.ok) {
      onWallet(result.wallet);
      onMade(result.item);
      return;
    }
    if (result.wallet) onWallet(result.wallet);
    setError(result.message);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlayBottom}>
        <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} accessible={false} />
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetContent}>
            <View style={styles.sheetHeader}>
              <View style={[styles.icon, { backgroundColor: `${entry.color}1F` }]}><Ionicons name={entry.icon} size={22} color={themeColor(entry.color)} /></View>
              <Text style={[styles.dialogTitle, styles.cardCopy]}>{entry.title}</Text>
              <Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Close" hitSlop={10}><Ionicons name="close" size={22} color={themeColor('#6A6580')} /></Pressable>
            </View>
            <Text style={styles.cardDetail}>{intro[entry.id]}</Text>

            {entry.id === 'study-planner' && (
              <>
                <Text style={styles.label}>What is it?</Text>
                <TextInput value={task} onChangeText={setTask} placeholder={isFaculty ? 'e.g., Grade 40 lab reports' : 'e.g., Biology midterm exam'} placeholderTextColor="#A19AAA" style={styles.input} maxLength={120} accessibilityLabel="What is it?" />
                <Text style={styles.label}>Due date</Text>
                {Platform.OS === 'web' ? (
                  <input type="date" aria-label="Due date" value={dueDate} min={inDays(0)} max={inDays(60)} onChange={(event) => { const value = event.currentTarget.value; if (value) setDueDate(value); }} style={{ height: 46, borderRadius: 12, border: '1.5px solid #E6E2F0', padding: '0 12px', fontSize: 16 }} />
                ) : (
                  <Pressable style={styles.input} onPress={() => setPickerOpen(true)} accessibilityRole="button" accessibilityLabel={`Due date ${dueDate}. Change`}>
                    <Text style={styles.inputText}>{new Date(`${dueDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</Text>
                  </Pressable>
                )}
                {pickerOpen && Platform.OS !== 'web' && (
                  <DateTimePicker value={new Date(`${dueDate}T00:00:00`)} mode="date" minimumDate={new Date()} maximumDate={new Date(`${inDays(60)}T00:00:00`)} onChange={(_event, date) => { setPickerOpen(false); if (date) setDueDate(dateKeyOf(date)); }} />
                )}
                <Text style={styles.label}>Time each day</Text>
                <View style={styles.chips}>
                  {MINUTE_CHOICES.map((choice) => (
                    <Pressable key={choice} style={[styles.chip, minutes === choice && styles.chipActive]} onPress={() => setMinutes(choice)} accessibilityRole="radio" accessibilityState={{ checked: minutes === choice }}>
                      <Text style={[styles.chipText, minutes === choice && styles.chipTextActive]}>{choice} min</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            {entry.id === 'practice-quiz' && (
              <>
                <Text style={styles.label}>Topic</Text>
                <TextInput value={topic} onChangeText={setTopic} placeholder="e.g., Photosynthesis, Fractions, Philippine history" placeholderTextColor="#A19AAA" style={styles.input} maxLength={120} accessibilityLabel="Topic" />
              </>
            )}

            {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            <Text style={styles.math}>{tokens} − {entry.cost} = {tokens - entry.cost} tokens left. If it cannot be made, your tokens come back.</Text>
            <Pressable style={({ pressed }) => [styles.primary, (!request || busy) && styles.disabled, pressed && styles.pressed]} onPress={() => void submit()} disabled={!request || busy} accessibilityRole="button" accessibilityLabel={`Redeem for ${entry.cost} tokens`} accessibilityState={{ disabled: !request || busy, busy }}>
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Redeem for {entry.cost} tokens</Text>}
            </Pressable>
            {busy ? <Text style={styles.cardDetail}>Making it… this can take up to a minute.</Text> : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F7F8FF' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 24, fontWeight: '900', color: '#24212D' },
  subtitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  eyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1, color: '#7A7488' },
  viewTitle: { fontSize: 20, fontWeight: '900', color: '#24212D' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  balanceCopy: { flex: 1 },
  balanceValue: { fontSize: 18, fontWeight: '900', color: '#24212D' },
  balanceHint: { fontSize: 12, fontWeight: '600', color: '#7A7488' },
  link: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  tabs: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 16, backgroundColor: '#EEEBF7' },
  tab: { flex: 1, minHeight: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tabActive: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 14, fontWeight: '800', color: '#5E5872' },
  tabTextActive: { color: '#FFFFFF' },
  loading: { marginVertical: 16 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F1ECFF' },
  noticeText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#5B42D8' },
  section: { gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '900', color: '#24212D', marginTop: 4 },
  sectionSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488', marginTop: -6 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  icon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  iconSmall: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0, gap: 3 },
  cardTitle: { fontSize: 15, fontWeight: '900', color: '#24212D' },
  cardDetail: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488' },
  costRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  costText: { fontSize: 12, fontWeight: '800', color: '#3B3650' },
  ownedText: { fontSize: 12, fontWeight: '800', color: '#2E8F5E' },
  action: { minWidth: 76, minHeight: 40, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  actionOwned: { backgroundColor: '#E6F6EE' },
  actionShort: { backgroundColor: '#F0EEF5' },
  actionText: { fontSize: 13, fontWeight: '900', color: '#FFFFFF' },
  actionTextQuiet: { color: '#5B42D8' },
  pressed: { opacity: 0.8 },
  empty: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#7A7488' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  itemTitle: { fontSize: 14, fontWeight: '800', color: '#24212D' },
  toast: { position: 'absolute', left: 16, right: 16, alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: '#2D2A3D' },
  toastText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF', textAlign: 'center' },
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  overlayBottom: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  backdrop: { flex: 1 },
  dialog: { width: '100%', maxWidth: 380, gap: 10, padding: 22, borderRadius: 22, backgroundColor: '#FFFFFF' },
  dialogTitle: { fontSize: 18, fontWeight: '900', color: '#24212D' },
  math: { fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#5E5872' },
  primary: { minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  cancel: { alignItems: 'center', paddingVertical: 8 },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '90%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#FFFFFF' },
  sheetContent: { padding: 20, gap: 10 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginTop: 4 },
  input: { minHeight: 46, justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: '#E6E2F0', paddingHorizontal: 12, fontSize: 16, color: '#1F1C26', backgroundColor: '#FAF9FD' },
  inputText: { fontSize: 16, color: '#1F1C26' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#DED6FA', backgroundColor: '#FAF8FF' },
  chipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  chipText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  chipTextActive: { color: '#FFFFFF' },
  error: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#B52E4D' },
  deleteRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14 },
  deleteText: { fontSize: 14, fontWeight: '800', color: '#C2412F' },
}, {
  screen: { flex: 1, backgroundColor: '#14121A' },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D1A24' },
  balance: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#2E2940' },
  tabs: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 16, backgroundColor: '#211C33' },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#2E2940' },
  itemRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 16, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#2E2940' },
  dialog: { width: '100%', maxWidth: 380, gap: 10, padding: 22, borderRadius: 22, backgroundColor: '#1D1A24' },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', maxHeight: '90%', borderTopLeftRadius: 26, borderTopRightRadius: 26, backgroundColor: '#1B1823' },
  input: { minHeight: 46, justifyContent: 'center', borderRadius: 12, borderWidth: 1.5, borderColor: '#3B3647', paddingHorizontal: 12, fontSize: 16, color: '#F2EFF8', backgroundColor: '#25212E' },
  actionOwned: { backgroundColor: '#1D3028' },
  actionShort: { backgroundColor: '#2A2440' },
});
