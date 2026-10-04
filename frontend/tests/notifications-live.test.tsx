import React from 'react';
import { render, act } from '@testing-library/react-native';
import NotificationsScreen from '@/app/notifications';
import { emitLive } from '@/utils/live-events';

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

  it('loads new notifications when the live pulse says they changed, and polls slowly as a fallback', async () => {
    await render(<NotificationsScreen />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetPersistedNotifications).toHaveBeenCalledTimes(1);

    await act(async () => {
      emitLive('notifications');
      await Promise.resolve();
    });

    expect(mockGetPersistedNotifications).toHaveBeenCalledTimes(2);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(60000);
    });

    expect(mockGetPersistedNotifications).toHaveBeenCalledTimes(3);
  });
});
