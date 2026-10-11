import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { Habit } from '@/hooks/app-state/types';
import { computeWidgetData } from './widget-data';
import { updateHomeWidget } from './widget-updater';

/**
 * Keeps the home-screen widget in sync with today's progress (Android and iOS). A no-op on web;
 * the native update is platform-resolved in widget-updater.android.tsx / widget-updater.ios.ts.
 */
export function useHomeWidget(habits: Habit[]) {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    updateHomeWidget(computeWidgetData(habits));
  }, [habits]);
}
