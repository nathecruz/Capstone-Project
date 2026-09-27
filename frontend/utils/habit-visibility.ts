export type HabitVisibilityCandidate = {
  completionDates: string[];
  startDate?: string;
  reminderEnabled?: boolean;
  reminderTime?: string;
};

export function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function parseReminderTime(reminderTime?: string) {
  if (!reminderTime) return null;
  const match = /^\s*(\d{1,2}):(\d{2})(?:\s*(AM|PM))?\s*$/i.exec(reminderTime.trim());
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

export function isHabitMissedToday(habit: HabitVisibilityCandidate, now = new Date()) {
  const today = getLocalDateKey(now);
  if (habit.completionDates.includes(today) || (habit.startDate && habit.startDate > today) || !habit.reminderEnabled) return false;
  const time = parseReminderTime(habit.reminderTime);
  return Boolean(time && (now.getHours() > time.hour || (now.getHours() === time.hour && now.getMinutes() >= time.minute)));
}

export function getVisibleHabitsForDate<T extends HabitVisibilityCandidate>(habits: T[], selectedDate: Date | string, now = new Date()): T[] {
  const selectedDateKey = typeof selectedDate === 'string' ? selectedDate : getLocalDateKey(selectedDate);
  const todayKey = getLocalDateKey(now);

  return habits.filter((habit) => {
    if (habit.completionDates.includes(selectedDateKey)) return true;
    if (selectedDateKey !== todayKey) return true;
    return !isHabitMissedToday(habit, now);
  });
}
