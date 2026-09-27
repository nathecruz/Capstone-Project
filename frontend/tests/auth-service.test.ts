import {
  getApiBaseUrl,
  getSession,
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

const fetchMock = jest.fn();

jest.mock('@/authentication/session', () => ({
  completePasswordReset: jest.fn(),
  getCurrentSession: jest.fn(),
  getRememberedEmail: jest.fn(),
  getSessionToken: jest.fn(),
  loginWithStoredAccount: jest.fn(),
  logoutUser: jest.fn(),
  readSavedAccounts: jest.fn(),
  requestPasswordReset: jest.fn(),
  saveNewAccount: jest.fn(),
  saveSessionToken: jest.fn(),
  setRememberedEmail: jest.fn(),
  subscribeToAuthChanges: jest.fn(),
  verifyResetCode: jest.fn(),
}));

describe('auth service offline behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAuthUrl === undefined) delete process.env.EXPO_PUBLIC_AUTH_URL; else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
    }
  });

  it('clears the session when the backend is unreachable', async () => {
    const cachedUser = { id: 'user-1', fullName: 'Test User', email: 'test@example.com' };
    jest.mocked(getCurrentSession).mockResolvedValue(cachedUser);
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(getSession()).resolves.toBeNull();
    expect(logoutUser).not.toHaveBeenCalled();
  });

  it('requires the backend to confirm the stored session', async () => {
    jest.mocked(getCurrentSession).mockResolvedValue({ fullName: 'Test User', email: 'test@example.com' });
    jest.mocked(getSessionToken).mockResolvedValue('session-token');
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ ok: false, message: 'Authentication required.' }),
    });

    await expect(isAuthenticated()).resolves.toBe(false);
    expect(logoutUser).toHaveBeenCalledTimes(1);
  });

  it('returns an actionable message when sign-in is attempted offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(signIn('test@example.com', 'password')).resolves.toEqual({
      ok: false,
      message: 'Unable to reach the account service. Connect to the internet and try again.',
    });
  });

  it('stores a server-issued session after successful sign-in', async () => {
    const user = { id: 'user-1', fullName: 'Test User', email: 'test@example.com' };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, token: 'issued-token', user }),
    });

    await expect(signIn('test@example.com', 'StrongPass!123')).resolves.toEqual({
      ok: true,
      message: 'Login successful.',
      user,
    });
    expect(saveSessionToken).toHaveBeenCalledWith('issued-token', user);
  });

  it('rejects a successful response that does not include a server session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        token: 'issued-token',
        user: { fullName: 'Test User', email: 'test@example.com' },
      }),
    });

    await expect(signIn('test@example.com', 'StrongPass!123')).resolves.toEqual({
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
      fullName: 'Test User',
      username: 'testuser',
      email: 'test@example.com',
      password: 'StrongPass!123',
      dateOfBirth: 'April 2, 2005',
      gender: 'Prefer not to say',
      region: 'Philippines',
    })).resolves.toEqual({
      ok: false,
      message: 'Registration is temporarily disabled.',
    });
  });

  it('shows the backend password reset error instead of the offline fallback', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' }),
      json: async () => ({ ok: false, message: 'The OTP is incorrect. Please check the code and try again.' }),
    });

    await expect(updatePasswordWithOtp('test@example.com', '123456', 'StrongPass!123')).resolves.toEqual({
      ok: false,
      message: 'The OTP is incorrect. Please check the code and try again.',
    });
  });

  it('blocks sign-in in production until the backend API URL is configured', async () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
    const previousAiApiUrl = process.env.EXPO_PUBLIC_AI_API_URL;
    const previousAuthUrl = process.env.EXPO_PUBLIC_AUTH_URL;
    process.env.NODE_ENV = 'production';
    delete process.env.EXPO_PUBLIC_API_URL;
    delete process.env.EXPO_PUBLIC_AI_API_URL;
    process.env.EXPO_PUBLIC_AUTH_URL = 'https://your-production-auth.example.com';

    try {
      await expect(signIn('test@example.com', 'StrongPass!123')).resolves.toEqual({
        ok: false,
        message: expect.stringContaining('Production API is not configured'),
      });
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousApiUrl === undefined) delete process.env.EXPO_PUBLIC_API_URL; else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
      if (previousAiApiUrl === undefined) delete process.env.EXPO_PUBLIC_AI_API_URL; else process.env.EXPO_PUBLIC_AI_API_URL = previousAiApiUrl;
      if (previousAuthUrl === undefined) delete process.env.EXPO_PUBLIC_AUTH_URL; else process.env.EXPO_PUBLIC_AUTH_URL = previousAuthUrl;
    }
  });
});
