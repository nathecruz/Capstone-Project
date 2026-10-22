// The weekly bonus store shared by the Monday recap and the Quests tab: a claim stays claimed when
// an answer sent before it lands late, a change asked for during a load is loaded after it, and a
// claim answered after the day changed does not mark the new week claimed.
import { act, renderHook } from '@testing-library/react-native';
import { claimWeeklyBonus, getWeeklyBonus, type WeeklyBonus } from '@/authentication/authService';
import { claimLastWeekBonus, loadWeeklyBonus, reloadWeeklyBonus, useWeeklyBonus } from '@/hooks/use-weekly-bonus';

jest.mock('@/authentication/authService', () => ({ getWeeklyBonus: jest.fn(), claimWeeklyBonus: jest.fn() }));
jest.mock('@/authentication/session', () => {
  const listeners: (() => void)[] = [];
  return { subscribeToAuthChanges: (listener: () => void) => { listeners.push(listener); return () => undefined; }, mockSignOut: () => listeners.forEach((listener) => listener()) };
});

type Answer = Awaited<ReturnType<typeof getWeeklyBonus>>;
const tiers = [{ percent: 60, amount: 10, label: 'Steady week' }, { percent: 75, amount: 20, label: 'Strong week' }, { percent: 90, amount: 30, label: 'Consistent week' }];
/** The bonus on the day `today`, whose last week starts `weekStart`, at 80% (Strong week). */
function answer(weekStart: string, lastWeek: Partial<WeeklyBonus['lastWeek']> = {}, doneSoFar = 2): Answer {
  return {
    ok: true,
    lastWeek: { weekStart, weekEnd: '', scheduled: 20, done: 16, percent: 80, activeDays: 6, eligible: true, reason: null, tier: tiers[1], claimed: false, claimedAmount: null, claimable: true, lapsesAt: 0, ...lastWeek },
    thisWeek: { weekStart: '', weekEnd: '', dueSoFar: 3, doneSoFar, dueWeek: 21, percentSoFar: 66, next: null },
    tiers,
  };
}
const paid = { ok: true as const, amount: 20, alreadyClaimed: false, percent: 80, tier: tiers[1], tokens: 140, tokenHistory: [], points: 400 };
/** A request whose answer the test sends when it wants. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  jest.requireMock<{ mockSignOut: () => void }>('@/authentication/session').mockSignOut();
});

describe('weekly bonus store', () => {
  it('keeps a claimed bonus claimed when a load sent before the claim answers after it', async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-19'));
    const { result } = renderHook(() => useWeeklyBonus('2026-10-26'));
    await act(async () => undefined);
    expect(result.current.bonus?.lastWeek.claimable).toBe(true);

    // A check-in reloads it; the claim is paid before that answer arrives.
    const late = deferred<Answer>();
    jest.mocked(getWeeklyBonus).mockReturnValueOnce(late.promise);
    act(() => reloadWeeklyBonus());
    jest.mocked(claimWeeklyBonus).mockResolvedValueOnce(paid);
    await act(async () => {
      await claimLastWeekBonus('2026-10-26');
    });
    expect(result.current.bonus?.lastWeek).toMatchObject({ claimed: true, claimable: false, claimedAmount: 20 });

    await act(async () => late.resolve(answer('2026-10-19')));
    expect(result.current.bonus?.lastWeek).toMatchObject({ claimed: true, claimable: false, claimedAmount: 20 });
  });

  it('loads again after the running load when a change is reported meanwhile', async () => {
    const first = deferred<Answer>();
    jest.mocked(getWeeklyBonus).mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useWeeklyBonus('2026-10-26'));
    await act(async () => first.resolve(answer('2026-10-19', {}, 2)));

    // The reload's answer was counted before the next check-in; the change after it brings it.
    const before = deferred<Answer>();
    jest.mocked(getWeeklyBonus).mockReturnValueOnce(before.promise).mockResolvedValueOnce(answer('2026-10-19', {}, 4));
    act(() => reloadWeeklyBonus());
    act(() => reloadWeeklyBonus());
    await act(async () => before.resolve(answer('2026-10-19', {}, 3)));
    expect(result.current.bonus?.thisWeek.doneSoFar).toBe(4);
    expect(getWeeklyBonus).toHaveBeenCalledTimes(3);
  });

  it('sends one request when several cards open on the same day', async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValue(answer('2026-10-19'));
    renderHook(() => [useWeeklyBonus('2026-10-26'), useWeeklyBonus('2026-10-26'), useWeeklyBonus('2026-10-26')]);
    await act(async () => undefined);
    expect(getWeeklyBonus).toHaveBeenCalledTimes(1);
  });

  it("does not mark the new week's bonus claimed when a claim from the day before answers late", async () => {
    // Sunday: the week of October 12 waits. The claim is sent, then Monday starts.
    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-12'));
    const { result, rerender } = renderHook(({ date }: { date: string }) => useWeeklyBonus(date), { initialProps: { date: '2026-10-25' } });
    await act(async () => undefined);
    const claim = deferred<Awaited<ReturnType<typeof claimWeeklyBonus>>>();
    jest.mocked(claimWeeklyBonus).mockReturnValueOnce(claim.promise);
    let claimed: Promise<unknown> = Promise.resolve();
    act(() => {
      claimed = claimLastWeekBonus('2026-10-25');
    });

    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-19'));
    rerender({ date: '2026-10-26' });
    await act(async () => undefined);
    expect(result.current.bonus?.lastWeek).toMatchObject({ weekStart: '2026-10-19', claimable: true });

    await act(async () => {
      claim.resolve(paid);
      await claimed;
    });
    expect(result.current.bonus?.lastWeek).toMatchObject({ weekStart: '2026-10-19', claimable: true, claimed: false });
  });

  it("forgets a refused claim of the day before once the new day's bonus is loaded", async () => {
    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-12'));
    const { result, rerender } = renderHook(({ date }: { date: string }) => useWeeklyBonus(date), { initialProps: { date: '2026-10-25' } });
    await act(async () => undefined);
    // Sent at 23:59:59 on Sunday, answered on Monday: that week lapsed.
    jest.mocked(claimWeeklyBonus).mockResolvedValueOnce({ ok: false, code: 'DAY_CLOSED', message: "That day is over. Claim last week's bonus on your today." });
    jest.mocked(getWeeklyBonus).mockResolvedValueOnce({ ok: false, message: 'That day is over.' });
    await act(async () => {
      await claimLastWeekBonus('2026-10-25');
    });
    expect(result.current.error).toBe("That day is over. Claim last week's bonus on your today.");

    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-19'));
    rerender({ date: '2026-10-26' });
    await act(async () => undefined);
    expect(result.current).toMatchObject({ error: '', bonus: { lastWeek: { weekStart: '2026-10-19', claimable: true } } });
  });

  it('drops an answer for an account that signed out meanwhile', async () => {
    const pending = deferred<Answer>();
    jest.mocked(getWeeklyBonus).mockReturnValueOnce(pending.promise);
    const { result } = renderHook(() => useWeeklyBonus('2026-10-26'));
    act(() => jest.requireMock<{ mockSignOut: () => void }>('@/authentication/session').mockSignOut());
    await act(async () => pending.resolve(answer('2026-10-19')));
    expect(result.current.bonus).toBeNull();
    // The next account loads its own.
    jest.mocked(getWeeklyBonus).mockResolvedValueOnce(answer('2026-10-19', { claimable: false, eligible: false, tier: null, reason: 'low-rate' }));
    await act(async () => {
      await loadWeeklyBonus('2026-10-26');
    });
    expect(result.current.bonus?.lastWeek.claimable).toBe(false);
  });
});
