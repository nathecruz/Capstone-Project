// Mirrors the categories that were hard-coded in the HabitAI app (frontend/app/(tabs)/add.tsx)
// so existing habits keep matching a managed category after the migration.
export const defaultCategories = [
  { id: 'health', label: 'Health', icon: 'heart-outline', color: '#E58D8D', description: 'Physical health, fitness, sleep and nutrition.' },
  { id: 'mind', label: 'Mind', icon: 'bulb-outline', color: '#7A6AED', description: 'Mindfulness, mental wellness and focus.' },
  { id: 'productivity', label: 'Productivity', icon: 'locate-outline', color: '#4BA3FF', description: 'Planning, time management and deep work.' },
  { id: 'lifestyle', label: 'Lifestyle', icon: 'leaf-outline', color: '#57B991', description: 'Daily routines, finances and personal care.' },
  { id: 'academics', label: 'Academics', icon: 'school-outline', color: '#57B991', description: 'Studying, reading and coursework habits.' },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal', color: '#57B991', description: 'Anything that does not fit another category.' },
];

export const defaultTemplates = [
  {
    id: 'habit-reminder',
    name: 'Habit reminder (automatic)',
    type: 'reminder',
    title: '{{habit}} reminder',
    body: 'A small step today keeps your streak moving.',
    description: 'Sent automatically by the reminder dispatcher when a habit reminder is due. Supports {{habit}}.',
    isSystem: true,
  },
  {
    id: 'welcome',
    name: 'Welcome message',
    type: 'system',
    title: 'Welcome to HabitAI, {{first_name}}!',
    body: 'Start small: create your first habit today and HabitAI will help you stay consistent.',
    description: 'Greets new students and nudges them to create a first habit.',
    isSystem: false,
  },
  {
    id: 'weekly-check-in',
    name: 'Weekly check-in',
    type: 'reminder',
    title: "How's your week going, {{first_name}}?",
    body: "You're tracking {{habit_count}} habit(s). Take a minute to log today's progress.",
    description: 'A gentle weekly nudge for active students.',
    isSystem: false,
  },
  {
    id: 'streak-encouragement',
    name: 'Streak encouragement',
    type: 'reminder',
    title: 'Keep your streak alive',
    body: 'Your best streak is {{best_streak}} day(s). One check-in today keeps it growing.',
    description: 'Motivates students to protect their current streak.',
    isSystem: false,
  },
  {
    id: 'we-miss-you',
    name: 'Re-engagement',
    type: 'reminder',
    title: 'We miss you, {{first_name}}',
    body: 'Your habits are waiting. Open HabitAI and pick one small win for today.',
    description: 'For students who have been inactive for a while.',
    isSystem: false,
  },
  {
    id: 'maintenance-notice',
    name: 'Scheduled maintenance',
    type: 'system',
    title: 'Scheduled maintenance',
    body: 'HabitAI will be briefly unavailable for maintenance. Your data is safe and will sync once we are back.',
    description: 'System announcement for planned downtime.',
    isSystem: false,
  },
];

export const defaultSettings = {
  anonymity_threshold: 3,
  inactive_days: 14,
};
