// Notifications > Settings > Reminders while HabitAI is closed (components/reminder-check.tsx): on
// the web, whether the server and this browser are ready, turning reminders on, and a test
// reminder a minute later; on a phone, its permission, its next reminders and the test.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';
import { Linking, Platform } from 'react-native';
import { ReminderCheck } from '@/components/reminder-check';
import { enableWebReminders, getWebReminderStatus, isWebPushReadyOnServer, nextPhoneReminders, scheduleTestReminder, sendTestReminder } from '@/hooks/app-state/reminders';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const mockNotifications = {
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted', canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
};
jest.mock('@/hooks/app-state/reminders', () => ({
  enableWebReminders: jest.fn(async () => true),
  getWebReminderStatus: jest.fn(async () => 'on'),
  isWebPushReadyOnServer: jest.fn(async () => true),
  sendTestReminder: jest.fn(async () => ({ ok: true, message: 'Close HabitAI now: the test reminder comes in about a minute.' })),
  getNotificationsModule: jest.fn(async () => mockNotifications),
  nextPhoneReminders: jest.fn(async () => []),
  scheduleTestReminder: jest.fn(async () => 'habitai-test-reminder'),
}));

const nativeOS = Platform.OS;
const setPlatform = (os: string) => Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
const settle = () => act(async () => { await new Promise<void>((resolve) => setImmediate(() => resolve())); });

beforeEach(() => jest.clearAllMocks());
afterEach(() => setPlatform(nativeOS));

describe('the reminder check on the web', () => {
  beforeEach(() => setPlatform('web'));

  it('sends a test reminder a minute later, once the server and this browser are ready', async () => {
    render(<ReminderCheck />);
    await settle();
    expect(screen.getByText("HabitAI's server is ready to send reminders.")).toBeTruthy();
    expect(screen.getByText('Reminders are on for this browser.')).toBeTruthy();
    expect(screen.queryByText('Turn on reminders')).toBeNull();
    fireEvent.press(screen.getByText('Send a test reminder in 1 minute'));
    await settle();
    expect(sendTestReminder).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(screen.getByText(/Close HabitAI now: it should appear then/)).toBeTruthy();
  });

  it('turns reminders on for this browser, and says so when the server cannot send them', async () => {
    jest.mocked(getWebReminderStatus).mockResolvedValue('off');
    jest.mocked(isWebPushReadyOnServer).mockResolvedValue(false);
    jest.mocked(enableWebReminders).mockResolvedValueOnce(false);
    render(<ReminderCheck />);
    await settle();
    expect(screen.getByText(/server could not be reached, or cannot send reminders yet/)).toBeTruthy();
    expect(screen.getByLabelText('Send a test reminder in 1 minute').props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(screen.getByText('Turn on reminders'));
    await settle();
    expect(enableWebReminders).toHaveBeenCalledWith({ prompt: true });
    expect(screen.getByText("HabitAI's server cannot send reminders yet.")).toBeTruthy();
    // Phone tips, for a phone's own battery saver (an Infinix one, say).
    expect(screen.getByText(/Phone Master's auto-start/)).toBeTruthy();
  });
});

describe('the reminder check in the app', () => {
  beforeEach(() => setPlatform('android'));

  it("lists the phone's next reminders and sets a test one a minute later", async () => {
    const tonight = new Date();
    tonight.setHours(23, 0, 0, 0);
    jest.mocked(nextPhoneReminders).mockResolvedValueOnce([{ title: 'Read · 11:00 PM', at: tonight.getTime() }]);
    render(<ReminderCheck />);
    await settle();
    expect(screen.getByText('HabitAI may show notifications on this phone.')).toBeTruthy();
    expect(screen.getByText('Today · Read · 11:00 PM')).toBeTruthy();
    fireEvent.press(screen.getByText('Send a test reminder in 1 minute'));
    await settle();
    expect(scheduleTestReminder).toHaveBeenCalledWith(mockNotifications, 60);
    expect(screen.getByText(/swipe it away too/)).toBeTruthy();
  });

  it('opens the settings when notifications were refused for good', async () => {
    mockNotifications.getPermissionsAsync.mockResolvedValueOnce({ status: 'denied', canAskAgain: false });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
    render(<ReminderCheck />);
    await settle();
    expect(screen.getByText('HabitAI is not allowed to show notifications on this phone.')).toBeTruthy();
    fireEvent.press(screen.getByText('Open settings'));
    await settle();
    expect(mockNotifications.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(openSettings).toHaveBeenCalled();
  });
});
