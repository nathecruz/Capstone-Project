// The help articles, shared by Help & Support (search, popular questions, the assistant's offline
// answer) and the FAQ screen.
export type FaqItem = { question: string; answer: string };
export type FaqSection = { title: string; icon: string; color: string; items: FaqItem[] };
export type FaqMatch = FaqItem & { section: string; icon: string; color: string };

export const faqSections: FaqSection[] = [
  {
    title: 'Getting Started',
    icon: 'rocket-outline',
    color: '#5B42D8',
    items: [
      { question: 'How do I create my first habit?', answer: 'Open the Add tab, enter a name, pick a category and how often (daily, weekly, monthly or custom days), set a target, then save your habit.' },
      { question: 'Can I customize reminder times?', answer: 'Yes. When you add a habit, turn on Reminders and choose up to two times. How long and how often a reminder snoozes is set in Snooze Settings.' },
      { question: 'What happens when I miss a day?', answer: 'Your check-in history is kept, but the streak goes back to zero after a scheduled day is missed. Days a habit is not scheduled (for example Tuesday for a Mon/Wed/Fri habit) never break it.' },
    ],
  },
  {
    title: 'Habits & Tracking',
    icon: 'checkbox-outline',
    color: '#2F9E6E',
    items: [
      { question: 'How do I mark a habit as complete?', answer: 'Tap the check control on the Habits tab. Tap it again to undo today\'s completion.' },
      { question: 'Can I edit an existing habit?', answer: 'Open the habit from the Habits tab to update its reminder and target.' },
      { question: 'How do streaks work?', answer: 'A streak counts the scheduled days in a row you completed the habit. Today counts once you check in, and an unfinished today does not break it yet.' },
    ],
  },
  {
    title: 'Account & Profile',
    icon: 'person-outline',
    color: '#2F7BD8',
    items: [
      { question: 'How do I update my profile information?', answer: 'Open Profile, choose Personal Information, then tap Edit Profile.' },
      { question: 'Can I change my email address?', answer: 'Yes. Edit Personal Information and save the new address. We email a 6-digit code to confirm it.' },
      { question: 'How do I manage notifications?', answer: 'Open Notifications from your Profile settings and adjust your reminders.' },
    ],
  },
  {
    title: 'Goals & Rewards',
    icon: 'trophy-outline',
    color: '#D9822B',
    items: [
      { question: 'How do I earn points and badges?', answer: 'Every check-in gives 20 points and 5 tokens; undoing it takes them back. Achievements unlock as you build habits and streaks. Spend tokens on rewards in Leaderboards.' },
      { question: 'Can I set multiple goals?', answer: 'Yes. Use Set New Goal as often as needed.' },
      { question: 'How are levels calculated?', answer: 'Every 100 points is one level.' },
    ],
  },
  {
    title: 'Privacy & Data',
    icon: 'shield-checkmark-outline',
    color: '#C2416B',
    items: [
      { question: 'Are my habits stored securely?', answer: 'Yes. Your data is saved to your HabitAI account over encrypted connections and synced to your devices. Read the Privacy Notice in Settings & Preferences for details.' },
      { question: 'Can I export my data?', answer: 'Yes. In Settings & Preferences tap Download my data to get a copy of everything HabitAI stores about you.' },
      { question: 'How do I delete my account data?', answer: 'In Settings & Preferences tap Delete Account. This permanently removes your account and all of its data and cannot be undone.' },
    ],
  },
];

export const faqCount = faqSections.reduce((total, section) => total + section.items.length, 0);

/** Shown first on Help & Support. */
export const popularQuestions = ['How do streaks work?', 'What happens when I miss a day?', 'How do I earn points and badges?', 'Can I customize reminder times?'];

/** Suggested questions for the help assistant. */
export const supportQuestions = ['How do I add a new habit?', "Why isn't my streak updating?", 'How do I earn more points?', 'How do I turn on reminders?'];

const allItems: FaqMatch[] = faqSections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title, icon: section.icon, color: section.color })));

export function findFaq(question: string) {
  return allItems.find((item) => item.question === question);
}

/** Every question whose topic, question or answer contains the search text. */
export function searchFaq(query: string): FaqMatch[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  return allItems.filter((item) => `${item.section} ${item.question} ${item.answer}`.toLowerCase().includes(wanted));
}

const STOP_WORDS = new Set(['the', 'and', 'can', 'how', 'why', 'what', 'when', 'does', 'for', 'are', 'you', 'your', 'with', 'isn', 'not', 'get', 'more', 'this', 'that', 'there']);
const words = (text: string) => new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length > 2 && !STOP_WORDS.has(word)).map((word) => word.replace(/s$/, '')));

/**
 * The FAQ entry that best fits a free-text question, for when the AI cannot answer: words shared
 * with the question count twice, words shared with the answer once. Null when nothing fits.
 */
export function closestFaq(question: string): FaqMatch | null {
  const asked = words(question);
  let best: FaqMatch | null = null;
  let bestScore = 0;
  for (const item of allItems) {
    let score = 0;
    for (const word of words(item.question)) if (asked.has(word)) score += 2;
    for (const word of words(item.answer)) if (asked.has(word)) score += 1;
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return bestScore >= 2 ? best : null;
}
