import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { getLocales } from 'expo-localization';
import { AppState, Appearance, Platform, useColorScheme as useRNColorScheme } from 'react-native';
import { translate, type SupportedLanguage } from '@/constants/i18n';
import { getCurrentSession, subscribeToAuthChanges, type SessionUser } from '@/authentication/session';
import { getApiBaseUrl, getAuthenticatedHeaders, getRemoteAppState, getRemoteHabitCompletions, getWebPushVapidPublicKey, saveRemoteAppState, saveRemoteHabitCompletion, saveWebPushSubscription, type AppStateSyncBase, type AppStateSyncPayload } from '@/authentication/authService';
import { normalizeHabitFields } from '@/utils/habit-data';
import { canCompleteHabitForDate } from '@/utils/habit-visibility';

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
type NotificationsModule = typeof import('expo-notifications');
let notificationsModule: NotificationsModule | null = null;

function parseReminderTime(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i.exec(value.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3]?.toUpperCase();
  if (!Number.isInteger(minute) || minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    if (period === 'PM' && hour !== 12) hour += 12;
    if (period === 'AM' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return { hour, minute };
}

export function getHabitReminderTimes(habit: Pick<Habit, 'reminderTime' | 'reminderTimes'>) {
  const values = habit.reminderTimes?.length ? habit.reminderTimes : [habit.reminderTime];
  return values.map(parseReminderTime).filter((time): time is { hour: number; minute: number } => Boolean(time));
}

const reminderDayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const reminderDayNumbers: Record<(typeof reminderDayLabels)[number], number> = {
  Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6, Sat: 7,
};

export function getHabitReminderDays(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays'>) {
  const metaParts = habit.meta.split(' • ');
  const configuredDays = habit.reminderDays?.length
    ? habit.reminderDays
    : habit.frequency === 'Custom'
      ? (metaParts[metaParts.length - 1] || '').split(',').map((day) => day.trim())
      : [];
  return configuredDays.filter((day): day is (typeof reminderDayLabels)[number] => reminderDayLabels.includes(day as (typeof reminderDayLabels)[number]));
}

export function getHabitReminderSchedule(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays' | 'startDate'>) {
  if (habit.frequency === 'Monthly') {
    const day = Number(habit.startDate.slice(8, 10));
    return { type: 'monthly' as const, day: day >= 1 && day <= 31 ? day : 1 };
  }
  if (habit.frequency === 'Weekly' || habit.frequency === 'Custom') {
    const days = getHabitReminderDays(habit);
    if (!days.length && habit.frequency === 'Weekly' && /^\d{4}-\d{2}-\d{2}$/.test(habit.startDate)) {
      return { type: 'weekly' as const, days: [reminderDayLabels[new Date(`${habit.startDate}T00:00:00`).getDay()]] };
    }
    return { type: 'weekly' as const, days };
  }
  return { type: 'daily' as const };
}

export function isHabitReminderDay(habit: Pick<Habit, 'frequency' | 'meta' | 'reminderDays' | 'startDate'>, date: Date) {
  const schedule = getHabitReminderSchedule(habit);
  if (schedule.type === 'weekly') return schedule.days.includes(reminderDayLabels[date.getDay()]);
  if (schedule.type === 'monthly') return date.getDate() === schedule.day;
  return true;
}

export function getSnoozeLimit(frequency: string) {
  if (frequency === 'Once') return 1;
  const count = Number.parseInt(frequency, 10);
  return Number.isFinite(count) ? Math.max(1, Math.min(5, count)) : 1;
}

export async function getNotificationsModule() {
  if (Platform.OS === 'web') return null;
  try {
    notificationsModule ??= await import('expo-notifications');
    notificationsModule.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    return notificationsModule;
  } catch {
    return null;
  }
}

async function getBrowserNotificationRegistration() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function decodeVapidPublicKey(value: string) {
  const padded = `${value}${'='.repeat((4 - value.length % 4) % 4)}`;
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
}

export async function requestNotificationAccess() {
  if (Platform.OS === 'web') {
    try {
      if (typeof window === 'undefined' || typeof window.Notification === 'undefined') return false;
      let permission = window.Notification.permission;
      if (permission === 'default') permission = await window.Notification.requestPermission();
      if (permission !== 'granted') return false;
      const registration = await getBrowserNotificationRegistration();
      if (!registration) return false;
      const publicKey = await getWebPushVapidPublicKey();
      if (!publicKey) return false;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeVapidPublicKey(publicKey).buffer as ArrayBuffer,
        });
      }
      const serialized = subscription.toJSON();
      if (!serialized.endpoint || !serialized.keys?.auth || !serialized.keys.p256dh) return false;
      const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      return saveWebPushSubscription({
        endpoint: serialized.endpoint,
        expirationTime: serialized.expirationTime,
        keys: { auth: serialized.keys.auth, p256dh: serialized.keys.p256dh },
      }, timeZone);
    } catch {
      return false;
    }
  }
  const Notifications = await getNotificationsModule();
  if (!Notifications) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (permission.status === 'granted') return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === 'granted';
}

