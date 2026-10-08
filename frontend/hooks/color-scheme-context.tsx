import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Appearance, Platform, useColorScheme as useRNColorScheme } from 'react-native';
import { translate } from '@/constants/i18n';
import { getCurrentSession, subscribeToAuthChanges, type SessionUser } from '@/authentication/session';
import { buyStreakFreeze as requestStreakFreeze, getLiveVersions, getRemoteAppState, getRemoteHabitCompletions, saveRemoteAppState, saveRemoteHabitCompletion, syncStreakFreezes, type AppStateSyncBase, type AppStateSyncPayload } from '@/authentication/authService';
import { normalizeHabitFields } from '@/utils/habit-data';
import { CHECK_IN_UNDO_MS, canCompleteHabitForDate } from '@/utils/habit-visibility';
import type { EditableHabitFields } from '@/utils/habit-edit';
import { namesOf } from '@/utils/names';
import { badgeProgress } from '@/utils/achievements';
import { buddyGrowth } from '@/utils/buddy';
import { levelProgress, streakMilestone, todayAgenda } from '@/utils/engagement';
import { weeklyQuests } from '@/utils/quests';
import { computeStreak } from '@/utils/streaks';
import { applyRemoteCompletionDates, applyVisibleOrder, getLocalDateKey } from './app-state/habit-progress';
import { AppThemeContext, DarkModeContext } from './dark-mode-context';
import { adjustBuddyCheckIns, getCachedBuddy, reloadBuddy } from './use-buddy';
import { loadRewards } from './use-rewards';
import { emitLive, setUnreadCount } from '@/utils/live-events';
import { getKnownChallenges, loadDailyChallenges, publishDailyChallenges } from './use-daily-challenges';
import { isAppTheme } from './use-themed-styles';
import { APP_STATE_KEY_PREFIX, clearSyncMeta, loadSyncMeta, persistSyncBase, persistUnsaved } from './app-state/sync-storage';
import { useHabitReminders } from './app-state/use-habit-reminders';
import { initialPreferences, initialProfile, type Goal, type Habit, type PersistedAppState, type Preferences, type Profile, type TokenTransaction } from './app-state/types';

export * from './app-state/types';
export { getHabitCompletionHistory, getHabitProgressSummary, getRecentCompletionHistory } from './app-state/habit-progress';
export { enableWebReminders, getHabitReminderDays, getHabitReminderSchedule, getHabitReminderTimes, getNotificationsModule, getSnoozeLimit, getWebReminderStatus, isHabitMissedYesterday, isHabitReminderDay, requestNotificationAccess, sendTestReminder, type WebReminderStatus } from './app-state/reminders';

type ColorScheme = 'light' | 'dark';
let nextHabitId = 0;
/**
 * How often an open tab asks the server what changed (GET /api/live, a few bytes). Only what
 * changed is fetched again; returning to the tab asks right away.
 */
const LIVE_PULSE_MS = 10000;

/** JSON with sorted keys, so two copies of the same state compare equal regardless of key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

const SERVER_OWNED_FIELDS = ['points', 'tokens', 'tokenHistory'];
const SERVER_OWNED_HABIT_FIELDS = ['done', 'progress', 'total', 'streak'];

/**
 * The part of a state the app owns, for "did anything change?" checks: points, tokens and streaks
 * are the server's, and check-in dates are compared as a set. (Comparing everything made the app
 * re-send an unchanged state again and again.)
 */
function clientOwnedKey(state: object | null | undefined) {
  if (!state) return '';
  const copy: Record<string, unknown> = { ...state };
  for (const key of SERVER_OWNED_FIELDS) delete copy[key];
  copy.habits = (Array.isArray(copy.habits) ? copy.habits : []).map((habit: Record<string, unknown>) => {
    const habitCopy: Record<string, unknown> = { ...habit };
    for (const key of SERVER_OWNED_HABIT_FIELDS) delete habitCopy[key];
    habitCopy.completionDates = [...new Set(Array.isArray(habit.completionDates) ? habit.completionDates as string[] : [])].sort();
    return habitCopy;
  });
  return stableStringify(copy);
}

/** A state loaded for a signed-in account always has its email; the blank startup state does not. */
const isLoadedState = (state: { profile?: { email?: string } } | null | undefined) => Boolean(state?.profile?.email?.trim());

type ColorSchemeContextValue = {
  colorScheme: ColorScheme;
  isDarkMode: boolean;
  setDarkMode: (enabled: boolean) => void;
  avatarImage: string | null;
  setAvatarImage: (uri: string | null) => void;
  profile: Profile;
  updateProfile: (profile: Profile) => void;
  preferences: Preferences;
  updatePreferences: (changes: Partial<Preferences>) => void;
  t: (key: Parameters<typeof translate>[1]) => string;
  habits: Habit[];
  addHabit: (habit: Omit<Habit, 'id' | 'goal' | 'progress' | 'total' | 'streak' | 'done' | 'completionDates'> & { goal: number }) => void;
  toggleHabit: (id: string) => void;
  toggleHabitForDate: (id: string, date: Date) => void;
  /** True while today's check-in of this habit can still be undone (right after the tap). */
  canUndoCheckIn: (id: string) => boolean;
  /** A moment worth celebrating after a check-in (streak milestone, level up, challenge, all done). */
  celebration: Celebration | null;
  /** Streak freezes held and the days they covered (null until the server answered). */
  streakFreeze: StreakFreeze | null;
  buyStreakFreeze: () => Promise<{ ok: boolean; message: string }>;
  dismissCelebration: () => void;
  deleteHabit: (id: string) => void;
  updateHabit: (id: string, changes: EditableHabitFields) => void;
  reorderHabits: (habits: Habit[]) => void;
  ringInterval: number;
  snoozeFrequency: string;
  goals: Goal[];
  updateGoals: (goals: Goal[] | ((current: Goal[]) => Goal[])) => void;
  setSnoozeSettings: (interval: number, frequency: string) => void;
  points: number;
  tokens: number;
  tokenHistory: TokenTransaction[];
  addTokens: (amount: number, label?: string) => void;
  applyWallet: (wallet: { points?: number; tokens?: number; tokenHistory?: TokenTransaction[] | object[] }) => void;
  getAppStateSnapshot: () => PersistedAppState;
  syncAppState: (state?: PersistedAppState) => Promise<{ state: PersistedAppState; ok: boolean; merged: boolean }>;
  refreshAppState: () => Promise<boolean>;
  clearLocalData: () => void;
  /** Faculty accounts track their own habits in Faculty mode (faculty ideas, no student leaderboards). */
  isFaculty: boolean;
};

