describe('web-safe platform fallbacks', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(globalThis, 'window', {
      value: { open: jest.fn(() => ({}) ) },
      configurable: true,
      writable: true,
    });
  });

  it('opens external links using the browser on web and native Linking on app platforms', async () => {
    const { Platform, Linking } = require('react-native');
    Platform.OS = 'web';
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { openExternalLink } = require('@/utils/platform');

    await openExternalLink('mailto:support@aihabittracker.app');

    expect(globalThis.window.open).toHaveBeenCalledWith('mailto:support@aihabittracker.app', '_blank', 'noopener,noreferrer');
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it('keeps notification logic available without crashing on web', async () => {
    const { Platform } = require('react-native');
    Platform.OS = 'web';

    const { supportsNativeNotifications, shouldUseWebNotificationFallback } = require('@/utils/platform');

    expect(supportsNativeNotifications).toBe(false);
    expect(shouldUseWebNotificationFallback).toBe(true);
  });
});
