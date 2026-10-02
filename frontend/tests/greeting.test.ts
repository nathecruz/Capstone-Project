import { greetingFor } from '@/utils/greeting';

const at = (hour: number, minute = 0) => new Date(2026, 9, 1, hour, minute);

describe('greetingFor', () => {
  it('follows the local time of day', () => {
    expect(greetingFor(at(5))).toBe('Good morning');
    expect(greetingFor(at(11, 59))).toBe('Good morning');
    expect(greetingFor(at(12))).toBe('Good afternoon');
    expect(greetingFor(at(15, 31))).toBe('Good afternoon');
    expect(greetingFor(at(18))).toBe('Good evening');
    expect(greetingFor(at(0, 30))).toBe('Good evening');
    expect(greetingFor(at(4, 59))).toBe('Good evening');
  });
});
