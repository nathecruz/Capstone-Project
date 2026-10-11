import { ExtensionStorage } from '@bacons/apple-targets';
import { APP_GROUP, WIDGET_STORAGE_KEY, type WidgetData } from './widget-data';

const storage = new ExtensionStorage(APP_GROUP);

/** Write the data to the shared App Group and reload the WidgetKit timeline. */
export function updateHomeWidget(data: WidgetData): void {
  try {
    storage.set(WIDGET_STORAGE_KEY, JSON.stringify(data));
    ExtensionStorage.reloadWidget();
  } catch {
    // Widget storage unavailable.
  }
}
