import { habitIcon } from '@/utils/habit-icons';
import { createThemedStyles, MIN_FONT_SIZE, withReadableText } from '@/hooks/use-themed-styles';

describe('habitIcon', () => {
  it('matches what the habit is about', () => {
    expect(habitIcon('Read a Book')).toBe('book-outline');
    expect(habitIcon('Drink 8 glasses of water')).toBe('water-outline');
    expect(habitIcon('No Sugar / Junk Food')).toBe('ban-outline');
    expect(habitIcon('Walk between classes')).toBe('footsteps-outline');
    expect(habitIcon('Plan Your Day')).toBe('calendar-outline');
    expect(habitIcon('Something brand new')).toBe('star-outline');
  });
});

describe('readable text', () => {
  it('raises text below the minimum and leaves the rest alone', () => {
    const themed = createThemedStyles({ tiny: { fontSize: 9, lineHeight: 11 }, body: { fontSize: 14, lineHeight: 20 }, box: { padding: 4 } });
    expect(themed.light.tiny).toEqual({ fontSize: MIN_FONT_SIZE, lineHeight: Math.round(MIN_FONT_SIZE * 1.3) });
    expect(themed.light.body).toEqual({ fontSize: 14, lineHeight: 20 });
    expect(themed.light.box).toEqual({ padding: 4 });
    expect(withReadableText({ label: { fontSize: 10, color: '#000000' } })).toEqual({ label: { fontSize: MIN_FONT_SIZE, color: '#000000' } });
  });
});
