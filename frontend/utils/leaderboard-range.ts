// The leaderboard's weeks and months, as the server counts them: on one campus calendar (its
// APP_TIME_ZONE, Asia/Manila), Monday to Sunday and the 1st to the month's last day. The server
// sends the chosen period's range; the device clock is only a fallback for older servers.
import { getLocalDateKey } from '@/hooks/app-state/habit-progress';

export type LeaderboardPeriod = 'This Week' | 'This Month' | 'All Time';
/** The period's first and last day (YYYY-MM-DD), its time zone, and when the next one starts (epoch ms). */
export type LeaderboardRange = { start: string; end: string; timeZone: string; resetsAt: number };
/** A classmate's Habit Buddy next to their name (Buddy Showcase); null when not shown. */
export type LeaderBuddy = { stage: 'baby' | 'kid' | 'teen' | 'champ' | 'legend'; checkIns: number; head: string; hand: string; accessory: string; room: string };
/** A row of the board. `id` is a public id (never the account's own id); older servers send none. */
export type Leader = { id?: string; rank: number; name: string; points: number; avatar: string; title?: string; frame?: string; isYou?: boolean; canGift?: boolean; buddy?: LeaderBuddy | null };

/** A row's React key: its public id, or its rank from older servers (names are not unique). */
export const leaderKey = (leader: Pick<Leader, 'id' | 'rank'>) => leader.id ?? String(leader.rank);

function shiftDay(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const dayLabel = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const weekdayName = (dateKey: string) => new Date(`${dateKey}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });

/** 'Oct 26 - Nov 1'. */
export const rangeLabel = (range: { start: string; end: string }) => `${dayLabel(range.start)} - ${dayLabel(range.end)}`;

/** Today in a time zone, or on the device when there is none (or the device cannot convert). */
function todayIn(now: Date, timeZone?: string | null) {
  if (timeZone) {
    try {
      const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).map((part) => [part.type, part.value]));
      if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
      // An unknown zone: the device's own day below.
    }
  }
  return getLocalDateKey(now);
}

/** The week (Monday to Sunday) or month around today in `timeZone`, for a period the server has not sent yet. */
export function periodRange(period: Exclude<LeaderboardPeriod, 'All Time'>, now: Date, timeZone?: string | null) {
  const today = todayIn(now, timeZone);
  if (period === 'This Month') {
    const [year, month] = today.split('-').map(Number);
    return { start: `${today.slice(0, 7)}-01`, end: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10) };
  }
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const start = shiftDay(today, weekday === 0 ? -6 : 1 - weekday);
  return { start, end: shiftDay(start, 6) };
}

/**
 * The dates under the period picker: the server's own label and range for the period it answered,
 * otherwise this week or month on the board's calendar (`timeZone`, the device's for older servers).
 */
export function leaderboardDateLabel(
  period: LeaderboardPeriod,
  board: { period: LeaderboardPeriod; date?: string; range?: LeaderboardRange | null } | null,
  now: Date,
  timeZone?: string | null,
) {
  if (period === 'All Time') return 'Since joining';
  if (board?.period === period && board.range) return board.date && board.date !== period ? board.date : rangeLabel(board.range);
  return rangeLabel(periodRange(period, now, timeZone));
}

/** 'Asia/Manila' -> 'Manila', 'America/New_York' -> 'New York'. */
const zonePlace = (timeZone: string) => (timeZone.split('/').pop() || timeZone).replace(/_/g, ' ');

/** '2d 5h', '3h 12m', '8m'. */
function untilText(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return minutes > 0 ? `${minutes}m` : 'less than a minute';
}

/**
 * When the board starts again, from the server's range: 'Resets Monday 12:00 AM Manila time · in
 * 2d 5h' for a week, 'Resets Nov 1, 12:00 AM Manila time · in 10d 3h' for a month.
 */
export function resetCountdownText(period: Exclude<LeaderboardPeriod, 'All Time'>, range: LeaderboardRange, now: number) {
  const nextStart = shiftDay(range.end, 1);
  const day = period === 'This Week' ? weekdayName(nextStart) : `${dayLabel(nextStart)},`;
  return `Resets ${day} 12:00 AM ${zonePlace(range.timeZone)} time · in ${untilText(range.resetsAt - now)}`;
}
