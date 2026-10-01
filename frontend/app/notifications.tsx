import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPersistedNotifications, markPersistedNotification } from '@/authentication';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

type NotificationCategory = 'Reminders' | 'Achievements' | 'System';
type ScreenMode = 'list' | 'empty' | 'settings';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  time: string;
  category: NotificationCategory;
  section: 'Today' | 'Yesterday' | 'Earlier';
  unread?: boolean;
  readAt?: number | null;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
};

const tabs: NotificationCategory[] = ['Reminders', 'Achievements', 'System'];

const settingLabels = ['Notification Settings', 'Reminders', 'Achievements', 'System Updates', 'Quiet Hours'];

export default function NotificationsScreen() {
  const { isDarkMode, preferences, updatePreferences } = useAppColorScheme();
  const [activeTab, setActiveTab] = useState<NotificationCategory>('Reminders');
  const [screenMode, setScreenMode] = useState<ScreenMode>('list');
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [settings, setSettings] = useState<Record<string, boolean>>({
    'Notification Settings': preferences.notificationsEnabled,
    Reminders: true,
    Achievements: true,
    'System Updates': true,
    'Quiet Hours': false,
  });
  const [unreadOnly, setUnreadOnly] = useState(false);
  const isRefreshingRef = useRef(false);

  useEffect(() => {
    let active = true;

    const refreshNotifications = async () => {
      if (isRefreshingRef.current) return;
      isRefreshingRef.current = true;

      try {
        const items = await getPersistedNotifications();
        if (!active || !items) return;
        const mapped = items.map((item) => {
          const notification = item as { id: string; type: string; title: string; message: string; readAt?: number | null; createdAt: number };
          const category: NotificationCategory = notification.type.includes('achievement') ? 'Achievements' : notification.type.includes('system') ? 'System' : 'Reminders';
          return { id: notification.id, title: notification.title, message: notification.message, time: new Date(notification.createdAt).toLocaleString(), category, section: 'Today' as const, unread: !notification.readAt, readAt: notification.readAt, icon: (category === 'Achievements' ? 'checkmark-circle-outline' : category === 'System' ? 'information-circle-outline' : 'notifications-outline') as keyof typeof Ionicons.glyphMap, accent: category === 'Achievements' ? '#49A866' : '#6c8dff' };
        });
        setNotifications(mapped);
        setReadIds(mapped.filter((item) => item.readAt).map((item) => item.id));
      } finally {
        if (active) {
          isRefreshingRef.current = false;
        }
      }
    };

    void refreshNotifications();
    const poller = setInterval(() => {
      void refreshNotifications();
    }, 15000);

    return () => {
      active = false;
      isRefreshingRef.current = false;
      clearInterval(poller);
    };
  }, []);

  const filteredNotifications = useMemo(
    () => notifications.filter((item) => preferences.notificationsEnabled && settings['Notification Settings'] && settings[item.category] !== false && item.category === activeTab && (!unreadOnly || !readIds.includes(item.id))),
    [activeTab, notifications, preferences.notificationsEnabled, readIds, settings, unreadOnly],
  );

  const groupedNotifications = useMemo(() => {
    return filteredNotifications.reduce<Record<string, NotificationItem[]>>((groups, item) => {
      const key = item.section;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
      return groups;
    }, {});
  }, [filteredNotifications]);

  const handleBack = () => {
    if (screenMode === 'list') {
      router.back();
      return;
    }

    setScreenMode('list');
  };

  const markAsRead = (item: NotificationItem) => {
    setReadIds((current) => current.includes(item.id) ? current : [...current, item.id]);
    void markPersistedNotification(item.id, true);
    if (item.category !== 'System') router.push('/(tabs)/habits');
  };

  const unreadCount = notifications.filter((item) => !readIds.includes(item.id)).length;

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <View style={[styles.container, isDarkMode && styles.darkContainer]}>
        <View style={styles.header}>
          <Pressable onPress={handleBack} style={[styles.backButton, isDarkMode && styles.darkIconButton]} hitSlop={8}>
            <Ionicons name="arrow-back" size={22} color={isDarkMode ? '#F2EFF8' : '#1d1d24'} />
          </Pressable>

          <Text style={[styles.title, isDarkMode && styles.darkText]}>Notifications</Text>

          <Pressable onPress={() => setScreenMode('settings')} style={[styles.actionButton, isDarkMode && styles.darkIconButton]} hitSlop={8}>
            <Ionicons name="settings-outline" size={20} color={isDarkMode ? '#F2EFF8' : '#1d1d24'} />
          </Pressable>
        </View>

        {screenMode === 'settings' ? (
          <View style={styles.settingsPanel}>
            <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Notification Settings</Text>
            {settingLabels.map((label) => (
              <View key={label} style={[styles.settingRow, isDarkMode && styles.darkCard]}>
                <Text style={[styles.settingLabel, isDarkMode && styles.darkText]}>{label}</Text>
                <Switch
                  value={settings[label]}
                  onValueChange={(value) => {
                    setSettings((current) => ({ ...current, [label]: value }));
                    if (label === 'Notification Settings') updatePreferences({ notificationsEnabled: value });
                  }}
                  trackColor={{ false: '#d8d8e2', true: '#5b42d8' }}
                  thumbColor="#ffffff"
                />
              </View>
            ))}
          </View>
        ) : screenMode === 'empty' ? (
          <View style={styles.emptyStateWrap}>
            <View style={styles.emptyIconWrap}>
              <Ionicons name="notifications-off-outline" size={32} color="#8a7df8" />
            </View>
            <Text style={styles.emptyTitle}>All caught up!</Text>
            <Text style={styles.emptyText}>You have no notifications.</Text>
            <Pressable style={styles.emptyButton} onPress={() => setScreenMode('list')}>
              <Text style={styles.emptyButtonText}>Check back</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={[styles.tabsRow, isDarkMode && styles.darkTabsRow]}>
              {tabs.map((tab) => {
                const selected = tab === activeTab;
                return (
                  <Pressable
                    key={tab}
                    onPress={() => setActiveTab(tab)}
                    style={[styles.tab, selected && styles.tabActive]}
                  >
                    <Text style={[styles.tabText, selected && styles.tabTextActive]}>{tab}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View style={styles.filterBar}>
              <Text style={[styles.filterLabel, isDarkMode && styles.darkMutedText]}>Priority</Text>
              <Pressable style={[styles.filterButton, isDarkMode && styles.darkCard]} onPress={() => setUnreadOnly((current) => !current)}>
                <Ionicons name="filter-outline" size={16} color="#4a4a57" />
                <Text style={styles.filterButtonText}>{unreadOnly ? 'Unread' : 'All'}</Text>
              </Pressable>
            </View>

            <View style={[styles.summaryPanel, isDarkMode && styles.darkCard]}>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, isDarkMode && styles.darkText]}>{filteredNotifications.length}</Text>
                <Text style={[styles.summaryLabel, isDarkMode && styles.darkMutedText]}>Active</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, isDarkMode && styles.darkText]}>{unreadCount}</Text>
                <Text style={[styles.summaryLabel, isDarkMode && styles.darkMutedText]}>New</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={[styles.summaryValue, isDarkMode && styles.darkText]}>2h</Text>
                <Text style={[styles.summaryLabel, isDarkMode && styles.darkMutedText]}>Focus</Text>
              </View>
            </View>

            {filteredNotifications.length === 0 ? (
              <View style={styles.emptyStateWrapCompact}>
                <Ionicons name="notifications-off-outline" size={28} color="#8a7df8" />
                <Text style={styles.emptyTitleSmall}>No notifications</Text>
              </View>
            ) : (
              <ScrollView
                contentContainerStyle={styles.content}
                showsVerticalScrollIndicator={false}
                style={styles.scrollArea}
              >
                {Object.entries(groupedNotifications).map(([section, items]) => (
                  <View key={section} style={styles.sectionBlock}>
                    <Text style={[styles.sectionHeading, isDarkMode && styles.darkMutedText]}>{section}</Text>

                    {items.map((item) => (
                      <Pressable key={item.id} onPress={() => markAsRead(item)} style={[styles.card, isDarkMode && styles.darkCard, !readIds.includes(item.id) && styles.cardUnread]} accessibilityRole="button" accessibilityLabel={`Open ${item.title}`}>
                        <View style={[styles.iconWrap, { backgroundColor: `${item.accent}22` }]}>
                          <Ionicons name={item.icon} size={20} color={item.accent} />
                        </View>

                        <View style={styles.textWrap}>
                          <View style={styles.cardHeader}>
                            <Text style={[styles.cardTitle, isDarkMode && styles.darkText]}>{item.title}</Text>
                            <Text style={[styles.time, isDarkMode && styles.darkMutedText]}>{item.time}</Text>
                          </View>

                          <Text style={[styles.message, isDarkMode && styles.darkMutedText]}>{item.message}</Text>
                        </View>

                        {!readIds.includes(item.id) ? <View style={[styles.unreadDot, { backgroundColor: item.accent }]} /> : null}
                      </Pressable>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f3f2f8',
    paddingTop: 35,
  },
  darkScreen: { backgroundColor: '#111018' },
  container: {
    flex: 1,
    backgroundColor: '#f3f2f8',
  },
  darkContainer: { backgroundColor: '#111018' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 12,
  },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  // Light icons need a dark button in dark mode (they were white on white).
  darkIconButton: {
    backgroundColor: '#221F2C',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  actionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: '700',
    color: '#1d1d24',
  },
  tabsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 18,
    marginBottom: 14,
    padding: 6,
    borderRadius: 18,
    backgroundColor: '#eceaf5',
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  darkTabsRow: { backgroundColor: '#25213A' },
  tab: {
    flex: 1,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: '#5b42d8',
    shadowColor: '#5b42d8',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  tabText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4b4d59',
    letterSpacing: 0.2,
  },
  tabTextActive: {
    color: '#ffffff',
  },
  filterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingBottom: 10,
  },
  filterLabel: {
    fontSize: 13,
    color: '#4d5363',
    fontWeight: '600',
  },
  filterButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  filterButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#374151',
  },
  summaryPanel: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 18,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.03,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#1d1d24',
  },
  summaryLabel: {
    fontSize: 11,
    color: '#6b7280',
    marginTop: 3,
    fontWeight: '600',
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 8,
    paddingBottom: 36,
    gap: 12,
    flexGrow: 1,
  },
  scrollArea: {
    flex: 1,
  },
  sectionBlock: {
    gap: 10,
  },
  sectionHeading: {
    fontSize: 12,
    fontWeight: '700',
    color: '#70778a',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: 2,
    marginTop: 4,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 14,
    borderLeftWidth: 4,
    borderLeftColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  cardUnread: {
    shadowColor: '#5b42d8',
    shadowOpacity: 0.12,
    borderLeftColor: '#5b42d8',
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  textWrap: {
    flex: 1,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1d1d24',
    flexShrink: 1,
  },
  time: {
    fontSize: 11,
    color: '#7a7e8a',
    marginLeft: 10,
  },
  message: {
    fontSize: 13,
    lineHeight: 18,
    color: '#575f6d',
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 10,
    marginTop: 6,
  },
  settingsPanel: {
    paddingHorizontal: 18,
    paddingTop: 8,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d24',
    marginBottom: 18,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#ffffff',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 10,
  },
  darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  settingLabel: {
    fontSize: 15,
    color: '#1d1d24',
    fontWeight: '600',
  },
  emptyStateWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 30,
  },
  emptyIconWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: '#e9e4ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1d1d24',
    marginBottom: 8,
  },
  emptyText: {
    fontSize: 15,
    color: '#5f6677',
    marginBottom: 18,
  },
  emptyButton: {
    backgroundColor: '#5b42d8',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 10,
  },
  emptyButtonText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 14,
  },
  emptyStateWrapCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 30,
    gap: 8,
  },
  emptyTitleSmall: {
    fontSize: 15,
    fontWeight: '700',
    color: '#1d1d24',
  },
});

