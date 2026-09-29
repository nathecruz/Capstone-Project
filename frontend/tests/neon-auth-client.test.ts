jest.mock('better-auth/react', () => ({
  createAuthClient: jest.fn((options) => ({
    options,
    __type: 'mock-auth-client',
  })),
}));

jest.mock('@better-auth/expo/client', () => ({
  expoClient: jest.fn((options) => ({
    __type: 'mock-expo-client',
    options,
  })),
}));

jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(),
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

import { createNeonAuthClient, getConfiguredAuthBaseUrl } from '@/authentication/neonAuth';

const unsetEnv = (key: string) => {
  delete (process.env as Record<string, string | undefined>)[key];
};

describe('neon auth client configuration', () => {
  it('uses the Expo app scheme and secure-store storage when auth is configured', () => {
    process.env.EXPO_PUBLIC_AUTH_URL = 'https://auth.example.com';
    const client = createNeonAuthClient() as any;

    expect(client).toBeTruthy();
    expect(client?.options.baseURL).toBe('https://auth.example.com');
    expect(client?.options.plugins).toHaveLength(1);
    expect(client?.options.plugins[0]).toMatchObject({ __type: 'mock-expo-client' });
    unsetEnv('EXPO_PUBLIC_AUTH_URL');
  });

  it('falls back to the app backend URL when no auth URL is configured', () => {
    unsetEnv('EXPO_PUBLIC_AUTH_URL');
    const url = getConfiguredAuthBaseUrl();

    expect(url).toMatch(/localhost:8787|10\.0\.2\.2:8787|127\.0\.0\.1:8787/);
  });
});
