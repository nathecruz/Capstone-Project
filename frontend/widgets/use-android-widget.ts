import { useEffect } from 'react';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Habit } from '@/hooks/app-state/types';
import { WIDGET_STORAGE_KEY, computeWidgetData } from './widget-data';
import { updateAndroidWidget } from './widget-updater';

/**
 * Keeps the Android home-screen widget in sync with today's progress: stores the data (so the
 * headless task can render it) and refreshes any placed widgets. A no-op on web and iOS.
 */
export function useAndroidWidget(habits: Habit[]) {
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const data = computeWidgetData(habits);
    void AsyncStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(data)).catch(() => undefined);
    updateAndroidWidget(data);
  }, [habits]);
}
