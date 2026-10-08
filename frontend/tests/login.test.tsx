import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import LoginScreen from '@/app/login';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { replace: jest.fn() },
}));

jest.mock('@/authentication', () => ({
  getPasswordStrengthStatus: () => ({ label: 'Strong', description: '', color: '#238a70' }),
  getSession: jest.fn().mockResolvedValue(null),
  getRememberedEmail: jest.fn().mockResolvedValue(''),
  isValidEmailFormat: (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && email.trim().toLowerCase().endsWith('@psau.edu.ph'),
  rememberEmail: jest.fn().mockResolvedValue(undefined),
  resetPassword: jest.fn(),
  signIn: jest.fn(),
  updatePasswordWithOtp: jest.fn(),
  verifyPasswordReset: jest.fn(),
  warmUpServer: jest.fn(),
}));

describe('LoginScreen', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const unsetEnv = (key: string) => {
    delete (process.env as Record<string, string | undefined>)[key];
  };

  beforeEach(() => {
    jest.clearAllMocks();
    if (originalNodeEnv === undefined) {
      unsetEnv('NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      unsetEnv('NODE_ENV');
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('allows a valid account to sign in', async () => {
    const { getSession, signIn } = jest.requireMock('@/authentication');
    const { router } = jest.requireMock('expo-router');
    getSession.mockResolvedValue(null);
    signIn.mockResolvedValue({ ok: true, message: 'Login successful.' });

    const screen = render(<LoginScreen />);
    await act(async () => {
      await Promise.resolve();
    });
    const { getByPlaceholderText, getByText, queryByText } = screen;
    await waitFor(() => {
      expect(getByPlaceholderText('Email Address')).toBeTruthy();
    });

    await fireEvent.changeText(getByPlaceholderText('Email Address'), 'newuser@psau.edu.ph');
    await fireEvent.changeText(getByPlaceholderText('Password'), 'ValidPassword!234');
    await fireEvent.press(getByText('Log In'));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('newuser@psau.edu.ph', 'ValidPassword!234');
      expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    });
    expect(queryByText('Legacy account migration required')).toBeNull();
  });

  it('accepts a valid PSAU email and rejects non-PSAU addresses', async () => {
    const { getByPlaceholderText, getByText, queryByText } = render(<LoginScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('Email Address')).toBeTruthy();
      expect(getByPlaceholderText('Password')).toBeTruthy();
    });

    await fireEvent.changeText(getByPlaceholderText('Email Address'), 'student@psau.edu.ph');
    await fireEvent.changeText(getByPlaceholderText('Password'), 'ValidPassword!234');
    await fireEvent.press(getByText('Log In'));

    await waitFor(() => {
      expect(jest.requireMock('@/authentication').signIn).toHaveBeenCalledWith('student@psau.edu.ph', 'ValidPassword!234');
    });
    expect(queryByText('Invalid email')).toBeNull();

    jest.clearAllMocks();
    await fireEvent.changeText(getByPlaceholderText('Email Address'), 'student@gmail.com');
    await fireEvent.changeText(getByPlaceholderText('Password'), 'some-password');
    await fireEvent.press(getByText('Log In'));

    expect(getByText('Invalid email')).toBeTruthy();
    expect(getByText('Please enter a valid email address.')).toBeTruthy();
  });
});
