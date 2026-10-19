// HabitAI needs the internet (there is no offline mode): with no connection it says so plainly,
// on the sign-in screen too, instead of letting the student use a copy that cannot be saved.
import { Ionicons } from '@expo/vector-icons';
import * as Network from 'expo-network';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { serverAnswers } from '@/authentication/authService';

// Moving between Wi-Fi and mobile data briefly reports no connection; only a lasting one counts.
const SETTLE_MS = 2000;
// While shown, it checks again now and then and goes away by itself once the connection is back.
const RECHECK_MS = 10_000;

const reportsNoInternet = (state: Network.NetworkState | null) => Boolean(state) && (state?.isConnected === false || state?.isInternetReachable === false);

export function NoInternetScreen() {
  const [offline, setOffline] = useState(false);
  const [checking, setChecking] = useState(false);
  const checkVersion = useRef(0);

  const check = useCallback(async (settle: boolean) => {
    const version = ++checkVersion.current;
    const current = () => version === checkVersion.current;
    const readState = () => Network.getNetworkStateAsync().catch(() => null);
    if (!reportsNoInternet(await readState())) {
      if (current()) setOffline(false);
      return;
    }
    if (settle) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
    if (!current() || !reportsNoInternet(await readState())) {
      if (current()) setOffline(false);
      return;
    }
    // The phone says it has no internet. Shown only if HabitAI's server is out of reach too, so a
    // network the phone has not verified (but that works) does not block the app. A server still
    // waking up can keep it shown for a moment; the recheck below hides it once the server answers.
    const reachable = await serverAnswers();
    if (current()) setOffline(!reachable);
  }, []);

  useEffect(() => {
    void check(false);
    const subscription = Network.addNetworkStateListener(() => void check(true));
    return () => {
      checkVersion.current += 1;
      subscription.remove();
    };
  }, [check]);

  useEffect(() => {
    if (!offline) return;
    const timer = setInterval(() => void check(false), RECHECK_MS);
    return () => clearInterval(timer);
  }, [check, offline]);

  const tryAgain = async () => {
    setChecking(true);
    try {
      await check(false);
    } finally {
      setChecking(false);
    }
  };

  if (!offline) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.page]} accessibilityRole="alert" accessibilityLiveRegion="assertive">
      <View style={styles.icon}>
        <Ionicons name="cloud-offline-outline" size={34} color="#5B42D8" />
      </View>
      <Text style={styles.title}>No internet connection</Text>
      <Text style={styles.text}>HabitAI needs the internet to sign in and save your habits. Connect to Wi-Fi or mobile data, then try again.</Text>
      <Pressable style={({ pressed }) => [styles.button, pressed && styles.pressed]} onPress={() => void tryAgain()} disabled={checking} accessibilityRole="button" accessibilityState={{ busy: checking }}>
        {checking ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.buttonText}>Try again</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { zIndex: 2000, alignItems: 'center', justifyContent: 'center', padding: 28, backgroundColor: '#F4F7FF' },
  icon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECE8FF' },
  title: { marginTop: 18, fontSize: 22, fontWeight: '800', color: '#24212D', textAlign: 'center' },
  text: { marginTop: 8, maxWidth: 360, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#5F5A6B', textAlign: 'center' },
  button: { marginTop: 24, minWidth: 160, minHeight: 48, paddingHorizontal: 24, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  buttonText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  pressed: { opacity: 0.85 },
});
