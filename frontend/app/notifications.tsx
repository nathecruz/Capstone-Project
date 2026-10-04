// Notifications from the server (badges earned, reminders, system news), by type and by day.
// It opens on a tab with something new; the settings choose which types show (saved with the
// student's preferences).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getPersistedNotifications, markPersistedNotification } from '@/authentication';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { onLive } from '@/utils/live-events';
import { sectionFor, timeLabel, type Section } from '@/utils/notification-time';

type NotificationCategory = 'Reminders' | 'Achievements' | 'System';

type NotificationItem = {
  id: string;
  title: string;
  message: string;
  createdAt: number;
  category: NotificationCategory;
  icon: keyof typeof Ionicons.glyphMap;
  accent: string;
};

const TABS: NotificationCategory[] = ['Reminders', 'Achievements', 'System'];
/** Short tab names, so a tab still fits beside its count of new items. */
const TAB_LABEL: Record<NotificationCategory, string> = { Reminders: 'Reminders', Achievements: 'Badges', System: 'System' };
const TYPE_INFO: Record<NotificationCategory, { icon: keyof typeof Ionicons.glyphMap; accent: string; empty: string; setting: string }> = {
  Reminders: { icon: 'alarm-outline', accent: '#5B42D8', empty: 'Habit reminders you get will show here.', setting: 'Habit reminders' },
  Achievements: { icon: 'ribbon-outline', accent: '#2E9D5C', empty: 'Badges and streak milestones will show here.', setting: 'Badges and milestones' },
  System: { icon: 'information-circle-outline', accent: '#2F86D8', empty: 'News about HabitAI will show here.', setting: 'News and updates' },
};

// React Native Web colours the thumb of an "on" switch with activeThumbColor (teal by default).
const WEB_THUMB = { activeThumbColor: '#FFFFFF' } as object;

