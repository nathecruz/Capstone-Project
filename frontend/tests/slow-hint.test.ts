import { act, renderHook } from '@testing-library/react-native';
import { useSlowHint } from '@/hooks/use-slow-hint';

describe('useSlowHint', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns on only after the wait has lasted, and off when it ends', () => {
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useSlowHint(active, 6000), { initialProps: { active: true } });
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(5999); });
    expect(result.current).toBe(false);
    act(() => { jest.advanceTimersByTime(1); });
    expect(result.current).toBe(true);
    rerender({ active: false });
    expect(result.current).toBe(false);
  });

  it('stays off for quick requests', () => {
    const { result, rerender } = renderHook(({ active }: { active: boolean }) => useSlowHint(active, 6000), { initialProps: { active: true } });
    act(() => { jest.advanceTimersByTime(2000); });
    rerender({ active: false });
    act(() => { jest.advanceTimersByTime(10000); });
    expect(result.current).toBe(false);
  });
});
