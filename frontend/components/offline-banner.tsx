import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * A quiet banner while the device has no connection, so a student knows HabitAI still works: the
 * cached app keeps running, habits and check-ins save on the device, and they sync when back online.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    // Web only: navigator.onLine + its events. Native builds bundle the app, so they already run
    // offline; connection changes there would need a separate module.
    if (Platform.OS !== 'web' || typeof navigator === 'undefined' || typeof window === 'undefined') return;
    const update = () => setOffline(!navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (!offline) return null;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: insets.bottom + 92 }]} accessibilityLiveRegion="polite">
      <View style={styles.banner}>
        <Ionicons name="cloud-offline-outline" size={16} color="#FFFFFF" />
        <Text style={styles.text} numberOfLines={2}>You are offline — habits still work; changes sync when you are back.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, alignItems: 'center', zIndex: 1000 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, maxWidth: 520, backgroundColor: '#2D2640', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 10, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
  text: { flexShrink: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '600', lineHeight: 18 },
});
