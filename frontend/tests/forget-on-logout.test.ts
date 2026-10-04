import AsyncStorage from '@react-native-async-storage/async-storage';
import { forgetAccountOnDevice } from '@/hooks/app-state/sync-storage';

jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (key: string) => store.get(key) ?? null),
      setItem: jest.fn(async (key: string, value: string) => void store.set(key, value)),
      removeItem: jest.fn(async (key: string) => void store.delete(key)),
    },
  };
});

describe('signing out on a shared device', () => {
  const email = 'ana@example.com';
  const seed = async (unsaved: boolean) => {
    await AsyncStorage.setItem(`habitai_app_state:${email}`, '{"habits":[]}');
    await AsyncStorage.setItem(`habitai_sync_base:${email}`, '{}');
    if (unsaved) await AsyncStorage.setItem(`habitai_unsaved:${email}`, '1');
    else await AsyncStorage.removeItem(`habitai_unsaved:${email}`);
  };

  it('removes the copy of the habits and settings', async () => {
    await seed(false);
    await forgetAccountOnDevice(email);
    expect(await AsyncStorage.getItem(`habitai_app_state:${email}`)).toBeNull();
    expect(await AsyncStorage.getItem(`habitai_sync_base:${email}`)).toBeNull();
  });

  it('keeps check-ins that have not reached the server yet', async () => {
    await seed(true);
    await forgetAccountOnDevice(email);
    expect(await AsyncStorage.getItem(`habitai_app_state:${email}`)).not.toBeNull();
  });
});