type PersistedAppState = {
  avatarImage: string | null;
  profile: Profile;
  preferences: Preferences;
  habits: Habit[];
  points: number;
  tokens: number;
  tokenHistory: TokenTransaction[];
  darkModeOverride: boolean | null;
  ringInterval: number;
  snoozeFrequency: string;
  goals: Goal[];
};

export type Goal = {
  id: string;
  title: string;
  category: string;
  summary: string;
  intensity: 'High focus' | 'Balanced' | 'Quick win';
  focusAreas: string[];
  actionPlan: string[];
  actionDueDates: string[];
  nextMilestone: string;
  risk: string;
  riskAction: string;
  timeline: string;
  focusTarget: string;
  nextCheckIn: string;
  completedSteps: boolean[];
  progress: number;
  status: string;
};

export type Habit = {
  id: string;
  startDate: string;
  label: string;
  meta: string;
  category: string;
  frequency: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  goal: number;
  progress: number;
  total: string;
  streak: number;
  done: boolean;
  completionDates: string[];
  reminderEnabled: boolean;
  reminderTime: string;
  reminderTimes?: string[];
  completionTimeZone?: string;
  reminderDays?: string[];
  reminderSoundEnabled?: boolean;
  smartReminderEnabled?: boolean;
};

export type Profile = {
  fullName: string;
  email: string;
  username: string;
  dateOfBirth: string;
  gender: string;
  about: string;
};

export type Preferences = {
  notificationsEnabled: boolean;
  hideProgress: boolean;
  showCompletedHabits: boolean;
  weekStartsOn: 'Sunday' | 'Monday';
  language: string;
  region: string;
};

const languageNames: Record<string, SupportedLanguage> = {
  en: 'English',
  fil: 'Tagalog',
  tl: 'Tagalog',
};

function getDeviceLocalePreferences() {
  try {
    const locale = getLocales()[0];
    const languageCode = locale?.languageCode?.toLowerCase() ?? '';
    return {
      language: languageNames[languageCode] ?? 'English',
      region: 'Metro Manila',
    };
  } catch {
    return { language: 'English' as SupportedLanguage, region: 'Metro Manila' };
  }
}

const deviceLocalePreferences = getDeviceLocalePreferences();

export type TokenTransaction = {
  id: string;
  amount: number;
  label: string;
  date: string;
};

export const initialPreferences: Preferences = {
  notificationsEnabled: true,
  hideProgress: false,
  showCompletedHabits: true,
  weekStartsOn: 'Monday',
  ...deviceLocalePreferences,
};

export const initialProfile: Profile = {
  fullName: '',
  email: '',
  username: '',
  dateOfBirth: '',
  gender: '',
  about: '',
};

export function getHabitProgressSummary(habits: Habit[]) {
  const completed = habits.filter((habit) => habit.done).length;
  const completionPercent = habits.length ? Math.round((completed / habits.length) * 100) : 0;
  const averageProgress = habits.length
    ? Math.round(habits.reduce((sum, habit) => sum + habit.progress, 0) / habits.length)
    : 0;
  const maxStreak = habits.length ? Math.max(...habits.map((habit) => habit.streak)) : 0;

  return { completed, completionPercent, averageProgress, maxStreak };
}

