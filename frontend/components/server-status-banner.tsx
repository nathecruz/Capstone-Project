import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { subscribeToServerStatus } from '@/authentication/authService';

/** Explains the delay when the free-tier server is starting up, instead of a frozen screen. */
export function ServerStatusBanner() {
  const [waking, setWaking] = useState(false);
  const insets = useSafeAreaInsets();

  useEffect(() => subscribeToServerStatus((status) => setWaking(status === 'waking')), []);

  if (!waking) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { top: insets.top + 8 }]} accessibilityLiveRegion="polite">
      <View style={styles.banner}>
        <ActivityIndicator size="small" color="#FFFFFF" />
        <Text style={styles.text}>Connecting to HabitAI… the server may take up to a minute to wake up.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1000 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, maxWidth: 520, backgroundColor: '#2D2640', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  text: { flexShrink: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
