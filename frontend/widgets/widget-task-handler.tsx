import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WidgetTaskHandlerProps } from 'react-native-android-widget';
import { HabitWidget } from './HabitWidget';
import { EMPTY_WIDGET_DATA, WIDGET_STORAGE_KEY, type WidgetData } from './widget-data';

async function readWidgetData(): Promise<WidgetData> {
  try {
    const raw = await AsyncStorage.getItem(WIDGET_STORAGE_KEY);
    return raw ? { ...EMPTY_WIDGET_DATA, ...(JSON.parse(raw) as Partial<WidgetData>) } : EMPTY_WIDGET_DATA;
  } catch {
    return EMPTY_WIDGET_DATA;
  }
}

/** Runs in a headless task when the OS adds, updates or resizes the widget: render it from stored data. */
export async function widgetTaskHandler(props: WidgetTaskHandlerProps) {
  switch (props.widgetAction) {
    case 'WIDGET_ADDED':
    case 'WIDGET_UPDATE':
    case 'WIDGET_RESIZED':
      props.renderWidget(<HabitWidget data={await readWidgetData()} />);
      break;
    default:
      break;
  }
}
