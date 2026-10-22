// Shapes of the synced app state and the defaults a new account starts with.
import { Ionicons } from '@expo/vector-icons';
import { getLocales } from 'expo-localization';
import type { SupportedLanguage } from '@/constants/i18n';

export type PersistedAppState = {
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
  habitSuggestions?: string[];
  /** The habits the AI planned for this week, from the student's history (added with one tap). */
  habitPlan?: PlannedHabit[];
  weeklyRoadmap?: string[];
  nextMilestone: string;
  successMetric?: string;
  motivation?: string;
  risk: string;
  riskAction: string;
  timeline: string;
  focusTarget: string;
  nextCheckIn: string;
  completedSteps: boolean[];
  progress: number;
  status: string;
};

/** A habit the AI goal planner recommends, ready to add (utils/planned-habits.ts). */
export type PlannedHabit = {
  name: string;
  category: string;
  frequency: 'Daily' | 'Weekly' | 'Custom';
  /** The days for a Weekly or Custom habit (Mon..Sun); empty for Daily. */
  days: string[];
  /** The reminder time, e.g. "07:30 AM". */
  time: string;
  /** Why the AI picked it, from the student's history. */
  reason: string;
};

export type Habit = {
  id: string;
  startDate: string;
  /**
   * The last day the habit is active (YYYY-MM-DD): the Sunday of the week it starts in
   * (utils/habit-week.ts). After it, the habit leaves Home and the habit lists but keeps its history.
   * Missing on habits from older app versions until the server sets it.
   */
  activeUntil?: string;
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
  isBadHabit?: boolean;
  badHabitReason?: string;
};

export type Profile = {
  /** "First Last", kept in step with firstName and lastName. */
  fullName: string;
  firstName: string;
  lastName: string;
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
  /** false hides the student from other students' leaderboards. */
  showOnLeaderboard?: boolean;
  /** With the Buddy Showcase reward: false hides Habi from the leaderboard (shown when unset). */
  showBuddy?: boolean;
  /** false stops classmates from sending this student treats (allowed when unset). */
  allowGifts?: boolean;
  /** App colour theme from the Premium Themes reward (classic, ocean, sunset, forest, midnight). */
  appTheme?: string;
  /** Notification types the student turned off on the Notifications screen. */
  hiddenNotificationTypes?: string[];
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
  showOnLeaderboard: true,
  hideProgress: false,
  showCompletedHabits: true,
  weekStartsOn: 'Monday',
  ...deviceLocalePreferences,
};

export const initialProfile: Profile = {
  fullName: '',
  firstName: '',
  lastName: '',
  email: '',
  username: '',
  dateOfBirth: '',
  gender: '',
  about: '',
};
