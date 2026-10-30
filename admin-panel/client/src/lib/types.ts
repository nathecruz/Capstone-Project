export type Role = 'user' | 'faculty' | 'admin';
export type Permission =
  | 'dashboard:view'
  | 'class:view'
  | 'analytics:view'
  | 'users:view'
  | 'users:manage'
  | 'categories:view'
  | 'categories:manage'
  | 'notifications:view'
  | 'notifications:manage'
  | 'support:view'
  | 'support:manage'
  | 'audit:view'
  | 'settings:manage';

export interface Admin {
  id: string;
  fullName: string;
  username: string;
  email: string;
  role: Role;
  roleLabel: string;
  permissions: Permission[];
}

/** A pending request for Admin Panel access, sent from the sign-in page. */
export interface AccessRequest {
  id: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  requestedRole: 'faculty' | 'admin';
  requestedRoleLabel: string;
  reason: string;
  createdAt: number;
}

export interface UserRow {
  id: string;
  /** "First Last" */
  fullName: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
  role: Role;
  roleLabel: string;
  status: 'active' | 'deactivated';
  statusReason: string;
  statusChangedAt: number | null;
  createdAt: number;
  lastActiveAt: number | null;
  habitCount: number;
  completionCount: number;
  gender: string;
  region: string;
  dateOfBirth: string;
}

export interface Category {
  id: string;
  label: string;
  icon: string;
  color: string;
  description: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
  habitCount: number;
  studentCount: number;
  completions30d: number;
}

export interface Template {
  id: string;
  name: string;
  type: 'system' | 'reminder';
  title: string;
  body: string;
  description: string;
  isActive: boolean;
  isSystem: boolean;
  createdAt: number;
  updatedAt: number;
  timesSent: number;
  lastSentAt: number | null;
}

export interface TemplateVariable {
  key: string;
  description: string;
  sample: string;
}

export type Audience =
  | { kind: 'all' }
  | { kind: 'active' }
  | { kind: 'inactive' }
  | { kind: 'no_habits' }
  | { kind: 'users'; userIds: string[] };

/**
 * What a token ledger row paid or bought (server/src/lib/token-kinds.js): earning kinds, the
 * spend kinds, 'undo' (an undone check-in's -5) and 'other'.
 */
export type TokenKind =
  | 'check-in'
  | 'daily-claim'
  | 'challenge'
  | 'quest'
  | 'mystery'
  | 'streak'
  | 'weekly-bonus'
  | 'refund'
  | 'reward'
  | 'buddy-item'
  | 'buddy-treat'
  | 'gift'
  | 'freeze'
  | 'coach'
  | 'undo'
  | 'other';

/** Tokens of one kind: `earned` from positive rows, `spent` from negative ones (as a positive number). */
export interface TokenKindTotal {
  kind: TokenKind;
  earned: number;
  spent: number;
}

/** The `economy` block of GET /api/analytics: students only, aggregates only, the last 28 days unless named otherwise. */
export interface TokenEconomy {
  /** First day of the 28 (YYYY-MM-DD, APP_TIME_ZONE). */
  since: string;
  /** Tokens are paid for `perDay` check-ins a day; from `from` a day also counts at most that many toward points. */
  checkInCap: { perDay: number; from: string };
  /** Positive rows that are not refunds. */
  issued28: number;
  refunds28: number;
  /** Negative rows that are not undone check-ins, as a positive number. */
  spent28: number;
  undone28: number;
  byKind28: TokenKindTotal[];
  /** Balances of the students active in the 28 days (never below 0); withheld below the anonymity threshold. */
  balances: { students: number; median: number | null; p90: number | null; over1000: number | null; withheld: boolean };
  /** The last 4 weeks whose bonus can be claimed (the newest is last week): claims by amount, gold 30, silver 20, bronze 10. */
  weeklyBonus: { weekStart: string; claims: number; gold: number; silver: number; bronze: number }[];
  /** The last 4 weeks, this one included. */
  drops: { weekStart: string; bought: number }[];
  /** All time. */
  showcaseOwners: number;
  gifts28: number;
  freezes: { bought28: number; used28: number };
  /** Student-days over the check-in cap since it started. */
  cappedDays28: number;
  /** Rewards on sale, with all-time redemptions. */
  rewards: { name: string; redemptions: number; tokenCost: number }[];
  /** Rewards no longer sold, and what their redemptions were refunded. */
  retired: { count: number; refundedTokens: number };
}

export type TokenFlagType = 'big-day' | 'capped-day' | 'many-habits' | 'many-gifts';

/** GET /api/users/token-flags: students whose last 14 days look like token farming (administrators only). */
export interface TokenFlags {
  from: string;
  to: string;
  /** Flagged above these: tokens or check-ins in a day, habits starting in a week; and gifts sent from `giftsSent`. */
  limits: { dayTokens: number; dayCheckIns: number; weekHabits: number; giftsSent: number };
  items: { userId: string; name: string; flags: { type: TokenFlagType; detail: string }[] }[];
}

/** A token ledger row; `id` is without the `<user id>:token:` prefix. */
export interface TokenEntry {
  id: string;
  amount: number;
  kind: TokenKind;
  label: string;
  createdAt: number;
}

export interface OwnedBuddyItem {
  id: string;
  name: string;
  boughtAt: number;
}

/** GET /api/users/:id/tokens?before=<nextCursor>: a student's tokens and one page (30 rows) of the ledger. */
export interface UserTokens {
  balance: number;
  earned: number;
  spent: number;
  byKind: TokenKindTotal[];
  /** Names of the rewards on sale the student owns. */
  rewards: string[];
  buddyItems: OwnedBuddyItem[];
  dropsOwned: OwnedBuddyItem[];
  freezesHeld: number;
  freezesUsed: number;
  giftsSent: number;
  giftsReceived: number;
  history: { items: TokenEntry[]; nextCursor: string | null };
}
