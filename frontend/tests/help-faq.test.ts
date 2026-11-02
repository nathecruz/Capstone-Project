import { closestFaq, faqCount, faqSections, findFaq, LIMITS_TOPIC, popularQuestions, searchFaq, supportQuestions } from '@/constants/help-faq';

describe('help FAQ', () => {
  it('counts every answer and finds the popular questions', () => {
    expect(faqCount).toBe(faqSections.reduce((total, section) => total + section.items.length, 0));
    for (const question of popularQuestions) expect(findFaq(question)?.question).toBe(question);
  });

  it('searches topics, questions and answers, ignoring case', () => {
    expect(searchFaq('   ')).toEqual([]);
    expect(searchFaq('STREAK').map((item) => item.question)).toEqual([
      'What happens when I miss a day?', 'How do streaks work?', 'How do I earn points and badges?', 'How do I earn tokens?', 'What can I spend tokens on?',
      'Can I check in a day I missed?', 'Do my habits carry over to next week?',
    ]);
    expect(searchFaq('privacy & data').map((item) => item.section)).toEqual(['Privacy & Data', 'Privacy & Data', 'Privacy & Data']);
    expect(searchFaq('zzzz')).toEqual([]);
  });

  it('picks the closest answer for a free-text question when the AI cannot answer', () => {
    expect(closestFaq("Why isn't my streak updating?")?.question).toBe('How do streaks work?');
    expect(closestFaq('How do I earn more points?')?.question).toBe('How do I earn points and badges?');
    expect(closestFaq('How do I add a new habit?')?.question).toBe('How do I create my first habit?');
    expect(closestFaq('How do I turn on reminders?')?.question).toBe('Can I customize reminder times?');
    expect(closestFaq('What is the weather like?')).toBeNull();
  });

  it('says how tokens are earned and spent, and leaves the prices to the Tokens screen', () => {
    const earn = findFaq('How do I earn tokens?');
    const spend = findFaq('What can I spend tokens on?');
    expect(earn?.section).toBe('Goals & Rewards');
    expect(earn?.answer).toContain('Tap Tokens on Home');
    expect(spend?.answer).toContain('Prices are on the Tokens screen.');
    for (const item of [earn, spend]) expect(item?.answer).not.toMatch(/\d/);
    expect(popularQuestions).toContain('How do I earn tokens?');
    // Points and tokens are paid for the first 6 check-ins of a day, not for every one.
    expect(findFaq('How do I earn points and badges?')?.answer).toContain('count up to 6 check-ins a day');
    expect(closestFaq('Where do I spend tokens?')?.question).toBe('What can I spend tokens on?');
    expect(closestFaq('How do I get more tokens?')?.question).toBe('How do I earn tokens?');
  });

  it('says what HabitAI can and cannot do, in one topic', () => {
    const limits = faqSections.find((section) => section.title === LIMITS_TOPIC);
    expect(limits?.items.map((item) => item.question)).toEqual([
      'How does HabitAI know I really did a habit?',
      'Why are there only Health and Academics habits?',
      'Can I check in a day I missed?',
      'Do my habits carry over to next week?',
      'Does HabitAI work offline?',
      'Why does a walk count only while HabitAI is open?',
      'Which features need the Android app?',
      'How accurate are the AI and the predictions?',
      'How long are proof photos kept, and who sees them?',
    ]);
    // Proof makes a fake check-in harder, and the answer says it is not impossible.
    expect(findFaq('How does HabitAI know I really did a habit?')?.answer).toContain('not impossible');
    expect(closestFaq('Does it work without internet?')?.question).toBe('Does HabitAI work offline?');
    expect(closestFaq('How accurate is the AI?')?.question).toBe('How accurate are the AI and the predictions?');
  });

  it('has an answer ready for every suggested question', () => {
    for (const question of supportQuestions) expect(closestFaq(question)).not.toBeNull();
  });
});
