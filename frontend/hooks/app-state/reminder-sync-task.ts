/** Registers the background reminder sync. Android only (reminder-sync-task.android.ts). */
export function registerReminderSyncTask(): void {
  // The web gets its reminders by Web Push from the server. iOS runs background tasks only at
  // times of its own choosing, so an iPhone build keeps the reminders the app schedules when opened.
}
