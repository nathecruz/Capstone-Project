import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, Appearance, Platform, useColorScheme as useRNColorScheme } from 'react-native';
import { translate } from '@/constants/i18n';
import { getCurrentSession, subscribeToAuthChanges, type SessionUser } from '@/authentication/session';
import { getRemoteAppState, getRemoteHabitCompletions, saveRemoteAppState, saveRemoteHabitCompletion, type AppStateSyncBase, type AppStateSyncPayload } from '@/authentication/authService';
import { normalizeHabitFields } from '@/utils/habit-data';
import { canCompleteHabitForDate } from '@/utils/habit-visibility';
import { computeStreak } from '@/utils/streaks';
import { applyRemoteCompletionDates, getLocalDateKey } from './app-state/habit-progress';
import { useHabitReminders } from './app-state/use-habit-reminders';
import { initialPreferences, initialProfile, type Goal, type Habit, type PersistedAppState, type Preferences, type Profile, type TokenTransaction } from './app-state/types';

export * from './app-state/types';
export { getHabitCompletionHistory, getHabitProgressSummary } from './app-state/habit-progress';
export { getHabitReminderDays, getHabitReminderSchedule, getHabitReminderTimes, getNotificationsModule, getSnoozeLimit, isHabitMissedToday, isHabitReminderDay, requestNotificationAccess } from './app-state/reminders';

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
  deleteHabit: (id: string) => void;
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
};

const ColorSchemeContext = createContext<ColorSchemeContextValue | undefined>(undefined);

