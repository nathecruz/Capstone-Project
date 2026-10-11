import React from 'react';
import { requestWidgetUpdate } from 'react-native-android-widget';
import { HabitWidget } from './HabitWidget';
import { WIDGET_NAME, type WidgetData } from './widget-data';

/** Re-render every placed HabitAI widget with the latest progress. */
export function updateAndroidWidget(data: WidgetData): void {
  void requestWidgetUpdate({
    widgetName: WIDGET_NAME,
    renderWidget: () => <HabitWidget data={data} />,
    widgetNotFound: () => undefined,
  }).catch(() => undefined);
}
