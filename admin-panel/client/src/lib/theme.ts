import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'habitai-admin-theme';

function readChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(KEY);
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  } catch {
    return 'system';
  }
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice);

  useEffect(() => {
    const root = document.documentElement;
    if (choice === 'system') delete root.dataset.theme;
    else root.dataset.theme = choice;
    try {
      if (choice === 'system') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      /* storage unavailable: the choice lasts for this page view only */
    }
  }, [choice]);

  const cycle = useCallback(() => {
    setChoice((current) => (current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system'));
  }, []);

  return { choice, setChoice, cycle };
}
