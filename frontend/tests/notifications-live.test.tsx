import React from 'react';
import { render, act } from '@testing-library/react-native';
import NotificationsScreen from '@/app/notifications';

const mockGetPersistedNotifications = jest.fn();
const mockMarkPersistedNotification = jest.fn();
const mockRouter = { back: jest.fn(), push: jest.fn() };

jest.useFakeTimers();

jest.mock('expo-router', () => ({
  router: mockRouter,
}));

jest.mock('@/authentication', () => ({
  getPersistedNotifications: (...args: any[]) => mockGetPersistedNotifications(...args),
  markPersistedNotification: (...args: any[]) => mockMarkPersistedNotification(...args),
}));

jest.mock('@/hooks/color-scheme-context', () => ({
  useAppColorScheme: () => ({
    isDarkMode: false,
    preferences: { notificationsEnabled: true },
    updatePreferences: jest.fn(),
  }),
}));

describe('NotificationsScreen live refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockGetPersistedNotifications.mockResolvedValue([
      {
        id: 'n-1',
        type: 'habit-reminder',
        title: 'Drink Water',
        message: 'Reminder set for 08:00 AM.',
        readAt: null,
        createdAt: Date.now(),
      },
    ]);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('polls the backend for new notifications while the screen is open', async () => {
    await render(<NotificationsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetPersistedNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(15000);
    });

    expect(mockGetPersistedNotifications).toHaveBeenCalledTimes(2);
  });
});
