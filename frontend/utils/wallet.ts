// The Tokens screen's words for the server's numbers: each way to earn with today's progress and
// where to go for it, each thing to buy with its status and where it opens, the next goal, and the
// history grouped by day. Every number comes from the wallet summary (GET /api/wallet/summary).
import type { Ionicons } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import type { WalletHistoryItem, WalletSpendRow, WalletSummary, WeeklyBonus } from '@/authentication/authService';
import type { TokenKind } from '@/hooks/app-state/types';
import { getLocalDateKey } from '@/utils/habit-visibility';

type IconName = keyof typeof Ionicons.glyphMap;

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

export const EARN_ICONS: Record<string, IconName> = {
  'check-in': 'checkmark-circle',
  'daily-claim': 'gift',
  challenge: 'trophy',
  mystery: 'cube',
  quest: 'flag',
  'weekly-bonus': 'calendar',
  streak: 'flame',
};

/** Where each way to earn is done: check-ins and the streak on Habits, the rest on Home. */
export const EARN_HREFS: Record<string, Href> = {
  'check-in': '/(tabs)/habits',
  'daily-claim': '/(tabs)',
  challenge: '/(tabs)',
  mystery: '/(tabs)',
  quest: '/(tabs)',
  'weekly-bonus': '/(tabs)',
  streak: '/(tabs)/habits',
};

export const SPEND_ICONS: Record<string, IconName> = {
  'streak-freeze': 'snow',
  'buddy-shop': 'shirt',
  'weekly-drop': 'gift',
  'premium-theme': 'color-palette',
  'profile-frames': 'person-circle',
  'custom-title': 'ribbon',
  'buddy-showcase': 'paw',
  'treat-gift': 'heart',
  coach: 'sparkles',
};

export const KIND_ICONS: Record<TokenKind, IconName> = {
  'check-in': 'checkmark-circle',
  undo: 'arrow-undo',
  'daily-claim': 'gift',
  challenge: 'trophy',
  quest: 'flag',
  mystery: 'cube',
  streak: 'flame',
  'weekly-bonus': 'calendar',
  refund: 'refresh',
  reward: 'ribbon',
  'buddy-item': 'shirt',
  'buddy-treat': 'ice-cream',
  gift: 'heart',
  freeze: 'snow',
  coach: 'sparkles',
  other: 'ellipse',
};

/** Last week's bonus while it can be claimed, otherwise this week so far and the next tier in reach. */
function bonusStatus({ lastWeek, thisWeek }: WeeklyBonus) {
  if (lastWeek.claimable && lastWeek.tier) return `Last week ${lastWeek.percent}%: +${lastWeek.tier.amount} ready`;
  const next = thisWeek.next;
  if (!next?.reachable) return `This week ${thisWeek.percentSoFar}%`;
  return `This week ${thisWeek.percentSoFar}% · ${next.checkInsNeeded} more check-in${next.checkInsNeeded === 1 ? ' reaches' : 's reach'} ${next.percent}% (+${next.amount})`;
}

/** Today's progress of one way to earn ('' for one this app does not know yet). */
export function earnStatus(id: string, { today, week, streak }: WalletSummary) {
  switch (id) {
    case 'check-in':
      return `${today.checkIns.paid}/${today.checkIns.limit} paid today · +${today.checkIns.perCheckIn} each`;
    case 'daily-claim':
      return today.dailyClaim.claimed
        ? `Claimed +${today.dailyClaim.amount} · tomorrow +${today.dailyClaim.tomorrowAmount}`
        : `Day ${today.dailyClaim.day} of 7 · +${today.dailyClaim.amount} ready`;
    case 'challenge':
      return `${today.challenges.done}/${today.challenges.total} done · up to ${today.challenges.available} more`;
    case 'mystery':
      if (today.mysteryBox.status === 'locked') return 'Check in once to unlock';
      if (today.mysteryBox.status === 'ready') return 'Ready to open';
      return today.mysteryBox.amount === null ? 'Opened' : `Opened +${today.mysteryBox.amount}`;
    case 'quest':
      return `${week.quests.done}/${week.quests.total} · up to ${week.quests.available} more · new on Monday`;
    case 'weekly-bonus':
      return bonusStatus(week.bonus);
    case 'streak':
      return streak.next ? `${streak.days}-day streak · ${plural(streak.next.daysLeft, 'day')} to +${streak.next.bonus}` : `${streak.days}-day streak`;
    default:
      return '';
  }
}

/** A thing to buy: 'Owned', 'Ready', '<n> more', 'Locked' or 'Full'. */
export function spendStatus(row: WalletSpendRow, tokens: number) {
  if (row.status === 'owned') return 'Owned';
  if (row.status === 'ready') return 'Ready';
  if (row.status === 'locked') return 'Locked';
  if (row.status === 'full') return 'Full';
  return `${row.short ?? Math.max(0, row.cost - tokens)} more`;
}

/**
 * Where a thing to buy opens: a Token Reward's confirm dialog or sheet on the leaderboard, Habi's
 * shop, the leaderboard (to pick a classmate for a treat), the AI Coach on Profile, or 'freeze' for
 * the Streak Freeze sheet. Null for a target this app does not know yet.
 */
export function spendTarget(target: string): Href | 'freeze' | null {
  if (target.startsWith('reward:')) return `/leaderboards?reward=${encodeURIComponent(target.slice('reward:'.length))}`;
  if (target === 'freeze') return 'freeze';
  if (target === 'buddy') return '/buddy';
  if (target === 'gift') return '/leaderboards';
  if (target === 'coach') return '/(tabs)/profile';
  return null;
}

/** 'Next goal: Buddy Showcase · 120 tokens · about 3 days at your pace' (no pace: without the days). */
export function goalLine(goal: NonNullable<WalletSummary['nextGoal']>) {
  const days = goal.days === null ? '' : ` · about ${plural(goal.days, 'day')} at your pace`;
  return `Next goal: ${goal.title} · ${goal.short} tokens${days}`;
}

/** When a history row was written (ms), from its createdAt or else its date. */
export function historyTime(item: WalletHistoryItem) {
  const createdAt = Number(item.createdAt);
  return Number.isFinite(createdAt) && createdAt > 0 ? createdAt : Date.parse(item.date);
}

/** History rows by the device's day, newest first: 'Today', 'Yesterday', then 'Mon, Oct 19'. */
export function historyGroups(items: WalletHistoryItem[], now = new Date()) {
  const today = getLocalDateKey(now);
  const yesterday = getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  const groups: { key: string; title: string; items: WalletHistoryItem[] }[] = [];
  for (const item of items) {
    const at = new Date(historyTime(item));
    const key = getLocalDateKey(at);
    let group = groups.at(-1);
    if (group?.key !== key) {
      const title = key === today ? 'Today' : key === yesterday ? 'Yesterday' : at.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      group = { key, title, items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}
