import { sectionFor, timeLabel } from '@/utils/notification-time';

describe('notification time', () => {
  const now = new Date(2026, 9, 4, 15, 0).getTime();
  it('groups by day', () => {
    expect(sectionFor(new Date(2026, 9, 4, 0, 5).getTime(), now)).toBe('Today');
    expect(sectionFor(new Date(2026, 9, 3, 23, 50).getTime(), now)).toBe('Yesterday');
    expect(sectionFor(new Date(2026, 9, 1, 9, 0).getTime(), now)).toBe('Earlier');
  });
  it('labels recent ones relative to now', () => {
    expect(timeLabel(now - 20_000, now)).toBe('Just now');
    expect(timeLabel(now - 13 * 60_000, now)).toBe('13 min ago');
    expect(timeLabel(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(timeLabel(new Date(2026, 9, 1, 9, 0).getTime(), now)).toBe('Oct 1');
  });
});
