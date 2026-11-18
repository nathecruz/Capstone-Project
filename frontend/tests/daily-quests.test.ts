import type { DailyChallenge } from '@/authentication/authService';
import { formatTimeLeft, habiQuestLine, isQuestMissed, questChest, questHint, questsResetAt, questStreakLine } from '@/utils/daily-quests';

const quest = (id: string, extra: Partial<DailyChallenge> = {}): DailyChallenge => ({ id, title: id, icon: 'trophy', target: 3, progress: 1, reward: 10, date: '2026-11-18', complete: false, reachable: true, ...extra });
// Wednesday 18 November 2026, 9:20 AM on the device.
const morning = new Date(2026, 10, 18, 9, 20);
const afternoon = new Date(2026, 10, 18, 15, 5);

describe('daily quests', () => {
  it('says what is left on each quest, and how long a time-of-day quest has', () => {
    expect(questHint(quest('finish'), morning)).toBe('2 more habits to go');
    expect(questHint(quest('finish', { progress: 2 }), morning)).toBe('1 more habit to go');
    expect(questHint(quest('perfect-day', { target: 4 }), morning)).toBe('3 more habits for a perfect day');
    expect(questHint(quest('early-bird', { target: 1, progress: 0 }), morning)).toBe('Before 10 AM · 40m left');
    expect(questHint(quest('two-by-noon', { target: 2, progress: 1 }), morning)).toBe('1 more before noon · 2h 40m left');
    expect(questHint(quest('comeback', { target: 1, progress: 0 }), morning)).toBe('Check it in today');
    expect(questHint(quest('streak-keeper', { target: 1, progress: 0 }), morning)).toBe('Check it in today');
    expect(questHint(quest('streak-keeper', { target: 3, progress: 1 }), morning)).toBe('2 more streaks to keep');
    expect(questHint(quest('finish', { complete: true, progress: 3 }), morning)).toBe('Done');
  });

  it('marks a quest missed when the server says so, or when its time passed since', () => {
    expect(isQuestMissed(quest('finish', { reachable: false }), morning)).toBe(true);
    expect(isQuestMissed(quest('early-bird', { target: 1, progress: 0 }), morning)).toBe(false);
    // Still reachable when the server answered at 9 AM; it is 3 PM now.
    expect(isQuestMissed(quest('early-bird', { target: 1, progress: 0 }), afternoon)).toBe(true);
    expect(questHint(quest('two-by-noon', { target: 2, progress: 1 }), afternoon)).toBe('Missed today');
    // Done stays done.
    expect(isQuestMissed(quest('early-bird', { target: 1, progress: 1, complete: true }), afternoon)).toBe(false);
    // An older server sends no `reachable`: the quest is open.
    expect(isQuestMissed(quest('finish', { reachable: undefined }), afternoon)).toBe(false);
  });

  it('opens the quest chest once every quest is done, and closes it for the day when one is missed', () => {
    const open = questChest([quest('finish', { complete: true }), quest('comeback', { complete: true })], 10, morning);
    expect(open).toEqual({ reward: 10, done: 2, total: 2, complete: true, missed: false, shown: true });
    const waiting = questChest([quest('finish', { complete: true }), quest('comeback')], 10, morning);
    expect([waiting.complete, waiting.missed, waiting.done]).toEqual([false, false, 1]);
    const lost = questChest([quest('finish', { complete: true }), quest('early-bird', { target: 1, progress: 0 })], 10, afternoon);
    expect([lost.complete, lost.missed]).toEqual([false, true]);
    expect(questChest([quest('finish')], 0, morning).shown).toBe(false);
    expect(questChest([], 10, morning).shown).toBe(false);
  });

  it('says how the quest streak stands', () => {
    expect(questStreakLine(2, { complete: true, missed: false })).toBe('3 days in a row with the chest opened');
    expect(questStreakLine(0, { complete: true, missed: false })).toBe('1 day in a row with the chest opened');
    expect(questStreakLine(4, { complete: false, missed: false })).toBe("4-day quest streak · open today's chest to keep it");
    expect(questStreakLine(4, { complete: false, missed: true })).toBe('Your 4-day quest streak ends today');
    expect(questStreakLine(0, { complete: false, missed: false })).toBe('Open the chest on days in a row for a quest streak');
  });

  it('lets Habi cheer the quests on', () => {
    const chest = (done: number, extra: Partial<ReturnType<typeof questChest>> = {}) => ({ reward: 10, done, total: 3, complete: done === 3, missed: false, shown: true, ...extra });
    expect(habiQuestLine(chest(0))).toBe('Finish all 3 quests to open the chest: +10!');
    expect(habiQuestLine(chest(2))).toBe('1 more quest and the chest opens: +10!');
    expect(habiQuestLine(chest(3))).toBe('We opened the chest! +10 bonus tokens.');
    expect(habiQuestLine(chest(1, { missed: true }))).toBe('One got away today, but the rest still pay!');
    expect(habiQuestLine(chest(1, { shown: false, reward: 0 }))).toBe('2 more quests to go today!');
  });

  it('counts down to the new quests: the server\'s reset time, else the next midnight', () => {
    expect(formatTimeLeft(5 * 3_600_000 + 12 * 60_000 + 30_000)).toBe('5h 12m');
    expect(formatTimeLeft(45 * 60_000)).toBe('45m');
    expect(formatTimeLeft(20_000)).toBe('under a minute');
    const midnight = new Date(2026, 10, 19).getTime();
    expect(questsResetAt(0, afternoon)).toBe(midnight);
    expect(questsResetAt(midnight + 60_000, afternoon)).toBe(midnight + 60_000);
    // A time already past is not trusted.
    expect(questsResetAt(afternoon.getTime() - 1, afternoon)).toBe(midnight);
  });
});