export default function NotificationsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { preferences, updatePreferences } = useAppColorScheme();
  const [chosenTab, setChosenTab] = useState<NotificationCategory | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [readIds, setReadIds] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const isRefreshingRef = useRef(false);
  const hidden = useMemo(() => new Set(preferences.hiddenNotificationTypes ?? []), [preferences.hiddenNotificationTypes]);
  const enabled = preferences.notificationsEnabled;

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
          return { id: notification.id, title: notification.title, message: notification.message, createdAt: notification.createdAt, category, icon: TYPE_INFO[category].icon, accent: TYPE_INFO[category].accent, readAt: notification.readAt };
        }).sort((left, right) => right.createdAt - left.createdAt);
        setNotifications(mapped);
        setReadIds((current) => [...new Set([...current, ...mapped.filter((item) => item.readAt).map((item) => item.id)])]);
        setNow(Date.now());
      } finally {
        if (active) {
          isRefreshingRef.current = false;
          setLoaded(true);
        }
      }
    };
    void refreshNotifications();
    // New ones arrive with the live pulse; the slow poll is a fallback.
    const unsubscribe = onLive('notifications', () => void refreshNotifications());
    const poller = setInterval(() => void refreshNotifications(), 60000);
    return () => {
      active = false;
      isRefreshingRef.current = false;
      unsubscribe();
      clearInterval(poller);
    };
  }, []);

  const visible = notifications.filter((item) => enabled && !hidden.has(item.category));
  const unread = visible.filter((item) => !readIds.includes(item.id));
  const unreadIn = (tab: NotificationCategory) => unread.filter((item) => item.category === tab).length;
  // Until the student picks a tab, show the first one with something new.
  const activeTab = chosenTab ?? TABS.find((tab) => unreadIn(tab) > 0) ?? 'Reminders';
  const shown = visible.filter((item) => item.category === activeTab && (!unreadOnly || !readIds.includes(item.id)));
  const sections = (['Today', 'Yesterday', 'Earlier'] as Section[])
    .map((section) => ({ section, items: shown.filter((item) => sectionFor(item.createdAt, now) === section) }))
    .filter((group) => group.items.length > 0);

  const markAsRead = (item: NotificationItem) => {
    if (!readIds.includes(item.id)) {
      setReadIds((current) => [...current, item.id]);
      void markPersistedNotification(item.id, true);
    }
    if (item.category === 'Reminders') router.push('/(tabs)/habits');
    if (item.category === 'Achievements') router.push('/achievements');
  };
  const markAllRead = () => {
    const ids = unread.filter((item) => item.category === activeTab).map((item) => item.id);
    setReadIds((current) => [...current, ...ids]);
    ids.forEach((id) => void markPersistedNotification(id, true));
  };
  const toggleType = (tab: NotificationCategory, on: boolean) => {
    const next = new Set(hidden);
    if (on) next.delete(tab);
    else next.add(tab);
    updatePreferences({ hiddenNotificationTypes: [...next] });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={() => (showSettings ? setShowSettings(false) : router.back())} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={showSettings ? 'Back to notifications' : 'Go back'} hitSlop={6}>
          <Ionicons name="arrow-back" size={22} color={themeColor('#1F1C26')} />
        </Pressable>
        <Text style={styles.title}>{showSettings ? 'Notification settings' : 'Notifications'}</Text>
        {showSettings ? <View style={styles.iconSpacer} /> : (
          <Pressable onPress={() => setShowSettings(true)} style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel="Notification settings" hitSlop={6}>
            <Ionicons name="settings-outline" size={20} color={themeColor('#1F1C26')} />
          </Pressable>
        )}
      </View>

      {showSettings ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.settingsCard}>
            <View style={styles.settingRow}>
              <View style={styles.settingCopy}>
                <Text style={styles.settingLabel}>Show notifications</Text>
                <Text style={styles.settingHint}>Turns reminders and alerts on or off for this account.</Text>
              </View>
              <Switch value={enabled} onValueChange={(value) => updatePreferences({ notificationsEnabled: value })} trackColor={{ false: '#D8D8E2', true: themeColor('#5B42D8', 'backgroundColor') }} thumbColor="#FFFFFF" {...WEB_THUMB} accessibilityLabel="Show notifications" />
            </View>
            {TABS.map((tab) => (
              <View key={tab} style={[styles.settingRow, styles.settingBorder, !enabled && styles.settingOff]}>
                <View style={[styles.settingIcon, { backgroundColor: `${TYPE_INFO[tab].accent}1F` }]}>
                  <Ionicons name={TYPE_INFO[tab].icon} size={18} color={themeColor(TYPE_INFO[tab].accent)} />
                </View>
                <View style={styles.settingCopy}>
                  <Text style={styles.settingLabel}>{TYPE_INFO[tab].setting}</Text>
                  <Text style={styles.settingHint}>{TAB_LABEL[tab]} tab</Text>
                </View>
                <Switch value={enabled && !hidden.has(tab)} disabled={!enabled} onValueChange={(value) => toggleType(tab, value)} trackColor={{ false: '#D8D8E2', true: themeColor('#5B42D8', 'backgroundColor') }} thumbColor="#FFFFFF" {...WEB_THUMB} accessibilityLabel={TYPE_INFO[tab].setting} />
              </View>
            ))}
          </View>
          <Text style={styles.footnote}>Reminder times and sounds are set on each habit and in Settings.</Text>
        </ScrollView>
      ) : (
        <>
          <View style={styles.tabsRow} accessibilityRole="tablist">
            {TABS.map((tab) => {
              const selected = tab === activeTab;
              const count = unreadIn(tab);
              return (
                <Pressable key={tab} onPress={() => setChosenTab(tab)} style={[styles.tab, selected && styles.tabActive]} accessibilityRole="tab" accessibilityState={{ selected }} accessibilityLabel={count ? `${TAB_LABEL[tab]}, ${count} new` : TAB_LABEL[tab]}>
                  <Text style={[styles.tabText, selected && styles.tabTextActive]} numberOfLines={1}>{TAB_LABEL[tab]}</Text>
                  {count > 0 && <View style={[styles.tabBadge, selected && styles.tabBadgeActive]}><Text style={[styles.tabBadgeText, selected && styles.tabBadgeTextActive]}>{count}</Text></View>}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.toolbar}>
            <Pressable style={({ pressed }) => [styles.chip, unreadOnly && styles.chipOn, pressed && styles.pressed]} onPress={() => setUnreadOnly((current) => !current)} accessibilityRole="switch" accessibilityState={{ checked: unreadOnly }} accessibilityLabel="Show only unread">
              <Ionicons name={unreadOnly ? 'mail-unread' : 'mail-unread-outline'} size={16} color={unreadOnly ? '#FFFFFF' : themeColor('#5B42D8')} />
              <Text style={[styles.chipText, unreadOnly && styles.chipTextOn]}>Unread only</Text>
            </Pressable>
            {unreadIn(activeTab) > 0 && (
              <Pressable style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]} onPress={markAllRead} accessibilityRole="button">
                <Ionicons name="checkmark-done" size={16} color={themeColor('#5B42D8')} />
                <Text style={styles.linkText}>Mark all read</Text>
              </Pressable>
            )}
          </View>

          {!enabled ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name="notifications-off-outline" size={30} color={themeColor('#5B42D8')} /></View>
              <Text style={styles.emptyTitle}>Notifications are off</Text>
              <Text style={styles.emptyText}>Turn them on to see reminders and badges here.</Text>
              <Pressable style={({ pressed }) => [styles.emptyButton, pressed && styles.pressed]} onPress={() => updatePreferences({ notificationsEnabled: true })} accessibilityRole="button">
                <Text style={styles.emptyButtonText}>Turn on</Text>
              </Pressable>
            </View>
          ) : sections.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}><Ionicons name={TYPE_INFO[activeTab].icon} size={30} color={themeColor('#5B42D8')} /></View>
              <Text style={styles.emptyTitle}>{!loaded ? 'Loading…' : unreadOnly ? 'All caught up' : `No ${TAB_LABEL[activeTab].toLowerCase()} yet`}</Text>
              {loaded && <Text style={styles.emptyText}>{unreadOnly ? 'You have read everything here.' : TYPE_INFO[activeTab].empty}</Text>}
            </View>
          ) : (
            <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
              {sections.map(({ section, items }) => (
                <View key={section} style={styles.sectionBlock}>
                  <Text style={styles.sectionHeading}>{section}</Text>
                  {items.map((item) => {
                    const isUnread = !readIds.includes(item.id);
                    return (
                      <Pressable key={item.id} onPress={() => markAsRead(item)} style={({ pressed }) => [styles.card, isUnread && styles.cardUnread, pressed && styles.pressed]} accessibilityRole="button" accessibilityLabel={`${isUnread ? 'New: ' : ''}${item.title}. ${item.message}`}>
                        <View style={[styles.cardIcon, { backgroundColor: `${item.accent}1F` }]}>
                          <Ionicons name={item.icon} size={20} color={themeColor(item.accent)} />
                        </View>
                        <View style={styles.cardCopy}>
                          <View style={styles.cardHeader}>
                            <Text style={styles.cardTitle} numberOfLines={2}>{item.title}</Text>
                            <Text style={styles.time}>{timeLabel(item.createdAt, now)}</Text>
                          </View>
                          <Text style={styles.message}>{item.message}</Text>
                        </View>
                        {isUnread && <View style={[styles.unreadDot, { backgroundColor: themeColor(item.accent, 'backgroundColor') }]} />}
                      </Pressable>
                    );
                  })}
                </View>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  pressed: { opacity: 0.85 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 12 },
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  iconSpacer: { width: 44, height: 44 },
  title: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '900', color: '#1F1C26' },
  tabsRow: { flexDirection: 'row', gap: 4, marginHorizontal: 18, marginBottom: 12, padding: 5, borderRadius: 18, backgroundColor: '#ECEAF5' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 42, borderRadius: 14, paddingHorizontal: 4 },
  tabActive: { backgroundColor: '#5B42D8' },
  tabText: { flexShrink: 1, fontSize: 13, fontWeight: '800', color: '#4B4D59' },
  tabTextActive: { color: '#FFFFFF' },
  tabBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  tabBadgeActive: { backgroundColor: '#FFFFFF' },
  tabBadgeText: { fontSize: 11, fontWeight: '900', color: '#FFFFFF' },
  tabBadgeTextActive: { color: '#5B42D8' },
  toolbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 18, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4DDF4' },
  chipOn: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  chipText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  chipTextOn: { color: '#FFFFFF' },
  linkButton: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 40, paddingHorizontal: 6 },
  linkText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  content: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 36, gap: 14, flexGrow: 1 },
  sectionBlock: { gap: 10 },
  sectionHeading: { fontSize: 12, fontWeight: '800', color: '#70778A', letterSpacing: 0.6, textTransform: 'uppercase', paddingHorizontal: 2 },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#EFEDF5' },
  cardUnread: { backgroundColor: '#F8F6FF', borderColor: '#D9D0FB' },
  cardIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  cardCopy: { flex: 1, minWidth: 0 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 3 },
  cardTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#1F1C26' },
  time: { fontSize: 12, fontWeight: '600', color: '#7A7E8A' },
  message: { fontSize: 13, lineHeight: 19, color: '#575F6D' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, marginTop: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 60, gap: 6 },
  emptyIcon: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#EEE9FF', alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '900', color: '#1F1C26', textAlign: 'center' },
  emptyText: { fontSize: 14, lineHeight: 20, color: '#6A6573', textAlign: 'center' },
  emptyButton: { marginTop: 10, minHeight: 44, paddingHorizontal: 20, borderRadius: 14, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  emptyButtonText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  settingsCard: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 16 },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  settingBorder: { borderTopWidth: 1, borderTopColor: '#F0EEF4' },
  settingOff: { opacity: 0.5 },
  settingIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1 },
  settingLabel: { fontSize: 15, fontWeight: '800', color: '#1F1C26' },
  settingHint: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#7A7E8A' },
  footnote: { fontSize: 12, lineHeight: 17, color: '#7A7E8A', textAlign: 'center', paddingHorizontal: 12 },
}, {
  iconButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#221F2C', alignItems: 'center', justifyContent: 'center', shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#302B3B' },
  card: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, backgroundColor: '#1D1A24', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#2C2935' },
  cardUnread: { backgroundColor: '#241F33', borderColor: '#3D3360' },
});
