// Android: lets reminders come on their minute. expo-notifications sets an exact alarm only when the
// app may (Android 12 and later); without the permission Android delays a reminder, by minutes or
// more while the phone dozes. USE_EXACT_ALARM is granted on install from Android 13 (Google Play only
// allows it for alarm and calendar apps); SCHEDULE_EXACT_ALARM, granted on install there, covers
// Android 12. They are declared as the Android documentation recommends for this pair.
const { withAndroidManifest } = require('expo/config-plugins');

function setPermission(permissions, name, attributes = {}) {
  const existing = permissions.find((permission) => permission.$['android:name'] === name);
  if (existing) Object.assign(existing.$, attributes);
  else permissions.push({ $: { 'android:name': name, ...attributes } });
}

module.exports = function withExactAlarms(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    manifest['uses-permission'] = manifest['uses-permission'] ?? [];
    setPermission(manifest['uses-permission'], 'android.permission.USE_EXACT_ALARM');
    setPermission(manifest['uses-permission'], 'android.permission.SCHEDULE_EXACT_ALARM', { 'android:maxSdkVersion': '32' });
    return modConfig;
  });
};
