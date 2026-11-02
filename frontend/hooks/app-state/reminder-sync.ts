// The Android app's background reminder sync, run about every hour while HabitAI is not open and
// only with internet (reminder-sync-task.android.ts). Reminders are scheduled on the phone, so they
// come while HabitAI is closed; this keeps them current when the habits change elsewhere (a habit
// added on the web, a check-in on another device) and sets their alarms again in case the phone
// cleared them. It asks whether the state changed with a sync token, which the server answers
// without its database (backend/services/state-versions.js), and fetches the state only then.
// Changes made on this phone that have not reached the server yet are left for the app to send.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRemoteAppState, getRemoteStateVersion, getStateSyncToken } from '@/authentication/authService';
import { getCurrentSession } from '@/authentication/session';
import { normalizeHabitFields } from '@/utils/habit-data';
import { currentHabits as habitsOfThisWeek } from '@/utils/habit-week';
import { applyRemoteCompletionDates, getLocalDateKey } from './habit-progress';
import { getNotificationsModule } from './reminders';
import { loadSavedPredictions, runReminderScheduling, scheduleNativeReminders } from './schedule-native-reminders';
import { APP_STATE_KEY_PREFIX, loadSyncMeta, loadSyncToken, persistSyncBase, saveSyncToken } from './sync-storage';
import type { Habit, PersistedAppState } from './types';

/** A sync token is asked for again this long before it expires. */
const RENEW_BEFORE_MS = 7 * 24 * 60 * 60 * 1000;

/** While HabitAI is open: keeps a sync token for the account, so the background sync can ask. */
export async function keepSyncToken(email: string, now = Date.now()) {
  const stored = await loadSyncToken(email);
  if (stored && stored.expiresAt - now > RENEW_BEFORE_MS) return;
  const fresh = await getStateSyncToken();
  if (fresh) await saveSyncToken(email, { ...fresh, seenVersion: stored?.seenVersion ?? null });
}

/**
 * The account's state from the server when it is newer than this phone's, saved on the phone as the
 * app saves it when it opens (hooks/color-scheme-context.tsx); null otherwise.
 */
async function newerServerState(email: string, saved: Partial<PersistedAppState>): Promise<Partial<PersistedAppState> | null> {
  const meta = await loadSyncMeta(email);
  if (meta.unsaved) return null;
  const stored = await loadSyncToken(email);
  if (!stored) return null;
  const version = await getRemoteStateVersion(stored.token);
  if (!version) return null;
  if (!version.ok) {
    // The server no longer takes it: the app asks for another one when it opens.
    if (version.invalid) await saveSyncToken(email, null);
    return null;
  }
  const known = meta.base?.updatedAt ?? 0;
  if (!version.updatedAt || version.updatedAt <= known || version.updatedAt === stored.seenVersion) return null;
  // Each time is fetched once, also when the state turns out to be no newer than this phone's.
  await saveSyncToken(email, { ...stored, seenVersion: version.updatedAt });
  const remote = await getRemoteAppState(null, { background: true });
  if (!remote?.state || !remote.updatedAt || remote.updatedAt <= known) return null;
  const datesByHabit = new Map<string, string[]>();
  for (const { habitId, date } of remote.completions ?? []) datesByHabit.set(habitId, [...(datesByHabit.get(habitId) ?? []), date]);
  const state = remote.state as Partial<PersistedAppState>;
  const next: Partial<PersistedAppState> = {
    ...state,
    goals: Array.isArray(state.goals) ? state.goals : saved.goals,
    habits: (Array.isArray(state.habits) ? state.habits : []).map((habit) => normalizeHabitFields({
      ...applyRemoteCompletionDates(habit, datesByHabit.get(habit.id) ?? []),
      startDate: habit.startDate || getLocalDateKey(),
    }) as Habit),
  };
  await AsyncStorage.setItem(`${APP_STATE_KEY_PREFIX}${email}`, JSON.stringify(next));
  persistSyncBase(email, { updatedAt: remote.updatedAt, state: remote.state });
  return next;
}

/**
 * One run: schedules the reminders of this week's habits, the server's when they are newer than
 * this phone's. 'skipped' when signed out, or the account was never opened on this phone.
 */
export async function syncRemindersInBackground(now = new Date()): Promise<'scheduled' | 'skipped'> {
  const email = (await getCurrentSession())?.email.trim().toLowerCase();
  if (!email) return 'skipped';
  let saved: Partial<PersistedAppState> | null = null;
  try {
    saved = JSON.parse((await AsyncStorage.getItem(`${APP_STATE_KEY_PREFIX}${email}`)) ?? 'null') as Partial<PersistedAppState> | null;
  } catch {
    saved = null;
  }
  if (!saved) return 'skipped';
  const Notifications = await getNotificationsModule();
  if (!Notifications) return 'skipped';
  const state = (await newerServerState(email, saved).catch(() => null)) ?? saved;
  const habits = habitsOfThisWeek(Array.isArray(state.habits) ? state.habits : [], getLocalDateKey(now));
  const predictions = await loadSavedPredictions();
  await runReminderScheduling(() => scheduleNativeReminders(Notifications, {
    habits,
    notificationsEnabled: state.preferences?.notificationsEnabled !== false,
    ringInterval: typeof state.ringInterval === 'number' ? state.ringInterval : 30,
    rearm: true,
    predictions,
    askPermission: false,
  }));
  return 'scheduled';
}
