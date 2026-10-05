// Dark mode for screens whose styles were written for the light theme. createThemedStyles keeps
// the light style sheet as written and derives a dark one from it with the app's dark palette:
// light surfaces become dark ones (keeping their hue), dark text becomes light, coloured text
// is lightened and light borders are darkened. Explicit per-screen overrides win.
import { StyleSheet } from 'react-native';
import { useAppTheme, useIsDarkMode } from '@/hooks/dark-mode-context';

export const DARK_PALETTE = {
  card: '#1D1A24',
  raised: '#25212E',
  ink: '#F2EFF8',
  muted: '#AAA4B7',
  border: '#302B3B',
};

type Rgb = { r: number; g: number; b: number; a: number };

function parseColor(value: string): Rgb | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((digit) => digit + digit).join('') : hex[1];
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(value.trim());
  return rgb ? { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) } : null;
}

function toHsl({ r, g, b }: Rgb) {
  const [red, green, blue] = [r / 255, g / 255, b / 255];
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const chroma = max - min;
  if (!chroma) return { h: 0, s: 0, l: lightness, chroma };
  const saturation = chroma / (1 - Math.abs(2 * lightness - 1));
  const hue = max === red ? ((green - blue) / chroma) % 6 : max === green ? (blue - red) / chroma + 2 : (red - green) / chroma + 4;
  return { h: (hue * 60 + 360) % 360, s: saturation, l: lightness, chroma };
}

function hsl(h: number, s: number, l: number, alpha = 1) {
  const value = `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  return alpha < 1 ? `hsla(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${alpha})` : value;
}

const withAlpha = (color: string, alpha: number) => {
  if (alpha >= 1) return color;
  const rgb = parseColor(color);
  return rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})` : color;
};

/** The dark-theme counterpart of one colour, given the style property it is used for. */
export function darkColor(value: string, property: string): string {
  const rgb = parseColor(value);
  if (!rgb) return value;
  const { h, s, l, chroma } = toHsl(rgb);
  const neutral = chroma < 0.045;
  if (property === 'backgroundColor') {
    // Dark already, or a translucent overlay (e.g. glass chips on a coloured hero): keep as is.
    if (l < 0.8 || rgb.a < 0.5) return value;
    if (neutral) return withAlpha(l >= 0.99 ? DARK_PALETTE.card : DARK_PALETTE.raised, rgb.a);
    return hsl(h, Math.min(s, 0.4), 0.2, rgb.a);
  }
  if (property === 'color' || property === 'tintColor') {
    if (neutral || chroma < 0.08) {
      if (l < 0.32) return DARK_PALETTE.ink;
      if (l < 0.62) return DARK_PALETTE.muted;
      return value;
    }
    return l < 0.62 ? hsl(h, Math.min(Math.max(s, 0.5), 0.9), 0.76, rgb.a) : value;
  }
  // Borders and dividers.
  return l >= 0.8 ? DARK_PALETTE.border : value;
}

const COLOR_PROPERTIES = ['backgroundColor', 'color', 'tintColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor'];

/** Dark-mode changes per style; each is merged over the derived dark style, so only the changed properties are needed. */
type StyleOverrides<T> = { [K in keyof T]?: Partial<T[K]> };

/** Switch knobs and slider thumbs stay white on their coloured or grey tracks. */
const KEEP_LIGHT = /knob|thumb/i;

/**
 * App colour themes (the Premium Themes reward). A theme moves the brand purple, and its tints and
 * shades, to another hue; neutrals and the colours that mean something (orange streaks, green
 * "done", blue freezes) stay as they are.
 */
export const APP_THEMES = [
  { id: 'classic', name: 'Classic' },
  { id: 'ocean', name: 'Ocean', hue: 199, lift: 1.3 },
  { id: 'sunset', name: 'Sunset', hue: 16, lift: 1.3 },
  { id: 'forest', name: 'Forest', hue: 150, lift: 1.3 },
  { id: 'midnight', name: 'Midnight', hue: 228, lift: 0.62 },
] as const;
export type AppTheme = (typeof APP_THEMES)[number]['id'];

export function isAppTheme(value: unknown): value is AppTheme {
  return APP_THEMES.some((theme) => theme.id === value);
}

function hslToRgb(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}

