// Android: runs the background reminder sync (reminder-sync.ts) about every hour while HabitAI is
// not open. expo-background-task runs it with WorkManager only while the phone has internet, never
// while the app is on screen (the app schedules the reminders itself then), and Android may run it
// later to save battery. Defined when the app's JavaScript loads (index.js), which is also how the
// task runs while HabitAI is closed.
import { syncRemindersInBackground } from './reminder-sync';

export const REMINDER_SYNC_TASK = 'habitai-reminder-sync';
const INTERVAL_MINUTES = 60;

// Loaded here rather than imported: a build made before these were added has no such native
// modules, and importing them would stop the app at launch.
let TaskManager: typeof import('expo-task-manager') | null = null;
let BackgroundTask: typeof import('expo-background-task') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  BackgroundTask = require('expo-background-task') as typeof import('expo-background-task');
} catch {
  TaskManager = null;
  BackgroundTask = null;
}

TaskManager?.defineTask(REMINDER_SYNC_TASK, async () => {
  try {
    await syncRemindersInBackground();
    return BackgroundTask?.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask?.BackgroundTaskResult.Failed;
  }
});

/** Registers the background reminder sync (again on each launch, which keeps it registered). */
export function registerReminderSyncTask(): void {
  const background = BackgroundTask;
  if (!TaskManager || !background) return;
  void background.getStatusAsync()
    .then((status) => (status === background.BackgroundTaskStatus.Available ? background.registerTaskAsync(REMINDER_SYNC_TASK, { minimumInterval: INTERVAL_MINUTES }) : undefined))
    .catch(() => undefined);
}
