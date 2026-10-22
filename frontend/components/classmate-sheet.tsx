// A classmate's card from the leaderboard: their frame, name, title and standing, their Habi in its
// room (Buddy Showcase), and a treat to send their Habi. Only the sender spends tokens; the
// classmate's Habi gets the treat, never tokens. Render it only while it is open.
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { sendBuddyGift } from '@/authentication/authService';
import { BuddyAvatar } from '@/components/buddy';
import { FramedAvatar } from '@/components/framed-avatar';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { reloadBuddy, useBuddy } from '@/hooks/use-buddy';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { buddyGrowth, classmateBuddy } from '@/utils/buddy';
import { getLocalDateKey } from '@/utils/habit-visibility';
import type { Leader, LeaderboardPeriod } from '@/utils/leaderboard-range';

/** The name on the card: the board marks the student's own row 'Maria R. (You)'. */
const cardName = (leader: Leader) => (leader.isYou ? leader.name.replace(/ \(You\)$/, '') : leader.name);

export function ClassmateSheet({ leader, period, onClose, onSent }: { leader: Leader; period: LeaderboardPeriod; onClose: () => void; onSent: (toast: string) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { tokens, applyWallet } = useAppColorScheme();
  // The student's own buddy has the catalog (to draw the classmate's items), the treats and the cheers.
  const { buddy: own, refresh } = useBuddy(false);
  const [picking, setPicking] = useState(false);
  const [treatsFailed, setTreatsFailed] = useState(false);
  const [treatId, setTreatId] = useState<string | null>(null);
  const [messageId, setMessageId] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  // A second tap before the button turns off must not send a second treat.
  const sendingRef = useRef(false);

  const name = cardName(leader);
  const firstName = name.split(' ')[0] || name;
  const treats = own?.treats ?? [];
  const cheers = own?.giftMessages ?? [];
  const treat = treats.find((entry) => entry.id === treatId) ?? null;
  const look = leader.buddy ? classmateBuddy(leader.buddy, own, leader.isYou ? 'Your Habi' : `${firstName}'s Habi`) : null;
  const stage = look ? buddyGrowth(look.checkIns, look.stages).stage.name : '';

  const openPicker = () => {
    setPicking(true);
    // The treats and cheers come with the student's own buddy: load it when the board could not.
    if (!treats.length || !cheers.length) {
      setTreatsFailed(false);
      void refresh().then((result) => setTreatsFailed(!result.ok));
    }
  };

  const send = async () => {
    if (!treat || !leader.id || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError('');
    const result = await sendBuddyGift({ to: leader.id, treatId: treat.id, messageId }, getLocalDateKey());
    sendingRef.current = false;
    setSending(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    applyWallet(result);
    // Gifts sent (on the buddy screen) count this one.
    void reloadBuddy();
    onSent(`Treat sent to ${name}!`);
    onClose();
  };

  const card = (
    <>
      <View style={styles.header}>
        <FramedAvatar frame={leader.frame} size={58}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{leader.avatar}</Text></View>
        </FramedAvatar>
        <View style={styles.headerCopy}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {leader.title ? <Text style={styles.titleText} numberOfLines={1}>{leader.title}</Text> : null}
          <Text style={styles.standing}>#{leader.rank} · {leader.points} points {period.toLowerCase()}</Text>
        </View>
      </View>
      {leader.isYou && (
        <View style={styles.youPill}>
          <Ionicons name="star" size={12} color={themeColor('#5B42D8')} />
          <Text style={styles.youText}>This is you</Text>
        </View>
      )}
      {look ? (
        <View style={styles.habi}>
          <BuddyAvatar buddy={look} checkIns={look.checkIns} mood="happy" size={120} />
          <Text style={styles.habiCaption}>{look.name} · {stage} stage</Text>
        </View>
      ) : (
        <View style={styles.noHabi}>
          <Ionicons name="paw-outline" size={18} color={themeColor('#8A8492')} />
          <Text style={styles.noHabiText}>{leader.isYou ? 'Classmates do not see your Habi yet.' : `${firstName} has not shown their Habi yet.`}</Text>
        </View>
      )}
      {leader.isYou ? (
        <Pressable
          style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
          onPress={() => {
            onClose();
            router.push('/buddy');
          }}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>Open Habi</Text>
        </Pressable>
      ) : leader.canGift && leader.id ? (
        <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={openPicker} accessibilityRole="button">
          <Ionicons name="gift-outline" size={17} color="#FFFFFF" />
          <Text style={styles.primaryText}>Send a treat</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
        <Text style={styles.secondaryText}>Close</Text>
      </Pressable>
    </>
  );

  const picker = (
    <>
      <View>
        <Text style={styles.name}>Send {firstName} a treat</Text>
        <Text style={styles.pickerHint}>It goes to {firstName}&apos;s Habi. Only you spend tokens.</Text>
      </View>
      {!treats.length ? <Text style={styles.pickerHint}>{treatsFailed ? 'Could not load the treats. Go back and try again.' : 'Loading the treats...'}</Text> : (
        <View style={styles.grid} accessibilityRole="radiogroup" accessibilityLabel="Treats">
          {treats.map((entry) => {
            const short = Math.max(0, entry.cost - tokens);
            const selected = entry.id === treatId;
            return (
              <Pressable
                key={entry.id}
                style={({ pressed }) => [styles.treat, selected && styles.treatOn, Boolean(short) && styles.treatDim, pressed && styles.pressed]}
                disabled={Boolean(short) || sending}
                onPress={() => {
                  setTreatId(entry.id);
                  setError('');
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: Boolean(short) }}
                accessibilityLabel={`${entry.name}, ${entry.cost} tokens${short ? `, ${short} more needed` : ''}`}
              >
                <Text style={styles.treatEmoji}>{entry.emoji}</Text>
                <Text style={styles.treatName} numberOfLines={1}>{entry.name}</Text>
                <Text style={[styles.treatCost, Boolean(short) && styles.treatCostShort]}>{short ? `${short} more` : `${entry.cost} tokens`}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View style={styles.cheers} accessibilityRole="radiogroup" accessibilityLabel="Cheer">
        {cheers.map((cheer, index) => {
          const selected = index === messageId;
          return (
            <Pressable key={cheer} style={({ pressed }) => [styles.cheer, selected && styles.cheerOn, pressed && styles.pressed]} onPress={() => setMessageId(index)} disabled={sending} accessibilityRole="radio" accessibilityState={{ selected }}>
              <Text style={[styles.cheerText, selected && styles.cheerTextOn]}>{cheer}</Text>
            </Pressable>
          );
        })}
      </View>
      {Boolean(error) && <Text style={styles.errorText} accessibilityLiveRegion="polite">{error}</Text>}
      <Pressable
        style={({ pressed }) => [styles.primary, (!treat || sending || !cheers.length) && styles.primaryDisabled, pressed && styles.pressed]}
        onPress={() => void send()}
        disabled={!treat || sending || !cheers.length}
        accessibilityRole="button"
      >
        {sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{treat ? `Send ${treat.emoji} ${treat.name} · ${treat.cost} tokens` : 'Pick a treat'}</Text>}
      </Pressable>
      <Pressable style={styles.secondary} onPress={() => setPicking(false)} disabled={sending} accessibilityRole="button">
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
    </>
  );

  return (
    <Modal visible transparent animationType="fade" onRequestClose={picking ? () => setPicking(false) : onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={`Close ${name}'s card`}>
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false}>
            {picking ? picker : card}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '90%', backgroundColor: '#FFFFFF', borderRadius: 26, overflow: 'hidden' },
  body: { padding: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerCopy: { flex: 1, minWidth: 0 },
  avatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 26, fontWeight: '900', color: '#5B42D8' },
  name: { fontSize: 19, fontWeight: '900', color: '#24212D' },
  titleText: { marginTop: 1, fontSize: 12, fontWeight: '800', color: '#7A4FB0' },
  standing: { marginTop: 3, fontSize: 13, fontWeight: '700', color: '#6A6573' },
  youPill: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, borderRadius: 999, backgroundColor: '#F1EDFF', paddingHorizontal: 10, paddingVertical: 5 },
  youText: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  habi: { alignItems: 'center', gap: 10, paddingVertical: 8 },
  habiCaption: { fontSize: 13, fontWeight: '800', color: '#4A4556' },
  noHabi: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 14, borderRadius: 14, backgroundColor: '#F7F5FC' },
  noHabiText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#6A6573' },
  pickerHint: { marginTop: 3, fontSize: 13, fontWeight: '600', color: '#6A6573' },
  // Three treats a row, also on a 320 px phone.
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  treat: { width: '31%', alignItems: 'center', gap: 3, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 14, borderWidth: 2, borderColor: '#EFEBFA', backgroundColor: '#FFFFFF' },
  treatOn: { borderColor: '#5B42D8', backgroundColor: '#F4F0FF' },
  treatDim: { opacity: 0.5 },
  treatEmoji: { fontSize: 28 },
  treatName: { fontSize: 11, fontWeight: '800', color: '#36313F' },
  treatCost: { fontSize: 11, fontWeight: '800', color: '#9A6A12' },
  treatCostShort: { color: '#8A8492' },
  cheers: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  cheer: { borderRadius: 999, borderWidth: 1, borderColor: '#E4DDF4', paddingHorizontal: 12, paddingVertical: 8 },
  cheerOn: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  cheerText: { fontSize: 12, fontWeight: '700', color: '#4A4556' },
  cheerTextOn: { color: '#FFFFFF' },
  errorText: { fontSize: 12, fontWeight: '700', color: '#C2543E' },
  primary: { minHeight: 50, flexDirection: 'row', gap: 6, borderRadius: 16, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryDisabled: { backgroundColor: '#B8AEDF' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF', textAlign: 'center' },
  secondary: { marginTop: -6, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '800', color: '#6A6573' },
  pressed: { opacity: 0.85 },
});
