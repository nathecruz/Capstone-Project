import { generateGoalPlan } from '@/utils/ai-client';

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

const request = { goal: 'Plan my week', focusTarget: '3 habits', timeline: '7-14 days' };

describe('generateGoalPlan', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends only the goal and choices (the server reads the history) and returns the planned habits', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, plan: { summary: 'A steady week.', habitSuggestions: ['Morning walk'], habits: [{ name: 'Morning walk', category: 'Health', frequency: 'Daily', days: [], time: '06:30 AM', reason: 'You walked 6 of 7 days.' }, { name: '' }] } });

    const result = await generateGoalPlan<{ summary: string; habitSuggestions: string[] }>(request);

    const [path, options] = mockApiRequest.mock.calls[0] as [string, { body: string }];
    expect(path).toBe('/api/goals/generate');
    expect(Object.keys(JSON.parse(options.body)).sort()).toEqual(['focusTarget', 'goal', 'timeZone', 'timeline']);
    expect(result).toEqual({
      ok: true,
      plan: {
        summary: 'A steady week.',
        habitSuggestions: ['Morning walk'],
        habits: [{ name: 'Morning walk', category: 'Health', frequency: 'Daily', days: [], time: '06:30 AM', reason: 'You walked 6 of 7 days.' }],
      },
    });
  });

  it('leaves habits out when the server sent none usable (older servers)', async () => {
    mockApiRequest.mockResolvedValue({ ok: true, plan: { summary: 'A steady week.', habitSuggestions: ['Morning walk'] } });
    const result = await generateGoalPlan<{ summary: string }>(request);
    expect(result.ok && 'habits' in result.plan).toBe(false);

    mockApiRequest.mockResolvedValue({ ok: true, plan: { summary: 'A steady week.', habits: [{ reason: 'no name' }] } });
    const malformed = await generateGoalPlan<{ summary: string }>(request);
    expect(malformed.ok && 'habits' in malformed.plan).toBe(false);
  });
});
