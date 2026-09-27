import { Linking, Platform } from 'react-native';

export const isWebPlatform = Platform.OS === 'web';

export const supportsNativeNotifications = !isWebPlatform;

export const shouldUseWebNotificationFallback = isWebPlatform;

export async function openExternalLink(url: string) {
  if (isWebPlatform) {
    const targetWindow = typeof window !== 'undefined' ? window : undefined;
    if (targetWindow && typeof targetWindow.open === 'function') {
      const opened = targetWindow.open(url, '_blank', 'noopener,noreferrer');
      if (opened !== null) {
        return;
      }
    }
  }

  await Linking.openURL(url);
}
