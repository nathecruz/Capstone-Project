import { warmUpServer } from '@/authentication/authService';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

jest.mock('expo-secure-store', () => ({
  setItemAsync: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

describe('warmUpServer', () => {
  const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;
  const previousFetch = globalThis.fetch;

  afterEach(() => {
    if (previousApiUrl === undefined) delete (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
    globalThis.fetch = previousFetch;
  });

  it('pings the backend health check at most once a minute and never throws', async () => {
    const fetchMock = jest.fn().mockRejectedValue(new Error('offline'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.org';

    const start = 10_000_000;
    warmUpServer(start);
    warmUpServer(start + 30_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.org/healthz');

    warmUpServer(start + 61_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await Promise.resolve();
  });
});
