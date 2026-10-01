import { Platform, useWindowDimensions } from 'react-native';

/** From this width (laptops and desktops on the web) the tabs become a sidebar. */
export const SIDEBAR_MIN_WIDTH = 1024;
/** From this width (tablets and wider) screens are centered instead of stretched edge to edge. */
export const CENTERED_MIN_WIDTH = 700;
/** Widest a screen's content gets; the app was designed for phones, so wider only adds empty space. */
export const CONTENT_MAX_WIDTH = 880;

export function useResponsiveLayout() {
  const { width } = useWindowDimensions();
  return {
    width,
    isDesktop: Platform.OS === 'web' && width >= SIDEBAR_MIN_WIDTH,
    isCentered: width >= CENTERED_MIN_WIDTH,
  };
}

/** Page background behind centered screens, matching the screens' own backgrounds. */
export function pageBackground(isDarkMode: boolean) {
  return isDarkMode ? '#111018' : '#F5F4F9';
}
