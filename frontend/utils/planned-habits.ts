// The habits the AI goal planner recommends for this week (POST /api/goals/generate, `plan.habits`)
// as habits the app can add: the same fields the Add habit screen (app/(tabs)/add.tsx) gives
// `addHabit`, which stamps the end of the week (`activeUntil`).
import type { Ionicons } from '@expo/vector-icons';
import type { HabitCategory } from '@/authentication';
import type { Habit, PlannedHabit } from '@/hooks/app-state/types';
import { habitIcon } from '@/utils/habit-icons';
import { formatReminderTime, parseReminderTime } from '@/utils/reminder-time';

/** What `addHabit` takes (the context fills in the id, progress and check-ins). */
export type NewHabit = Omit<Habit, 'id' | 'goal' | 'progress' | 'total' | 'streak' | 'done' | 'completionDates'> & { goal: number };

const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const FREQUENCIES: PlannedHabit['frequency'][] = ['Daily', 'Weekly', 'Custom'];
const MAX_PLANNED_HABITS = 5;
const DEFAULT_TIME = '07:00 AM';
/** The Add habit screen's colour for a habit without a known category. */
const FALLBACK_COLOR = '#57B991';

const nameKey = (name: string) => name.replace(/\s+/g, ' ').trim().toLowerCase();

/** "7:30 pm" or "19:30" as "07:30 PM", or null. */
function plannedTime(value: unknown) {
  const parsed = typeof value === 'string' ? parseReminderTime(value) : null;
  return parsed ? formatReminderTime(parsed.hour % 12 || 12, parsed.minute, parsed.hour < 12 ? 'AM' : 'PM') : null;
}

/**
 * The planned habits in a plan from the server, or undefined when there are none (older servers
 * only send `habitSuggestions`). The server already cleans them; this keeps a malformed item from
 * breaking the screen: no name, a repeated name, unknown days, a Weekly or Custom habit without
 * days (Daily then).
 */
export function readPlannedHabits(value: unknown): PlannedHabit[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const habits: PlannedHabit[] = [];
  const names = new Set<string>();
  for (const item of value) {
    if (habits.length >= MAX_PLANNED_HABITS) break;
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
    if (!name || names.has(nameKey(name))) continue;
    names.add(nameKey(name));
    const listed = new Set(Array.isArray(raw.days) ? raw.days : []);
    const days = WEEK_DAYS.filter((day) => listed.has(day));
    const frequency = FREQUENCIES.find((option) => option === raw.frequency) ?? 'Daily';
    const repeats = frequency !== 'Daily' && days.length > 0;
    habits.push({
      name,
      category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : 'Other',
      frequency: repeats ? frequency : 'Daily',
      days: repeats ? days : [],
      time: plannedTime(raw.time) ?? DEFAULT_TIME,
      reason: typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 140) : '',
    });
  }
  return habits.length ? habits : undefined;
}

/** When the habit repeats, for its card: "Every day" or "Mon, Wed, Fri". */
export function plannedDaysText(planned: PlannedHabit) {
  return planned.frequency === 'Daily' || !planned.days.length || planned.days.length === 7 ? 'Every day' : planned.days.join(', ');
}

/**
 * The category, icon and colour of a planned habit, from the managed categories (any case).
 * Categories come from the Admin Panel, so one may be missing from the app's list: its label is
 * kept, with an icon from the habit's name.
 */
export function plannedHabitLook(planned: PlannedHabit, categories: HabitCategory[]) {
  const label = planned.category.trim() || 'Other';
  const category = categories.find((item) => item.label.toLowerCase() === label.toLowerCase());
  return {
    category: category?.label ?? label,
    icon: (category?.icon || habitIcon(planned.name)) as keyof typeof Ionicons.glyphMap,
    color: category?.color || FALLBACK_COLOR,
  };
}

/**
 * The `addHabit` input for a planned habit, built like the Add habit screen builds it: the meta
 * ("Daily • 07:30 AM", "Weekly • 07:30 AM" or "Selected days • 07:30 AM • Mon, Wed"), the
 * category's icon and colour, a reminder at the planned time with sound, and today as start date.
 */
export function habitFromPlan(planned: PlannedHabit, categories: HabitCategory[], today: string): NewHabit {
  const { category, icon, color } = plannedHabitLook(planned, categories);
  const repeats = planned.frequency !== 'Daily' && planned.days.length > 0;
  const frequency = repeats ? planned.frequency : 'Daily';
  const time = plannedTime(planned.time) ?? DEFAULT_TIME;
  const days = WEEK_DAYS.filter((day) => planned.days.includes(day));
  return {
    startDate: today,
    label: planned.name.trim(),
    meta: `${frequency === 'Custom' ? 'Selected days' : frequency} • ${time}${frequency === 'Custom' ? ` • ${days.join(', ')}` : ''}`,
    category,
    frequency,
    icon,
    color,
    goal: 1,
    reminderEnabled: true,
    reminderTime: time,
    reminderTimes: [time],
    reminderDays: repeats ? days : [],
    reminderSoundEnabled: true,
    smartReminderEnabled: false,
    isBadHabit: false,
  };
}

/**
 * The planned habits not yet among this week's habits (same name, any case), each name once. The
 * server leaves out the habits it knows, but not ones made on this device and not synced yet.
 * The result holds the plan's own objects, so a screen can tell which ones are already in Habits.
 */
export function newPlannedHabits(plan: PlannedHabit[], currentHabits: Pick<Habit, 'label'>[]) {
  const taken = new Set(currentHabits.map((habit) => nameKey(habit.label)));
  return plan.filter((planned) => {
    const key = nameKey(planned.name);
    if (!key || taken.has(key)) return false;
    taken.add(key);
    return true;
  });
}
