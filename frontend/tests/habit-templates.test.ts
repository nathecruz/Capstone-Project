// Habits are about Health and Academics, ready-made ones are added with one tap, and every new habit
// carries the proof its check-in needs (the capstone panel's notes).
import { DEFAULT_HABIT_CATEGORIES, focusCategoryFor, focusCategoryList } from '@/constants/habit-categories';
import { FACULTY_HABIT_TEMPLATES, habitTemplatesFor, STUDENT_HABIT_TEMPLATES } from '@/constants/habit-templates';
import { habitBalance, suggestedTemplate } from '@/utils/habit-balance';
import { habitFromTemplate, normalizedProof, proofText, suggestedProof } from '@/utils/habit-templates';

describe('focus categories', () => {
  it('files a habit under Health or Academics, by its own category or its name', () => {
    expect(focusCategoryFor({ label: 'Anything', category: 'academics' })).toBe('Academics');
    expect(focusCategoryFor({ label: 'Review notes', category: 'Productivity' })).toBe('Academics');
    expect(focusCategoryFor({ label: 'Read a book', category: 'Mind' })).toBe('Academics');
    expect(focusCategoryFor({ label: 'Meditate', category: 'Mind' })).toBe('Health');
    expect(focusCategoryFor({ label: 'Bread and butter' })).toBe('Health');
  });

  it('keeps only Health and Academics of the managed list, in its order, else the two defaults', () => {
    const managed = [{ label: 'Mind', icon: 'bulb-outline', color: '#7A6AED' }, { label: 'academics', icon: 'book-outline', color: '#4B82D8' }, { label: 'Health', icon: 'heart-outline', color: '#E58D8D' }];
    expect(focusCategoryList(managed).map((item) => item.label)).toEqual(['Academics', 'Health']);
    expect(focusCategoryList([{ label: 'Mind', icon: 'bulb-outline', color: '#7A6AED' }])).toBe(DEFAULT_HABIT_CATEGORIES);
    expect(focusCategoryList(null)).toBe(DEFAULT_HABIT_CATEGORIES);
  });
});

describe('proof', () => {
  it('suggests steps for walking, the Focus timer for time, and a photo for the rest', () => {
    expect(suggestedProof('Walk 3,000 steps')).toEqual({ type: 'steps', steps: 3000 });
    expect(suggestedProof('Walk 5k steps')).toEqual({ type: 'steps', steps: 5000 });
    expect(suggestedProof('Evening walk')).toEqual({ type: 'steps', steps: 2000 });
    expect(suggestedProof('Read for 15 minutes')).toEqual({ type: 'timer', minutes: 15 });
    expect(suggestedProof('Study 1 hour')).toEqual({ type: 'timer', minutes: 60 });
    expect(suggestedProof('Study')).toEqual({ type: 'timer', minutes: 20 });
    expect(suggestedProof('Drink 8 glasses of water')).toEqual({ type: 'photo' });
  });

  it('keeps minutes and steps within the limits, and says what each needs', () => {
    expect(normalizedProof({ type: 'timer', minutes: 1 })).toEqual({ type: 'timer', minutes: 5 });
    expect(normalizedProof({ type: 'timer', minutes: 600 })).toEqual({ type: 'timer', minutes: 180 });
    expect(normalizedProof({ type: 'steps', steps: 90000 })).toEqual({ type: 'steps', steps: 30000 });
    expect(suggestedProof('Walk 100 steps')).toEqual({ type: 'steps', steps: 500 });
    expect([proofText({ type: 'timer', minutes: 20 }), proofText({ type: 'steps', steps: 2000 }), proofText({ type: 'photo' })]).toEqual(['20-minute Focus timer', '2,000 steps', 'Photo']);
  });
});

describe('templates', () => {
  it('are all Health or Academics with a proof, for students and faculty', () => {
    for (const template of [...STUDENT_HABIT_TEMPLATES, ...FACULTY_HABIT_TEMPLATES]) {
      expect(['Health', 'Academics']).toContain(template.category);
      expect(normalizedProof(template.proof)).toEqual(template.proof);
      expect(template.reminderTime).toMatch(/^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/);
    }
    for (const list of [STUDENT_HABIT_TEMPLATES, FACULTY_HABIT_TEMPLATES]) {
      expect(new Set(list.map((template) => template.category))).toEqual(new Set(['Health', 'Academics']));
    }
    expect(habitTemplatesFor(true)).toBe(FACULTY_HABIT_TEMPLATES);
  });

  it('make a daily habit with its reminder, proof and the managed colour', () => {
    const study = STUDENT_HABIT_TEMPLATES.find((template) => template.id === 'study-30')!;
    expect(habitFromTemplate(study, [{ label: 'Academics', icon: 'school-outline', color: '#4B82D8' }], '2026-11-02')).toEqual({
      startDate: '2026-11-02', label: 'Study for 30 minutes', meta: 'Daily • 07:00 PM', category: 'Academics', frequency: 'Daily',
      icon: 'school-outline', color: '#4B82D8', goal: 1, reminderEnabled: true, reminderTime: '07:00 PM', reminderTimes: ['07:00 PM'],
      reminderDays: [], reminderSoundEnabled: true, smartReminderEnabled: false, isBadHabit: false, proof: { type: 'timer', minutes: 30 },
    });
  });
});

describe('balance', () => {
  const health = { label: 'Walk 2,000 steps', category: 'Health' };
  const academics = { label: 'Study for 30 minutes', category: 'Academics' };

  it('counts this week\'s habits by area and names the one missing', () => {
    expect(habitBalance([health, health])).toEqual({ Health: 2, Academics: 0, missing: 'Academics' });
    expect(habitBalance([academics])).toEqual({ Health: 0, Academics: 1, missing: 'Health' });
    expect(habitBalance([health, academics, { label: 'Review notes', category: 'Productivity' }])).toEqual({ Health: 1, Academics: 2, missing: null });
    expect(habitBalance([])).toEqual({ Health: 0, Academics: 0, missing: null });
  });

  it('suggests a habit of the missing area that the student does not have yet', () => {
    const first = () => 0;
    expect(suggestedTemplate(STUDENT_HABIT_TEMPLATES, [health], first)?.category).toBe('Academics');
    expect(suggestedTemplate(STUDENT_HABIT_TEMPLATES, [academics], first)?.label).toBe('Walk 2,000 steps');
    expect(suggestedTemplate(STUDENT_HABIT_TEMPLATES, [academics, health], first)?.label).toBe('Exercise for 20 minutes');
    expect(suggestedTemplate(STUDENT_HABIT_TEMPLATES.slice(0, 1), [health], first)).toBeNull();
  });
});
