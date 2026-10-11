import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { HabitWidget } from './HabitWidget';
import { WIDGET_NAME, WIDGET_STORAGE_KEY, type WidgetData } from './widget-data';

/** Store the data (for the headless render task) and re-render every placed HabitAI widget. */
export function updateHomeWidget(data: WidgetData): void {
  void AsyncStorage.setItem(WIDGET_STORAGE_KEY, JSON.stringify(data)).catch(() => undefined);
  void requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => <HabitWidget data={data} />,
    widgetNotFound: () => undefined,
  }).catch(() => undefined);
}
