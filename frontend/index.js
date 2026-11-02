// App entry: load Expo Router, then register the Android home-screen widget task handler, the
// background task for a reminder's Snooze button and the background reminder sync. All are no-ops
// on web and iOS (platform-resolved), so this is safe everywhere.
import 'expo-router/entry';
import { registerReminderSyncTask } from './hooks/app-state/reminder-sync-task';
import { registerSnoozeTask } from './hooks/app-state/snooze-task';
import { registerWidget } from './widgets/register-widget';

registerWidget();
registerSnoozeTask();
registerReminderSyncTask();
