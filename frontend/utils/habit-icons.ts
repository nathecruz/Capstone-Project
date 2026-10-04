import type { Ionicons } from '@expo/vector-icons';

type IconName = keyof typeof Ionicons.glyphMap;

// The first rule whose words appear in the habit's name picks its icon, so "Read a Book" gets a
// book and "Drink Water" a drop. Order matters: more specific words come first.
const RULES: [RegExp, IconName][] = [
  [/water|hydrat|drink/i, 'water-outline'],
  [/sugar|junk/i, 'ban-outline'],
  [/eat|food|nutrition|meal/i, 'nutrition-outline'],
  [/sleep|bed|rest/i, 'moon-outline'],
  [/walk|steps|run/i, 'footsteps-outline'],
  [/exercise|workout|gym|fitness/i, 'barbell-outline'],
  [/stretch|yoga/i, 'body-outline'],
  [/meditat|breath|mindful/i, 'flower-outline'],
  [/read|book|article/i, 'book-outline'],
  [/journal|notes|write|research/i, 'create-outline'],
  [/gratitude|thank/i, 'heart-outline'],
  [/detox|screen|phone/i, 'phone-portrait-outline'],
  [/positive|affirmation/i, 'sunny-outline'],
  [/plan|week ahead|schedule/i, 'calendar-outline'],
  [/homework|assignment|grade|paper/i, 'document-text-outline'],
  [/focus|manage time|stop work/i, 'time-outline'],
  [/track/i, 'checkmark-done-outline'],
  [/prepare|materials|lesson/i, 'briefcase-outline'],
  [/feedback|message|consultation/i, 'chatbubbles-outline'],
  [/money|save|budget/i, 'wallet-outline'],
  [/declutter|clean|tidy/i, 'sparkles-outline'],
  [/help others|kind|volunteer/i, 'people-outline'],
  [/plastic|recycle|eco/i, 'leaf-outline'],
  [/study|revise|class|learn/i, 'school-outline'],
];

/** An icon that matches what the habit is about. */
export function habitIcon(name: string): IconName {
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? 'star-outline';
}
