// Sidebar navigation for laptops and desktops (web, >= 1024px wide). It replaces the phone
// bottom tab bar there; the routes, labels and order are the same tabs.
import { Ionicons } from '@expo/vector-icons';
import { router, type Tabs } from 'expo-router';
import React from 'react';
import { Pressable, type PressableStateCallbackType, StyleSheet, Text, View } from 'react-native';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

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

export const DESKTOP_SIDEBAR_WIDTH = 248;

export function DesktopSidebar({ state, descriptors, navigation }: TabBarProps) {
  const { isDarkMode, profile } = useAppColorScheme();
  const colors = isDarkMode ? darkColors : lightColors;
  const firstName = profile.firstName || profile.fullName.split(' ')[0] || '';

  const open = (routeName: string, routeKey: string, focused: boolean) => {
    const event = navigation.emit({ type: 'tabPress', target: routeKey, canPreventDefault: true });
    if (!focused && !event.defaultPrevented) navigation.navigate(routeName);
  };
  const addRoute = state.routes.find((route) => route.name === 'add');

  return (
    <View style={[styles.sidebar, { backgroundColor: colors.surface, borderRightColor: colors.border }]} accessibilityRole="tablist">
      <View style={styles.brand}>
        <View style={styles.brandMark}><Text style={styles.brandMarkText}>H</Text></View>
        <View>
          <Text style={[styles.brandName, { color: colors.text }]}>HabitAI</Text>
          <Text style={[styles.brandTagline, { color: colors.muted }]}>Small habits, big progress</Text>
        </View>
      </View>

      {addRoute && (
        <Pressable
          style={({ hovered }: HoverState) => [styles.addButton, hovered && styles.addButtonHovered]}
          onPress={() => open(addRoute.name, addRoute.key, state.routes[state.index].key === addRoute.key)}
          accessibilityRole="button"
          accessibilityLabel="Add a habit"
        >
          <Ionicons name="add" size={20} color="#FFFFFF" />
          <Text style={styles.addButtonText}>Add habit</Text>
        </Pressable>
      )}

      <View style={styles.nav}>
        {state.routes.map((route, index) => {
          if (route.name === 'add' || !ICONS[route.name]) return null;
          const focused = state.index === index;
          const label = descriptors[route.key].options.title ?? route.name;
          return (
            <Pressable
              key={route.key}
              style={({ hovered }: HoverState) => [
                styles.navItem,
                focused ? { backgroundColor: colors.activeBackground } : hovered && { backgroundColor: colors.hoverBackground },
              ]}
              onPress={() => open(route.name, route.key, focused)}
              accessibilityRole="tab"
              accessibilityState={{ selected: focused }}
              accessibilityLabel={label}
            >
              <Ionicons name={ICONS[route.name][focused ? 1 : 0]} size={20} color={focused ? colors.active : colors.muted} />
              <Text style={[styles.navLabel, { color: focused ? colors.active : colors.text }, focused && styles.navLabelActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.footer, { borderTopColor: colors.border }]}>
        <Pressable
          style={({ hovered }: HoverState) => [styles.navItem, hovered && { backgroundColor: colors.hoverBackground }]}
          onPress={() => router.push('/settings-preferences')}
          accessibilityRole="button"
        >
          <Ionicons name="options-outline" size={20} color={colors.muted} />
          <Text style={[styles.navLabel, { color: colors.text }]}>Settings</Text>
        </Pressable>
        <Pressable
          style={({ hovered }: HoverState) => [styles.navItem, hovered && { backgroundColor: colors.hoverBackground }]}
          onPress={() => router.push('/help-support')}
          accessibilityRole="button"
        >
          <Ionicons name="help-circle-outline" size={20} color={colors.muted} />
          <Text style={[styles.navLabel, { color: colors.text }]}>Help &amp; Support</Text>
        </Pressable>
        {firstName ? (
          <View style={styles.account}>
            <View style={styles.accountAvatar}><Text style={styles.accountAvatarText}>{firstName.charAt(0).toUpperCase()}</Text></View>
            <Text style={[styles.accountName, { color: colors.text }]} numberOfLines={1}>{profile.fullName || firstName}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const lightColors = { surface: '#FFFFFF', border: '#ECE9F3', text: '#24212D', muted: '#7A7D8A', active: '#4F2AC8', activeBackground: '#EFEBFF', hoverBackground: '#F6F4FB' };
const darkColors = { surface: '#17151F', border: '#2A2635', text: '#F2EFF8', muted: '#A7A0B5', active: '#B9A9FF', activeBackground: '#2A2440', hoverBackground: '#211E2B' };

const styles = StyleSheet.create({
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
