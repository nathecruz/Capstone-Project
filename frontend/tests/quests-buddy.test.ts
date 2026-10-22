import type { Habit } from '@/hooks/app-state/types';
import { BUDDY_STAGES, buddyCatalog, buddyGrowth, buddyMood, dropQuestsFooter, keepWeekDrop, ROOM_LOOK, weeklyDropCard, type Buddy, type BuddyDrop, type BuddyItem } from '@/utils/buddy';
import { daysLeftInWeek, weekStartOf, weeklyQuests } from '@/utils/quests';

function habit(id: string, completionDates: string[] = [], overrides: Partial<Habit> = {}): Habit {
  return {
    id, startDate: '2026-09-01', label: id, meta: 'Daily • Anytime', category: 'Health', frequency: 'Daily', icon: 'heart-outline', color: '#E58D8D',
    goal: 1, progress: 0, total: '0/1', streak: 0, done: false, completionDates, reminderEnabled: false, reminderTime: '07:00 AM', ...overrides,
  };
}

// Saturday, October 3, 2026: the same cases as backend/test/engagement.test.js.
const saturday = new Date(2026, 9, 3, 20);

describe('weekly quests', () => {
  it('match the server for the same week', () => {
    expect(weekStartOf('2026-10-04')).toBe('2026-09-28');
    const habits = [
      habit('a', ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-03']),
      habit('b', ['2026-09-27', '2026-09-28', '2026-09-29', '2026-10-01']),
      habit('c', ['2026-09-27', '2026-09-28', '2026-09-29']),
    ];
    const quests = Object.fromEntries(weeklyQuests(habits, saturday).map((quest) => [quest.id, quest]));
    expect(quests['check-ins']).toEqual({ id: 'check-ins', title: 'Check in 12 times', icon: 'checkmark-done', target: 12, progress: 10, reward: 15, weekStart: '2026-09-28', complete: false });
    expect(quests['perfect-days']).toMatchObject({ progress: 2, complete: true, reward: 20 });
    const third = Object.values(quests).find((quest) => !['check-ins', 'perfect-days'].includes(quest.id))!;
    const expected = { 'challenge-days': [2, false], 'active-days': [5, true], 'every-habit': [3, true] }[third.id];
    expect([third.progress, third.complete]).toEqual(expected);
  });

  it('fit the number of habits and count the days left', () => {
    expect(weeklyQuests([], saturday)).toEqual([]);
    expect(weeklyQuests([habit('a')], saturday)[0].target).toBe(5);
    expect(weeklyQuests([habit('a'), habit('b')], saturday)[0].target).toBe(8);
    expect(daysLeftInWeek(saturday)).toBe(2);
    expect(daysLeftInWeek(new Date(2026, 8, 28))).toBe(7);
  });
});

describe('habit buddy', () => {
  it('grows through stages with check-ins', () => {
    expect(buddyGrowth(0)).toMatchObject({ index: 0, toNext: 10, share: 0 });
    expect(buddyGrowth(30)).toMatchObject({ index: 1, toNext: 20, share: 0.5 });
    expect(buddyGrowth(400)).toMatchObject({ index: 4, next: null, share: 1, toNext: 0 });
  });

  it('feels how today is going', () => {
    const morning = new Date(2026, 9, 3, 8);
    const afternoon = new Date(2026, 9, 3, 15);
    expect(buddyMood([], 'Habi', morning).mood).toBe('sleepy');
    expect(buddyMood([habit('a', ['2026-10-02'])], 'Habi', morning).mood).toBe('sleepy');
    expect(buddyMood([habit('a', ['2026-10-02'])], 'Habi', afternoon).mood).toBe('hungry');
    expect(buddyMood([habit('a', ['2026-10-02', '2026-10-03']), habit('b', ['2026-10-02'])], 'Habi', afternoon)).toMatchObject({ mood: 'happy', energy: 0.5 });
    expect(buddyMood([habit('a', ['2026-10-03'])], 'Habi', afternoon)).toMatchObject({ mood: 'ecstatic', energy: 1 });
    // Missed yesterday (October 2) and nothing done yet today.
    expect(buddyMood([habit('a', ['2026-10-01'])], 'Habi', afternoon).mood).toBe('sad');
  });

  it('does not ask for check-ins that are no longer possible today', () => {
    const afternoon = new Date(2026, 9, 3, 15);
    // Its last reminder was at noon: missed for today, so it cannot be checked in any more.
    const missed = habit('gym', ['2026-10-02'], { reminderEnabled: true, reminderTime: '12:00 PM', reminderTimes: ['12:00 PM'] });
    expect(buddyMood([missed, habit('read', ['2026-10-02', '2026-10-03']), habit('walk', ['2026-10-02'])], 'Habi', afternoon).line).toBe("Yum, thanks! 1 more and I'm full of energy.");
    expect(buddyMood([missed, habit('read', ['2026-10-02', '2026-10-03'])], 'Habi', afternoon).line).toBe("Yum, thanks! That's all for today.");
    expect(buddyMood([missed], 'Habi', afternoon)).toMatchObject({ mood: 'sad', line: "We missed today's habits... let's get them next time." });
  });
});

// The 12 weekly drops as GET /api/buddy lists them (backend/services/buddy.js BUDDY_DROPS).
const DROPS: BuddyItem[] = [
  ['umbrella', 'hand', '☔', 'Umbrella'], ['rice', 'hand', '🌾', 'Rice stalk'], ['carabao', 'hand', '🐃', 'Carabao'], ['mango', 'hand', '🥭', 'Mango'],
  ['salabat', 'hand', '🍵', 'Salabat tea'], ['lantern', 'hand', '🏮', 'Lantern'], ['sunflower', 'head', '🌻', 'Sunflower'], ['parol', 'head', '🌟', 'Parol star'],
  ['fireworks', 'head', '🎆', 'Fireworks'], ['mini-tree', 'hand', '🎄', 'Mini tree'], ['sports-medal', 'accessory', '🏅', 'Sports medal'], ['ribbon', 'accessory', '🎗️', 'Ribbon'],
].map(([id, slot, emoji, name]) => ({ id: `drop-${id}`, slot: slot as BuddyItem['slot'], emoji, name, cost: 150, stage: 'kid', drop: true }));

/** A Kid-stage buddy (30 check-ins) in the week of October 26, 2026, whose drop is the Umbrella. */
function buddyWith(drop: Partial<BuddyDrop> | null, overrides: Partial<Buddy> = {}): Buddy {
  return {
    name: 'Habi', head: '', hand: '', room: '', accessory: '', owned: [], checkIns: 30, items: [{ id: 'cap', slot: 'head', name: 'Cap', emoji: '🧢', cost: 40, stage: 'baby' }],
    stages: BUDDY_STAGES, treats: [], fedTreats: [], treatsFed: 0, drops: DROPS,
    drop: drop && { item: DROPS[0], weekStart: '2026-10-26', weekEnd: '2026-11-01', questsDone: 1, questsNeeded: 2, unlocked: false, owned: false, ...drop },
    ...overrides,
  };
}

// A day of that week.
const WEDNESDAY = '2026-10-28';

describe('weekly drop', () => {
  it('is locked until 2 of the 3 quests are done', () => {
    expect(weeklyDropCard(buddyWith({ questsDone: 1 }), 500, WEDNESDAY)).toEqual({
      item: DROPS[0],
      state: 'locked',
      action: 'See quests',
      canBuy: false,
      line: '☔ Umbrella · 150 tokens · this week only',
      progress: 'Finish 2 of 3 weekly quests to unlock (1/2)',
      collected: 'Drops collected 0/12',
    });
    expect(weeklyDropCard(buddyWith({ questsDone: 0 }), 500, WEDNESDAY)?.progress).toBe('Finish 2 of 3 weekly quests to unlock (0/2)');
  });

  it('can be bought once unlocked, unless the stage or the balance is short', () => {
    expect(weeklyDropCard(buddyWith({ questsDone: 2, unlocked: true }), 500, WEDNESDAY)).toMatchObject({ state: 'unlocked', action: 'Get it', canBuy: true, progress: null });
    expect(weeklyDropCard(buddyWith({ questsDone: 3, unlocked: true }), 100, WEDNESDAY)).toMatchObject({ state: 'unlocked', action: '50 more', canBuy: false });
    // Below Kid (10 check-ins), as the server refuses it.
    expect(weeklyDropCard(buddyWith({ questsDone: 2, unlocked: true }, { checkIns: 6 }), 500, WEDNESDAY)).toMatchObject({ state: 'unlocked', action: 'Kid stage', canBuy: false });
  });

  it('is collected once bought, and counts the drops collected', () => {
    const owned = buddyWith({ questsDone: 3, unlocked: true, owned: true }, { owned: ['cap', 'drop-umbrella', 'drop-parol'], dropsOwned: 2 });
    expect(weeklyDropCard(owned, 0, WEDNESDAY)).toMatchObject({ state: 'owned', action: 'Collected', canBuy: false, progress: null, collected: 'Drops collected 2/12' });
    // Unknown without the account's today.
    expect(weeklyDropCard(buddyWith(null), 500, WEDNESDAY)).toBeNull();
  });

  it('is named at the bottom of the weekly quests card', () => {
    const { drop } = buddyWith({ questsDone: 1 });
    expect(dropQuestsFooter(drop, 1, WEDNESDAY)).toBe("Unlocks this week's drop: ☔ Umbrella (1/2)");
    expect(dropQuestsFooter(drop, 3, WEDNESDAY)).toBe("Unlocks this week's drop: ☔ Umbrella (2/2)");
    expect(dropQuestsFooter(null, 2, WEDNESDAY)).toBeNull();
  });

  it("is not shown after its week, while the buddy loaded before Monday still has it", () => {
    const unlocked = buddyWith({ questsDone: 2, unlocked: true });
    expect(weeklyDropCard(unlocked, 500, '2026-11-01')).toMatchObject({ state: 'unlocked', action: 'Get it' });
    expect(weeklyDropCard(unlocked, 500, '2026-11-02')).toBeNull();
    expect(weeklyDropCard(unlocked, 500, '2026-10-25')).toBeNull();
    expect(dropQuestsFooter(unlocked.drop, 2, '2026-11-01')).toBe("Unlocks this week's drop: ☔ Umbrella (2/2)");
    expect(dropQuestsFooter(unlocked.drop, 0, '2026-11-02')).toBeNull();
  });

  it('is drawn and worn like a shop item', () => {
    expect(buddyCatalog(buddyWith(null)).find((item) => item.id === 'drop-parol')).toMatchObject({ slot: 'head', emoji: '🌟' });
    expect(buddyCatalog(null)).toEqual([]);
  });

  it('stays known for its week after an answer without it (a change of look)', () => {
    const known = buddyWith({ questsDone: 2, unlocked: true });
    const bought = buddyWith(null, { owned: ['drop-umbrella'], hand: 'drop-umbrella' });
    expect(keepWeekDrop(bought, known, '2026-10-28').drop).toMatchObject({ item: DROPS[0], unlocked: true, owned: true });
    // A new week has a new drop: the old one is not kept.
    expect(keepWeekDrop(bought, known, '2026-11-02').drop).toBeNull();
    // An answer with the drop replaces it.
    const fresh = buddyWith({ item: DROPS[1], weekStart: '2026-11-02', weekEnd: '2026-11-08' });
    expect(keepWeekDrop(fresh, known, '2026-11-02').drop?.item.id).toBe('drop-rice');
  });
});

describe('legend room', () => {
  it('has a look for the Aurora', () => {
    expect(ROOM_LOOK.aurora).toEqual({ background: '#1B2346', decor: ['🌌', '✨'] });
  });
});
