import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import SettingsPreferencesScreen from '@/app/settings-preferences';

const mockScrollTo = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

jest.mock('react-native', () => {
  const React = jest.requireActual('react');

  const View = ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('View', props, children);
  const Text = ({ children, ...props }: { children?: React.ReactNode }) => React.createElement('Text', props, children);
  const Pressable = React.forwardRef(({ children, onPress, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      focus: () => onPress?.(),
    }));
    return React.createElement('Pressable', { ...props, onPress }, children);
  });
  Pressable.displayName = 'MockPressable';
  const TextInput = React.forwardRef(({ onFocus, onChangeText, value, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      focus: () => onFocus?.(),
      measure: (callback: (x: number, y: number, width: number, height: number, pageX: number, pageY: number) => void) => callback(0, 0, 200, 44, 0, 120),
    }));
    return React.createElement('TextInput', { ...props, value: value ?? '', onChangeText, onFocus });
  });
  TextInput.displayName = 'MockTextInput';
  const ScrollView = React.forwardRef(({ children, ...props }: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({
      scrollTo: mockScrollTo,
      scrollToEnd: jest.fn(),
    }));
    return React.createElement('ScrollView', props, children);
  });
  ScrollView.displayName = 'MockScrollView';
  const Modal = ({ children, visible, ...props }: any) => (visible ? React.createElement('Modal', props, children) : null);
  const KeyboardAvoidingView = ({ children, ...props }: any) => React.createElement('KeyboardAvoidingView', props, children);

  return {
    View,
    Text,
    TextInput,
    Pressable,
    ScrollView,
    Modal,
    KeyboardAvoidingView,
    Platform: {
      OS: 'ios',
      select: (options: Record<string, any>) => options.ios ?? options.default ?? options.android ?? options.native ?? undefined,
    },
    StyleSheet: {
      create: (styles: Record<string, any>) => styles,
      flatten: (style: any) => Array.isArray(style)
        ? style.reduce((acc: Record<string, any>, entry: any) => ({ ...acc, ...(entry || {}) }), {})
        : style || {},
    },
    Animated: { View },
    Dimensions: { get: () => ({ width: 390, height: 844 }) },
    NativeModules: { DevMenu: {} },
  };
});

const mockShowAlert = jest.fn();
const mockUpdatePreferences = jest.fn();
const mockSetDarkMode = jest.fn();
const mockClearLocalData = jest.fn();
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock('expo-router', () => ({
  router: mockRouter,
}));

jest.mock('react-native-safe-area-context', () => {
  const React = jest.requireActual('react');
  return {
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => React.createElement(React.Fragment, null, children),
  };
});

jest.mock('@/components/ui/app-dialog', () => ({
  useAppDialog: () => mockShowAlert,
}));

jest.mock('@/hooks/color-scheme-context', () => ({
  useAppColorScheme: () => ({
    isDarkMode: false,
    setDarkMode: mockSetDarkMode,
    clearLocalData: mockClearLocalData,
    profile: {
      fullName: 'Test User',
      email: 'user@example.com',
      username: 'testuser',
    },
    preferences: {
      notificationsEnabled: true,
      hideProgress: false,
      showCompletedHabits: true,
      weekStartsOn: 'Monday',
      language: 'English',
      region: 'Metro Manila',
    },
    updatePreferences: mockUpdatePreferences,
    t: (key: string) => key,
  }),
}));

jest.mock('@/authentication', () => ({
  changePassword: jest.fn().mockResolvedValue({ ok: true }),
  deleteAccount: jest.fn().mockResolvedValue({ ok: true }),
  getLoginActivity: jest.fn().mockResolvedValue({ activities: [] }),
  getPasswordStrengthStatus: jest.fn(() => ({
    label: 'Strong',
    description: 'Looks good.',
    color: '#2DAA76',
  })),
  validatePasswordStrength: jest.fn(() => ({ ok: true, message: '' })),
}));

describe('SettingsPreferencesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('clears password fields when the modal closes so the placeholder remains visible', async () => {
    const screen = await render(<SettingsPreferencesScreen />);
    const { getByPlaceholderText, getByLabelText, queryByDisplayValue } = screen;

    await fireEvent.press(getByLabelText('changePassword'));
    await fireEvent.changeText(getByPlaceholderText('Enter current password'), 'secret123');

    expect(queryByDisplayValue('secret123')).toBeTruthy();

    await fireEvent.press(getByLabelText('Close change password'));
    await fireEvent.press(getByLabelText('changePassword'));

    expect(getByPlaceholderText('Enter current password')).toBeTruthy();
    expect(queryByDisplayValue('secret123')).toBeNull();
  });

  it('scrolls to the focused password field instead of forcing the full form to jump', async () => {
    const screen = await render(<SettingsPreferencesScreen />);
    const { getByLabelText, getByPlaceholderText } = screen;

    await fireEvent.press(getByLabelText('changePassword'));
    await fireEvent(getByPlaceholderText('Repeat your password'), 'focus');

    expect(mockScrollTo).toHaveBeenCalled();
  });
});
