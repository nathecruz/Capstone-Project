export type BadHabitDetection = {
  isBadHabit: boolean;
  reason: string;
};

// Common bad habits offered as quick-pick presets in the habit library.
export const BAD_HABIT_PRESETS: string[] = [
  'Smoking',
  'Vaping',
  'Procrastinating',
  'Nail Biting',
  'Late-Night Scrolling',
  'Skipping Meals',
  'Oversleeping',
  'Junk Food Binge',
  'Excessive Gaming',
  'Negative Self-Talk',
];

// Phrases that reframe a vice as improvement ("No Sugar", "Quit Smoking").
// When any appears, the habit is a healthy intention, not a bad habit.
const IMPROVEMENT_MARKERS = [
  'no ',
  'avoid',
  'quit',
  'stop',
  'less ',
  'reduce',
  'cut down',
  'cut back',
  'limit',
  'break the',
  'free from',
];

// Keywords that signal an unhealthy or counter-productive routine.
const BAD_HABIT_KEYWORDS = [
  'smoke',
  'smoking',
  'cigarette',
  'vape',
  'vaping',
  'alcohol',
  'drink beer',
  'binge drink',
  'gambl',
  'procrastinat',
  'skip',
  'oversleep',
  'sleep late',
  'late night',
  'all night',
  'stay up',
  'doomscroll',
  'scroll',
  'junk food',
  'fast food',
  'nail biting',
  'bite nails',
  'excessive gaming',
  'negative',
];

export function detectBadHabit(input: string): BadHabitDetection {
  const text = (input ?? '').trim().toLowerCase();
  if (!text) {
    return { isBadHabit: false, reason: '' };
  }

  // A habit framed as cutting something out is a positive goal, not a vice.
  if (IMPROVEMENT_MARKERS.some((marker) => text.includes(marker))) {
    return { isBadHabit: false, reason: '' };
  }

  const matched = BAD_HABIT_KEYWORDS.find((keyword) => text.includes(keyword));
  if (matched) {
    return {
      isBadHabit: true,
      reason: 'This looks like a bad habit. We will track it so you can work on replacing it with a healthier routine.',
    };
  }

  return { isBadHabit: false, reason: '' };
}
