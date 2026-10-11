import type { WidgetData } from './widget-data';

/** Refresh the home-screen widget. A no-op on web; see widget-updater.android.tsx / .ios.ts. */
export function updateHomeWidget(_data: WidgetData): void {
  // No home-screen widget on this platform.
}
