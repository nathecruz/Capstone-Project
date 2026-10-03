import { createContext, useContext } from 'react';

/**
 * Whether the app is in dark mode, provided by ColorSchemeProvider. Kept apart from the full
 * app-state context so shared UI can read it without loading storage and sync code; outside the
 * provider (e.g. a component rendered alone in a test) it is false.
 */
export const DarkModeContext = createContext(false);

export function useIsDarkMode() {
  return useContext(DarkModeContext);
}

/** The app colour theme the student picked (the Premium Themes reward); 'classic' outside the provider. */
export const AppThemeContext = createContext<string>('classic');

export function useAppTheme() {
  return useContext(AppThemeContext) as 'classic' | 'ocean' | 'sunset' | 'forest' | 'midnight';
}
