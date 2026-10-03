// Streak Freeze: what it does, how many are held, and buying one with tokens.
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';

const HOW_IT_WORKS = [
  { icon: 'shield-checkmark', text: 'Miss a habit? A freeze is used the next day so your streaks keep going.' },
  { icon: 'pause-circle', text: 'A frozen day keeps the streak alive; it does not add to it.' },
  { icon: 'time', text: 'Bought after a miss, it can still save yesterday.' },
];

export function StreakFreezeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const { streakFreeze, tokens, buyStreakFreeze } = useAppColorScheme();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const available = streakFreeze?.available ?? 0;
  const max = streakFreeze?.max ?? 2;
  const cost = streakFreeze?.cost ?? 30;
  const full = available >= max;
  const short = Math.max(0, cost - tokens);

  const buy = async () => {
    setBusy(true);
    setNote(null);
    const result = await buyStreakFreeze();
    setBusy(false);
    setNote({ ok: result.ok, text: result.ok ? `Streak freeze added! ${result.message}` : result.message });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close streak freeze">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.icon}><Ionicons name="snow" size={26} color="#FFFFFF" /></View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Streak Freeze</Text>
              <Text style={styles.subtitle}>Protects all your streaks for one missed day.</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close">
              <Ionicons name="close" size={22} color="#8A8492" />
            </Pressable>
          </View>

          <View style={styles.slots} accessible accessibilityLabel={`${available} of ${max} streak freezes held`}>
            {Array.from({ length: max }, (_, index) => (
              <View key={index} style={[styles.slot, index < available && styles.slotFull]}>
                <Text style={styles.slotEmoji}>{index < available ? '🧊' : ''}</Text>
              </View>
            ))}
            <View style={styles.slotCopy}>
              <Text style={styles.slotCount}>{available} of {max} held</Text>
              <Text style={styles.slotSaved}>{streakFreeze?.frozenDays.length ? `Saved ${streakFreeze.frozenDays.length} day${streakFreeze.frozenDays.length === 1 ? '' : 's'} so far` : 'None used yet'}</Text>
            </View>
          </View>

          <View style={styles.list}>
            {HOW_IT_WORKS.map((item) => (
              <View key={item.text} style={styles.row}>
                <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={17} color="#4BA3FF" />
                <Text style={styles.rowText}>{item.text}</Text>
              </View>
            ))}
          </View>

          {note && <Text style={[styles.note, !note.ok && styles.noteError]}>{note.text}</Text>}
          <Pressable
            style={({ pressed }) => [styles.buy, (full || short > 0 || busy) && styles.buyDisabled, pressed && styles.pressed]}
            onPress={buy}
            disabled={full || short > 0 || busy}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Ionicons name="snow" size={17} color="#FFFFFF" />}
            <Text style={styles.buyText}>{full ? 'You hold the most you can' : short > 0 ? `Need ${short} more tokens` : `Buy for ${cost} tokens`}</Text>
          </Pressable>
          <Text style={styles.balance}>You have {tokens} tokens</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 26, padding: 20, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#4BA3FF', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: '900', color: '#24212D' },
  subtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#6A6573' },
  slots: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 18, backgroundColor: '#EEF6FF' },
  slot: { width: 50, height: 50, borderRadius: 14, borderWidth: 2, borderStyle: 'dashed', borderColor: '#9CCBF5', alignItems: 'center', justifyContent: 'center' },
  slotFull: { borderStyle: 'solid', borderColor: '#4BA3FF', backgroundColor: '#FFFFFF' },
  slotEmoji: { fontSize: 26 },
  slotCopy: { flex: 1, marginLeft: 4 },
  slotCount: { fontSize: 15, fontWeight: '900', color: '#24212D' },
  slotSaved: { marginTop: 2, fontSize: 12, fontWeight: '700', color: '#4A84C1' },
  list: { gap: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  rowText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#4A4556' },
  note: { fontSize: 13, fontWeight: '800', color: '#2C6B4C', textAlign: 'center' },
  noteError: { color: '#C2543E' },
  buy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 16, backgroundColor: '#4BA3FF' },
  buyDisabled: { backgroundColor: '#A9C9E8' },
  buyText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
  balance: { marginTop: -8, fontSize: 12, fontWeight: '700', color: '#8A8492', textAlign: 'center' },
});
