import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, useSegments } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, LogBox, Platform, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ColorSchemeProvider, useAppColorScheme } from '@/hooks/color-scheme-context';
import { AppDialogProvider } from '@/components/ui/app-dialog';
import { getSession, subscribeToAuthChanges, type SessionUser } from '@/authentication';
import { PageSidebar } from '@/components/desktop-sidebar';
import { ServerStatusBanner } from '@/components/server-status-banner';
import { CONTENT_MAX_WIDTH, pageBackground, useResponsiveLayout } from '@/hooks/use-responsive-layout';
import { canonicalRedirect } from '@/utils/canonical-host';

// A per-deploy Vercel address keeps an old version of the app forever: go to the main address.
if (Platform.OS === 'web' && typeof window !== 'undefined') {
  const target = canonicalRedirect(window.location);
  if (target) window.location.replace(target);
}

LogBox.ignoreLogs([
  "InteractionManager has been deprecated and will be removed in a future release. Please refactor long tasks into smaller ones, and  use 'requestIdleCallback' instead.",
]);

// Screens that fill the window on wide screens: the tabs (they center themselves next to the
// sidebar) and the sign-in flow, whose decorated backgrounds are designed edge to edge.
const FULL_WIDTH_ROUTES = new Set(['(tabs)', 'login', 'register', 'logout', 'verify-email', 'privacy-notice', 'snooze-settings', 'modal']);
// Pages without the laptop sidebar: the tabs draw their own, and the sign-in flow has none.
const NO_SIDEBAR_ROUTES = new Set(['(tabs)', 'login', 'register', 'logout', 'verify-email', 'privacy-notice']);
// Overlays open on top of another page, which keeps its sidebar.
const OVERLAY_ROUTES = new Set(['snooze-settings', 'modal']);

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  return (
    <ColorSchemeProvider>
      <AppDialogProvider>
        <SafeAreaProvider>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <RootNavigator />
          </GestureHandlerRootView>
        </SafeAreaProvider>
      </AppDialogProvider>
    </ColorSchemeProvider>
  );
}

