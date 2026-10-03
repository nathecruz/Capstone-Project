// Sidebar navigation for laptops and desktops (web, >= 1024px wide). It replaces the phone
// bottom tab bar there; the routes, labels and order are the same tabs. PageSidebar shows the
// same sidebar beside the pages outside the tabs (Achievements, Settings, ...).
import { Ionicons } from '@expo/vector-icons';
import { type Href, router, type Tabs } from 'expo-router';
import React from 'react';
import { Pressable, type PressableStateCallbackType, StyleSheet, Text, View } from 'react-native';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { themeSheet } from '@/hooks/use-themed-styles';

type IconName = keyof typeof Ionicons.glyphMap;
/** Pressable state on the web also carries `hovered` (react-native-web); native leaves it out. */
type HoverState = PressableStateCallbackType & { hovered?: boolean };
/** The props expo-router's Tabs passes to a custom tab bar. */
type TabBarProps = Parameters<NonNullable<React.ComponentProps<typeof Tabs>['tabBar']>>[0];

const ICONS: Record<string, [IconName, IconName]> = {
  index: ['home-outline', 'home'],
  habits: ['list-outline', 'list'],
  goals: ['flag-outline', 'flag'],
  insights: ['bar-chart-outline', 'bar-chart'],
  profile: ['person-outline', 'person'],
};

const TAB_HREFS: Record<string, Href> = {
  index: '/(tabs)',
  habits: '/(tabs)/habits',
  goals: '/(tabs)/goals',
  insights: '/(tabs)/insights',
  profile: '/(tabs)/profile',
};

// Pages that belong to a footer link, so the sidebar can show where the user is.
const SETTINGS_PAGES = new Set(['settings-preferences']);
const HELP_PAGES = new Set(['help-support', 'help-support-faq', 'report-issue']);

export const DESKTOP_SIDEBAR_WIDTH = 248;

type NavItem = { key: string; name: string; label: string; focused: boolean; onPress: () => void };

