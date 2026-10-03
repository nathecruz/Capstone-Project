import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Appearance, Platform, useColorScheme as useRNColorScheme } from 'react-native';
import { translate } from '@/constants/i18n';
import { getCurrentSession, subscribeToAuthChanges, type SessionUser } from '@/authentication/session';
import { getRemoteAppState, getRemoteHabitCompletions, saveRemoteAppState, saveRemoteHabitCompletion, type AppStateSyncBase, type AppStateSyncPayload } from '@/authentication/authService';
import { normalizeHabitFields } from '@/utils/habit-data';
import { CHECK_IN_UNDO_MS, canCompleteHabitForDate } from '@/utils/habit-visibility';
import type { EditableHabitFields } from '@/utils/habit-edit';
import { namesOf } from '@/utils/names';
import { computeStreak } from '@/utils/streaks';
import { applyRemoteCompletionDates, applyVisibleOrder, getLocalDateKey } from './app-state/habit-progress';
import { DarkModeContext } from './dark-mode-context';
import { clearSyncMeta, loadSyncMeta, persistSyncBase, persistUnsaved } from './app-state/sync-storage';
import { useHabitReminders } from './app-state/use-habit-reminders';
import { initialPreferences, initialProfile, type Goal, type Habit, type PersistedAppState, type Preferences, type Profile, type TokenTransaction } from './app-state/types';

export * from './app-state/types';
export { getHabitCompletionHistory, getHabitProgressSummary, getRecentCompletionHistory } from './app-state/habit-progress';
export { getHabitReminderDays, getHabitReminderSchedule, getHabitReminderTimes, getNotificationsModule, getSnoozeLimit, isHabitMissedYesterday, isHabitReminderDay, requestNotificationAccess } from './app-state/reminders';

type ColorScheme = 'light' | 'dark';
let nextHabitId = 0;
const APP_STATE_KEY_PREFIX = 'habitai_app_state:';
const REMOTE_REFRESH_INTERVAL_MS = 15000;

/** JSON with sorted keys, so two copies of the same state compare equal regardless of key order. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

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

const ColorSchemeContext = createContext<ColorSchemeContextValue | undefined>(undefined);

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [darkModeOverride, setDarkModeOverride] = useState<boolean | null>(null);
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
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
  // At midnight a new day starts: yesterday's check-ins lock and unfinished habits become
  // missed, without waiting for a reload.
  const [dayKey, setDayKey] = useState(() => getLocalDateKey());
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
    const timer = setTimeout(() => {
      setHabits((current) => current.map((habit) => applyRemoteCompletionDates(habit, habit.completionDates)));
      setUndoUntil({});
      setDayKey(getLocalDateKey());
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

      const remoteCompletions = keepLocalChanges ? null : await getRemoteHabitCompletions();
      if (cancelled || version !== sessionLoadVersion) return;
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
      setPreferences({ ...initialPreferences, ...(savedState.preferences ?? {}), region: savedState.preferences?.region || session.region || initialPreferences.region });
      const savedHabits = Array.isArray(savedState.habits) ? savedState.habits : [];
      const completionsByHabit = new Map<string, string[]>();
      for (const completion of remoteCompletions ?? []) {
        completionsByHabit.set(completion.habitId, [...(completionsByHabit.get(completion.habitId) ?? []), completion.date]);
      }
      setHabits((remoteCompletions === null
        ? savedHabits
        : savedHabits.map((habit) => applyRemoteCompletionDates(habit, completionsByHabit.get(habit.id) ?? [])))
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
    if (!stateHydrated || !activeUserEmail) return;
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
    if (syncBaseRef.current && stableStringify(syncBaseRef.current.state) === stableStringify(state)) return;
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
          : savedHabits.map((habit) => applyRemoteCompletionDates(habit, completionsByHabit.get(habit.id) ?? [])))
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
    const syncThenRefresh = async () => {
      if (remoteReadyRef.current) {
        const result = await syncAppStateRef.current?.();
        if (!result?.ok) return;
      }
      await refreshRemoteState();
    };
    const handleVisibilityChange = () => {
      appIsActive = !document.hidden;
      if (appIsActive) void syncThenRefresh();
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

    // Other devices' changes arrive within this interval; returning to the app refreshes immediately.
    // (It used to poll every second, which exhausted the API rate limit within minutes.)
    const refreshTimer = setInterval(() => void refreshRemoteState(), REMOTE_REFRESH_INTERVAL_MS);
    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      appIsActive = nextState === 'active';
      if (appIsActive) void syncThenRefresh();
    });
    void refreshRemoteState();

    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
      appStateSubscription.remove();
      if (Platform.OS === 'web' && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.removeEventListener('online', handleOnline);
      }
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
    }]);
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
      const streak = computeStreak(habit, completionDates, getLocalDateKey());
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
    void saveRemoteHabitCompletion({ habitId: id, date: dateKey, completed }).then((result) => {
      if (!result) {
        // The server keeps a check-in it would not undo (locked, or unreachable): show it again.
        if (!completed) applyLocalCheckIn(id, dateKey, true);
        return;
      }
      applyWallet(result);
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
      return { ...next, streak: computeStreak(next, next.completionDates, getLocalDateKey()) };
    }));
  };

  /** Reorders the habits shown on screen (possibly a filtered subset) without dropping the rest. */
  const reorderHabits = (ordered: Habit[]) => setHabits((current) => applyVisibleOrder(current, ordered));

  const setSnoozeSettings = (interval: number, frequency: string) => {
    setRingInterval(interval);
    setSnoozeFrequency(frequency);
  };

  const updatePreferences = (changes: Partial<Preferences>) => {
    setPreferences((current) => ({ ...current, ...changes }));
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
    // Never send before the server's state is known: it would replace the server copy.
    if (!remoteReadyRef.current) return { state, ok: false, merged: false };
    const result = await saveRemoteAppState(state as AppStateSyncPayload, syncBaseRef.current);
    const savedState = result?.state as PersistedAppState | undefined;
    if (savedState && result?.updatedAt && result.state) {
      setSyncBase({ updatedAt: result.updatedAt, state: result.state });
      setUnsaved(false);
      applyWallet(result.state);
    } else if (!syncBaseRef.current || stableStringify(syncBaseRef.current.state) !== stableStringify(state)) {
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
    [avatarImage, colorScheme, darkModeOverride, getAppStateSnapshot, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, syncAppState, tokenHistory, tokens, undoUntil, accountRole],
  );

  return <ColorSchemeContext.Provider value={value}><DarkModeContext.Provider value={value.isDarkMode}>{children}</DarkModeContext.Provider></ColorSchemeContext.Provider>;
}

export function useAppColorScheme() {
  const context = useContext(ColorSchemeContext);

  if (!context) {
    throw new Error('useAppColorScheme must be used inside ColorSchemeProvider');
  }

  return context;
}
