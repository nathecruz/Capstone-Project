// Android: a Snooze tapped while HabitAI is closed reaches no app code (the button does not open the
// app), so the snooze was never set. expo-notifications runs this background task for it instead: it
// loads the app's JavaScript without showing it and sets the snooze from the habits saved on the
// device. Defined when the app's JavaScript loads (index.js), which is also how the task runs.
import { getNotificationsModule } from './reminders';
import { loadSnoozeSettings, responseFromTaskPayload, snoozeReminder } from './snooze';

export const SNOOZE_TASK = 'habitai-snooze';

// Loaded here rather than imported: a build made before expo-task-manager was added (an older
// development client) has no such native module, and importing it would stop the app at launch.
let TaskManager: typeof import('expo-task-manager') | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  TaskManager = require('expo-task-manager') as typeof import('expo-task-manager');
} catch {
  TaskManager = null;
}

TaskManager?.defineTask(SNOOZE_TASK, async ({ data }) => {
  const response = responseFromTaskPayload(data);
  if (response?.actionIdentifier !== 'SNOOZE') return;
  const [Notifications, settings] = await Promise.all([getNotificationsModule(), loadSnoozeSettings()]);
  if (!Notifications || !settings) return;
  await snoozeReminder(Notifications, response, settings);
});

/** Registers the background task that handles a Snooze tapped while HabitAI is closed. */
export function registerSnoozeTask(): void {
  if (!TaskManager) return;
  void getNotificationsModule()
    .then((Notifications) => Notifications?.registerTaskAsync(SNOOZE_TASK))
    .catch(() => undefined);
}