function RootNavigator() {
  const { colorScheme } = useAppColorScheme();
  const { isCentered, isDesktop } = useResponsiveLayout();
  const background = pageBackground(colorScheme === 'dark');
  // Navigation containers use the app's page color, so the sides of centered screens match them.
  const baseTheme = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
  const navigationTheme = { ...baseTheme, colors: { ...baseTheme.colors, background, card: background } };
  const segments = useSegments();
  // undefined while checking; null when signed out.
  const [sessionUser, setSessionUser] = useState<SessionUser | null | undefined>(undefined);
  const isAuthenticated = sessionUser === undefined ? null : Boolean(sessionUser);
  const sessionCheckVersion = useRef(0);
  const currentPage = segments[0] as string | undefined;
  // Remembers the last real page, so an overlay opened on it keeps that page's sidebar.
  const [pageBelowOverlay, setPageBelowOverlay] = useState(currentPage);
  if (currentPage && !OVERLAY_ROUTES.has(currentPage) && currentPage !== pageBelowOverlay) setPageBelowOverlay(currentPage);
  const sidebarPage = currentPage && OVERLAY_ROUTES.has(currentPage) ? pageBelowOverlay : currentPage;
  const showPageSidebar = isDesktop && Boolean(sessionUser) && Boolean(sidebarPage) && !NO_SIDEBAR_ROUTES.has(sidebarPage ?? '');

  useEffect(() => {
    let isMounted = true;
    const refreshSession = async () => {
      const checkVersion = ++sessionCheckVersion.current;
      const session = await getSession();
      if (isMounted && checkVersion === sessionCheckVersion.current) {
        setSessionUser(session ?? null);
      }
    };
    const unsubscribe = subscribeToAuthChanges(() => {
      setSessionUser(undefined);
      void refreshSession();
    });

    void refreshSession();

    return () => {
      isMounted = false;
      sessionCheckVersion.current += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (sessionUser === undefined) return;

    const currentSegment = segments[0] as string | undefined;
    const isPublicRoute = currentSegment === 'login' || currentSegment === 'register' || currentSegment === 'logout' || currentSegment === 'privacy-notice';

    if (!sessionUser) {
      if (!isPublicRoute) router.replace('/login');
      return;
    }
    if (currentSegment === 'logout') return;
    // New accounts confirm their email first; older accounts accept the Privacy Notice once.
    if (sessionUser.emailVerified === false) {
      if (currentSegment !== 'verify-email') router.replace('/verify-email');
    } else if (sessionUser.privacyConsentAt === null) {
      if (currentSegment !== 'privacy-notice') router.replace('/privacy-notice?accept=1');
    } else if (currentSegment === 'login' || currentSegment === 'register' || currentSegment === 'verify-email') {
      router.replace('/(tabs)');
    }
  }, [sessionUser, segments]);

  return (
    <>
      <Head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-title" content="HabitAI" />
        <meta name="mobile-web-app-capable" content="yes" />
      </Head>
      <ThemeProvider value={navigationTheme}>
      <View style={[styles.stackRoot, { backgroundColor: background }]}>
      {showPageSidebar && <PageSidebar current={sidebarPage} />}
      <View style={styles.stackArea}>
      <Stack
        screenOptions={({ route }) => ({
          contentStyle: isCentered && !FULL_WIDTH_ROUTES.has(route.name)
            ? { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', backgroundColor: background }
            : undefined,
        })}
      >
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="register" options={{ headerShown: false }} />
        <Stack.Screen name="logout" options={{ headerShown: false }} />
        <Stack.Screen name="verify-email" options={{ headerShown: false }} />
        <Stack.Screen name="privacy-notice" options={{ headerShown: false }} />
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="progress" options={{ headerShown: false }} />
        <Stack.Screen name="personal-information" options={{ headerShown: false }} />
        <Stack.Screen name="stats-progress" options={{ headerShown: false }} />
        <Stack.Screen name="activity-history" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
        <Stack.Screen name="all-habits" options={{ headerShown: false }} />
        <Stack.Screen name="sync-activity" options={{ headerShown: false }} />
        <Stack.Screen name="sync-complete" options={{ headerShown: false }} />
        <Stack.Screen name="settings-preferences" options={{ headerShown: false }} />
        <Stack.Screen name="help-support" options={{ headerShown: false }} />
        <Stack.Screen name="report-issue" options={{ headerShown: false }} />
        <Stack.Screen name="leaderboards" options={{ headerShown: false }} />
        <Stack.Screen name="today-progress" options={{ headerShown: false }} />
        <Stack.Screen name="help-support-faq" options={{ headerShown: false }} />
        <Stack.Screen
          name="snooze-settings"
          options={{
            headerShown: false,
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
      </Stack>
      </View>
      </View>
      </ThemeProvider>
      {isAuthenticated === null && (
        <View
          accessibilityLabel="Checking your session"
          accessibilityRole="progressbar"
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.loadingPage, { backgroundColor: '#f4f7ff' }]}
        >
          <View style={styles.loadingMark}>
            <Text style={styles.loadingMarkText}>H</Text>
          </View>
          <Text style={styles.loadingBrand}>HabitAI</Text>
          <ActivityIndicator size="small" color="#5B42D8" style={styles.loadingIndicator} />
          <Text style={styles.loadingText}>Preparing your habits...</Text>
        </View>
      )}
      <ServerStatusBanner />
      <StatusBar
        style={colorScheme === 'dark' ? 'light' : 'dark'}
      />
    </>
  );
}

const styles = StyleSheet.create({
  stackRoot: {
    flex: 1,
    flexDirection: 'row',
  },
  stackArea: {
    flex: 1,
  },
  loadingPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B42D8',
    shadowColor: '#5B42D8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  loadingMarkText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
  },
  loadingBrand: {
    marginTop: 16,
    color: '#24212D',
    fontSize: 24,
    fontWeight: '800',
  },
  loadingIndicator: {
    marginTop: 28,
  },
  loadingText: {
    marginTop: 10,
    color: '#777282',
    fontSize: 12,
    fontWeight: '600',
  },
});
