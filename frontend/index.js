// App entry: load Expo Router, then register the Android home-screen widget task handler and the
// background task for a reminder's Snooze button. Both are no-ops on web and iOS (platform-resolved),
// so this is safe everywhere.
import 'expo-router/entry';
import { registerSnoozeTask } from './hooks/app-state/snooze-task';
import { registerWidget } from './widgets/register-widget';

registerWidget();
registerSnoozeTask();
