import { getInstallPlatform, isInAppBrowser, promptInstall } from '@/utils/install-app';

const agents = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  iphoneMessenger: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/480.0]',
  ipadOs: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36',
  androidWebView: 'Mozilla/5.0 (Linux; Android 14; SM-A546E; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/152.0.0.0 Mobile Safari/537.36',
  windowsEdge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36 Edg/152.0.0.0',
};

function useBrowser(userAgent: string, { platform = '', maxTouchPoints = 0 } = {}) {
  Object.defineProperty(globalThis.navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(globalThis.navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(globalThis.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
}

describe('install HabitAI', () => {
  it('tells iPhone, iPad, Android and computers apart', () => {
    useBrowser(agents.iphoneSafari);
    expect(getInstallPlatform()).toBe('ios');
    // iPadOS asks for desktop sites and reports a Mac, but with touch.
    useBrowser(agents.ipadOs, { platform: 'MacIntel', maxTouchPoints: 5 });
    expect(getInstallPlatform()).toBe('ios');
    useBrowser(agents.ipadOs, { platform: 'MacIntel', maxTouchPoints: 0 });
    expect(getInstallPlatform()).toBe('desktop');
    useBrowser(agents.androidChrome);
    expect(getInstallPlatform()).toBe('android');
    useBrowser(agents.windowsEdge);
    expect(getInstallPlatform()).toBe('desktop');
  });

  it('spots browsers inside other apps, which cannot install', () => {
    useBrowser(agents.iphoneMessenger);
    expect(isInAppBrowser()).toBe(true);
    useBrowser(agents.androidWebView);
    expect(isInAppBrowser()).toBe(true);
    useBrowser(agents.iphoneSafari);
    expect(isInAppBrowser()).toBe(false);
    useBrowser(agents.androidChrome);
    expect(isInAppBrowser()).toBe(false);
  });

  it('says when the browser has no install prompt to open', async () => {
    await expect(promptInstall()).resolves.toBe('unavailable');
  });
});
