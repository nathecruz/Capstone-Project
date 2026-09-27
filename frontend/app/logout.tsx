import { router } from 'expo-router';
import React, { useEffect } from 'react';
import { StatusBar as RNStatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppDialog } from '@/components/ui/app-dialog';
import { signOut } from '@/authentication';

export default function LogoutScreen() {
  const [showSignedOutDialog, setShowSignedOutDialog] = React.useState(false);

  useEffect(() => {
    let isMounted = true;

    const doLogout = async () => {
      await signOut();
      if (isMounted) {
        setShowSignedOutDialog(true);
      }
    };

    void doLogout();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <RNStatusBar barStyle="dark-content" backgroundColor="#dff4ff" />
      <View style={styles.page}>
        <View style={styles.decorCircleOne} />
        <View style={styles.decorCircleTwo} />

      </View>
      <AppDialog
        visible={showSignedOutDialog}
        title="You're signed out"
        message="Thanks for using HabitAI. Take care and see you next time."
        variant="success"
        onClose={() => router.replace('/login')}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7ff',
    paddingHorizontal: 20,
    position: 'relative',
  },
  decorCircleOne: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#dff0ff',
    opacity: 0.9,
  },
  decorCircleTwo: {
    position: 'absolute',
    bottom: -90,
    left: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#eae3ff',
    opacity: 0.9,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 28,
    shadowColor: '#1e2b5b',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#edf2ff',
    zIndex: 1,
  },
  brand: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4a3bd5',
    letterSpacing: 1.2,
    backgroundColor: '#ebe7ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
  },
  title: {
    marginTop: 18,
    fontSize: 26,
    fontWeight: '700',
    color: '#1d1f2c',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 12,
    fontSize: 14,
    textAlign: 'center',
    color: '#586074',
    lineHeight: 22,
    maxWidth: 300,
  },
  primaryButton: {
    width: '100%',
    backgroundColor: '#5a42d8',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 28,
    shadowColor: '#5a42d8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
});
