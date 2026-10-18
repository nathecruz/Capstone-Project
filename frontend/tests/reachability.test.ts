import * as Network from 'expo-network';
import { isServerReachable, probeReachability } from '@/authentication/authService';

jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn() }));
jest.mock('@/authentication/session', () => ({
  getCurrentSession: jest.fn(),
  getRememberedEmail: jest.fn(),
  getSessionToken: jest.fn(),
  logoutUser: jest.fn(),
  saveSessionToken: jest.fn(),
  setRememberedEmail: jest.fn(),
  subscribeToAuthChanges: jest.fn(),
}));

const fetchMock = jest.fn();
const timedOut = () => Object.assign(new Error('Aborted'), { name: 'AbortError' });
const deviceOnline = (online: boolean) => jest.mocked(Network.getNetworkStateAsync).mockResolvedValue({
  isConnected: online,
  isInternetReachable: online,
} as Awaited<ReturnType<typeof Network.getNetworkStateAsync>>);

describe('server reachability', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  it('does not call a slow, waking server offline while the phone has internet', async () => {
    deviceOnline(true);
    fetchMock.mockRejectedValue(timedOut());

    await expect(probeReachability()).resolves.toBe(true);
    expect(isServerReachable()).toBe(true);
  });

  it('is offline when the check times out and the phone has no internet', async () => {
    deviceOnline(false);
    fetchMock.mockRejectedValue(timedOut());

    await expect(probeReachability()).resolves.toBe(false);
    expect(isServerReachable()).toBe(false);
  });

  it('is back online as soon as the server answers', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await expect(probeReachability()).resolves.toBe(true);
    expect(isServerReachable()).toBe(true);
  });

  it('is offline when the request fails outright, whatever the phone reports', async () => {
    deviceOnline(true);
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    await expect(probeReachability()).resolves.toBe(false);
    expect(isServerReachable()).toBe(false);
  });
});
