import { registerWidgetTaskHandler } from 'react-native-android-widget';
import { widgetTaskHandler } from './widget-task-handler';

/** Register the headless task that renders the widget when the OS adds, updates or resizes it. */
export function registerWidget(): void {
  registerWidgetTaskHandler(widgetTaskHandler);
}
