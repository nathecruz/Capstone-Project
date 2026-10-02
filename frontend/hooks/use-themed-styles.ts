// Dark mode for screens whose styles were written for the light theme. createThemedStyles keeps
// the light style sheet as written and derives a dark one from it with the app's dark palette:
// light surfaces become dark ones (keeping their hue), dark text becomes light, coloured text
// is lightened and light borders are darkened. Explicit per-screen overrides win.
import { StyleSheet } from 'react-native';
import { useIsDarkMode } from '@/hooks/dark-mode-context';

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

type StyleOverrides<T> = { [K in keyof T]?: T[K] };

/** Switch knobs and slider thumbs stay white on their coloured or grey tracks. */
const KEEP_LIGHT = /knob|thumb/i;

/** Light and dark versions of a style sheet; read them with useThemedStyles. */
export function createThemedStyles<T extends StyleSheet.NamedStyles<T>>(styles: T & StyleSheet.NamedStyles<T>, overrides: StyleOverrides<T> = {}) {
  const dark = {} as Record<keyof T, object>;
  for (const name of Object.keys(styles) as (keyof T)[]) {
    const style = { ...(styles[name] as Record<string, unknown>) };
    for (const property of KEEP_LIGHT.test(String(name)) ? [] : COLOR_PROPERTIES) {
      if (typeof style[property] === 'string') style[property] = darkColor(style[property] as string, property);
    }
    dark[name] = { ...style, ...(overrides[name] as object | undefined) };
  }
  return { light: StyleSheet.create(styles), dark: StyleSheet.create(dark as unknown as T) };
}

/** Maps a colour used inline (icon colours, data-driven backgrounds) for the current theme. */
export function useThemeColor() {
  const isDarkMode = useIsDarkMode();
  return (value: string, property = 'color') => (isDarkMode ? darkColor(value, property) : value);
}

/** The style sheet for the current theme. */
export function useThemedStyles<T>(themed: { light: T; dark: T }): T {
  return useIsDarkMode() ? themed.dark : themed.light;
}
