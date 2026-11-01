// Ready-made habits a student adds with one tap (the panel's "tap-to-tap" input): each has its
// focus area, a reminder time and the proof its check-in needs, so nothing has to be typed.
// Faculty get habits for a teacher's day.
import type { Ionicons } from '@expo/vector-icons';
import type { FocusCategory } from '@/constants/habit-categories';
import type { HabitProof } from '@/hooks/app-state/types';

export type HabitTemplate = {
  id: string;
  label: string;
  category: FocusCategory;
  icon: keyof typeof Ionicons.glyphMap;
  /** The daily reminder, "hh:mm AM". */
  reminderTime: string;
  proof: HabitProof;
};

const timer = (minutes: number): HabitProof => ({ type: 'timer', minutes });
const steps = (count: number): HabitProof => ({ type: 'steps', steps: count });
const photo: HabitProof = { type: 'photo' };

export const STUDENT_HABIT_TEMPLATES: HabitTemplate[] = [
  { id: 'walk-2000', label: 'Walk 2,000 steps', category: 'Health', icon: 'walk-outline', reminderTime: '05:30 PM', proof: steps(2000) },
  { id: 'exercise-20', label: 'Exercise for 20 minutes', category: 'Health', icon: 'barbell-outline', reminderTime: '06:00 AM', proof: timer(20) },
  { id: 'stretch-10', label: 'Stretch for 10 minutes', category: 'Health', icon: 'fitness-outline', reminderTime: '07:00 AM', proof: timer(10) },
  { id: 'water-8', label: 'Drink 8 glasses of water', category: 'Health', icon: 'water-outline', reminderTime: '09:00 AM', proof: photo },
  { id: 'healthy-meal', label: 'Eat a healthy meal', category: 'Health', icon: 'restaurant-outline', reminderTime: '12:00 PM', proof: photo },
  { id: 'meditate-10', label: 'Meditate for 10 minutes', category: 'Health', icon: 'leaf-outline', reminderTime: '09:00 PM', proof: timer(10) },
  { id: 'screen-free-30', label: 'Screen-free 30 minutes before bed', category: 'Health', icon: 'moon-outline', reminderTime: '09:30 PM', proof: timer(30) },
  { id: 'study-30', label: 'Study for 30 minutes', category: 'Academics', icon: 'school-outline', reminderTime: '07:00 PM', proof: timer(30) },
  { id: 'read-20', label: 'Read for 20 minutes', category: 'Academics', icon: 'book-outline', reminderTime: '08:00 PM', proof: timer(20) },
  { id: 'review-notes-15', label: 'Review notes for 15 minutes', category: 'Academics', icon: 'document-text-outline', reminderTime: '06:00 PM', proof: timer(15) },
  { id: 'practice-problems-20', label: 'Practice problems for 20 minutes', category: 'Academics', icon: 'calculator-outline', reminderTime: '04:00 PM', proof: timer(20) },
  { id: 'homework', label: "Finish today's homework", category: 'Academics', icon: 'create-outline', reminderTime: '05:00 PM', proof: photo },
  { id: 'plan-tomorrow', label: "Plan tomorrow's tasks", category: 'Academics', icon: 'calendar-outline', reminderTime: '09:00 PM', proof: photo },
];

export const FACULTY_HABIT_TEMPLATES: HabitTemplate[] = [
  { id: 'faculty-lesson-30', label: "Prepare tomorrow's lesson", category: 'Academics', icon: 'clipboard-outline', reminderTime: '07:00 PM', proof: timer(30) },
  { id: 'faculty-research-30', label: 'Write research for 30 minutes', category: 'Academics', icon: 'create-outline', reminderTime: '08:00 AM', proof: timer(30) },
  { id: 'faculty-article-20', label: 'Read a journal article', category: 'Academics', icon: 'book-outline', reminderTime: '09:00 PM', proof: timer(20) },
  { id: 'faculty-grading-30', label: 'Grade papers for 30 minutes', category: 'Academics', icon: 'checkmark-done-outline', reminderTime: '04:00 PM', proof: timer(30) },
  { id: 'faculty-consultation', label: 'Hold consultation hours', category: 'Academics', icon: 'people-outline', reminderTime: '01:00 PM', proof: timer(60) },
  { id: 'faculty-walk-2000', label: 'Walk 2,000 steps between classes', category: 'Health', icon: 'walk-outline', reminderTime: '12:30 PM', proof: steps(2000) },
  { id: 'faculty-water', label: 'Drink water during breaks', category: 'Health', icon: 'water-outline', reminderTime: '10:00 AM', proof: photo },
  { id: 'faculty-stretch-10', label: 'Stretch for 10 minutes', category: 'Health', icon: 'fitness-outline', reminderTime: '03:00 PM', proof: timer(10) },
];

/** The templates for this account: a teacher's day for faculty, a student's otherwise. */
export const habitTemplatesFor = (isFaculty: boolean) => (isFaculty ? FACULTY_HABIT_TEMPLATES : STUDENT_HABIT_TEMPLATES);
