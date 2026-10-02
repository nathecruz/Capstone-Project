import { analyzeHabit } from '@/authentication/authService';
import { getSessionToken } from '@/authentication/session';

jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(),
  getRememberedEmail: jest.fn(),
  getSessionToken: jest.fn(),
  logoutUser: jest.fn(),
  saveSessionToken: jest.fn(),
  setRememberedEmail: jest.fn(),
  subscribeToAuthChanges: jest.fn(),
}));

const fetchMock = jest.fn();
const reply = (status: number, body: object) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });

describe('analyzeHabit', () => {
  const previousApiUrl = process.env.EXPO_PUBLIC_API_URL;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.EXPO_PUBLIC_API_URL = 'https://api.example.org';
    (getSessionToken as jest.Mock).mockResolvedValue('session-token');
  });

  afterAll(() => {
    if (previousApiUrl === undefined) delete (process.env as Record<string, string | undefined>).EXPO_PUBLIC_API_URL;
    else process.env.EXPO_PUBLIC_API_URL = previousApiUrl;
  });

  it('asks the server for one habit with the device time zone', async () => {
    const analysis = { habitId: 'habit-1', stats: { completionRate: 0.5 }, ml: null, ai: null };
    fetchMock.mockResolvedValue(reply(200, { ok: true, ...analysis }));
    const result = await analyzeHabit('habit-1');
    expect(result).toMatchObject({ ok: true, analysis: { habitId: 'habit-1' } });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.example.org/api/insights/habit-analysis');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer session-token');
    expect(JSON.parse(init.body)).toEqual({ habitId: 'habit-1', timeZone: expect.any(String) });
  });

  it('explains a habit the server has not received yet', async () => {
    fetchMock.mockResolvedValue(reply(404, { ok: false, error: 'Habit not found.' }));
    await expect(analyzeHabit('new-habit')).resolves.toEqual({ ok: false, message: 'This habit is still syncing. Try again in a few seconds.' });
  });

  it('does not call the server when signed out', async () => {
    (getSessionToken as jest.Mock).mockResolvedValue(null);
    await expect(analyzeHabit('habit-1')).resolves.toEqual({ ok: false, message: 'You are not signed in.' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
