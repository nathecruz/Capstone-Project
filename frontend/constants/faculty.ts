// Faculty mode: faculty accounts use the app for their own habits. These are the parts of the
// app that differ for them.

/** The HabitAI Admin Panel, where faculty see their class in Class Pulse. */
export const ADMIN_PANEL_URL = (process.env.EXPO_PUBLIC_ADMIN_URL?.trim() || 'https://habitai-admin.onrender.com').replace(/\/+$/, '');

/** Habit ideas for a teacher's day: teaching, research, students and their own well-being. */
export const FACULTY_HABIT_IDEAS = [
  "Prepare tomorrow's lesson",
  'Check student messages',
  'Grade 10 papers',
  'Hold consultation hours',
  'Write research for 30 minutes',
  'Read a journal article',
  'Plan the week ahead',
  'Walk between classes',
  'Stop work by 7 PM',
  'Drink water during breaks',
];
