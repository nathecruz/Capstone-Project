import React from 'react';
import { render, act, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';
import NotificationsScreen from '@/app/notifications';
import { emitLive } from '@/utils/live-events';

const mockGetPersistedNotifications = jest.fn();
const mockMarkPersistedNotification = jest.fn();

jest.useFakeTimers();

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
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

describe('NotificationsScreen treats from classmates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetPersistedNotifications.mockResolvedValue([
      { id: 'r-1', type: 'habit-reminder', title: 'Drink Water', message: 'Reminder set for 08:00 AM.', readAt: Date.now(), createdAt: Date.now() - 1000 },
      { id: 'g-1', type: 'gift', title: '🧁 A treat for Habi', message: 'Maria R. sent Habi a Cupcake: Keep going!', readAt: null, createdAt: Date.now() },
    ]);
  });

  afterEach(() => {
    jest.clearAllTimers();
  });

  it("puts a 'gift' notification in the Treats tab, which opens Habi", async () => {
    const screen = await render(<NotificationsScreen />);
    await act(async () => {
      await Promise.resolve();
    });

    // It opens on the tab with something new.
    expect(screen.getByLabelText('Treats, 1 new').props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByText('🧁 A treat for Habi')).toBeTruthy();
    expect(screen.queryByText('Drink Water')).toBeNull();

    await fireEvent.press(screen.getByLabelText('New: 🧁 A treat for Habi. Maria R. sent Habi a Cupcake: Keep going!'));
    expect(mockMarkPersistedNotification).toHaveBeenCalledWith('g-1', true);
    expect(router.push).toHaveBeenCalledWith('/buddy');

    // Reminders keep only the reminder.
    await fireEvent.press(screen.getByLabelText('Reminders'));
    expect(screen.getByText('Drink Water')).toBeTruthy();
    expect(screen.queryByText('🧁 A treat for Habi')).toBeNull();
  });

  it('says what the Treats tab is for while it is empty', async () => {
    mockGetPersistedNotifications.mockResolvedValue([]);
    const screen = await render(<NotificationsScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    await fireEvent.press(screen.getByLabelText('Treats'));
    expect(screen.getByText('Treats from classmates will show here.')).toBeTruthy();
  });
});
