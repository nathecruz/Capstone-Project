// "Install HabitAI" on the web: Android Chrome, Edge and desktop Chrome offer an install prompt
// (beforeinstallprompt), which is kept here as soon as the app loads so HabitAI's own Install
// button can open it; iPhone and iPad have none, so the app shows the Add to Home Screen steps.
// Imported for its side effect by app/_layout.tsx, before the event can fire.
import { useEffect, useReducer } from 'react';
import { Platform } from 'react-native';

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

export type InstallPlatform = 'ios' | 'android' | 'desktop';

let deferredPrompt: InstallPromptEvent | null = null;
let justInstalled = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // HabitAI shows its own Install button (Home and sign-in), instead of the browser's mini bar.
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    justInstalled = true;
    deferredPrompt = null;
    notify();
  });
}

/** Opened from the Home Screen or as an installed app, not in a browser tab. */
export function isRunningInstalled() {
  if (Platform.OS !== 'web') return true;
  if (typeof window === 'undefined') return false;
  return Boolean(window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.matchMedia?.('(display-mode: minimal-ui)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true);
}

export function getInstallPlatform(): InstallPlatform {
  if (typeof navigator === 'undefined') return 'desktop';
  const agent = navigator.userAgent;
  // iPadOS reports a Mac with touch.
  if (/iPad|iPhone|iPod/.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(agent)) return 'android';
  return 'desktop';
}

/** The browser inside another app (Messenger, Facebook, Instagram, TikTok...), which cannot install. */
export function isInAppBrowser() {
  if (typeof navigator === 'undefined') return false;
  return /FBAN|FBAV|FB_IAB|Instagram|Messenger|MicroMessenger|Line\/|TikTok|musical_ly|Snapchat|; wv\)/i.test(navigator.userAgent);
}

/** Opens the browser's install prompt; 'unavailable' when the browser has none to offer. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  // A prompt can be shown only once; the browser offers a new one later if it was dismissed.
  deferredPrompt = null;
  notify();
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    if (outcome === 'accepted') justInstalled = true;
    notify();
    return outcome;
  } catch {
    return 'unavailable';
  }
}

/** Whether to offer installing here, and how: a real Install button, or the steps to follow. */
export function useInstallApp() {
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);
  const platform = getInstallPlatform();
  return {
    platform,
    installed: Platform.OS !== 'web' || justInstalled || isRunningInstalled(),
    canPrompt: Boolean(deferredPrompt),
    inAppBrowser: isInAppBrowser(),
  };
}
