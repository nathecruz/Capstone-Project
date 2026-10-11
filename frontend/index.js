// App entry: load Expo Router, then register the Android home-screen widget task handler.
// registerWidget is a no-op on web and iOS (platform-resolved), so this is safe everywhere.
import 'expo-router/entry';
import { registerWidget } from './widgets/register-widget';

registerWidget();
