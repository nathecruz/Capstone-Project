// The Android background task that runs the reminder sync about every hour while HabitAI is not
// open (hooks/app-state/reminder-sync-task.android.ts).
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { syncRemindersInBackground } from '@/hooks/app-state/reminder-sync';

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-background-task', () => ({
  getStatusAsync: jest.fn(async () => 2),
  registerTaskAsync: jest.fn(async () => undefined),
  BackgroundTaskStatus: { Restricted: 1, Available: 2 },
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
jest.mock('@/hooks/app-state/reminder-sync', () => ({ syncRemindersInBackground: jest.fn(async () => 'scheduled') }));

// The Android file itself (jest runs as iOS, which resolves the no-op one).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { registerReminderSyncTask, REMINDER_SYNC_TASK } = require('@/hooks/app-state/reminder-sync-task.android') as typeof import('@/hooks/app-state/reminder-sync-task.android');

type Executor = () => Promise<number | undefined>;
// Captured now: the mocks' calls are cleared before each test.
const [definedName, executor] = (TaskManager.defineTask as jest.Mock).mock.calls[0] as [string, Executor];
const settle = () => new Promise<void>((resolve) => setImmediate(() => resolve()));

describe('the Android background reminder sync task', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs the sync, and tells the system whether it worked', async () => {
    expect(definedName).toBe(REMINDER_SYNC_TASK);
    expect(await executor()).toBe(BackgroundTask.BackgroundTaskResult.Success);
    expect(syncRemindersInBackground).toHaveBeenCalledTimes(1);
    jest.mocked(syncRemindersInBackground).mockRejectedValueOnce(new Error('offline'));
    expect(await executor()).toBe(BackgroundTask.BackgroundTaskResult.Failed);
  });

  it('registers about every hour where background tasks are available', async () => {
    registerReminderSyncTask();
    await settle();
    expect(BackgroundTask.registerTaskAsync).toHaveBeenCalledWith(REMINDER_SYNC_TASK, { minimumInterval: 60 });
    jest.mocked(BackgroundTask.getStatusAsync).mockResolvedValueOnce(BackgroundTask.BackgroundTaskStatus.Restricted);
    jest.mocked(BackgroundTask.registerTaskAsync).mockClear();
    registerReminderSyncTask();
    await settle();
    expect(BackgroundTask.registerTaskAsync).not.toHaveBeenCalled();
  });
});
