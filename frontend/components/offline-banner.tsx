import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isServerReachable, probeReachability, subscribeToReachability } from '@/authentication/authService';

// How often to actively check the connection, so offline shows without waiting for another request.
const PROBE_MS = 15000;

/**
 * A quiet banner while the device has no connection, so a student knows HabitAI still works: the
 * cached app keeps running, habits and check-ins save on the device, and they sync when back online.
 *
 * "Offline" means the server is actually unreachable — a request failed with a network error —
 * which covers no Wi-Fi, no mobile data, and being on Wi-Fi that has no internet. On web it also
 * reacts to the browser's online/offline events so the banner appears the instant the link drops.
 */
export function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const onWeb = Platform.OS === 'web' && typeof navigator !== 'undefined' && typeof window !== 'undefined';
    const compute = () => {
      const navOffline = onWeb ? navigator.onLine === false : false;
      setOffline(navOffline || !isServerReachable());
    };
    compute();
    const unsubscribe = subscribeToReachability(compute);
    // Actively check the connection so "offline" is detected on any loss of internet — Wi-Fi or data
    // off, no signal, or Wi-Fi with no internet — without turning on Airplane mode, and even on the
    // sign-in screen or while idle. navigator.onLine alone is unreliable on some devices.
    void probeReachability();
    const probe = setInterval(() => void probeReachability(), PROBE_MS);
    const onOnline = () => { void probeReachability(); compute(); };
    if (onWeb) {
      window.addEventListener('online', onOnline);
      window.addEventListener('offline', compute);
    }
    return () => {
      unsubscribe();
      clearInterval(probe);
      if (onWeb) {
        window.removeEventListener('online', onOnline);
        window.removeEventListener('offline', compute);
      }
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