export function ColorSchemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useRNColorScheme();
  const [darkModeOverride, setDarkModeOverride] = useState<boolean | null>(null);
  const [avatarImage, setAvatarImage] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [preferences, setPreferences] = useState<Preferences>(initialPreferences);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [points, setPoints] = useState(0);
  const [tokens, setTokens] = useState(0);
  const [tokenHistory, setTokenHistory] = useState<TokenTransaction[]>([]);
  const [ringInterval, setRingInterval] = useState(30);
  const [snoozeFrequency, setSnoozeFrequency] = useState('Once');
  const [goals, setGoals] = useState<Goal[]>([]);
  const [activeUserEmail, setActiveUserEmail] = useState('');
  const [stateHydrated, setStateHydrated] = useState(false);
  const syncBaseRef = useRef<AppStateSyncBase | null>(null);
  const refreshAppStateRef = useRef<(() => Promise<void>) | null>(null);
  const syncAppStateRef = useRef<(() => Promise<{ state: PersistedAppState; ok: boolean; merged: boolean }>) | null>(null);
  useHabitReminders({ habits, preferences, ringInterval, snoozeFrequency });

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
      setActiveUserEmail('');
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
      let savedState: Partial<PersistedAppState> = {};
      try {
        const raw = await AsyncStorage.getItem(`${APP_STATE_KEY_PREFIX}${email}`);
        if (raw) savedState = JSON.parse(raw) as Partial<PersistedAppState>;
      } catch {
        savedState = {};
      }
      if (cancelled || version !== sessionLoadVersion) return;

      const remoteState = await getRemoteAppState();
      if (cancelled || version !== sessionLoadVersion) return;
      if (remoteState?.state) {
        const remoteSavedState = remoteState.state as Partial<PersistedAppState>;
        savedState = {
          ...remoteSavedState,
          goals: Array.isArray(remoteSavedState.goals) ? remoteSavedState.goals : savedState.goals,
        };
        syncBaseRef.current = remoteState.updatedAt
          ? { updatedAt: remoteState.updatedAt, state: remoteState.state }
          : null;
      } else {
        syncBaseRef.current = null;
      }

      const remoteCompletions = await getRemoteHabitCompletions();
      if (cancelled || version !== sessionLoadVersion) return;
      setActiveUserEmail(email);
      setAvatarImage(savedState.avatarImage ?? null);
      setProfile({
        ...initialProfile,
        ...(savedState.profile ?? {}),
        fullName: savedState.profile?.fullName || session.fullName,
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
    const syncTimer = setTimeout(() => {
      void saveRemoteAppState(state as AppStateSyncPayload, syncBaseRef.current).then((result) => {
        if (!result?.state || !result.updatedAt) return;
        syncBaseRef.current = { updatedAt: result.updatedAt, state: result.state };
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
      });
    }, 500);
    return () => clearTimeout(syncTimer);
  }, [activeUserEmail, avatarImage, darkModeOverride, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, stateHydrated, tokenHistory, tokens]);

  useEffect(() => {
    if (!stateHydrated || !activeUserEmail) return;

    let cancelled = false;
    let refreshInFlight = false;
    let appIsActive = Platform.OS === 'web' || AppState.currentState === 'active';

    const refreshRemoteState = async () => {
      if (cancelled || !appIsActive || refreshInFlight) return;
      refreshInFlight = true;
      try {
        // Cheap poll: the server only returns the full state when another device saved something newer.
        const knownUpdatedAt = syncBaseRef.current?.updatedAt ?? 0;
        const remoteState = await getRemoteAppState(knownUpdatedAt || null);
        if (cancelled || !remoteState || remoteState.unchanged || !remoteState.state || !remoteState.updatedAt) return;
        const localUpdatedAt = syncBaseRef.current?.updatedAt ?? 0;
        if (remoteState.updatedAt <= localUpdatedAt) return;
        const remoteCompletions = remoteState.completions ?? await getRemoteHabitCompletions();
        if (cancelled) return;

        const nextState = remoteState.state;
        const savedHabits: Habit[] = Array.isArray(nextState.habits) ? nextState.habits as Habit[] : [];
        const completionsByHabit = new Map<string, string[]>();
        for (const completion of remoteCompletions ?? []) {
          completionsByHabit.set(completion.habitId, [...(completionsByHabit.get(completion.habitId) ?? []), completion.date]);
        }

        syncBaseRef.current = { updatedAt: remoteState.updatedAt, state: nextState };
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
      const result = await syncAppStateRef.current?.();
      if (result?.ok) await refreshRemoteState();
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

  const toggleHabitForDate = (id: string, date: Date) => {
    const dateKey = getLocalDateKey(date);
    const isToday = dateKey === getLocalDateKey();
    const completionTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    const currentHabit = habits.find((habit) => habit.id === id);
    if (isToday && currentHabit && !canCompleteHabitForDate(currentHabit, date)) return;
    const completedOnDate = currentHabit?.completionDates.includes(dateKey) ?? false;
    setHabits((current) => current.map((habit) => {
      if (habit.id !== id) return habit;
      const completedOnDate = habit.completionDates.includes(dateKey);
      const completionDates = completedOnDate
        ? habit.completionDates.filter((completionDate) => completionDate !== dateKey)
        : [...habit.completionDates, dateKey];
      const goal = habit.goal || 1;
      const done = completionDates.includes(getLocalDateKey());
      // Streaks come from the check-in dates and schedule (a missed day resets them).
      const streak = computeStreak(habit, completionDates, getLocalDateKey());
      // Optimistic display only: the server's ledger replaces these values in the response below.
      setPoints((current) => Math.max(0, current + (completedOnDate ? -20 : 20)));
      setTokens((current) => Math.max(0, current + (completedOnDate ? -5 : 5)));
      return { ...habit, done, completionDates, streak, completionTimeZone, progress: isToday ? (done ? 100 : 0) : habit.progress, total: isToday ? `${done ? goal : 0}/${goal}` : habit.total };
    }));
    void saveRemoteHabitCompletion({ habitId: id, date: dateKey, completed: !completedOnDate }).then((result) => {
      if (!result) return;
      applyWallet(result);
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
    const result = await saveRemoteAppState(state as AppStateSyncPayload, syncBaseRef.current);
    const savedState = result?.state as PersistedAppState | undefined;
    if (savedState && result?.updatedAt && result.state) {
      syncBaseRef.current = { updatedAt: result.updatedAt, state: result.state };
      applyWallet(result.state);
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
  }, [getAppStateSnapshot]);
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
      deleteHabit,
      reorderHabits: setHabits,
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
        const result = await syncAppStateRef.current?.();
        if (!result?.ok) return false;
        await refreshAppStateRef.current?.();
        return true;
      },
      clearLocalData,
    }),
    [avatarImage, colorScheme, darkModeOverride, getAppStateSnapshot, goals, habits, points, preferences, profile, ringInterval, snoozeFrequency, syncAppState, tokenHistory, tokens],
  );

  return <ColorSchemeContext.Provider value={value}>{children}</ColorSchemeContext.Provider>;
}

export function useAppColorScheme() {
  const context = useContext(ColorSchemeContext);

  if (!context) {
    throw new Error('useAppColorScheme must be used inside ColorSchemeProvider');
  }

  return context;
}
