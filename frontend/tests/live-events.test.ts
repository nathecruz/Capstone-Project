import { emitLive, onLive, setUnreadCount } from '@/utils/live-events';

describe('live events', () => {
  it('calls the listeners of a topic until they unsubscribe', () => {
    const claims = jest.fn();
    const notifications = jest.fn();
    const stop = onLive('claims', claims);
    onLive('notifications', notifications);
    emitLive('claims');
    expect([claims.mock.calls.length, notifications.mock.calls.length]).toEqual([1, 0]);
    stop();
    emitLive('claims');
    expect(claims).toHaveBeenCalledTimes(1);
  });

  it('keeps the unread count', () => {
    expect(() => setUnreadCount(3)).not.toThrow();
    expect(() => setUnreadCount(3)).not.toThrow();
  });
});
