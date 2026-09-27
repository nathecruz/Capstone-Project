import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

let createAuthClientFn: ((options: Record<string, unknown>) => unknown) | undefined;
let expoClientFn: ((options: Record<string, unknown>) => unknown) | undefined;

try {
  const betterAuthReact = require('better-auth/react');
  createAuthClientFn = betterAuthReact.createAuthClient;
} catch {
  createAuthClientFn = (options: Record<string, unknown>) => ({ options, __type: 'fallback-auth-client' });
}

try {
  const betterAuthExpoClient = require('@better-auth/expo/client');
  expoClientFn = betterAuthExpoClient.expoClient;
} catch {
  expoClientFn = (options: Record<string, unknown>) => ({ options, __type: 'fallback-expo-client' });
}

function isLocalUrl(value: string) {
  try {
    const hostname = new URL(value).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.includes('replace-with')
    || normalized.includes('your-')
    || normalized.includes('your_')
    || normalized.includes('@example.')
    || normalized.includes('example.com')
    || normalized.includes('localhost')
    || normalized.includes('127.0.0.1')
    || normalized.includes('::1');
}

export function getConfiguredAuthBaseUrl() {
  const envUrl = (process.env.EXPO_PUBLIC_AUTH_URL || process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_AI_API_URL)?.trim();
  if (envUrl) {
    if (process.env.NODE_ENV === 'production' && !envUrl.startsWith('https://')) {
      throw new Error('Production auth is not configured. Set EXPO_PUBLIC_AUTH_URL to the deployed auth backend URL.');
    }
    if (process.env.NODE_ENV === 'production' && (isPlaceholderUrl(envUrl) || isLocalUrl(envUrl))) {
      throw new Error('Production auth is not configured. Set EXPO_PUBLIC_AUTH_URL to the deployed auth backend URL.');
    }
    return envUrl.replace(/\/$/, '');
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('Production auth is not configured. Set EXPO_PUBLIC_AUTH_URL to the deployed auth backend URL.');
  }

  if (Platform.OS === 'web') {
    const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname;
    return `http://${host}:8787`;
  }

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    return `http://${host}:8787`;
  }

  if (Platform.OS === 'android') {
    return 'http://10.0.2.2:8787';
  }

  return 'http://localhost:8787';
}

export function createNeonAuthClient() {
  const baseURL = getConfiguredAuthBaseUrl();

  const authClient = createAuthClientFn?.({
    baseURL,
    plugins: [
      expoClientFn?.({
        scheme: 'habitmind',
        storagePrefix: 'habitmind',
        storage: {
          getItem: (key: string) => SecureStore.getItem(key),
          setItem: async (key: string, value: string) => {
            await SecureStore.setItemAsync(key, value);
          },
        },
      }),
    ],
  });

  return authClient;
}

export const neonAuthClient = (() => {
  try {
    return createNeonAuthClient();
  } catch {
    return {
      __type: 'fallback-auth-client',
      options: {
        baseURL: 'http://localhost:8787',
      },
    };
  }
})();
