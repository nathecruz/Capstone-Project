import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import LoginScreen from '@/app/login';

jest.mock('expo-router', () => ({
  Link: ({ children }: { children: React.ReactNode }) => children,
  router: { replace: jest.fn() },
}));

jest.mock('@/authentication', () => ({
  getPasswordStrengthStatus: () => ({ label: 'Strong', description: '', color: '#238a70' }),
  getSession: jest.fn().mockResolvedValue(null),
  getRememberedEmail: jest.fn().mockResolvedValue(''),
  rememberEmail: jest.fn().mockResolvedValue(undefined),
  resetPassword: jest.fn(),
  signIn: jest.fn(),
  updatePasswordWithOtp: jest.fn(),
  verifyPasswordReset: jest.fn(),
}));

describe('LoginScreen', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it('allows a valid account to sign in in production', async () => {
    const { signIn } = jest.requireMock('@/authentication');
    const { router } = jest.requireMock('expo-router');
    signIn.mockResolvedValue({ ok: true, message: 'Login successful.' });
    process.env.NODE_ENV = 'production';

    const { getByPlaceholderText, getByText, queryByText } = render(<LoginScreen />);
    await waitFor(() => {
      expect(getByPlaceholderText('Email Address')).toBeTruthy();
    });

    await fireEvent.changeText(getByPlaceholderText('Email Address'), 'newuser@example.com');
    await fireEvent.changeText(getByPlaceholderText('Password'), 'ValidPassword!234');
    await fireEvent.press(getByText('Log In'));

    await waitFor(() => {
      expect(signIn).toHaveBeenCalledWith('newuser@example.com', 'ValidPassword!234');
      expect(router.replace).toHaveBeenCalledWith('/(tabs)');
    });
    expect(queryByText('Legacy account migration required')).toBeNull();
  });

  it('shows a custom validation dialog for an invalid email', async () => {
    const { getByPlaceholderText, getByText } = render(<LoginScreen />);

    await waitFor(() => {
      expect(getByPlaceholderText('Email Address')).toBeTruthy();
      expect(getByPlaceholderText('Password')).toBeTruthy();
    });

    await fireEvent.changeText(getByPlaceholderText('Email Address'), 'not-an-email');
    await fireEvent.changeText(getByPlaceholderText('Password'), 'some-password');
    await fireEvent.press(getByText('Log In'));

    expect(getByText('Invalid email')).toBeTruthy();
    expect(getByText('Please enter a valid email address.')).toBeTruthy();
  });
});
