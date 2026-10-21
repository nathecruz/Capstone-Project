import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { AiChatSheet, useAiChat, type ChatAnswer } from '@/components/ai-chat';
import { askCoach } from '@/utils/ai-client';

const mockApiRequest = jest.fn();
jest.mock('@/authentication/authService', () => {
  class ApiRequestError extends Error {
    status: number;
    payload: Record<string, unknown>;
    constructor(message: string, status: number, payload: Record<string, unknown> = {}) {
      super(message);
      this.status = status;
      this.payload = payload;
    }
  }
  return {
    ApiRequestError,
    apiRequest: (...args: unknown[]) => mockApiRequest(...args),
    getAuthenticatedHeaders: async () => ({ Authorization: 'Bearer token' }),
  };
});

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

  it('says the AI Coach returned the tokens when the AI failed after the charge, and takes the server\'s balance', async () => {
    const { ApiRequestError } = jest.requireMock('@/authentication/authService');
    mockApiRequest.mockRejectedValue(new ApiRequestError('The AI service is temporarily unavailable.', 502, { ok: false, refunded: true, tokens: 40 }));
    const applyWallet = jest.fn();
    const screen = render(<Chat ask={(question) => askCoach(question, { tokens: 40, applyWallet })} />);

    fireEvent.press(screen.getByLabelText('Ask: What should I focus on today?'));

    await waitFor(() => expect(screen.getByText('The AI Coach is unavailable right now. Your 10 tokens were returned.')).toBeTruthy());
    expect(applyWallet).toHaveBeenCalledWith({ tokens: 40 });
    expect(mockApiRequest.mock.calls[0][0]).toBe('/api/insights/assistant');
    expect(JSON.parse(mockApiRequest.mock.calls[0][1].body)).toMatchObject({ mode: 'coach', question: 'What should I focus on today?' });
  });

  it('shows the server\'s reason when there are not enough tokens, and the Coach\'s answer with its cost', async () => {
    const { ApiRequestError } = jest.requireMock('@/authentication/authService');
    mockApiRequest.mockRejectedValueOnce(new ApiRequestError('You need 10 tokens to ask the AI Coach. Complete habits to earn more.', 402, { ok: false }));
    const applyWallet = jest.fn();
    const screen = render(<Chat ask={(question) => askCoach(question, { tokens: 10, applyWallet })} />);
    fireEvent.press(screen.getByLabelText('Ask: What should I focus on today?'));
    await waitFor(() => expect(screen.getByText('You need 10 tokens to ask the AI Coach. Complete habits to earn more.')).toBeTruthy());
    expect(applyWallet).not.toHaveBeenCalled();

    mockApiRequest.mockResolvedValueOnce({ answer: 'Walk after dinner today.', tokens: 0, tokenHistory: [] });
    fireEvent.changeText(screen.getByLabelText('Ask about your habits...'), 'And now?');
    fireEvent.press(screen.getByLabelText('Send question'));
    await waitFor(() => expect(screen.getByText('Walk after dinner today.')).toBeTruthy());
    expect(screen.getByText('10 tokens used')).toBeTruthy();
    expect(applyWallet).toHaveBeenCalledWith({ ok: true, answer: 'Walk after dinner today.', tokens: 0, tokenHistory: [] });
  });

  it('does not send an empty question', () => {
    const ask = jest.fn();
    const screen = render(<Chat ask={ask} />);
    fireEvent.changeText(screen.getByLabelText('Ask about your habits...'), '   ');
    fireEvent.press(screen.getByLabelText('Send question'));
    expect(ask).not.toHaveBeenCalled();
  });
});
