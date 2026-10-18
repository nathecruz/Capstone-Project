import { Linking, Platform } from 'react-native';

export const isWebPlatform = Platform.OS === 'web';

export const supportsNativeNotifications = !isWebPlatform;

export const shouldUseWebNotificationFallback = isWebPlatform;

export async function openExternalLink(url: string) {
  if (isWebPlatform && typeof window !== 'undefined') {
    // Mail and phone links open the device's own app; a new tab for them would stay blank.
    if (/^(mailto|tel):/i.test(url)) {
      window.location.href = url;
      return;
    }
    // Opened once: with noopener the browser always returns null, so a null result does not mean
    // it was blocked (falling back to Linking opened every link twice).
    if (typeof window.open === 'function') {
      window.open(url, '_blank', 'noopener,noreferrer');
      return;
    }
  }

  await Linking.openURL(url);
}
