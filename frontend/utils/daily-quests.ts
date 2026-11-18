// Daily quests as Home shows them (components/daily-cards.tsx): what is left on each quest, which can
// no longer be finished today, the quest chest, the quest streak and when new quests come.
import type { DailyChallenge } from '@/authentication';

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// The time-of-day quests close at these minutes of the day (backend/services/daily-challenges.js).
const CLOSES_AT: Record<string, number> = { 'early-bird': 10 * 60, 'two-by-noon': 12 * 60 };

const minuteOf = (now: Date) => now.getHours() * 60 + now.getMinutes();

/** '5h 12m', '45m', 'under a minute'. */
export function formatTimeLeft(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return 'under a minute';
  const hours = Math.floor(minutes / 60);
  return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** When today's quests end and new ones come: the server's time, else the device's next midnight. */
export function questsResetAt(resetsAt: number, now: Date) {
  if (resetsAt > now.getTime()) return resetsAt;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

/**
 * Whether a quest can no longer be finished today: the server says so (`reachable` false), or it
 * is a time-of-day quest and its time passed since the server last answered.
 */
export function isQuestMissed(challenge: DailyChallenge, now: Date) {
  if (challenge.complete) return false;
  if (challenge.reachable === false) return true;
  const closes = CLOSES_AT[challenge.id];
  return closes !== undefined && minuteOf(now) >= closes;
}

/** The line under a quest: done, missed, or what is left (and for the time-of-day ones, how long). */
export function questHint(challenge: DailyChallenge, now: Date) {
  if (challenge.complete) return 'Done';
  if (isQuestMissed(challenge, now)) return 'Missed today';
  const left = Math.max(0, challenge.target - challenge.progress);
  const closes = CLOSES_AT[challenge.id];
  const until = closes === undefined ? '' : ` · ${formatTimeLeft((closes - minuteOf(now)) * 60_000 - now.getSeconds() * 1000)} left`;
  switch (challenge.id) {
    case 'finish':
      return `${plural(left, 'more habit')} to go`;
    case 'perfect-day':
      return `${plural(left, 'more habit')} for a perfect day`;
    case 'early-bird':
      return `Before 10 AM${until}`;
    case 'two-by-noon':
      return `${left} more before noon${until}`;
    case 'comeback':
      return 'Check it in today';
    case 'streak-keeper':
      return challenge.target === 1 ? 'Check it in today' : `${plural(left, 'more streak')} to keep`;
    default:
      return `${challenge.progress} of ${challenge.target}`;
  }
}

/**
 * The quest chest: open once every quest is done, and closed for today once one is missed.
 * `reward` 0: the server has no chest (an older one), so none is shown.
 */
export function questChest(challenges: DailyChallenge[], reward: number, now: Date) {
  const done = challenges.filter((challenge) => challenge.complete).length;
  const complete = challenges.length > 0 && done === challenges.length;
  const missed = !complete && challenges.some((challenge) => isQuestMissed(challenge, now));
  return { reward, done, total: challenges.length, complete, missed, shown: reward > 0 && challenges.length > 0 };
}

/** The quest streak line: days in a row with the chest opened (`streak`: before today). */
export function questStreakLine(streak: number, chest: { complete: boolean; missed: boolean }) {
  if (chest.complete) return `${plural(streak + 1, 'day')} in a row with the chest opened`;
  if (!streak) return 'Open the chest on days in a row for a quest streak';
  if (chest.missed) return `Your ${streak}-day quest streak ends today`;
  return `${streak}-day quest streak · open today's chest to keep it`;
}

/** What Habi says about today's quests. */
export function habiQuestLine(chest: ReturnType<typeof questChest>) {
  const left = chest.total - chest.done;
  if (chest.complete) return chest.shown ? `We opened the chest! +${chest.reward} bonus tokens.` : 'All quests done! See you tomorrow.';
  if (!chest.shown) return `${plural(left, 'more quest')} to go today!`;
  if (chest.missed) return 'One got away today, but the rest still pay!';
  return left === chest.total ? `Finish all ${chest.total} quests to open the chest: +${chest.reward}!` : `${plural(left, 'more quest')} and the chest opens: +${chest.reward}!`;
}
