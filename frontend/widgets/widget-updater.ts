import type { WidgetData } from './widget-data';

/** Refresh the Android home-screen widget. A no-op on web and iOS; see widget-updater.android.tsx. */
export function updateAndroidWidget(_data: WidgetData): void {
  // No Android widget on this platform.
}
