// "Describe your habit" (utils/ai-client.ts parseHabit): the server's reading of a description is
// checked before it fills in the Add form, and a text that is no habit comes back with its reason.
import { parseHabit, readDescribedHabit } from '@/utils/ai-client';

const mockApiRequest = jest.fn();
jest.mock('@/authentication/authService', () => {
  class ApiRequestError extends Error {
    status: number;
    payload: Record<string, unknown>;
    constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  }
  return {
    ApiRequestError,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
    getAuthenticatedHeaders: async () => ({ Authorization: 'Bearer token' }),
  };
});

const reading = { label: 'Walk 3,000 steps', category: 'Health', frequency: 'Custom', days: ['Fri', 'Mon', 'Funday'], reminderTimes: ['06:00 AM', '7pm', '08:00 PM', '09:00 PM'], proof: { type: 'steps', steps: 90000 }, start: 'tomorrow' };

describe('a described habit', () => {
  it('is checked: known days in week order, real reminder times (2 at most) and proof within the limits', () => {
    expect(readDescribedHabit(reading)).toEqual({ label: 'Walk 3,000 steps', category: 'Health', frequency: 'Custom', days: ['Mon', 'Fri'], reminderTimes: ['06:00 AM', '08:00 PM'], proof: { type: 'steps', steps: 30000 }, start: 'tomorrow' });
    // Weekly or Custom without a day is Daily; an unknown start is today.
    expect(readDescribedHabit({ ...reading, frequency: 'Weekly', days: [], start: 'someday' })).toMatchObject({ frequency: 'Daily', days: [], start: 'today' });
    expect(readDescribedHabit({ ...reading, frequency: 'Daily' })).toMatchObject({ frequency: 'Daily', days: [] });
    for (const broken of [null, 'text', { ...reading, label: ' ' }, { ...reading, proof: { type: 'timer' } }, { ...reading, proof: { type: 'magic' } }]) expect(readDescribedHabit(broken)).toBeNull();
  });

  it('is read by the server, which may say the text is no habit', async () => {
    mockApiRequest.mockResolvedValueOnce({ ok: true, source: 'ai', habit: reading });
    const result = await parseHabit('  Walk 3,000 steps every morning  ');
    expect(result).toMatchObject({ ok: true, source: 'ai', habit: { label: 'Walk 3,000 steps' } });
    expect(mockApiRequest.mock.calls[0][0]).toBe('/api/habit/parse');
    expect(JSON.parse(mockApiRequest.mock.calls[0][1].body)).toEqual({ text: 'Walk 3,000 steps every morning' });

    const { ApiRequestError } = jest.requireMock('@/authentication/authService');
    mockApiRequest.mockRejectedValueOnce(new ApiRequestError('Unprocessable', 422, { ok: false, code: 'NOT_A_HABIT', error: 'Try a real habit, like walking after class.' }));
    expect(await parseHabit('asdf')).toEqual({ ok: false, status: 422, message: 'Try a real habit, like walking after class.' });
    mockApiRequest.mockResolvedValueOnce({ ok: true, source: 'rules', habit: { label: '' } });
    expect(await parseHabit('Walk')).toEqual({ ok: false, status: 502, message: 'HabitAI could not read that description.' });
    mockApiRequest.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await parseHabit('Walk')).toMatchObject({ ok: false, status: 0 });
  });
});