function SidebarView({ items, onAdd, current, asTabs }: { items: NavItem[]; onAdd?: () => void; current?: string; asTabs: boolean }) {
  const { isDarkMode, profile } = useAppColorScheme();
  const appTheme = useAppTheme();
  const colors = themeSheet(isDarkMode ? darkColors : lightColors, appTheme);
  const styles = themeSheet(baseStyles, appTheme);
  const firstName = profile.firstName || profile.fullName.split(' ')[0] || '';
  const footerLinks = [
    { label: 'Settings', icon: 'options-outline' as IconName, href: '/settings-preferences' as Href, focused: Boolean(current && SETTINGS_PAGES.has(current)) },
    { label: 'Help & Support', icon: 'help-circle-outline' as IconName, href: '/help-support' as Href, focused: Boolean(current && HELP_PAGES.has(current)) },
  ];

  return (
    <View style={[styles.sidebar, { backgroundColor: colors.surface, borderRightColor: colors.border }]} accessibilityRole={asTabs ? 'tablist' : undefined}>
      <View style={styles.brand}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>H</Text></View>
        <View>
          <Text style={[styles.brandName, { color: colors.text }]}>HabitAI</Text>
          <Text style={[styles.brandTagline, { color: colors.muted }]}>Small habits, big progress</Text>
        </View>
      </View>

      {onAdd && (
        <Pressable
          style={({ hovered }: HoverState) => [styles.addButton, hovered && styles.addButtonHovered]}
          onPress={onAdd}
          accessibilityRole="button"
          accessibilityLabel="Add a habit"
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Add habit</Text>
        </Pressable>
      )}

      <View style={styles.nav}>
        {items.map((item) => (
          <Pressable
            key={item.key}
            style={({ hovered }: HoverState) => [
              styles.navItem,
              item.focused ? { backgroundColor: colors.activeBackground } : hovered && { backgroundColor: colors.hoverBackground },
            ]}
            onPress={item.onPress}
            accessibilityRole={asTabs ? 'tab' : 'link'}
            accessibilityState={asTabs ? { selected: item.focused } : undefined}
            accessibilityLabel={item.label}
          >
            <Ionicons name={ICONS[item.name][item.focused ? 1 : 0]} size={20} color={item.focused ? colors.active : colors.muted} />
            <Text style={[styles.navLabel, { color: item.focused ? colors.active : colors.text }, item.focused && styles.navLabelActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        {footerLinks.map((link) => (
          <Pressable
            key={link.label}
            style={({ hovered }: HoverState) => [
              styles.navItem,
              link.focused ? { backgroundColor: colors.activeBackground } : hovered && { backgroundColor: colors.hoverBackground },
            ]}
            onPress={() => { if (!link.focused) router.push(link.href); }}
            accessibilityRole="link"
            accessibilityState={{ selected: link.focused }}
          >
            <Ionicons name={link.icon} size={20} color={link.focused ? colors.active : colors.muted} />
            <Text style={[styles.navLabel, { color: link.focused ? colors.active : colors.text }, link.focused && styles.navLabelActive]}>{link.label}</Text>
          </Pressable>
        ))}
        {firstName ? (
          <View style={styles.account}>
            <View style={[styles.accountAvatar, { backgroundColor: colors.activeBackground }]}><Text style={[styles.accountAvatarText, { color: colors.active }]}>{firstName.charAt(0).toUpperCase()}</Text></View>
            <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>{profile.fullName || firstName}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** The tab bar on laptops: one sidebar entry per tab. */
export function DesktopSidebar({ state, descriptors, navigation }: TabBarProps) {
  const open = (routeName: string, routeKey: string, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: routeKey, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(routeName);
  };
  const addRoute = state.routes.find((route) => route.name === 'add');
  const items = state.routes
    .map((route, index) => ({ route, focused: state.index === index }))
    .filter(({ route }) => route.name !== 'add' && ICONS[route.name])
    .map(({ route, focused }) => ({
      key: route.key,
      name: route.name,
      label: descriptors[route.key].options.title ?? route.name,
      focused,
      onPress: () => open(route.name, route.key, focused),
    }));

  return (
    <SidebarView
      asTabs
      items={items}
      onAdd={addRoute ? () => open(addRoute.name, addRoute.key, state.routes[state.index].key === addRoute.key) : undefined}
    />
  );
}

/**
 * The same sidebar beside pages outside the tabs, so laptop users keep their navigation there
 * too. Its links close the page and return to the tab instead of stacking more pages.
 */
export function PageSidebar({ current }: { current?: string }) {
  const { t } = useAppColorScheme();
  const labels: Record<string, string> = { index: t('home'), habits: t('habits'), goals: 'Goals', insights: t('insights'), profile: t('profile') };
  const items = Object.keys(ICONS).map((name) => ({
    key: name,
    name,
    label: labels[name],
    focused: false,
    onPress: () => router.dismissTo(TAB_HREFS[name]),
  }));
  return <SidebarView asTabs={false} items={items} current={current} onAdd={() => router.dismissTo('/(tabs)/add')} />;
}

const lightColors = { surface: '#FFFFFF', border: '#ECE9F3', text: '#24212D', muted: '#7A7D8A', active: '#4F2AC8', activeBackground: '#EFEBFF', hoverBackground: '#F6F4FB' };
const darkColors = { surface: '#17151F', border: '#2A2635', text: '#F2EFF8', muted: '#A7A0B5', active: '#B9A9FF', activeBackground: '#2A2440', hoverBackground: '#211E2B' };

const baseStyles = StyleSheet.create({
  sidebar: {
    width: DESKTOP_SIDEBAR_WIDTH,
    height: '100%',
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 16,
    borderRightWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, marginBottom: 24 },
  brandMark: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  brandName: { fontSize: 17, fontWeight: '800' },
  brandTagline: { fontSize: 11, fontWeight: '600', marginTop: 1 },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#5B42D8',
    marginBottom: 18,
  },
  addButtonHovered: { backgroundColor: '#4F2AC8' },
  addButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  nav: { gap: 4, flex: 1 },
  navItem: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, borderRadius: 12, paddingHorizontal: 12 },
  navLabel: { fontSize: 14, fontWeight: '600' },
  navLabelActive: { fontWeight: '800' },
  footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 4 },
  account: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingTop: 10 },
  accountAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#EFEBFF', alignItems: 'center', justifyContent: 'center' },
  accountAvatarText: { color: '#4F2AC8', fontSize: 13, fontWeight: '800' },
  accountName: { flex: 1, fontSize: 13, fontWeight: '700' },
});
