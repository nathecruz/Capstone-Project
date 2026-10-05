import { createThemedStyles, darkColor, DARK_PALETTE, themedColor, themeSheet } from '@/hooks/use-themed-styles';

function hue(value: string) {
  const [r, g, b] = [1, 3, 5].map((index) => parseInt(value.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const chroma = max - Math.min(r, g, b);
  const sector = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  return Math.round((sector * 60 + 360) % 360);
}

function contrastWithWhite(value: string) {
  const [r, g, b] = [1, 3, 5].map((index) => {
    const channel = parseInt(value.slice(index, index + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

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

describe('app themes', () => {
  it('moves the brand purple to the theme colour and keeps white text readable on it', () => {
    expect(themedColor('#5B42D8', 'classic')).toBe('#5B42D8');
    for (const [theme, expected] of [['ocean', 199], ['sunset', 16], ['forest', 150], ['midnight', 228]] as const) {
      const color = themedColor('#5B42D8', theme);
      expect(color).toMatch(/^#[0-9A-F]{6}$/);
      expect(Math.abs(hue(color) - expected)).toBeLessThanOrEqual(2);
      expect(contrastWithWhite(color)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps tints light, transparency, and the colours that mean something', () => {
    expect(themedColor('#F7F4FF', 'forest')).toMatch(/^#[DEF][0-9A-F][EF][0-9A-F][DEF][0-9A-F]$/);
    expect(themedColor('rgba(91, 66, 216, 0.2)', 'ocean')).toMatch(/^rgba\(\d+, \d+, \d+, 0.2\)$/);
    // Streak orange, done green, freeze blue, white, and grey-purple text stay as they are.
    for (const color of ['#F2A93B', '#3BAA74', '#4BA3FF', '#FFFFFF', '#302B3B', '#827C8C']) {
      expect(themedColor(color, 'sunset')).toBe(color);
    }
  });

  it('builds a themed light and dark sheet, and themes plain sheets once', () => {
    const themed = createThemedStyles({ button: { backgroundColor: '#5B42D8' }, link: { color: '#5B42D8' } });
    const ocean = themed.variant('ocean');
    expect(ocean.light.button.backgroundColor).toBe(themedColor('#5B42D8', 'ocean'));
    expect(ocean.dark.link.color).toMatch(/^hsl\(199, \d+%, 76%\)$/);
    expect(themed.variant('classic').light).toBe(themed.light);

    const colors = { active: '#4F2AC8', text: '#24212D' };
    expect(themeSheet(colors, 'classic')).toBe(colors);
    expect(themeSheet(colors, 'forest')).toBe(themeSheet(colors, 'forest'));
    expect(themeSheet(colors, 'forest')).toEqual({ active: themedColor('#4F2AC8', 'forest'), text: '#24212D' });
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

  it('merges a partial override over the derived dark style, so its text still turns light', () => {
    const themed = createThemedStyles({
      input: { backgroundColor: '#FFFFFF', color: '#2D2A3D', borderWidth: 2 },
    }, { input: { backgroundColor: '#221E2B' } });
    expect(themed.dark.input).toEqual({ backgroundColor: '#221E2B', color: DARK_PALETTE.ink, borderWidth: 2 });
  });
});
