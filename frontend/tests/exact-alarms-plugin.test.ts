// The mod itself; `npx expo config --type introspect` shows it in the real config (Jest cannot load
// @expo/config-plugins).
jest.mock('expo/config-plugins', () => ({
  withAndroidManifest: (config: Record<string, unknown>, action: unknown) => ({ ...config, mods: { android: { manifest: action } } }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withExactAlarms = require('../plugins/with-exact-alarms') as (config: Record<string, unknown>) => { mods: { android: { manifest: (config: Record<string, unknown>) => Promise<{ modResults: AndroidManifest }> } } };

type AndroidManifest = { manifest: { 'uses-permission'?: { $: Record<string, string> }[] } };

async function permissionsAfter(manifest: AndroidManifest) {
  const config = withExactAlarms({ name: 'HabitAI', slug: 'habitmind' });
  const result = await config.mods.android.manifest({ name: 'HabitAI', slug: 'habitmind', modResults: manifest, modRequest: { platform: 'android', modName: 'manifest', projectRoot: '.', platformProjectRoot: './android', introspect: true } });
  return result.modResults.manifest['uses-permission'];
}

describe('exact alarms for Android reminders', () => {
  it('declares USE_EXACT_ALARM, and SCHEDULE_EXACT_ALARM for Android 12 only', async () => {
    expect(await permissionsAfter({ manifest: { 'uses-permission': [{ $: { 'android:name': 'android.permission.INTERNET' } }] } })).toEqual([
      { $: { 'android:name': 'android.permission.INTERNET' } },
      { $: { 'android:name': 'android.permission.USE_EXACT_ALARM' } },
      { $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM', 'android:maxSdkVersion': '32' } },
    ]);
  });

  it('limits a SCHEDULE_EXACT_ALARM declared elsewhere to Android 12 instead of adding it twice', async () => {
    const permissions = await permissionsAfter({ manifest: { 'uses-permission': [{ $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM' } }] } });
    expect(permissions?.filter((permission) => permission.$['android:name'] === 'android.permission.SCHEDULE_EXACT_ALARM')).toEqual([
      { $: { 'android:name': 'android.permission.SCHEDULE_EXACT_ALARM', 'android:maxSdkVersion': '32' } },
    ]);
  });
});
