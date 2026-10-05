// The help assistant on Help & Support and the FAQ. The server answers questions about using the
// app (only the question is sent, no habit data). If it cannot, the closest FAQ answer is shown
// and labelled as such.
import React, { useState } from 'react';
import { AiChatSheet, useAiChat, type ChatAnswer } from '@/components/ai-chat';
import { closestFaq, supportQuestions } from '@/constants/help-faq';
import { askAi } from '@/utils/ai-client';

export function useSupportChat() {
  const [visible, setVisible] = useState(false);
  const [autoFocus, setAutoFocus] = useState(false);
  const chat = useAiChat(async (question): Promise<ChatAnswer> => {
    const result = await askAi('support', question);
    if (result.ok) return { ok: true, answer: result.answer };
    if (result.status === 401 || result.status === 429) return { ok: false, message: result.message, tone: 'warning' };
    const faq = closestFaq(question);
    return faq
      ? { ok: true, answer: faq.answer, note: `From the FAQ: "${faq.question}" ${result.message}` }
      : { ok: false, message: `${result.message} Browse the FAQ or report an issue instead.`, tone: 'warning' };
  });
  /** Opens the chat; with a question, asks it straight away. */
  const open = (question?: string) => {
    setVisible(true);
    setAutoFocus(!question);
    if (question) void chat.send(question);
  };
  return { chat, visible, autoFocus, open, close: () => setVisible(false) };
}

export function SupportChatSheet({ support }: { support: ReturnType<typeof useSupportChat> }) {
  return (
    <AiChatSheet
      chat={support.chat}
      visible={support.visible}
      onClose={support.close}
      title="HabitAI Help"
      subtitle="Answers about using the app"
      greeting="Hi! I can explain how HabitAI works: habits, streaks, points, goals, reminders and your account. What do you need help with?"
      suggestions={supportQuestions}
      placeholder="Ask how something works..."
      footnote="Free to use. Only your question is sent, not your habits. Answers can be wrong."
      autoFocus={support.autoFocus}
    />
  );
}