export function getHabitCompletionHistory(habits: Habit[], days = 7, weekStartsOn: Preferences['weekStartsOn'] = 'Monday') {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentDay = today.getDay();
  const weekStartDay = weekStartsOn === 'Sunday' ? 0 : 1;
  const daysSinceWeekStart = (currentDay - weekStartDay + 7) % 7;
  const firstDate = new Date(today);
  firstDate.setDate(today.getDate() - daysSinceWeekStart);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(firstDate);
    date.setDate(firstDate.getDate() + index);
    const dateKey = getLocalDateKey(date);
    const count = habits.reduce((total, habit) => total + (habit.completionDates.includes(dateKey) ? 1 : 0), 0);
    return {
      dateKey,
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      count,
    };
  });
}

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function applyRemoteCompletionDates(habit: Habit, completionDates: string[]) {
  const today = getLocalDateKey();
  const done = completionDates.includes(today);
  const goal = Math.max(1, Number(habit.goal) || 1);
  return normalizeHabitFields({
    ...habit,
    completionDates,
    done,
    progress: done ? 100 : 0,
    total: `${done ? goal : 0}/${goal}`,
  }) as Habit;
}

export function isHabitMissedToday(habit: Pick<Habit, 'completionDates' | 'startDate' | 'reminderEnabled' | 'reminderTime' | 'reminderTimes'>, now = new Date()) {
  const today = getLocalDateKey(now);
  if (habit.completionDates.includes(today) || (habit.startDate && habit.startDate > today) || !habit.reminderEnabled) return false;
  const reminderTimes = habit.reminderTimes?.length ? habit.reminderTimes : [habit.reminderTime];
  let hasValidReminderTime = false;
  for (const reminderTime of reminderTimes) {
    const time = parseReminderTime(reminderTime);
    if (!time) continue;
    hasValidReminderTime = true;
    if (now.getHours() < time.hour || (now.getHours() === time.hour && now.getMinutes() < time.minute)) return false;
  }
  return hasValidReminderTime;
}

function getSmartReminderMessage(habit: Habit, riskLevel: 'low' | 'medium' | 'high') {
  const riskMessages = {
    low: `You have a good rhythm with ${habit.label}. Keep the momentum going with one small win today.`,
    medium: `A quick ${habit.label} check-in now could help you stay on track before the day gets busy.`,
    high: `${habit.label} is at risk of being skipped today. A short action now will protect your streak.`,
  };
  return riskMessages[riskLevel];
}

type HabitPrediction = {
  dropout_risk?: number;
  completion_probability?: number;
  recommended_action?: string;
};

function getRecentHabitSignals(habit: Habit, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const last7Days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return habit.completionDates.includes(getLocalDateKey(date)) ? 1 : 0;
  });

  return {
    last_7_days: last7Days,
    completion_rate: last7Days.reduce<number>((sum, value) => sum + value, 0) / last7Days.length,
    missed_days: last7Days.filter((value) => value === 0).length,
  };
}

function getRiskLevel(dropoutRisk: number, completionProbability: number): 'low' | 'medium' | 'high' {
  const risk = Number.isFinite(dropoutRisk) ? dropoutRisk : 1 - completionProbability;
  return risk >= 0.65 ? 'high' : risk >= 0.35 ? 'medium' : 'low';
}