export type StreakFreeze = { available: number; max: number; cost: number; frozenDays: string[] };

export type Celebration = { id: string; kind: 'buddy' | 'streak' | 'freeze' | 'badge' | 'quest' | 'level' | 'challenge' | 'allDone'; icon: string; title: string; message: string; color?: string };

const ColorSchemeContext = createContext<ColorSchemeContextValue | undefined>(undefined);

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [darkModeOverride, setDarkModeOverride] = useState<boolean | null>(null);
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [storedPreferences, setPreferences] = useState<Preferences>(initialPreferences);
  // The region is the account's, chosen at sign-up; the app shows it but cannot change it.
  const [accountRegion, setAccountRegion] = useState('');
  const preferences = useMemo(() => (accountRegion && storedPreferences.region !== accountRegion ? { ...storedPreferences, region: accountRegion } : storedPreferences), [accountRegion, storedPreferences]);
  const [habits, setHabits] = useState<Habit[]>([]);
  // Check-ins made in this session that can still be undone: habit id -> when the Undo ends.
  const [undoUntil, setUndoUntil] = useState<Record<string, number>>({});
  const canUndoCheckIn = (id: string) => (undoUntil[id] ?? 0) > Date.now();
  useEffect(() => {
    const ends = Object.values(undoUntil);
    if (!ends.length) return;
    // Re-render when the next Undo ends, so the check-in shows as locked right away.
    const timer = setTimeout(() => {
      setUndoUntil((current) => Object.fromEntries(Object.entries(current).filter(([, until]) => until > Date.now())));
    }, Math.max(0, Math.min(...ends) - Date.now()) + 50);
    return () => clearTimeout(timer);
  }, [undoUntil]);
  // Celebrations: each moment shows once per session, so an undo and a new tap do not repeat it.
  // Several at once (a streak and a challenge from one check-in) show one after the other.
  const [celebrations, setCelebrations] = useState<Celebration[]>([]);
  const celebration = celebrations[0] ?? null;
  const celebrated = useRef(new Set<string>());
  const celebrate = (next: Celebration) => {
    if (celebrated.current.has(next.id)) return;
    celebrated.current.add(next.id);
    setCelebrations((current) => [...current, next]);
  };

  // Streak freezes: days they covered count as neither done nor missed in every streak.
  const [streakFreeze, setStreakFreeze] = useState<StreakFreeze | null>(null);
  const frozenDaysRef = useRef<string[]>([]);
  /** Shows what the server said about freezes, and celebrates the days a freeze just saved. */
  const takeFreezeStatus = (status: { available: number; max: number; cost: number; frozenDays: string[]; used?: string[] }) => {
    frozenDaysRef.current = status.frozenDays;
    setStreakFreeze({ available: status.available, max: status.max, cost: status.cost, frozenDays: status.frozenDays });
    if (!status.used?.length) return;
    const days = status.used.map((day) => new Date(`${day}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long' })).join(' and ');
    celebrate({ id: `freeze:${status.used.join(',')}`, kind: 'freeze', icon: 'snow', color: '#4BA3FF', title: 'Streak saved!', message: `A streak freeze covered ${days}, so your streak lives on.` });
  };
  // At midnight a new day starts: yesterday's check-ins lock and unfinished habits become
  // missed, without waiting for a reload. A held freeze may now cover yesterday.
  const [dayKey, setDayKey] = useState(() => getLocalDateKey());
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(() => {
      setHabits((current) => current.map((habit) => applyRemoteCompletionDates(habit, habit.completionDates, frozenDaysRef.current)));
      setUndoUntil({});
      setDayKey(getLocalDateKey());
      void syncStreakFreezes(getLocalDateKey()).then((result) => {
        if (!result.ok) return;
        takeFreezeStatus(result);
        setHabits((current) => current.map((habit) => applyRemoteCompletionDates(habit, habit.completionDates, result.frozenDays)));
      });
    }, nextMidnight.getTime() - now.getTime());
    return () => clearTimeout(timer);
  }, [dayKey]);
  const [points, setPoints] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [tokenHistory, setTokenHistory] = useState<TokenTransaction[]>([]);
  const [ringInterval, setRingInterval] = useState(30);
  const [snoozeFrequency, setSnoozeFrequency] = useState('Once');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeUserEmail, setActiveUserEmail] = useState('');
  const [accountRole, setAccountRole] = useState<'user' | 'faculty' | 'admin'>('user');
  const [stateHydrated, setStateHydrated] = useState(false);
  const syncBaseRef = useRef<AppStateSyncBase | null>(null);
  const refreshAppStateRef = useRef<(() => Promise<void>) | null>(null);
  const syncAppStateRef = useRef<(() => Promise<{ state: PersistedAppState; ok: boolean; merged: boolean }>) | null>(null);
  const activeEmailRef = useRef('');
  // True once the server's state is known (loaded, confirmed empty, or a saved base exists).
  // Until then nothing is sent, so an empty or stale device can never overwrite it.
  const remoteReadyRef = useRef(false);
  // Local changes the server has not accepted yet (a failed save or one made offline).
  const unsavedRef = useRef(false);
  // Saves scheduled or in flight; a poll must not replace the state while one is pending.
  const pendingSavesRef = useRef(0);
  useHabitReminders({ habits, preferences, ringInterval, snoozeFrequency });

  /** The last state the server confirmed; kept on the device so later saves merge correctly. */
  const setSyncBase = useCallback((base: AppStateSyncBase | null) => {
    syncBaseRef.current = base;
    persistSyncBase(activeEmailRef.current, base);
  }, []);
  const setUnsaved = useCallback((unsaved: boolean) => {
    if (unsavedRef.current === unsaved) return;
    unsavedRef.current = unsaved;
    persistUnsaved(activeEmailRef.current, unsaved);
  }, []);

  const colorScheme: ColorScheme = darkModeOverride === null
    ? systemScheme === 'dark'
      ? 'dark'
      : 'light'
    : darkModeOverride
      ? 'dark'
      : 'light';

  useEffect(() => {
    if (typeof Appearance?.setColorScheme === 'function') {
      Appearance.setColorScheme(colorScheme);
    }
  }, [colorScheme]);

  useEffect(() => {
    let cancelled = false;
    let sessionLoadVersion = 0;

    const resetState = () => {
      syncBaseRef.current = null;
      activeEmailRef.current = '';
      remoteReadyRef.current = false;
      unsavedRef.current = false;
      setActiveUserEmail('');
      setAccountRole('user');
      setAccountRegion('');
      setAvatarImage(null);
      setProfile(initialProfile);
      setPreferences(initialPreferences);
      setHabits([]);
      setPoints(0);
      setTokens(0);
      setTokenHistory([]);
      setDarkModeOverride(null);
      setRingInterval(30);
      setSnoozeFrequency('Once');
      setGoals([]);
      setStateHydrated(true);
    };

    const loadStateForSession = async (session: SessionUser | null, version: number) => {
      if (!session) {
        if (!cancelled && version === sessionLoadVersion) resetState();
        return;
      }

      const email = session.email.trim().toLowerCase();
      activeEmailRef.current = email;
      let savedState: Partial<PersistedAppState> = {};
      try {
        const raw = await AsyncStorage.getItem(`${APP_STATE_KEY_PREFIX}${email}`);
        if (raw) savedState = JSON.parse(raw) as Partial<PersistedAppState>;
      } catch {
        savedState = {};
      }
      const syncMeta = await loadSyncMeta(email);
      if (cancelled || version !== sessionLoadVersion) return;

      const remoteState = await getRemoteAppState();
      if (cancelled || version !== sessionLoadVersion) return;
      unsavedRef.current = syncMeta.unsaved;
      // Changes made on this device that never reached the server (offline) are kept and merged
      // into the server copy by the next save, instead of being replaced by it.
      const keepLocalChanges = syncMeta.unsaved && Boolean(syncMeta.base);
      const remoteBase = remoteState?.state && remoteState.updatedAt ? { updatedAt: remoteState.updatedAt, state: remoteState.state } : null;
      if (remoteState?.state && !keepLocalChanges) {
        const remoteSavedState = remoteState.state as Partial<PersistedAppState>;
        savedState = {
          ...remoteSavedState,
          goals: Array.isArray(remoteSavedState.goals) ? remoteSavedState.goals : savedState.goals,
        };
        setSyncBase(remoteBase);
        remoteReadyRef.current = true;
      } else if (remoteState) {
        // Reachable: the server has no state yet, or local changes are merged against the saved base.
        syncBaseRef.current = keepLocalChanges ? syncMeta.base : remoteBase;
        remoteReadyRef.current = true;
      } else {
        // Unreachable (offline or the server is waking up): keep the local copy. Saves wait until the
        // server state is known, unless a saved base lets the server merge them safely.
        syncBaseRef.current = syncMeta.base;
        remoteReadyRef.current = Boolean(syncMeta.base);
      }

      // Check-ins and streak freezes together; a held freeze may cover a day missed since the last visit.
      const [remoteCompletions, freezes] = await Promise.all([
        keepLocalChanges ? null : getRemoteHabitCompletions(),
        remoteState ? syncStreakFreezes(getLocalDateKey()) : null,
      ]);
      if (cancelled || version !== sessionLoadVersion) return;
      if (freezes?.ok) takeFreezeStatus(freezes);
      setActiveUserEmail(email);
      setAccountRole(session.role ?? 'user');
      setAvatarImage(savedState.avatarImage ?? null);
      // Names come from the account (the server's copy); older sessions fall back to the saved full name.
      const names = namesOf(session.firstName || session.lastName ? session : { fullName: session.fullName || savedState.profile?.fullName });
      setProfile({
        ...initialProfile,
        ...(savedState.profile ?? {}),
        fullName: names.fullName || savedState.profile?.fullName || session.fullName,
        firstName: names.firstName,
        lastName: names.lastName,
        username: savedState.profile?.username || session.username || '',
        email: savedState.profile?.email || session.email,
        dateOfBirth: savedState.profile?.dateOfBirth || session.dateOfBirth || '',
        gender: savedState.profile?.gender || session.gender || '',
        about: savedState.profile?.about || session.about || '',
      });
      setAccountRegion(session.region || '');
      setPreferences({ ...initialPreferences, ...(savedState.preferences ?? {}), region: session.region || savedState.preferences?.region || initialPreferences.region });
      const savedHabits = Array.isArray(savedState.habits) ? savedState.habits : [];
      const completionsByHabit = new Map<string, string[]>();
      for (const completion of remoteCompletions ?? []) {
        completionsByHabit.set(completion.habitId, [...(completionsByHabit.get(completion.habitId) ?? []), completion.date]);
      }
      setHabits((remoteCompletions === null
        ? savedHabits
        : savedHabits.map((habit) => applyRemoteCompletionDates(habit, completionsByHabit.get(habit.id) ?? [], frozenDaysRef.current)))
        .map((habit) => normalizeHabitFields({ ...habit, startDate: habit.startDate || getLocalDateKey() })) as Habit[]);
      setPoints(typeof savedState.points === 'number' ? savedState.points : 0);
      setTokens(typeof savedState.tokens === 'number' ? savedState.tokens : 0);
      setTokenHistory(Array.isArray(savedState.tokenHistory) ? savedState.tokenHistory : []);
      setDarkModeOverride(typeof savedState.darkModeOverride === 'boolean' ? savedState.darkModeOverride : null);
      setRingInterval(typeof savedState.ringInterval === 'number' ? savedState.ringInterval : 30);
      setSnoozeFrequency(typeof savedState.snoozeFrequency === 'string' ? savedState.snoozeFrequency : 'Once');
      setGoals(Array.isArray(savedState.goals) ? savedState.goals as Goal[] : []);
      setStateHydrated(true);
    };

    const refreshSessionState = async () => {
      const version = ++sessionLoadVersion;
      const session = await getCurrentSession();
      if (cancelled || version !== sessionLoadVersion) return;
      await loadStateForSession(session, version);
    };

    const unsubscribe = subscribeToAuthChanges(() => {
      void refreshSessionState();
    });
    void refreshSessionState();
    return () => {
      cancelled = true;
      sessionLoadVersion += 1;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!stateHydrated || !activeUserEmail || !isLoadedState({ profile })) return;
    const state: PersistedAppState = {
      avatarImage,
      profile,
      preferences,
      habits,
      points,
      tokens,
      tokenHistory,
      darkModeOverride,
      ringInterval,
      snoozeFrequency,
      goals,
    };
    void AsyncStorage.setItem(`${APP_STATE_KEY_PREFIX}${activeUserEmail}`, JSON.stringify(state));
    // State just received from the server (or unchanged) does not need to be sent back.
    if (syncBaseRef.current && clientOwnedKey(syncBaseRef.current.state) === clientOwnedKey(state)) return;
    setUnsaved(true);
    // Until the server's state is known it stays on the device; the poll sends it once it is.
    if (!remoteReadyRef.current) return;
    pendingSavesRef.current += 1;
    let sent = false;
    const syncTimer = setTimeout(() => {
      sent = true;
      void saveRemoteAppState(state as AppStateSyncPayload, syncBaseRef.current).then((result) => {
        if (!result?.state || !result.updatedAt) return;
        setSyncBase({ updatedAt: result.updatedAt, state: result.state });
        setUnsaved(false);
        applyWallet(result.state);
        if (!result.merged) return;
        const mergedGoals = result.state.goals;
        setAvatarImage(result.state.avatarImage);
        setProfile(result.state.profile as Profile);
        setPreferences(result.state.preferences as Preferences);
        setHabits(result.state.habits as Habit[]);
        setPoints(result.state.points);
        setTokens(result.state.tokens);
        setTokenHistory(result.state.tokenHistory as TokenTransaction[]);
        setDarkModeOverride(result.state.darkModeOverride);
        setRingInterval(result.state.ringInterval);
        setSnoozeFrequency(result.state.snoozeFrequency);
        setGoals((current) => Array.isArray(mergedGoals) ? mergedGoals as Goal[] : current);
      }).finally(() => {
        pendingSavesRef.current -= 1;
      });
    }, 500);
    return () => {
      clearTimeout(syncTimer);
      if (!sent) pendingSavesRef.current -= 1;
    };
  }, [activeUserEmail, avatarImage, darkModeOverride, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, stateHydrated, tokenHistory, tokens]);

  useEffect(() => {
    if (!stateHydrated || !activeUserEmail) return;

    let cancelled = false;
    let refreshInFlight = false;
    let appIsActive = Platform.OS === 'web' || AppState.currentState === 'active';

    const refreshRemoteState = async () => {
      // A save that is scheduled or in flight will reconcile with the server itself; replacing the
      // local state now could drop the change it carries.
      if (cancelled || !appIsActive || refreshInFlight || pendingSavesRef.current > 0) return;
      refreshInFlight = true;
      try {
        // Changes that could not be saved earlier (offline) are sent first and merged by the server.
        if (unsavedRef.current && remoteReadyRef.current) {
          const saved = await syncAppStateRef.current?.();
          if (cancelled || !saved?.ok) return;
        }
        // Cheap poll: the server only returns the full state when another device saved something newer.
        const knownUpdatedAt = remoteReadyRef.current ? syncBaseRef.current?.updatedAt ?? 0 : 0;
        const remoteState = await getRemoteAppState(knownUpdatedAt || null);
        if (cancelled || !remoteState) return;
        if (!remoteReadyRef.current && !remoteState.state) {
          // The server has no state yet: this device's copy becomes the first one.
          remoteReadyRef.current = true;
          await syncAppStateRef.current?.();
          return;
        }
        if (remoteState.unchanged || !remoteState.state || !remoteState.updatedAt) return;
        if (remoteState.updatedAt <= knownUpdatedAt) return;
        const remoteCompletions = remoteState.completions ?? await getRemoteHabitCompletions();
        if (cancelled) return;

        const nextState = remoteState.state;
        const savedHabits: Habit[] = Array.isArray(nextState.habits) ? nextState.habits as Habit[] : [];
        const completionsByHabit = new Map<string, string[]>();
        for (const completion of remoteCompletions ?? []) {
          completionsByHabit.set(completion.habitId, [...(completionsByHabit.get(completion.habitId) ?? []), completion.date]);
        }

        setSyncBase({ updatedAt: remoteState.updatedAt, state: nextState });
        remoteReadyRef.current = true;
        setUnsaved(false);
        setAvatarImage(nextState.avatarImage ?? null);
        setProfile(nextState.profile as Profile);
        setPreferences(nextState.preferences as Preferences);
        setHabits((remoteCompletions === null
          ? savedHabits
          : savedHabits.map((habit) => applyRemoteCompletionDates(habit, completionsByHabit.get(habit.id) ?? [], frozenDaysRef.current)))
          .map((habit) => normalizeHabitFields(habit)) as Habit[]);
        setPoints(nextState.points);
        setTokens(nextState.tokens);
        setTokenHistory(nextState.tokenHistory as TokenTransaction[]);
        setDarkModeOverride(nextState.darkModeOverride);
        setRingInterval(nextState.ringInterval);
        setSnoozeFrequency(nextState.snoozeFrequency);
        setGoals((current) => Array.isArray(nextState.goals) ? nextState.goals as Goal[] : current);
      } catch {
        // Keep the current local state when the server is temporarily unavailable.
      } finally {
        refreshInFlight = false;
      }
    };

    refreshAppStateRef.current = refreshRemoteState;

    // Tokens can change without the habits changing (a daily claim, a purchase, the mystery box,
    // another device or the admin panel): take the wallet from the server's state.
    const refreshWallet = async () => {
      const remote = await getRemoteAppState(null);
      if (cancelled || !remote?.state) return;
      setPoints(remote.state.points);
      setTokens(remote.state.tokens);
      setTokenHistory(remote.state.tokenHistory as TokenTransaction[]);
    };

    // The live pulse: what changed on the server since the last one, and fetch only that.
    let lastVersions: Record<string, string> | null = null;
    let pulseInFlight = false;
    const pulse = async () => {
      if (cancelled || !appIsActive || pulseInFlight) return;
      pulseInFlight = true;
      try {
        // Changes that could not be saved (offline) are retried on every pulse.
        if (unsavedRef.current) void refreshRemoteState();
        const live = await getLiveVersions();
        if (cancelled || !live.ok) return;
        setUnreadCount(live.unread);
        const before = lastVersions;
        lastVersions = live.versions;
        if (!before) return;
        const changed = (key: string) => before[key] !== live.versions[key];
        if (changed('state')) void refreshRemoteState();
        else if (changed('wallet')) void refreshWallet();
        if (changed('state') || changed('wallet')) void loadDailyChallenges();
        if (changed('state') || changed('buddy')) void reloadBuddy();
        if (changed('rewards')) void loadRewards();
        if (changed('claims')) emitLive('claims');
        if (changed('notifications')) emitLive('notifications');
        if (changed('freezes')) {
          void syncStreakFreezes(getLocalDateKey()).then((result) => {
            if (!cancelled && result.ok) takeFreezeStatus(result);
          });
        }
      } catch {
        // The server is unreachable for now: the next pulse tries again.
      } finally {
        pulseInFlight = false;
      }
    };

    const syncThenRefresh = async () => {
      if (remoteReadyRef.current) {
        const result = await syncAppStateRef.current?.();
        if (!result?.ok) return;
      }
      await refreshRemoteState();
    };
    const handleVisibilityChange = () => {
      appIsActive = !document.hidden;
      if (appIsActive) {
        void syncThenRefresh();
        void pulse();
      }
    };
    const handleOnline = () => {
      if (appIsActive) void syncThenRefresh();
      else void syncAppStateRef.current?.();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
    }
    const handleWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'habitai-checked-in') void refreshRemoteState();
    };
    const workers = Platform.OS === 'web' && typeof navigator !== 'undefined' && 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    workers?.addEventListener('message', handleWorkerMessage);

    // Changes from anywhere arrive within one pulse; returning to the app asks right away.
    // (It used to poll every second, which exhausted the API rate limit within minutes.)
    const refreshTimer = setInterval(() => void pulse(), LIVE_PULSE_MS);
    const firstPulse = setTimeout(() => void pulse(), 1000);
    // The first refresh waits until this render's effects have run: syncAppStateRef still held the
    // blank startup state here, and sending it replaced the account's habits and check-ins.
    const firstRefresh = setTimeout(() => void refreshRemoteState(), 0);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appIsActive = nextState === 'active';
      if (appIsActive) {
        void syncThenRefresh();
        void pulse();
      }
    });

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      clearTimeout(firstRefresh);
      clearTimeout(firstPulse);
      appStateSubscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
      workers?.removeEventListener('message', handleWorkerMessage);
      if (refreshAppStateRef.current === refreshRemoteState) refreshAppStateRef.current = null;
    };
  }, [activeUserEmail, stateHydrated]);

  const addHabit = (habit: Omit<Habit, 'id' | 'goal' | 'progress' | 'total' | 'streak' | 'done' | 'completionDates'> & { goal: number }) => {
    const goal = Math.max(1, habit.goal || 1);
    setHabits((current) => [...current, {
      id: `habit-${Date.now()}-${nextHabitId++}`,
      startDate: habit.startDate,
      label: habit.label,
      meta: habit.meta,
      category: habit.category,
      frequency: habit.frequency,
      icon: habit.icon,
      color: habit.color,
      goal,
      progress: 0,
      total: `0/${goal}`,
      streak: 0,
      done: false,
      completionDates: [],
      reminderEnabled: habit.reminderEnabled,
      reminderTime: habit.reminderTime,
      reminderTimes: habit.reminderTimes ?? [habit.reminderTime],
      reminderDays: habit.reminderDays ?? [],
      reminderSoundEnabled: habit.reminderSoundEnabled ?? true,
      smartReminderEnabled: habit.smartReminderEnabled ?? false,
      isBadHabit: Boolean(habit.isBadHabit),
      badHabitReason: habit.badHabitReason || undefined,
    }]);
  };

  /** Picks the best thing to celebrate about a check-in: streak milestone, level, challenge, all done. */
  const celebrateCheckIn = (habit: Habit, dateKey: string) => {
    const now = new Date();
    const datesAfter = [...habit.completionDates.filter((date) => date !== dateKey), dateKey];
    const habitsAfter = habits.map((item) => (item.id === habit.id ? { ...item, completionDates: datesAfter } : item));
    const frozen = frozenDaysRef.current;
    const milestone = streakMilestone(computeStreak(habit, habit.completionDates, dateKey, frozen), computeStreak(habit, datesAfter, dateKey, frozen));
    const levelBefore = levelProgress(points).level;
    const levelAfter = levelProgress(points + 20).level;
    const agendaAfter = todayAgenda(habitsAfter, now);
    const earnedBefore = new Set(badgeProgress(habits, goals, now, frozen).filter((badge) => badge.earned).map((badge) => badge.id));
    const newBadge = badgeProgress(habitsAfter, goals, now, frozen).find((badge) => badge.earned && !earnedBefore.has(badge.id));
    const questsBefore = new Set(weeklyQuests(habits, now).filter((quest) => quest.complete).map((quest) => quest.id));
    const newQuest = weeklyQuests(habitsAfter, now).find((quest) => quest.complete && !questsBefore.has(quest.id));
    // The buddy grows up with this check-in (the rarest moment, so it comes first).
    const buddy = getCachedBuddy();
    const checkInsBefore = buddy?.checkIns ?? habits.reduce((sum, item) => sum + item.completionDates.length, 0);
    const grownBefore = buddyGrowth(checkInsBefore, buddy?.stages);
    const grownAfter = buddyGrowth(checkInsBefore + 1, buddy?.stages);
    if (grownAfter.index > grownBefore.index) {
      const name = buddy?.name ?? 'Habi';
      celebrate({ id: `buddy:${grownAfter.stage.id}`, kind: 'buddy', icon: 'paw', title: `${name} grew into a ${grownAfter.stage.name}!`, message: `${checkInsBefore + 1} check-ins together. New looks are waiting in ${name}'s shop.` });
    } else if (milestone) {
      celebrate({ id: `streak:${habit.id}:${milestone}:${dateKey}`, kind: 'streak', icon: 'flame', title: `${milestone}-day streak!`, message: `${habit.label}: ${milestone} days in a row. Keep the flame going!` });
    } else if (newBadge) {
      celebrate({ id: `badge:${newBadge.id}`, kind: 'badge', icon: newBadge.icon, color: newBadge.color, title: `Badge unlocked: ${newBadge.title}`, message: `You did it: ${newBadge.goal.charAt(0).toLowerCase()}${newBadge.goal.slice(1)}. See all your badges in Achievements.` });
    } else if (newQuest) {
      celebrate({ id: `quest:${newQuest.weekStart}:${newQuest.id}`, kind: 'quest', icon: 'flag', color: '#4BA3FF', title: 'Quest complete!', message: `${newQuest.title}: +${newQuest.reward} tokens this week.` });
    } else if (levelAfter > levelBefore) {
      celebrate({ id: `level:${levelAfter}`, kind: 'level', icon: 'star', title: `Level ${levelAfter}!`, message: `You reached level ${levelAfter}. Every check-in moves you up.` });
    } else if (agendaAfter.scheduled.length > 0 && agendaAfter.open.length === 0) {
      celebrate({ id: `all:${dateKey}`, kind: 'allDone', icon: 'sparkles', title: 'All done for today!', message: 'Every habit is checked off. See you tomorrow.' });
    }
  };

  /** Shows a check-in (or its undo) on screen; the server's answer to the same change follows. */
  const applyLocalCheckIn = (id: string, dateKey: string, completed: boolean) => {
    const completionTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    // Optimistic display only: the server's ledger replaces these values in the response below.
    setPoints((current) => Math.max(0, current + (completed ? 20 : -20)));
    setTokens((current) => Math.max(0, current + (completed ? 5 : -5)));
    setHabits((current) => current.map((habit) => {
      if (habit.id !== id) return habit;
      const others = habit.completionDates.filter((completionDate) => completionDate !== dateKey);
      const completionDates = completed ? [...others, dateKey] : others;
      const goal = habit.goal || 1;
      const done = completionDates.includes(getLocalDateKey());
      // Streaks come from the check-in dates and schedule (a missed day resets them).
      const streak = computeStreak(habit, completionDates, getLocalDateKey(), frozenDaysRef.current);
      return { ...habit, done, completionDates, streak, completionTimeZone, progress: done ? 100 : 0, total: `${done ? goal : 0}/${goal}` };
    }));
  };

  const toggleHabitForDate = (id: string, date: Date) => {
    const dateKey = getLocalDateKey(date);
    const currentHabit = habits.find((habit) => habit.id === id);
    // Today only: once a day is over, a missed habit stays missed and a done one stays done.
    if (!canCompleteHabitForDate(date)) return;
    if (!currentHabit) return;
    // The same intent goes to the screen and the server, so a quick double tap cannot leave them disagreeing.
    const completed = !currentHabit.completionDates.includes(dateKey);
    // A check-in can be undone only right after the tap; then it is locked for the day.
    if (!completed && !canUndoCheckIn(id)) return;
    setUndoUntil((current) => {
      const next = { ...current };
      if (completed) next[id] = Date.now() + CHECK_IN_UNDO_MS;
      else delete next[id];
      return next;
    });
    applyLocalCheckIn(id, dateKey, completed);
    if (completed) celebrateCheckIn(currentHabit, dateKey);
    adjustBuddyCheckIns(completed ? 1 : -1);
    void saveRemoteHabitCompletion({ habitId: id, date: dateKey, completed }).then((result) => {
      if (!result) {
        // The server keeps a check-in it would not undo (locked, or unreachable): show it again.
        if (!completed) applyLocalCheckIn(id, dateKey, true);
        return;
      }
      applyWallet(result);
      // Daily challenges as the server counted them: announce any this check-in completed.
      if (result.dailyChallenges) {
        const known = getKnownChallenges();
        publishDailyChallenges(result.dailyChallenges);
        if (completed) {
          for (const challenge of result.dailyChallenges.filter((item) => item.complete && !known.some((before) => before.id === item.id && before.complete))) {
            celebrate({ id: `challenge:${challenge.date}:${challenge.id}`, kind: 'challenge', icon: challenge.icon, title: 'Challenge complete!', message: `${challenge.title}: +${challenge.reward} tokens.` });
          }
        }
      }
      // The response carries the new server snapshot: use it as the sync base so the next save
      // is not treated as a conflicting edit (which used to undo a reorder made right after).
      if (result.state && result.updatedAt && (!syncBaseRef.current || result.updatedAt > syncBaseRef.current.updatedAt)) {
        setSyncBase({ updatedAt: result.updatedAt, state: result.state });
      }
      if (result.habit) {
        const serverHabit = result.habit;
        setHabits((current) => current.map((habit) => (habit.id === serverHabit.id ? { ...habit, streak: serverHabit.streak } : habit)));
      }
    });
  };

  const toggleHabit = (id: string) => toggleHabitForDate(id, new Date());

  const deleteHabit = (id: string) => {
    setHabits((current) => current.filter((habit) => habit.id !== id));
  };

  /** Renames, recategorizes or reschedules a habit; its check-ins stay and the streak is recounted for the schedule. */
  const updateHabit = (id: string, changes: EditableHabitFields) => {
    setHabits((current) => current.map((habit) => {
      if (habit.id !== id) return habit;
      const next = { ...habit, ...changes };
      return { ...next, streak: computeStreak(next, next.completionDates, getLocalDateKey(), frozenDaysRef.current) };
    }));
  };

  /** Reorders the habits shown on screen (possibly a filtered subset) without dropping the rest. */
  const reorderHabits = (ordered: Habit[]) => setHabits((current) => applyVisibleOrder(current, ordered));

  const setSnoozeSettings = (interval: number, frequency: string) => {
    setRingInterval(interval);
    setSnoozeFrequency(frequency);
  };

  const updatePreferences = (changes: Partial<Preferences>) => {
    // The region stays the one set at sign-up.
    setPreferences((current) => ({ ...current, ...changes, region: current.region }));
  };

  const updateProfile = (nextProfile: Profile) => {
    setProfile(nextProfile);
    setActiveUserEmail(nextProfile.email.trim().toLowerCase());
  };

  /** Points, tokens and token history are owned by the server; show its values whenever it sends them. */
  const applyWallet = useCallback((wallet: { points?: number; tokens?: number; tokenHistory?: TokenTransaction[] | object[] }) => {
    if (typeof wallet.points === 'number') setPoints(wallet.points);
    if (typeof wallet.tokens === 'number') setTokens(wallet.tokens);
    if (Array.isArray(wallet.tokenHistory)) setTokenHistory(wallet.tokenHistory as TokenTransaction[]);
  }, []);

  const addTokens = (amount: number, label = amount >= 0 ? 'Tokens added' : 'Tokens spent') => {
    setTokens((current) => Math.max(0, current + amount));
    if (amount !== 0) {
      setTokenHistory((current) => [{
        id: `token-${Date.now()}-${current.length}`,
        amount,
        label,
        date: new Date().toISOString(),
      }, ...current]);
    }
  };

  const clearLocalData = () => {
    if (activeUserEmail) {
      void AsyncStorage.removeItem(`${APP_STATE_KEY_PREFIX}${activeUserEmail}`);
      clearSyncMeta(activeUserEmail);
    }
    setAvatarImage(null);
    setProfile(initialProfile);
    setPreferences(initialPreferences);
    setAccountRegion('');
    setHabits([]);
    setPoints(0);
    setTokens(0);
    setTokenHistory([]);
    setDarkModeOverride(null);
    setRingInterval(30);
    setSnoozeFrequency('Once');
    setGoals([]);
  };

  const getAppStateSnapshot = useCallback((): PersistedAppState => ({
    avatarImage,
    profile,
    preferences,
    habits,
    points,
    tokens,
    tokenHistory,
    darkModeOverride,
    ringInterval,
    snoozeFrequency,
    goals,
  }), [avatarImage, darkModeOverride, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, tokenHistory, tokens]);

  const syncAppState = useCallback(async (state = getAppStateSnapshot()) => {
    // Never send before the server's state is known, or a state that is not loaded yet (the blank
    // startup state): either would replace the account's habits and check-ins on the server.
    if (!remoteReadyRef.current || !isLoadedState(state)) return { state, ok: false, merged: false };
    const result = await saveRemoteAppState(state as AppStateSyncPayload, syncBaseRef.current);
    const savedState = result?.state as PersistedAppState | undefined;
    if (savedState && result?.updatedAt && result.state) {
      setSyncBase({ updatedAt: result.updatedAt, state: result.state });
      setUnsaved(false);
      applyWallet(result.state);
    } else if (!syncBaseRef.current || clientOwnedKey(syncBaseRef.current.state) !== clientOwnedKey(state)) {
      setUnsaved(true);
    }
    if (savedState && result?.merged) {
      setAvatarImage(savedState.avatarImage ?? null);
      setProfile(savedState.profile as Profile);
      setPreferences(savedState.preferences as Preferences);
      setHabits(savedState.habits as Habit[]);
      setPoints(savedState.points);
      setTokens(savedState.tokens);
      setTokenHistory(savedState.tokenHistory as TokenTransaction[]);
      setDarkModeOverride(savedState.darkModeOverride);
      setRingInterval(savedState.ringInterval);
      setSnoozeFrequency(savedState.snoozeFrequency);
      setGoals(Array.isArray(savedState.goals) ? savedState.goals as Goal[] : []);
    }
    return { state: savedState ?? state, ok: Boolean(savedState), merged: Boolean(result?.merged) };
  }, [applyWallet, getAppStateSnapshot, setSyncBase, setUnsaved]);
  useEffect(() => {
    syncAppStateRef.current = syncAppState;
  }, [syncAppState]);

  const value = useMemo(
    () => ({
      colorScheme,
      isDarkMode: colorScheme === 'dark',
      setDarkMode: setDarkModeOverride,
      avatarImage,
      setAvatarImage,
      profile,
      updateProfile,
      preferences,
      updatePreferences,
      t: (key: Parameters<typeof translate>[1]) => translate(preferences.language, key),
      habits,
      addHabit,
      toggleHabit,
      toggleHabitForDate,
      canUndoCheckIn,
      celebration,
      streakFreeze,
      buyStreakFreeze: async () => {
        const result = await requestStreakFreeze(getLocalDateKey());
        if (!result.ok) return { ok: false, message: result.message };
        takeFreezeStatus(result);
        applyWallet(result);
        setHabits((current) => current.map((habit) => applyRemoteCompletionDates(habit, habit.completionDates, result.frozenDays)));
        return { ok: true, message: result.used.length ? 'It saved your streak right away.' : 'It will protect your streaks on a day you miss.' };
      },
      dismissCelebration: () => setCelebrations((current) => current.slice(1)),
      deleteHabit,
      updateHabit,
      reorderHabits,
      ringInterval,
      snoozeFrequency,
      goals,
      updateGoals: setGoals,
      setSnoozeSettings,
      points,
      tokens,
      tokenHistory,
      addTokens,
      applyWallet,
      getAppStateSnapshot,
      syncAppState,
      refreshAppState: async () => {
        if (remoteReadyRef.current) {
          const result = await syncAppStateRef.current?.();
          if (!result?.ok) return false;
        }
        await refreshAppStateRef.current?.();
        return remoteReadyRef.current;
      },
      clearLocalData,
      isFaculty: accountRole === 'faculty',
    }),
    [avatarImage, colorScheme, darkModeOverride, getAppStateSnapshot, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, syncAppState, tokenHistory, tokens, undoUntil, accountRole, celebration, streakFreeze],
  );

  const appTheme = isAppTheme(preferences.appTheme) ? preferences.appTheme : 'classic';
  return (
    <ColorSchemeContext.Provider value={value}>
      <DarkModeContext.Provider value={value.isDarkMode}>
        <AppThemeContext.Provider value={appTheme}>{children}</AppThemeContext.Provider>
      </DarkModeContext.Provider>
    </ColorSchemeContext.Provider>
  );
}

export function useAppColorScheme() {
  const context = useContext(ColorSchemeContext);

  if (!context) {
    throw new Error('useAppColorScheme must be used inside ColorSchemeProvider');
  }

  return context;
}
