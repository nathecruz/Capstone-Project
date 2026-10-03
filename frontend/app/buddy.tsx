// Habit Buddy: the mascot that grows with every check-in. Tap it, rename it, and dress it up with
// items bought with tokens (the server checks prices, stages and the balance).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { buyBuddyItem, saveBuddy } from '@/authentication/authService';
import { BuddyAvatar } from '@/components/buddy';
import { Confetti } from '@/components/confetti';
import { useAppDialog } from '@/components/ui/app-dialog';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { publishBuddy, useBuddy } from '@/hooks/use-buddy';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { buddyGrowth, buddyMood, PET_LINES, type BuddyItem } from '@/utils/buddy';

type Slot = 'head' | 'hand';

export default function BuddyScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { habits, tokens, applyWallet } = useAppColorScheme();
  const { buddy } = useBuddy();
  const [slot, setSlot] = useState<Slot>('head');
  const [editingName, setEditingName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [petLine, setPetLine] = useState<string | null>(null);
  const [burst, setBurst] = useState(0);
  const [hearts] = useState(() => new Animated.Value(0));

  const name = buddy?.name ?? 'Habi';
  const checkIns = buddy?.checkIns ?? habits.reduce((sum, habit) => sum + habit.completionDates.length, 0);
  const growth = buddyGrowth(checkIns, buddy?.stages);
  const { mood, line, energy } = buddyMood(habits, name);
  const stages = buddy?.stages ?? [];
  const stageIndex = (id: string) => stages.findIndex((stage) => stage.id === id);

  // Tapping the buddy: hearts float up and it says something nice.
  const pet = () => {
    setPetLine(PET_LINES[Math.floor(Math.random() * PET_LINES.length)]);
    hearts.setValue(0);
    Animated.timing(hearts, { toValue: 1, duration: 900, useNativeDriver: Platform.OS !== 'web' }).start();
  };

  const rename = async () => {
    const next = editingName?.trim();
    setEditingName(null);
    if (!next || next === name) return;
    const result = await saveBuddy({ name: next.slice(0, 20) });
    if (result.ok) publishBuddy(result.buddy);
    else showAlert('Could not rename', result.message);
  };

  const wear = async (item: BuddyItem) => {
    const current = item.slot === 'head' ? buddy?.head : buddy?.hand;
    setBusy(true);
    const result = await saveBuddy({ [item.slot]: current === item.id ? '' : item.id });
    setBusy(false);
    if (result.ok) publishBuddy(result.buddy);
    else showAlert('Could not change the look', result.message);
  };

  const buy = (item: BuddyItem) => {
    showAlert(`Buy the ${item.name}?`, `${item.emoji}  ${item.cost} tokens. ${name} will wear it right away.`, [
      { text: 'Not now', style: 'cancel' },
      {
        text: `Buy for ${item.cost}`,
        onPress: async () => {
          setBusy(true);
          const result = await buyBuddyItem(item.id);
          setBusy(false);
          if (!result.ok) {
            showAlert('Not yet', result.message);
            return;
          }
          publishBuddy(result.buddy);
          applyWallet(result);
          setBurst((count) => count + 1);
          setPetLine(`I love my new ${item.name.toLowerCase()}!`);
        },
      },
    ]);
  };

  const items = (buddy?.items ?? []).filter((item) => item.slot === slot);

  return (
    <SafeAreaView style={styles.screen}>
      {burst > 0 && <Confetti burstKey={`buddy-${burst}`} />}
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable style={styles.backButton} onPress={() => (router.canGoBack() ? router.back() : router.replace('/(tabs)'))} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={21} color={themeColor('#292633')} />
          </Pressable>
          <Text style={styles.headerTitle}>Habit Buddy</Text>
          <View style={styles.tokenPill} accessible accessibilityLabel={`${tokens} tokens`}>
            <Ionicons name="logo-bitcoin" size={14} color="#E7A72F" />
            <Text style={styles.tokenText}>{tokens}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Pressable onPress={pet} accessibilityRole="button" accessibilityLabel={`Pet ${name}`} style={styles.avatarWrap}>
            <BuddyAvatar buddy={buddy} checkIns={checkIns} mood={mood} size={170} />
            <Animated.Text
              pointerEvents="none"
              style={[styles.hearts, { opacity: hearts.interpolate({ inputRange: [0, 0.2, 1], outputRange: [0, 1, 0] }), transform: [{ translateY: hearts.interpolate({ inputRange: [0, 1], outputRange: [0, -60] }) }] }]}
            >
              💜 💛 💜
            </Animated.Text>
          </Pressable>
          {editingName === null ? (
            <Pressable style={styles.nameRow} onPress={() => setEditingName(name)} accessibilityRole="button" accessibilityLabel={`Rename ${name}`}>
              <Text style={styles.name}>{name}</Text>
              <Ionicons name="pencil" size={15} color={themeColor('#8A8492')} />
            </Pressable>
          ) : (
            <TextInput
              value={editingName}
              onChangeText={setEditingName}
              onSubmitEditing={rename}
              onBlur={rename}
              autoFocus
              maxLength={20}
              style={styles.nameInput}
              accessibilityLabel="Buddy name"
            />
          )}
          <View style={styles.speech}><Text style={styles.speechText}>{petLine ?? line}</Text></View>
          <View style={styles.meters}>
            <View style={styles.meter}>
              <View style={styles.meterHead}><Ionicons name="flash" size={13} color="#F2A93B" /><Text style={styles.meterLabel}>Energy today</Text><Text style={styles.meterValue}>{Math.round(energy * 100)}%</Text></View>
              <View style={styles.track}><View style={[styles.fill, styles.energyFill, { width: `${Math.round(energy * 100)}%` }]} /></View>
            </View>
            <View style={styles.meter}>
              <View style={styles.meterHead}><Ionicons name="leaf" size={13} color="#3BAA74" /><Text style={styles.meterLabel}>{growth.stage.name} stage</Text><Text style={styles.meterValue}>{growth.next ? `${growth.toNext} to ${growth.next.name}` : 'Fully grown!'}</Text></View>
              <View style={styles.track}><View style={[styles.fill, styles.growthFill, { width: `${Math.round(growth.share * 100)}%` }]} /></View>
            </View>
          </View>
          <View style={styles.stageRow}>
            {stages.map((stage, index) => (
              <View key={stage.id} style={[styles.stageChip, index <= growth.index && styles.stageChipReached]}>
                <Text style={[styles.stageChipText, index <= growth.index && styles.stageChipTextReached]}>{stage.name}</Text>
                <Text style={[styles.stageChipMin, index <= growth.index && styles.stageChipTextReached]}>{stage.min}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.hint}>Every check-in feeds {name} and helps it grow. Tokens buy new looks.</Text>
        </View>

        <View style={styles.tabs}>
          {(['head', 'hand'] as const).map((value) => (
            <Pressable key={value} style={[styles.tab, slot === value && styles.activeTab]} onPress={() => setSlot(value)} accessibilityRole="tab" accessibilityState={{ selected: slot === value }}>
              <Text style={[styles.tabText, slot === value && styles.activeTabText]}>{value === 'head' ? 'Hats' : 'Things to hold'}</Text>
            </Pressable>
          ))}
        </View>

        {!buddy ? <Text style={styles.hint}>Loading the wardrobe...</Text> : (
          <View style={styles.grid}>
            {items.map((item) => {
              const owned = buddy.owned.includes(item.id);
              const wearing = (item.slot === 'head' ? buddy.head : buddy.hand) === item.id;
              const lockedStage = stageIndex(item.stage) > growth.index ? stages[stageIndex(item.stage)] : null;
              const short = Math.max(0, item.cost - tokens);
              const action = wearing ? 'Wearing' : owned ? 'Wear' : lockedStage ? `${lockedStage.name} stage` : short ? `${short} more` : `Buy · ${item.cost}`;
              return (
                <Pressable
                  key={item.id}
                  style={[styles.item, wearing && styles.itemWearing, Boolean(!owned && (lockedStage || short)) && styles.itemDim]}
                  disabled={busy || Boolean(!owned && (lockedStage || short))}
                  onPress={() => (owned ? wear(item) : buy(item))}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.name}: ${action}`}
                >
                  <Text style={styles.itemEmoji}>{item.emoji}</Text>
                  <Text style={styles.itemName} numberOfLines={1}>{item.name}</Text>
                  <View style={[styles.itemAction, owned && styles.itemActionOwned, wearing && styles.itemActionWearing]}>
                    {lockedStage && !owned ? <Ionicons name="lock-closed" size={11} color="#8A8492" /> : null}
                    <Text style={[styles.itemActionText, owned && styles.itemActionTextOwned, wearing && styles.itemActionTextWearing]}>{action}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  content: { paddingHorizontal: 20, paddingBottom: 110, width: '100%', maxWidth: 640, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 12, marginBottom: 8 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '800', color: '#24212D' },
  tokenPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#FFF4D9' },
  tokenText: { fontSize: 13, fontWeight: '900', color: '#9A6A12' },
  hero: { alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 26, paddingVertical: 22, paddingHorizontal: 18, marginBottom: 16 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center' },
  hearts: { position: 'absolute', top: 0, fontSize: 22 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
  name: { fontSize: 24, fontWeight: '900', color: '#24212D' },
  nameInput: { marginTop: 14, minWidth: 160, textAlign: 'center', fontSize: 22, fontWeight: '900', color: '#24212D', borderBottomWidth: 2, borderBottomColor: '#5B42D8', paddingVertical: 2 },
  speech: { marginTop: 10, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, backgroundColor: '#F7F4FF' },
  speechText: { fontSize: 13, fontWeight: '700', color: '#4A4556', textAlign: 'center' },
  meters: { alignSelf: 'stretch', gap: 12, marginTop: 16 },
  meter: { gap: 6 },
  meterHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meterLabel: { flex: 1, fontSize: 12, fontWeight: '800', color: '#4A4556' },
  meterValue: { fontSize: 12, fontWeight: '800', color: '#8A8492' },
  track: { height: 9, borderRadius: 5, backgroundColor: '#EFEBFA', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 5 },
  energyFill: { backgroundColor: '#F2A93B' },
  growthFill: { backgroundColor: '#3BAA74' },
  stageRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 6, marginTop: 14 },
  stageChip: { alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: '#DCD6EC' },
  stageChipReached: { backgroundColor: '#3BAA74', borderColor: '#3BAA74' },
  stageChipText: { fontSize: 11, fontWeight: '800', color: '#6A6573' },
  stageChipMin: { fontSize: 9, fontWeight: '700', color: '#8A8492' },
  stageChipTextReached: { color: '#FFFFFF' },
  hint: { marginTop: 12, fontSize: 12, fontWeight: '600', color: '#8A8492', textAlign: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 14, padding: 4, marginBottom: 12 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  activeTab: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 12, color: '#777283', fontWeight: '700' },
  activeTabText: { color: '#FFFFFF' },
  // Left-aligned, so a row with fewer items does not spread them apart.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  item: { width: '31.3%', alignItems: 'center', gap: 6, backgroundColor: '#FFFFFF', borderRadius: 16, paddingVertical: 14, paddingHorizontal: 6, borderWidth: 2, borderColor: '#FFFFFF' },
  itemWearing: { borderColor: '#5B42D8' },
  itemDim: { opacity: 0.6 },
  itemEmoji: { fontSize: 34 },
  itemName: { fontSize: 12, fontWeight: '800', color: '#36313F' },
  itemAction: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: '#FFF4D9' },
  itemActionOwned: { backgroundColor: '#ECF8F1' },
  itemActionWearing: { backgroundColor: '#5B42D8' },
  itemActionText: { fontSize: 11, fontWeight: '800', color: '#9A6A12' },
  itemActionTextOwned: { color: '#2C6B4C' },
  itemActionTextWearing: { color: '#FFFFFF' },
});
