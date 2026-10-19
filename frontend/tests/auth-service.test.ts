import * as Network from 'expo-network';
import {
  getApiBaseUrl,
  getLiveVersions,
  getSession,
  saveRemoteHabitCompletion,
  signIn,
  signUp,
  updatePasswordWithOtp,
} from '@/authentication/authService';
import {
  getCurrentSession,
  getSessionToken,
  logoutUser,
  saveSessionToken,
} from '@/authentication/session';
import { isAuthenticated } from '@/authorization';
import { Platform } from 'react-native';

const fetchMock = jest.fn();
const unsetEnv = (key: string) => {
  delete (process.env as Record<string, string | undefined>)[key];
};

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
const deviceOnline = (online: boolean) => jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
  isConnected: online,
  isInternetReachable: online,
} as Awaited<ReturnType<typeof Network.getNetworkStateAsync>>);
const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(),
  getRememberedEmail: jest.fn(),
  getSessionToken: jest.fn(),
  logoutUser: jest.fn(),
  saveSessionToken: jest.fn(),
  setRememberedEmail: jest.fn(),
  subscribeToAuthChanges: jest.fn(),
}));

describe('auth service offline behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    deviceOnline(true);
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('uses the backend API URL instead of the separate Neon Auth URL', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL;
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.org';
    process.env.EXPO_PUBLIC_AUTH_URL = 'https://neon-auth.example.org/auth';

    try {
      expect(getApiBaseUrl()).toBe('https://api.example.org');
    } finally {
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAuthUrl === undefined) unsetEnv('EXPO_PUBLIC_AUTH_URL'); else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
    }
  });

  it('keeps the cached session while the backend is unreachable (offline or waking up)', async () => {
    const cachedUser = { id: 'user-1', fullName: 'Test User', email: 'test@psau.edu.ph' };
    jest.mocked(getCurrentSession).mockResolvedValue(cachedUser);
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(getSession()).resolves.toEqual(cachedUser);
    expect(logoutUser).not.toHaveBeenCalled();
  });

  it('requires the backend to confirm the stored session', async () => {
    jest.mocked(getCurrentSession).mockResolvedValue({ fullName: 'Test User', email: 'test@psau.edu.ph' });
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ ok: false, message: 'Authentication required.' }),
    });

    await expect(isAuthenticated()).resolves.toBe(false);
    expect(logoutUser).toHaveBeenCalledTimes(1);
  });

  it('stores a role the server changed, so Faculty mode turns on without signing out', async () => {
    const stored = { id: 'u1', fullName: 'Jose Reyes', email: 'jose@psau.edu.ph' };
    const fromServer = { ...stored, role: 'faculty' as const };
    jest.mocked(getCurrentSession).mockResolvedValue(stored);
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify({ ok: true, user: fromServer }) });

    await expect(getSession()).resolves.toEqual(fromServer);
    expect(saveSessionToken).toHaveBeenCalledWith('session-token', fromServer);

    // Same role as stored: nothing is saved (saving notifies listeners, which would loop).
    jest.mocked(saveSessionToken).mockClear();
    jest.mocked(getCurrentSession).mockResolvedValue(fromServer);
    await getSession();
    expect(saveSessionToken).not.toHaveBeenCalled();
  });

  it('sends the device time zone with habit completions', async () => {
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, completions: [] }),
    });

    await saveRemoteHabitCompletion({ habitId: 'habit-1', date: '2026-09-30', completed: true });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      habitId: 'habit-1',
      date: '2026-09-30',
      completed: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    });
  });

  it('says there is no internet when sign-in fails on a phone with no connection', async () => {
    deviceOnline(false);
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(signIn('test@psau.edu.ph', 'password')).resolves.toEqual({
      ok: false,
      message: 'No internet connection. Connect to Wi-Fi or mobile data, then try again.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a sign-in again once the waking server answers, when its connection was dropped', async () => {
    const user = { id: 'user-1', fullName: 'Test User', email: 'test@psau.edu.ph' };
    fetchMock
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(answer(200, { ok: true }))
      .mockResolvedValueOnce(answer(200, { ok: true, token: 'issued-token', user }));

    await expect(signIn('test@psau.edu.ph', 'StrongPass!123')).resolves.toMatchObject({ ok: true, user });
    expect(fetchMock.mock.calls.map(([url]) => String(url).replace(/^https?:\/\/[^/]+/, ''))).toEqual(['/api/auth/login', '/healthz', '/api/auth/login']);
  });

  it('does not blame the internet when the server takes too long to start', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    await expect(signIn('test@psau.edu.ph', 'password')).resolves.toEqual({
      ok: false,
      message: 'The HabitAI server is taking too long to start. Please try again in a few seconds.',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shows a readable message instead of the host\'s HTML error page', async () => {
    fetchMock.mockResolvedValue(answer(502, '<!DOCTYPE html><html><body>Bad gateway</body></html>'));

    await expect(signIn('test@psau.edu.ph', 'password')).resolves.toEqual({
      ok: false,
      message: 'The HabitAI server is starting up. Please try again in a moment.',
    });
  });

  it('does not call a correct password wrong when the answer is not the API\'s (a Wi-Fi sign-in page)', async () => {
    fetchMock.mockResolvedValue(answer(200, '<html><body>Log in to the school Wi-Fi</body></html>'));

    await expect(signIn('test@psau.edu.ph', 'password')).resolves.toEqual({
      ok: false,
      message: 'The sign-in service sent an unexpected answer. Please try again.',
    });
  });

  it('keeps an account whose confirmed email is at another domain signed in', async () => {
    const user = { id: 'user-1', fullName: 'Test User', email: 'test@student.psau.edu.ph' };
    jest.mocked(getCurrentSession).mockResolvedValue(user);
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue(answer(200, { ok: true, user }));

    await expect(getSession()).resolves.toEqual(user);
    expect(logoutUser).not.toHaveBeenCalled();
  });

  it('signs out when the live check finds the session ended on the server', async () => {
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue(answer(401, { ok: false, message: 'Authentication required.' }));

    await expect(getLiveVersions()).resolves.toMatchObject({ ok: false });
    expect(logoutUser).toHaveBeenCalledTimes(1);
  });

  it('keeps the session when the live check cannot reach the server', async () => {
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(getLiveVersions()).resolves.toMatchObject({ ok: false });
    expect(logoutUser).not.toHaveBeenCalled();
  });

  it('stores a server-issued session after successful sign-in', async () => {
    const user = { id: 'user-1', fullName: 'Test User', email: 'test@psau.edu.ph' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, token: 'issued-token', user }),
    });

    await expect(signIn('test@psau.edu.ph', 'StrongPass!123')).resolves.toEqual({
      ok: true,
      message: 'Login successful.',
      user,
    });
    expect(saveSessionToken).toHaveBeenCalledWith('issued-token', user, { persist: false });
  });

  it('shows the server reason when a system admin tries to sign in to the app', async () => {
    const message = 'System admin accounts cannot sign in to the HabitAI app. Please use the HabitAI Admin Panel.';
    fetchMock.mockResolvedValue({ ok: false, status: 403, text: async () => JSON.stringify({ ok: false, code: 'ADMIN_ACCOUNT', message }) });

    await expect(signIn('admin@psau.edu.ph', 'StrongPass!123')).resolves.toEqual({ ok: false, message });
    expect(saveSessionToken).not.toHaveBeenCalled();
  });

  it('does not keep a system admin session even if a server issues one', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, token: 'issued-token', user: { id: 'admin-1', fullName: 'Site Admin', email: 'admin@psau.edu.ph', role: 'admin' } }),
    });

    const result = await signIn('admin@psau.edu.ph', 'StrongPass!123');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/Admin Panel/);
    expect(saveSessionToken).not.toHaveBeenCalled();
  });

  it('rejects a successful response that does not include a server session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        token: 'issued-token',
        user: { fullName: 'Test User', email: 'test@psau.edu.ph' },
      }),
    });

    await expect(signIn('test@psau.edu.ph', 'StrongPass!123')).resolves.toEqual({
      ok: false,
      message: 'The account service returned an incomplete sign-in response.',
    });
    expect(saveSessionToken).not.toHaveBeenCalled();
  });

  it('surfaces the backend error text when registration fails with a non-JSON response', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'Registration is temporarily disabled.',
      json: async () => {
        throw new Error('Not JSON');
      },
    });

    await expect(signUp({
      firstName: 'Test',
      lastName: 'User',
      username: 'testuser',
      email: 'test@psau.edu.ph',
      password: 'StrongPass!123',
      dateOfBirth: 'April 2, 2005',
      gender: 'Prefer not to say',
      region: 'Philippines',
      privacyConsent: true,
    })).resolves.toEqual({
      ok: false,
      message: 'Registration is temporarily disabled.',
    });
  });

  it('registers with a separate first and last name', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, text: async () => JSON.stringify({ ok: false, message: 'stop' }) });
    await signUp({ firstName: ' Juan ', lastName: 'Dela Cruz', username: 'juan', email: 'juan@psau.edu.ph', password: 'StrongPass!123', dateOfBirth: 'April 2, 2005', gender: 'Male', region: 'Philippines', privacyConsent: true });
    const body = JSON.parse(fetchMock.mock.calls.at(-1)[1].body);
    expect(body).toMatchObject({ firstName: 'Juan', lastName: 'Dela Cruz' });
    expect(body.fullName).toBeUndefined();
  });

  it('shows the backend password reset error instead of the offline fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' }),
      json: async () => ({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' }),
    });

    await expect(updatePasswordWithOtp('test@psau.edu.ph', '123456', 'StrongPass!123')).resolves.toEqual({
      ok: false,
      message: 'The OTP is incorrect. Please check the code and try again.',
    });
  });

  it('signs in against the deployed backend when a production build has no API URL', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAiApiUrl = process.env.EXPO_PUBLIC_AI_API_URL;
    const previousAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL;
    process.env.NODE_ENV = 'production';
    unsetEnv('EXPO_PUBLIC_API_URL');
    unsetEnv('EXPO_PUBLIC_AI_API_URL');
    process.env.EXPO_PUBLIC_AUTH_URL = 'https://your-production-auth.example.com';

    try {
      fetchMock.mockResolvedValue(answer(401, { ok: false, message: 'Incorrect email or password.' }));
      await expect(signIn('test@psau.edu.ph', 'StrongPass!123')).resolves.toEqual({
        ok: false,
        message: 'Incorrect email or password.',
      });
      expect(fetchMock).toHaveBeenCalledWith('https://habitai-backend.onrender.com/api/auth/login', expect.anything());
    } finally {
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAiApiUrl === undefined) unsetEnv('EXPO_PUBLIC_AI_API_URL'); else process.env.EXPO_PUBLIC_AI_API_URL = previousAiApiUrl;
      if (previousAuthUrl === undefined) unsetEnv('EXPO_PUBLIC_AUTH_URL'); else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
    }
  });

  it('allows localhost web previews in production without a deployed backend URL', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAiApiUrl = process.env.EXPO_PUBLIC_AI_API_URL;
    const previousAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL;
    const previousLocation = window.location;
    const previousPlatform = Platform.OS;

    Platform.OS = 'web';
    process.env.NODE_ENV = 'production';
    unsetEnv('EXPO_PUBLIC_API_URL');
    unsetEnv('EXPO_PUBLIC_AI_API_URL');
    unsetEnv('EXPO_PUBLIC_AUTH_URL');

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...previousLocation, hostname: 'localhost' },
    });

    try {
      expect(getApiBaseUrl()).toBe('http://localhost:8787');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: previousLocation,
      });
      Platform.OS = previousPlatform;
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAiApiUrl === undefined) unsetEnv('EXPO_PUBLIC_AI_API_URL'); else process.env.EXPO_PUBLIC_AI_API_URL = previousAiApiUrl;
      if (previousAuthUrl === undefined) unsetEnv('EXPO_PUBLIC_AUTH_URL'); else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
    }
  });

  it('reaches a localhost API in .env through the laptop\'s address when a phone opens the dev server', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousLocation = window.location;
    const previousPlatform = Platform.OS;

    Platform.OS = 'web';
    process.env.NODE_ENV = 'development';
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8787/';
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...previousLocation, hostname: '192.168.1.23' },
    });

    try {
      expect(getApiBaseUrl()).toBe('http://192.168.1.23:8787');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: previousLocation,
      });
      Platform.OS = previousPlatform;
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
    }
  });

  it('allows an explicitly configured localhost API in production localhost previews', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAiApiUrl = process.env.EXPO_PUBLIC_AI_API_URL;
    const previousLocation = window.location;
    const previousPlatform = Platform.OS;

    Platform.OS = 'web';
    process.env.NODE_ENV = 'production';
    process.env.EXPO_PUBLIC_API_URL = 'http://localhost:8787';
    unsetEnv('EXPO_PUBLIC_AI_API_URL');
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...previousLocation, hostname: 'localhost' },
    });

    try {
      expect(getApiBaseUrl()).toBe('http://localhost:8787');
    } finally {
      Object.defineProperty(window, 'location', {
        configurable: true,
        value: previousLocation,
      });
      Platform.OS = previousPlatform;
      if (previousNodeEnv === undefined) unsetEnv('NODE_ENV'); else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) unsetEnv('EXPO_PUBLIC_API_URL'); else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAiApiUrl === undefined) unsetEnv('EXPO_PUBLIC_AI_API_URL'); else process.env.EXPO_PUBLIC_AI_API_URL = previousAiApiUrl;
    }
  });
});
