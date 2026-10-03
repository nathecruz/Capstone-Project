import { Ionicons } from '@expo/vector-icons';
import * as SystemUI from 'expo-system-ui';
import { Tabs } from 'expo-router';
import React, { useEffect } from 'react';
import { StatusBar, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DesktopSidebar } from '@/components/desktop-sidebar';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { themedColor, useAppThemeSheet } from '@/hooks/use-themed-styles';
import { CONTENT_MAX_WIDTH, pageBackground, useResponsiveLayout } from '@/hooks/use-responsive-layout';

export default function TabLayout() {
  const { isDarkMode, t } = useAppColorScheme();
  const styles = useAppThemeSheet(baseStyles);
  // Light on the dark tab bar, so the selected tab stands out there too.
  const accent = themedColor(isDarkMode ? '#B9A9FF' : '#4F2AC8', useAppTheme());
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isDesktop, isCentered } = useResponsiveLayout();
  const compact = width < 370;
  const background = pageBackground(isDarkMode);
  // Wider than a phone, screens are centered at a readable width instead of stretched.
  const centered = isCentered ? { width: '100%' as const, maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center' as const, backgroundColor: background } : undefined;
  const tabBarHeight = compact ? 74 : 78;
  const systemBarColor = isDarkMode ? '#111018' : '#F3F2F8';

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(systemBarColor);
  }, [isDarkMode, systemBarColor]);

  return (
    <>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} backgroundColor={systemBarColor} />
      <View style={[styles.root, { backgroundColor: background }]}>
      <Tabs
        // Laptops and desktops get a labelled sidebar instead of the phone tab bar.
        tabBar={isDesktop ? (props) => <DesktopSidebar {...props} /> : undefined}
        screenOptions={{
          headerShown: false,
          tabBarPosition: isDesktop ? 'left' : 'bottom',
          sceneStyle: centered,
          tabBarShowLabel: false,
          tabBarHideOnKeyboard: true,
          tabBarStyle: [
            styles.tabBar,
            {
              backgroundColor: isDarkMode ? '#1D1A24' : '#FFFFFF',
              height: tabBarHeight + insets.bottom,
              paddingBottom: insets.bottom + 10,
            },
            centered,
          ],
          tabBarActiveTintColor: accent,
          tabBarInactiveTintColor: isDarkMode ? '#B6B0C3' : '#7A7D8A',
          tabBarItemStyle: styles.item,
        }}>
      <Tabs.Screen
        name="index"
        options={{
          title: t('home'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="habits"
        options={{
          title: t('habits'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'list' : 'list-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="goals"
        options={{
          title: 'Goals',
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'flag' : 'flag-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="add"
        options={{
          title: t('add'),
          tabBarIcon: () => (
            <View style={styles.addButtonWrap}>
              <Ionicons name="add" size={28} color="#FFFFFF" />
            </View>
          ),
          tabBarLabelStyle: { fontSize: 10, color: accent, marginTop: 2 },
        }}
      />
      <Tabs.Screen
        name="insights"
        options={{
          title: t('insights'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'bar-chart' : 'bar-chart-outline'} size={22} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('profile'),
          tabBarIcon: ({ color, focused }) => (
            <Ionicons name={focused ? 'person' : 'person-outline'} size={22} color={color} />
          ),
        }}
      />
      </Tabs>
      </View>
    </>
  );
}

const baseStyles = StyleSheet.create({
  root: {
    flex: 1,
  },
  tabBar: {
    height: 78,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E7E5EC',
    paddingTop: 10,
    paddingBottom: 10,
    paddingHorizontal: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 10,
  },
  item: {
    paddingVertical: 2,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
    marginTop: 4,
  },
  addButtonWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#5B42D8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    shadowColor: '#5B42D8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
});
