import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { resetPassword } from '@/authentication/authService';
import { getSessionToken, logoutUser, saveSessionToken } from '@/authentication/session';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
  },
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

const platformDescriptor = Object.getOwnPropertyDescriptor(Platform, 'OS');
const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
const webSessionStorage = {
  getItem: jest.fn<string | null, [string]>(),
  setItem: jest.fn<void, [string, string]>(),
  removeItem: jest.fn<void, [string]>(),
};
const unsetEnv = (key: string) => {
  delete (process.env as Record<string, string | undefined>)[key];
};

function setPlatform(platform: string) {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: platform });
}

describe('session token storage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setPlatform('web');
    webSessionStorage.getItem.mockReturnValue(null);
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: webSessionStorage },
    });
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    jest.mocked(AsyncStorage.setItem).mockResolvedValue(undefined);
    jest.mocked(AsyncStorage.removeItem).mockResolvedValue(undefined);
    jest.mocked(SecureStore.setItemAsync).mockResolvedValue(undefined);
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue(null);
    jest.mocked(SecureStore.deleteItemAsync).mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (platformDescriptor) {
      Object.defineProperty(Platform, 'OS', platformDescriptor);
    }
    if (windowDescriptor) {
      Object.defineProperty(globalThis, 'window', windowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('stores and reads web session tokens without calling native SecureStore', async () => {
    const user = { fullName: 'Test User', email: 'test@example.com' };
    await saveSessionToken('web-token', user);
    webSessionStorage.getItem.mockReturnValue('web-token');

    await expect(getSessionToken()).resolves.toBe('web-token');
    expect(webSessionStorage.setItem).toHaveBeenCalledWith('habitai_session_token', 'web-token');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('moves legacy web tokens into session-only storage', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('legacy-token');

    await expect(getSessionToken()).resolves.toBe('legacy-token');
    expect(webSessionStorage.setItem).toHaveBeenCalledWith('habitai_session_token', 'legacy-token');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
  });

  it('persists the web token in localStorage for an installed PWA, not ephemeral sessionStorage', async () => {
    const localStore = {
      getItem: jest.fn<string | null, [string]>().mockReturnValue(null),
      setItem: jest.fn<void, [string, string]>(),
      removeItem: jest.fn<void, [string]>(),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        sessionStorage: webSessionStorage,
        localStorage: localStore,
        // Standalone display mode = installed PWA.
        matchMedia: jest.fn().mockReturnValue({ matches: true }),
      },
    });

    await saveSessionToken('pwa-token', { fullName: 'PWA User', email: 'pwa@example.com' });
    expect(localStore.setItem).toHaveBeenCalledWith('habitai_session_token', 'pwa-token');
    expect(webSessionStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
    expect(webSessionStorage.setItem).not.toHaveBeenCalled();

    localStore.getItem.mockReturnValue('pwa-token');
    await expect(getSessionToken()).resolves.toBe('pwa-token');
  });

  it('keeps the token the installed (Home Screen) app saves, although web AsyncStorage is that same localStorage', async () => {
    // As in a browser: AsyncStorage on the web reads and writes window.localStorage under the same keys.
    const stored = new Map<string, string>();
    const localStore = {
      getItem: jest.fn<string | null, [string]>((key) => stored.get(key) ?? null),
      setItem: jest.fn<void, [string, string]>((key, value) => { stored.set(key, value); }),
      removeItem: jest.fn<void, [string]>((key) => { stored.delete(key); }),
    };
    jest.mocked(AsyncStorage.getItem).mockImplementation(async (key: string) => stored.get(key) ?? null);
    jest.mocked(AsyncStorage.setItem).mockImplementation(async (key: string, value: string) => { stored.set(key, value); });
    jest.mocked(AsyncStorage.removeItem).mockImplementation(async (key: string) => { stored.delete(key); });
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: webSessionStorage, localStorage: localStore, matchMedia: jest.fn().mockReturnValue({ matches: true }) },
    });

    await saveSessionToken('home-screen-token', { fullName: 'Phone User', email: 'phone@example.com' });

    expect(stored.get('habitai_session_token')).toBe('home-screen-token');
    await expect(getSessionToken()).resolves.toBe('home-screen-token');
  });

  it('keeps a phone-browser sign-in after its tab is closed when Remember me was ticked', async () => {
    const stored = new Map<string, string>();
    const localStore = {
      getItem: jest.fn<string | null, [string]>((key) => stored.get(key) ?? null),
      setItem: jest.fn<void, [string, string]>((key, value) => { stored.set(key, value); }),
      removeItem: jest.fn<void, [string]>((key) => { stored.delete(key); }),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: webSessionStorage, localStorage: localStore, matchMedia: jest.fn().mockReturnValue({ matches: false }) },
    });

    await saveSessionToken('remembered-token', { fullName: 'Phone User', email: 'phone@example.com' }, { persist: true });
    expect(stored.get('habitai_session_token')).toBe('remembered-token');
    expect(webSessionStorage.setItem).not.toHaveBeenCalled();

    // A new tab starts with an empty sessionStorage and still finds the session.
    await expect(getSessionToken()).resolves.toBe('remembered-token');

    await logoutUser();
    expect(stored.has('habitai_session_token')).toBe(false);
    expect(stored.has('habitai_keep_signed_in')).toBe(false);
  });

  it('keeps a browser sign-in for this tab only without Remember me', async () => {
    const localStore = {
      getItem: jest.fn<string | null, [string]>().mockReturnValue(null),
      setItem: jest.fn<void, [string, string]>(),
      removeItem: jest.fn<void, [string]>(),
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { sessionStorage: webSessionStorage, localStorage: localStore, matchMedia: jest.fn().mockReturnValue({ matches: false }) },
    });

    await saveSessionToken('tab-token', { fullName: 'Tab User', email: 'tab@example.com' }, { persist: false });
    expect(webSessionStorage.setItem).toHaveBeenCalledWith('habitai_session_token', 'tab-token');
    expect(localStore.removeItem).toHaveBeenCalledWith('habitai_keep_signed_in');
    expect(localStore.setItem).not.toHaveBeenCalled();
  });

  it('stores native session tokens in SecureStore', async () => {
    setPlatform('android');
    const user = { fullName: 'Test User', email: 'test@example.com' };
    await saveSessionToken('native-token', user);

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('habitai_session_token', 'native-token');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
  });

  it('clears web tokens without calling native SecureStore', async () => {
    await logoutUser();

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
    expect(webSessionStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('sends password reset requests to the backend API, not the Neon Auth URL', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL;
    const previousFetch = globalThis.fetch;
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ ok: true, message: 'A verification code was sent.' }),
    });
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.org';
    process.env.EXPO_PUBLIC_AUTH_URL = 'https://neon-auth.example.org/auth';
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await resetPassword('test@example.org');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.org/api/auth/forgot-password',
        expect.any(Object),
      );
    } finally {
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAuthUrl === undefined) unsetEnv('EXPO_PUBLIC_AUTH_URL'); else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
      globalThis.fetch = previousFetch;
    }
  });
});
