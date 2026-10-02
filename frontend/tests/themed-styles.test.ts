import { createThemedStyles, darkColor, DARK_PALETTE } from '@/hooks/use-themed-styles';

describe('darkColor', () => {
  it('turns light surfaces dark and keeps dark or translucent ones', () => {
    expect(darkColor('#FFFFFF', 'backgroundColor')).toBe(DARK_PALETTE.card);
    expect(darkColor('#F5F4F9', 'backgroundColor')).toBe(DARK_PALETTE.raised);
    expect(darkColor('#5B42D8', 'backgroundColor')).toBe('#5B42D8');
    expect(darkColor('rgba(255, 255, 255, 0.18)', 'backgroundColor')).toBe('rgba(255, 255, 255, 0.18)');
    expect(darkColor('#E6F6EA', 'backgroundColor')).toMatch(/^hsl\(\d+, \d+%, 20%\)$/);
  });

  it('makes dark text light and lightens coloured text', () => {
    expect(darkColor('#24212D', 'color')).toBe(DARK_PALETTE.ink);
    expect(darkColor('#777282', 'color')).toBe(DARK_PALETTE.muted);
    expect(darkColor('#FFFFFF', 'color')).toBe('#FFFFFF');
    expect(darkColor('#5B42D8', 'color')).toMatch(/^hsl\(\d+, \d+%, 76%\)$/);
  });

  it('darkens light borders only', () => {
    expect(darkColor('#ECE8F4', 'borderColor')).toBe(DARK_PALETTE.border);
    expect(darkColor('#5B42D8', 'borderColor')).toBe('#5B42D8');
  });
});

describe('createThemedStyles', () => {
  it('leaves the light sheet untouched, derives the dark one and applies overrides', () => {
    const themed = createThemedStyles({
      card: { backgroundColor: '#FFFFFF', padding: 4 },
      title: { color: '#302B3B', fontSize: 14 },
      knob: { backgroundColor: '#FFFFFF' },
      badge: { backgroundColor: '#FFFFFF' },
    }, { badge: { backgroundColor: '#123456' } });
    expect(themed.light.card).toEqual({ backgroundColor: '#FFFFFF', padding: 4 });
    expect(themed.dark.card).toEqual({ backgroundColor: DARK_PALETTE.card, padding: 4 });
    expect(themed.dark.title).toEqual({ color: DARK_PALETTE.ink, fontSize: 14 });
    expect(themed.dark.knob).toEqual({ backgroundColor: '#FFFFFF' });
    expect(themed.dark.badge).toEqual({ backgroundColor: '#123456' });
  });
});
