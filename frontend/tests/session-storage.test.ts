import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { getSessionToken, logoutUser, requestPasswordReset, saveSessionToken } from '@/authentication/session';

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
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(SecureStore.getItemAsync).not.toHaveBeenCalled();
  });

  it('moves legacy web tokens into session-only storage', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('legacy-token');

    await expect(getSessionToken()).resolves.toBe('legacy-token');
    expect(webSessionStorage.setItem).toHaveBeenCalledWith('habitai_session_token', 'legacy-token');
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith('habitai_session_token');
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
      await requestPasswordReset('test@example.org');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.org/api/auth/forgot-password',
        expect.any(Object),
      );
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAuthUrl === undefined) delete process.env.EXPO_PUBLIC_AUTH_URL; else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
      globalThis.fetch = previousFetch;
    }
  });
});
