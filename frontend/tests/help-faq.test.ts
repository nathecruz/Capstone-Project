import { closestFaq, faqCount, faqSections, findFaq, popularQuestions, searchFaq, supportQuestions } from '@/constants/help-faq';

describe('help FAQ', () => {
  it('counts every answer and finds the popular questions', () => {
    expect(faqCount).toBe(faqSections.reduce((total, section) => total + section.items.length, 0));
    for (const question of popularQuestions) expect(findFaq(question)?.question).toBe(question);
  });

  it('searches topics, questions and answers, ignoring case', () => {
    expect(searchFaq('   ')).toEqual([]);
    expect(searchFaq('STREAK').map((item) => item.question)).toEqual(['What happens when I miss a day?', 'How do streaks work?', 'How do I earn points and badges?']);
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

  it('has an answer ready for every suggested question', () => {
    for (const question of supportQuestions) expect(closestFaq(question)).not.toBeNull();
  });
});
