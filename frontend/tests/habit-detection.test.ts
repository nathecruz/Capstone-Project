import { detectBadHabit } from '@/utils/habit-detection';

describe('detectBadHabit', () => {
  it('flags clearly unhealthy habits', () => {
    expect(detectBadHabit('Smoke cigarettes every day').isBadHabit).toBe(true);
    expect(detectBadHabit('Skip workouts and sleep late').isBadHabit).toBe(true);
    expect(detectBadHabit('Scroll all night instead of sleeping').isBadHabit).toBe(true);
  });

  it('keeps healthy habits as good inputs', () => {
    expect(detectBadHabit('Drink Water').isBadHabit).toBe(false);
    expect(detectBadHabit('Exercise / Workout').isBadHabit).toBe(false);
    expect(detectBadHabit('Read a Book').isBadHabit).toBe(false);
  });

  it('returns a clear reason for flagged habits', () => {
    const result = detectBadHabit('Procrastinate and skip assignments');
    expect(result.isBadHabit).toBe(true);
    expect(result.reason).toContain('bad habit');
  });
});
