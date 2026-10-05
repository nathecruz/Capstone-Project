/** The HabitAI app students and faculty use (override with VITE_HABITAI_APP_URL at build time). */
export const APP_URL = ((import.meta.env.VITE_HABITAI_APP_URL as string | undefined)?.trim() || 'https://capstone-project-indol-five.vercel.app').replace(/\/+$/, '');
