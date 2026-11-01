// Faculty mode: faculty accounts use the app for their own habits. These are the parts of the
// app that differ for them.

/** The HabitAI Admin Panel, where faculty see their class in Class Pulse. */
export const ADMIN_PANEL_URL = (process.env.EXPO_PUBLIC_ADMIN_URL?.trim() || 'https://habitai-admin.onrender.com').replace(/\/+$/, '');
