describe('web-safe platform fallbacks', () => {
  beforeEach(() => {
    jest.resetModules();
    Object.defineProperty(globalThis, 'window', {
      value: { open: jest.fn(() => null), location: { href: 'https://app.example/help-support' } },
      configurable: true,
      writable: true,
    });
  });

  it('opens a web link once in a new tab, even though noopener makes the browser return null', async () => {
    const { Platform, Linking } = require('react-native');
    Platform.OS = 'web';
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { openExternalLink } = require('@/utils/platform');

    await openExternalLink('https://example.org/guide');

    expect(globalThis.window.open).toHaveBeenCalledTimes(1);
    expect(globalThis.window.open).toHaveBeenCalledWith('https://example.org/guide', '_blank', 'noopener,noreferrer');
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it('hands a mail link to the mail app on web, without a blank tab', async () => {
    const { Platform, Linking } = require('react-native');
    Platform.OS = 'web';
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { openExternalLink } = require('@/utils/platform');

    await openExternalLink('mailto:support@aihabittracker.app');

    expect(globalThis.window.location.href).toBe('mailto:support@aihabittracker.app');
    expect(globalThis.window.open).not.toHaveBeenCalled();
    expect(openURLSpy).not.toHaveBeenCalled();
  });

  it('uses native Linking in the phone app', async () => {
    const { Platform, Linking } = require('react-native');
    Platform.OS = 'android';
    const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    const { openExternalLink } = require('@/utils/platform');

    await openExternalLink('mailto:support@aihabittracker.app');

    expect(openURLSpy).toHaveBeenCalledWith('mailto:support@aihabittracker.app');
    expect(globalThis.window.open).not.toHaveBeenCalled();
  });

  it('keeps notification logic available without crashing on web', async () => {
    const { Platform } = require('react-native');
    Platform.OS = 'web';

    const { supportsNativeNotifications, shouldUseWebNotificationFallback } = require('@/utils/platform');

    expect(supportsNativeNotifications).toBe(false);
    expect(shouldUseWebNotificationFallback).toBe(true);
  });
});