function computeSmartReminderTime(habit: Habit, now = new Date(), modelRisk?: { dropoutRisk: number; completionProbability: number }) {
  const fallbackTime = parseReminderTime(habit.reminderTime) ?? { hour: 9, minute: 0 };
  const recentSignals = getRecentHabitSignals(habit, now);
  const riskLevel = modelRisk
    ? getRiskLevel(modelRisk.dropoutRisk, modelRisk.completionProbability)
    : habit.progress < 35 || habit.streak <= 1 || recentSignals.completion_rate < 0.4
      ? 'high'
      : habit.progress < 70 || recentSignals.completion_rate < 0.7
        ? 'medium'
        : 'low';

  const target = new Date(now);
  const minuteOffset = riskLevel === 'high' ? -30 : riskLevel === 'medium' ? 15 : 45;
  const baseMinutes = fallbackTime.hour * 60 + fallbackTime.minute + minuteOffset;

  target.setHours(Math.floor(baseMinutes / 60), baseMinutes % 60, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return { target, riskLevel };
}

async function requestHabitPrediction(habit: Habit): Promise<HabitPrediction | null> {
  const signals = getRecentHabitSignals(habit);
  const normalizedCategory = habit.category.toLowerCase();
  const goalType = normalizedCategory.includes('health')
    ? 'health'
    : normalizedCategory.includes('mind')
      ? 'mindfulness'
      : normalizedCategory.includes('productivity')
        ? 'productivity'
        : 'balanced';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(`${getApiBaseUrl()}/api/habit/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        habit_name: habit.label,
        streak: habit.streak,
        completion_rate: signals.completion_rate,
        missed_days: signals.missed_days,
        last_7_days: signals.last_7_days,
        priority: 'balanced',
        goal_type: goalType,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const prediction = await response.json() as HabitPrediction;
    if (typeof prediction.dropout_risk !== 'number' && typeof prediction.completion_probability !== 'number') return null;
    const completionProbability = typeof prediction.completion_probability === 'number'
      ? Math.max(0, Math.min(1, prediction.completion_probability))
      : 1 - Math.max(0, Math.min(1, prediction.dropout_risk ?? 1));
    const dropoutRisk = typeof prediction.dropout_risk === 'number'
      ? Math.max(0, Math.min(1, prediction.dropout_risk))
      : 1 - completionProbability;
    return { ...prediction, dropout_risk: dropoutRisk, completion_probability: completionProbability };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
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
  const [reminderScheduleRevision, setReminderScheduleRevision] = useState(0);
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
  const sentBrowserRemindersRef = useRef(new Set<string>());
  const handledSnoozeActionsRef = useRef(new Set<string>());
  const colorScheme: ColorScheme = darkModeOverride === null
    ? systemScheme === 'dark'
      ? 'dark'
      : 'light'
    : darkModeOverride
      ? 'dark'
      : 'light';

  useEffect(() => {
    const refreshAtMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      return setTimeout(() => setReminderScheduleRevision((revision) => revision + 1), nextMidnight.getTime() - now.getTime() + 100);
    };
    let midnightTimer = refreshAtMidnight();
    const appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      setReminderScheduleRevision((revision) => revision + 1);
      clearTimeout(midnightTimer);
      midnightTimer = refreshAtMidnight();
    });
    return () => {
      clearTimeout(midnightTimer);
      appStateSubscription.remove();
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    let browserReminderTimer: ReturnType<typeof setInterval> | undefined;
    const scheduleReminders = async () => {
      if (cancelled) return;
      if (Platform.OS === 'web') {
        if (!preferences.notificationsEnabled || typeof window === 'undefined' || typeof window.Notification === 'undefined' || window.Notification.permission !== 'granted') return;
        const registration = await getBrowserNotificationRegistration();
        if (!registration) return;
        if (await registration.pushManager.getSubscription()) return;
        const reminders = habits
          .map((habit) => ({ habit, times: getHabitReminderTimes(habit) }))
          .filter((entry) => entry.habit.reminderEnabled && entry.times.length > 0);
        if (!reminders.length) return;

        const notifyDueReminders = () => {
          if (cancelled) return;
          const now = new Date();
          const today = getLocalDateKey(now);
          for (const key of sentBrowserRemindersRef.current) {
            if (key.split('|')[1] !== today) sentBrowserRemindersRef.current.delete(key);
          }
          for (const { habit, times } of reminders) {
            if ((habit.startDate && habit.startDate > today) || !isHabitReminderDay(habit, now)) continue;
            for (const time of times) {
              if (now.getHours() !== time.hour || now.getMinutes() !== time.minute) continue;
              const key = `${habit.id}|${today}|${time.hour}:${time.minute}`;
              if (sentBrowserRemindersRef.current.has(key)) continue;
              sentBrowserRemindersRef.current.add(key);
              void registration.showNotification(`${habit.label} reminder`, {
                body: 'A small step today keeps your streak moving.',
                tag: key,
                silent: habit.reminderSoundEnabled === false,
              }).catch(() => undefined);
            }
          }
        };

        notifyDueReminders();
        browserReminderTimer = setInterval(notifyDueReminders, 15000);
        return;
      }
      const Notifications = await getNotificationsModule();
      if (!Notifications) return;
      await Notifications.setNotificationCategoryAsync('habit-reminder-snooze', [{
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      }]);
      await Notifications.cancelAllScheduledNotificationsAsync();
      if (!preferences.notificationsEnabled) return;
      const reminders = habits
        .map((habit) => ({ habit, times: getHabitReminderTimes(habit) }))
        .filter((entry): entry is { habit: Habit; times: { hour: number; minute: number }[] } => entry.habit.reminderEnabled && entry.times.length > 0 && (!entry.habit.startDate || entry.habit.startDate <= getLocalDateKey()));
      if (!reminders.length) return;
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('habit-reminders-sound-v2', {
          name: 'Habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: 'reminder_sound.mp3',
        });
        await Notifications.setNotificationChannelAsync('habit-reminders-silent-v2', {
          name: 'Silent habit reminders', importance: Notifications.AndroidImportance.HIGH, sound: null,
        });
      }
      const permission = await Notifications.getPermissionsAsync();
      if (permission.status !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        if (requested.status !== 'granted') return;
      }
      const smartReminders = reminders.filter(({ habit }) => habit.smartReminderEnabled);
      for (const { habit, times } of reminders.filter(({ habit }) => !habit.smartReminderEnabled)) {
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
        for (const time of times) {
          if (cancelled) return;
          const schedule = getHabitReminderSchedule(habit);
          const content = {
            title: `${habit.label} reminder`,
            body: 'A small step today keeps your streak moving.',
            sound: soundEnabled ? 'reminder_sound.mp3' : false,
            data: { habitId: habit.id, snoozeCount: 0 },
            categoryIdentifier: 'habit-reminder-snooze',
          };
          if (schedule.type === 'weekly') {
            for (const day of schedule.days) {
              await Notifications.scheduleNotificationAsync({
                content,
                trigger: { type: Notifications.SchedulableTriggerInputTypes.WEEKLY, weekday: reminderDayNumbers[day], hour: time.hour, minute: time.minute, ...channel },
              });
            }
          } else if (schedule.type === 'monthly') {
            await Notifications.scheduleNotificationAsync({
              content,
              trigger: { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, day: schedule.day, hour: time.hour, minute: time.minute, repeats: true, ...channel },
            });
          } else {
            await Notifications.scheduleNotificationAsync({
              content,
              trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour: time.hour, minute: time.minute, ...channel },
            });
          }
        }

        if (habit.frequency === 'Custom') continue;
        const lastReminderTime = times.reduce((latest, time) => time.hour * 60 + time.minute > latest.hour * 60 + latest.minute ? time : latest);
        const missedAt = new Date();
        missedAt.setHours(lastReminderTime.hour, lastReminderTime.minute + 1, 0, 0);
        if (missedAt <= new Date()) missedAt.setDate(missedAt.getDate() + 1);
        await Notifications.scheduleNotificationAsync({
          content: {
            title: 'Smart Reminder',
            body: `${habit.label} may have been missed. Complete it now to keep your routine moving.`,
            sound: soundEnabled ? 'reminder_sound.mp3' : false,
            data: { habitId: habit.id, type: 'missed-habit', snoozeCount: 0 },
            categoryIdentifier: 'habit-reminder-snooze',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: missedAt, ...channel },
        });
      }

      const predictions = await Promise.all(smartReminders.map(async ({ habit }) => ({
        habit,
        prediction: await requestHabitPrediction(habit),
      })));
      if (cancelled) return;
      for (const { habit, prediction } of predictions) {
        if (cancelled) return;
        const modelRisk = prediction && typeof prediction.dropout_risk === 'number' && typeof prediction.completion_probability === 'number'
          ? { dropoutRisk: prediction.dropout_risk, completionProbability: prediction.completion_probability }
          : undefined;
        const { target, riskLevel } = computeSmartReminderTime(habit, new Date(), modelRisk);
        const soundEnabled = habit.reminderSoundEnabled !== false;
        const channel = Platform.OS === 'android'
          ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
          : {};
        await Notifications.scheduleNotificationAsync({
          content: {
            title: `Smart reminder: ${habit.label}`,
            body: prediction?.recommended_action || getSmartReminderMessage(habit, riskLevel),
            sound: soundEnabled ? 'reminder_sound.mp3' : false,
            data: { habitId: habit.id, type: 'smart-reminder', riskLevel, snoozeCount: 0 },
            categoryIdentifier: 'habit-reminder-snooze',
          },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: target, ...channel },
        });
      }
    };
    void scheduleReminders().catch(() => undefined);
    return () => {
      cancelled = true;
      if (browserReminderTimer) clearInterval(browserReminderTimer);
    };
  }, [habits, preferences.notificationsEnabled, reminderScheduleRevision]);

  useEffect(() => {
    let active = true;
    let responseSubscription: { remove: () => void } | undefined;

    const handleResponse = async (Notifications: NotificationsModule, response: import('expo-notifications').NotificationResponse) => {
      if (response.actionIdentifier !== 'SNOOZE') return;
      const actionKey = `${response.notification.request.identifier}:SNOOZE`;
      if (handledSnoozeActionsRef.current.has(actionKey)) return;
      handledSnoozeActionsRef.current.add(actionKey);

      const data = response.notification.request.content.data ?? {};
      const snoozeCount = Number(data.snoozeCount) || 0;
      const snoozeLimit = getSnoozeLimit(snoozeFrequency);
      if (snoozeCount >= snoozeLimit) return;
      const habitId = typeof data.habitId === 'string' ? data.habitId : '';
      const habit = habits.find((item) => item.id === habitId);
      const soundEnabled = habit?.reminderSoundEnabled !== false;
      const channel = Platform.OS === 'android'
        ? { channelId: soundEnabled ? 'habit-reminders-sound-v2' : 'habit-reminders-silent-v2' }
        : {};
      const notificationContent = response.notification.request.content;
      const nextSnoozeCount = snoozeCount + 1;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: notificationContent.title || 'Habit reminder',
          body: notificationContent.body || 'A small step today keeps your streak moving.',
          sound: soundEnabled ? 'reminder_sound.mp3' : false,
          data: { ...data, snoozeCount: nextSnoozeCount },
          ...(nextSnoozeCount < snoozeLimit ? { categoryIdentifier: 'habit-reminder-snooze' } : {}),
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.DATE,
          date: new Date(Date.now() + ringInterval * 60_000),
          ...channel,
        },
      });
    };

    const register = async () => {
      const Notifications = await getNotificationsModule();
      if (!Notifications || !active) return;
      await Notifications.setNotificationCategoryAsync('habit-reminder-snooze', [{
        identifier: 'SNOOZE',
        buttonTitle: 'Snooze',
        options: { opensAppToForeground: false },
      }]);
      responseSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
        void handleResponse(Notifications, response).catch(() => undefined);
      });
      const lastResponse = await Notifications.getLastNotificationResponseAsync();
      if (active && lastResponse) await handleResponse(Notifications, lastResponse).catch(() => undefined);
    };

    void register();
    return () => {
      active = false;
      responseSubscription?.remove();
    };
  }, [habits, ringInterval, snoozeFrequency]);

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
      const streak = isToday
        ? done !== habit.done
          ? done ? habit.streak + 1 : Math.max(0, habit.streak - 1)
          : habit.streak
        : habit.streak;
      setPoints((current) => Math.max(0, current + (completedOnDate ? -20 : 20)));
      setTokens((current) => Math.max(0, current + (completedOnDate ? -5 : 5)));
      setTokenHistory((current) => [{
        id: `token-${Date.now()}-${id}`,
        amount: completedOnDate ? -5 : 5,
        label: completedOnDate ? `Undid ${habit.label}` : `Completed ${habit.label}`,
        date: new Date().toISOString(),
      }, ...current]);
      return { ...habit, done, completionDates, streak, completionTimeZone, progress: isToday ? (done ? 100 : 0) : habit.progress, total: isToday ? `${done ? goal : 0}/${goal}` : habit.total };
    }));
    void saveRemoteHabitCompletion({ habitId: id, date: dateKey, completed: !completedOnDate }).then((result) => {
      if (typeof result?.points === 'number') setPoints(result.points);
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
    if (savedState && result?.updatedAt && result.state) syncBaseRef.current = { updatedAt: result.updatedAt, state: result.state };
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
