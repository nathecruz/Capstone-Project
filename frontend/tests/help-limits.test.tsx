// What HabitAI can and cannot do (the capstone panel asked for the system's limits): one tap from
// Help & Support opens the FAQ on its Limitations topic.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import React from 'react';
import HelpSupportScreen from '@/app/help-support';
import HelpSupportFaqScreen from '@/app/help-support-faq';
import { LIMITS_TOPIC } from '@/constants/help-faq';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() }, useLocalSearchParams: () => mockParams }));
jest.mock('react-native-safe-area-context', () => {
  const ReactActual = jest.requireActual('react');
  return { SafeAreaView: ({ children }: { children?: React.ReactNode }) => ReactActual.createElement(ReactActual.Fragment, null, children) };
});
jest.mock('@/authentication', () => ({ submitFeatureSuggestion: jest.fn() }));
jest.mock('@/components/ai-chat', () => ({ AskAiCard: () => null }));
jest.mock('@/components/support-chat', () => ({ SupportChatSheet: () => null, useSupportChat: () => ({ open: jest.fn() }) }));
jest.mock('@/components/ui/app-dialog', () => ({ useAppDialog: () => jest.fn() }));
jest.mock('@/utils/platform', () => ({ openExternalLink: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = {};
});

describe('what HabitAI can and cannot do', () => {
  it('is one tap from Help & Support', () => {
    render(<HelpSupportScreen />);
    fireEvent.press(screen.getByLabelText('What HabitAI can and cannot do'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/help-support-faq', params: { topic: LIMITS_TOPIC } });
  });

  it('opens the FAQ on its topic, and the FAQ opens on All without one', () => {
    mockParams = { topic: LIMITS_TOPIC };
    const limits = render(<HelpSupportFaqScreen />);
    expect(limits.getByText('How does HabitAI know I really did a habit?')).toBeTruthy();
    expect(limits.getByText('Does HabitAI work offline?')).toBeTruthy();
    expect(limits.queryByText('How do streaks work?')).toBeNull();
    limits.unmount();

    mockParams = { topic: 'Not a topic' };
    const all = render(<HelpSupportFaqScreen />);
    expect(all.getByText('How do streaks work?')).toBeTruthy();
    expect(all.getByText('Does HabitAI work offline?')).toBeTruthy();
  });
});
