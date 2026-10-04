import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AiChatSheet, useAiChat, type ChatAnswer } from '@/components/ai-chat';

function Chat({ ask }: { ask: (question: string) => Promise<ChatAnswer> }) {
  const chat = useAiChat(ask);
  return (
    <AiChatSheet
      chat={chat}
      visible
      onClose={() => undefined}
      title="HabitAI Assistant"
      subtitle="Answers from your habits"
      greeting="You have 2 habits left today."
      suggestions={['What should I focus on today?']}
      placeholder="Ask about your habits..."
      footnote="Answers can be wrong."
    />
  );
}

// The first render of a test file can be slow on a busy machine.
jest.setTimeout(20000);

describe('AI chat', () => {
  it('sends a typed question and shows it with the answer', async () => {
    const ask = jest.fn().mockResolvedValue({ ok: true, answer: 'Walk right after dinner.', note: '10 tokens used' });
    const screen = render(<Chat ask={ask} />);
    // The first message comes from the student's data, before anything is asked.
    expect(screen.getByText('You have 2 habits left today.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Ask about your habits...'), '  How do I keep going?  ');
    fireEvent.press(screen.getByLabelText('Send question'));

    await waitFor(() => expect(screen.getByText('Walk right after dinner.')).toBeTruthy(), { timeout: 15000 });
    expect(ask).toHaveBeenCalledWith('How do I keep going?');
    expect(screen.getByText('How do I keep going?')).toBeTruthy();
    expect(screen.getByText('10 tokens used')).toBeTruthy();
    expect(screen.getByLabelText('Ask about your habits...').props.value).toBe('');
  });

  it('asks a suggested question straight away and shows a failure as a note', async () => {
    const ask = jest.fn().mockResolvedValue({ ok: false, message: 'AI features are not available right now. Your tokens were not spent.' });
    const screen = render(<Chat ask={ask} />);

    fireEvent.press(screen.getByLabelText('Ask: What should I focus on today?'));

    await waitFor(() => expect(screen.getByText('AI features are not available right now. Your tokens were not spent.')).toBeTruthy());
    expect(ask).toHaveBeenCalledWith('What should I focus on today?');
  });

  it('does not send an empty question', () => {
    const ask = jest.fn();
    const screen = render(<Chat ask={ask} />);
    fireEvent.changeText(screen.getByLabelText('Ask about your habits...'), '   ');
    fireEvent.press(screen.getByLabelText('Send question'));
    expect(ask).not.toHaveBeenCalled();
  });
});