const channel = (value: number) => (value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: number[]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

const themedColors = new Map<string, string>();

/**
 * The colour in `theme`: brand purples (hue 228-292, not grey) take the theme's hue at the
 * same brightness, so white text on a themed button stays readable. Mid and dark tones are
 * lifted a little (never below 4.5:1 against white); Midnight makes them deeper instead.
 */
export function themedColor(value: string, theme: AppTheme): string {
  if (theme === 'classic') return value;
  const key = `${theme}|${value}`;
  const cached = themedColors.get(key);
  if (cached) return cached;
  const rgb = parseColor(value);
  let result = value;
  if (rgb) {
    const { h, s, l, chroma } = toHsl(rgb);
    // Light tints are themed even when faint; grey-purple text and dark surfaces stay neutral.
    if (h >= 228 && h <= 292 && chroma >= (l > 0.85 ? 0.03 : 0.09)) {
      const target = APP_THEMES.find((item) => item.id === theme) as { hue: number; lift: number };
      const saturation = l > 0.85 ? Math.min(s, 0.6) : s;
      const original = luminance([rgb.r / 255, rgb.g / 255, rgb.b / 255]);
      const goal = l >= 0.7 ? original : target.lift > 1 ? Math.min(original * target.lift, Math.max(original, 0.17)) : original * target.lift;
      let low = 0;
      let high = 1;
      for (let step = 0; step < 24; step += 1) {
        const middle = (low + high) / 2;
        if (luminance(hslToRgb(target.hue, saturation, middle)) < goal) low = middle;
        else high = middle;
      }
      // Hex (or rgba), not hsl(): darkColor reads it again for dark mode.
      const [red, green, blue] = hslToRgb(target.hue, saturation, (low + high) / 2).map((part) => Math.round(part * 255));
      result = rgb.a < 1 ? `rgba(${red}, ${green}, ${blue}, ${rgb.a})` : `#${[red, green, blue].map((part) => part.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    }
  }
  themedColors.set(key, result);
  return result;
}

const THEME_PROPERTIES = [...COLOR_PROPERTIES, 'shadowColor'];

function withTheme(style: Record<string, unknown>, theme: AppTheme) {
  if (theme === 'classic') return style;
  const themed = { ...style };
  for (const property of THEME_PROPERTIES) {
    if (typeof themed[property] === 'string') themed[property] = themedColor(themed[property] as string, theme);
  }
  return themed;
}

/** The smallest text the app shows; anything written smaller is raised to it so it stays readable on phones. */
export const MIN_FONT_SIZE = 11;

function readable(style: Record<string, unknown>) {
  if (typeof style.fontSize !== 'number' || style.fontSize >= MIN_FONT_SIZE) return style;
  const lineHeight = typeof style.lineHeight === 'number' && style.lineHeight < MIN_FONT_SIZE * 1.3 ? Math.round(MIN_FONT_SIZE * 1.3) : style.lineHeight;
  return { ...style, fontSize: MIN_FONT_SIZE, ...(lineHeight === undefined ? {} : { lineHeight }) };
}

/** A plain style sheet with every font size at least MIN_FONT_SIZE (createThemedStyles does this itself). */
export function withReadableText<T extends object>(styles: T): T {
  return Object.fromEntries(Object.entries(styles).map(([name, style]) => [name, style && typeof style === 'object' && !Array.isArray(style) ? readable(style as Record<string, unknown>) : style])) as T;
}

/**
 * Light and dark versions of a style sheet; read them with useThemedStyles. The other app themes
 * are built the first time they are used: the theme's colours first, then the dark derivation.
 */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(styles: T & StyleSheet.NamedStyles<T>, overrides: StyleOverrides<T> = {}) {
  const build = (theme: AppTheme) => {
    const light = {} as Record<keyof T, object>;
    const dark = {} as Record<keyof T, object>;
    for (const name of Object.keys(styles) as (keyof T)[]) {
      const style = withTheme(readable(styles[name] as Record<string, unknown>), theme);
      light[name] = style;
      const darkStyle = { ...style };
      for (const property of KEEP_LIGHT.test(String(name)) ? [] : COLOR_PROPERTIES) {
        if (typeof darkStyle[property] === 'string') darkStyle[property] = darkColor(darkStyle[property] as string, property);
      }
      const override = overrides[name] as Record<string, unknown> | undefined;
      dark[name] = { ...darkStyle, ...(override ? withTheme(override, theme) : {}) };
    }
    return { light: StyleSheet.create(light as unknown as T), dark: StyleSheet.create(dark as unknown as T) };
  };
  const classic = build('classic');
  const variants = new Map<AppTheme, { light: T; dark: T }>([['classic', classic]]);
  return {
    light: classic.light,
    dark: classic.dark,
    variant(theme: AppTheme) {
      if (!variants.has(theme)) variants.set(theme, build(theme));
      return variants.get(theme) as { light: T; dark: T };
    },
  };
}

const sheetVariants = new WeakMap<object, Map<AppTheme, unknown>>();

/**
 * A plain style sheet, or a map of colours, in an app theme. For screens that handle dark mode
 * themselves instead of with createThemedStyles.
 */
export function themeSheet<T extends object>(sheet: T, theme: AppTheme): T {
  if (theme === 'classic') return sheet;
  let variants = sheetVariants.get(sheet);
  if (!variants) {
    variants = new Map();
    sheetVariants.set(sheet, variants);
  }
  if (!variants.has(theme)) {
    const themed: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(sheet)) {
      themed[name] = typeof value === 'string' ? themedColor(value, theme) : value && typeof value === 'object' && !Array.isArray(value) ? withTheme(value as Record<string, unknown>, theme) : value;
    }
    variants.set(theme, themed);
  }
  return variants.get(theme) as T;
}

/** themeSheet for the current app theme. */
export function useAppThemeSheet<T extends object>(sheet: T): T {
  return themeSheet(sheet, useAppTheme());
}

/** Maps a colour used inline (icon colours, data-driven backgrounds) for the current theme. */
export function useThemeColor() {
  const isDarkMode = useIsDarkMode();
  const theme = useAppTheme();
  return (value: string, property = 'color') => {
    const themed = themedColor(value, theme);
    return isDarkMode ? darkColor(themed, property) : themed;
  };
}

/** The style sheet for the current theme. */
export function useThemedStyles<T>(themed: { light: T; dark: T; variant?: (theme: AppTheme) => { light: T; dark: T } }): T {
  const isDarkMode = useIsDarkMode();
  const theme = useAppTheme();
  const sheet = theme !== 'classic' && themed.variant ? themed.variant(theme) : themed;
  return isDarkMode ? sheet.dark : sheet.light;
}
