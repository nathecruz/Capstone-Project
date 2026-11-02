// The help articles, shared by Help & Support (search, popular questions, the assistant's offline
// answer) and the FAQ screen.
export type FaqItem = { question: string; answer: string };
export type FaqSection = { title: string; icon: string; color: string; items: FaqItem[] };
export type FaqMatch = FaqItem & { section: string; icon: string; color: string };

/** The topic of what HabitAI can and cannot do (the capstone panel asked for the system's limits). */
export const LIMITS_TOPIC = 'Limitations';

export const faqSections: FaqSection[] = [
  {
    title: 'Getting Started',
    icon: 'rocket-outline',
    color: '#5B42D8',
    items: [
      { question: 'How do I create my first habit?', answer: 'Open the Add tab and tap a ready-made habit to add it in one tap. Or enter a name, pick Health or Academics and how often (daily, weekly, monthly or custom days), choose how its check-in is proven, then save it.' },
      { question: 'Can I customize reminder times?', answer: 'Yes. When you add a habit, turn on Reminders and choose up to two times. How long and how often a reminder snoozes is set in Snooze Settings.' },
      { question: 'What happens when I miss a day?', answer: 'Your check-in history is kept, but the streak goes back to zero after a scheduled day is missed. Days a habit is not scheduled (for example Tuesday for a Mon/Wed/Fri habit) never break it.' },
    ],
  },
  {
    title: 'Habits & Tracking',
    icon: 'checkbox-outline',
    color: '#2F9E6E',
    items: [
      { question: 'How do I mark a habit as complete?', answer: 'Tap the check control on the Habits tab. A habit is checked in with its proof: a study habit opens its Focus timer, a walking habit its walk, and the others the camera for a photo.' },
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
      { question: 'How do I earn points and badges?', answer: 'Every check-in gives 20 points and 5 tokens (points and tokens count up to 6 check-ins a day); undoing it takes them back. Achievements unlock as you build habits and streaks.' },
      // Prices stay on the Tokens screen, which has them from the server.
      { question: 'How do I earn tokens?', answer: "Check-ins, the daily reward, daily challenges, the mystery box, weekly quests, the Monday consistency bonus and streak milestones. Tap Tokens on Home to see each one with today's progress." },
      { question: 'What can I spend tokens on?', answer: "Token Rewards (themes, frames, a custom title, Buddy Showcase), Habi's shop and weekly drop, treats for classmates, Streak Freezes and AI Coach answers. Faculty spend theirs on the same things except the Buddy Showcase and treats, which show on the student leaderboard. Prices are on the Tokens screen." },
      { question: 'Can I set multiple goals?', answer: 'Yes. Use Set New Goal as often as needed.' },
      { question: 'How are levels calculated?', answer: 'Every 100 points is one level.' },
    ],
  },
  {
    title: LIMITS_TOPIC,
    icon: 'information-circle-outline',
    color: '#6B5BD2',
    items: [
      { question: 'How does HabitAI know I really did a habit?', answer: 'Each new habit is checked in with proof: a study habit by finishing its Focus timer, a walking habit by walking its steps with HabitAI open, and the rest with a photo taken at the check-in. The server times the timer and the walk, so neither can be cut short. Proof makes a fake check-in harder, not impossible: a timer can run while you do something else, a phone can be shaken, and a photo can be staged.' },
      { question: 'Why are there only Health and Academics habits?', answer: 'HabitAI is made for PSAU students and faculty, so it focuses on the two areas that matter most at school: your health and your academics. The Habits tab shows how your habits split between them and suggests one when an area is missing.' },
      { question: 'Can I check in a day I missed?', answer: "No. Only today can be checked in, until the habit's last reminder time. A day that ends without a check-in stays missed; a Streak Freeze can keep your streak going, but it does not check the habit in." },
      { question: 'Do my habits carry over to next week?', answer: 'No. A habit lasts one week, from its start day to Sunday. Its check-ins stay in your stats, history and streak. Each week you start fresh ones, or plan them with the AI on the Goals tab.' },
      { question: 'Does HabitAI work offline?', answer: 'No. Check-ins, proofs, tokens and the AI are all checked on the server, so HabitAI needs an internet connection. Reminders in the Android app are the exception: they are set on the phone, so they still come without internet.' },
      { question: 'Will I get reminders while HabitAI is closed?', answer: "Yes. The Android app sets the next two weeks of reminders on the phone, so they come while HabitAI is closed, even without internet, and with internet it keeps them up to date about every hour (for example a habit you added on the web). On the web, reminders come from HabitAI's server while you have internet. Some phones' battery savers can still stop them: turn off battery optimization for HabitAI (or, on the web, for Chrome). To check a phone, open Settings & Preferences > Check reminders and send a test reminder, then close HabitAI." },
      { question: 'Why does a walk count only while HabitAI is open?', answer: 'Your phone counts steps for HabitAI only while the Walk screen is open, so the screen stays on during the walk. The web app and phones without a step counter cannot count steps: there you take the walk, then check in with a photo.' },
      { question: 'Which features need the Android app?', answer: 'The step counter and the home-screen widget are in the Android app, and its reminders are set on the phone itself, so they come even without internet. On the web and on iPhone (added to the Home Screen), reminders come as web notifications from the server, and walks are checked in with a photo.' },
      { question: 'How accurate are the AI and the predictions?', answer: 'The AI Coach, the planner, the follow-up questions and the tips are written by an AI model and can be wrong, so use your own judgment, especially about your health. Predictions are estimates: until a model trained on real HabitAI data is approved, they come from simple rules based on your check-ins.' },
      { question: 'How long are proof photos kept, and who sees them?', answer: 'Proof photos are deleted after 14 days; the record that the check-in was proven stays. Only HabitAI administrators can open a photo, and every time one does it is logged. Faculty never see your photos.' },
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
export const popularQuestions = ['How do streaks work?', 'What happens when I miss a day?', 'How do I earn points and badges?', 'How do I earn tokens?', 'Can I customize reminder times?'];

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
