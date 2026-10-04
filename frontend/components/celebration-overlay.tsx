// Shows the latest celebration (streak milestone, level up, daily challenge, all done) with
// confetti. Rendered once at the root, so it works on every screen where a habit is checked.
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import React, { useEffect } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { Confetti } from '@/components/confetti';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemedStyles } from '@/hooks/use-themed-styles';

const ACCENT: Record<string, string> = { buddy: '#D2588F', streak: '#F2A93B', freeze: '#4BA3FF', badge: '#E7A72F', quest: '#4BA3FF', level: '#5B42D8', challenge: '#3BAA74', allDone: '#5B42D8' };

export function CelebrationOverlay() {
  const styles = useThemedStyles(themedStyles);
  const { celebration, dismissCelebration } = useAppColorScheme();

  useEffect(() => {
    if (celebration && Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [celebration]);

  if (!celebration) return null;
  const accent = celebration.color ?? ACCENT[celebration.kind] ?? '#5B42D8';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={dismissCelebration}>
      <Pressable style={styles.backdrop} onPress={dismissCelebration} accessibilityLabel="Close celebration">
        <Pressable style={styles.card} onPress={() => undefined} accessibilityViewIsModal>
          <View style={[styles.badge, { backgroundColor: accent }]}>
            <Ionicons name={celebration.icon as keyof typeof Ionicons.glyphMap} size={34} color="#FFFFFF" />
          </View>
          <Text style={styles.title}>{celebration.title}</Text>
          <Text style={styles.message}>{celebration.message}</Text>
          <Pressable style={[styles.button, { backgroundColor: accent }]} onPress={dismissCelebration} accessibilityRole="button">
            <Text style={styles.buttonText}>Keep going</Text>
          </Pressable>
        </Pressable>
        {/* In front of the card, so the burst falls over it; it ignores touches. */}
        <Confetti burstKey={celebration.id} />
      </Pressable>
    </Modal>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { width: '100%', maxWidth: 340, alignItems: 'center', gap: 10, paddingHorizontal: 22, paddingTop: 28, paddingBottom: 20, borderRadius: 28, backgroundColor: '#FFFFFF' },
  badge: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  title: { fontSize: 22, fontWeight: '800', color: '#1D1C26', textAlign: 'center' },
  message: { fontSize: 14, lineHeight: 20, color: '#5E5868', textAlign: 'center', fontWeight: '600' },
  button: { marginTop: 8, alignSelf: 'stretch', alignItems: 'center', paddingVertical: 13, borderRadius: 16 },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
});
