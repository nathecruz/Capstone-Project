import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FaqQuestion } from '@/components/faq-question';
import { SupportChatSheet, useSupportChat } from '@/components/support-chat';
import { faqCount, faqSections } from '@/constants/help-faq';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

// Web: the search field shows its own focus border instead of the browser's ring.
const WEB_NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
const ALL = 'All';

export default function HelpSupportFaqScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { width } = useWindowDimensions();
  const gutter = width < 360 ? 12 : 18;
  // Phones swipe through the topics; wide screens (mouse, no swipe) show them all.
  const wrapTopics = width >= 700;
  const support = useSupportChat();
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [topic, setTopic] = useState(ALL);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  const query = search.trim();
  const wanted = query.toLowerCase();
  const sections = faqSections
    .filter((section) => topic === ALL || section.title === topic)
    .map((section) => ({ ...section, items: section.items.filter((item) => !wanted || `${section.title} ${item.question} ${item.answer}`.toLowerCase().includes(wanted)) }))
    .filter((section) => section.items.length > 0);
  const shown = sections.reduce((total, section) => total + section.items.length, 0);
  const topicChips = [{ title: ALL, icon: 'apps-outline' }, ...faqSections].map((section) => {
    const active = topic === section.title;
    return (
      <Pressable key={section.title} style={({ pressed }) => [styles.topicChip, active && styles.topicChipActive, pressed && styles.pressed]} onPress={() => setTopic(section.title)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={section.title}>
        <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={15} color={active ? '#FFFFFF' : themeColor('#5B42D8')} />
        <Text style={[styles.topicText, active && styles.topicTextActive]}>{section.title}</Text>
      </Pressable>
    );
  });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.container, { paddingHorizontal: gutter }]}>
          <View style={styles.headerRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={21} color={themeColor('#292633')} />
            </Pressable>
            <Text style={styles.headerTitle}>FAQ</Text>
            <View style={styles.headerSpacer} />
          </View>

          <Text style={styles.title}>Frequently asked questions</Text>
          <Text style={styles.subtitle}>{faqCount} answers about habits, streaks, rewards and your account.</Text>

          <View style={[styles.searchBox, searchFocused && styles.searchBoxFocused]}>
            <Ionicons name="search-outline" size={18} color={themeColor('#8A8492')} />
            <TextInput
              value={search}
              onChangeText={setSearch}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => setSearchFocused(false)}
              placeholder="Search questions"
              placeholderTextColor={themeColor('#9A94A4')}
              style={[styles.searchInput, WEB_NO_RING]}
              returnKeyType="search"
              maxLength={60}
              accessibilityLabel="Search questions"
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={18} color={themeColor('#9A94A4')} />
              </Pressable>
            )}
          </View>

          {wrapTopics ? (
            <View style={[styles.topics, styles.topicsWrap]} accessibilityRole="radiogroup" accessibilityLabel="Topic">{topicChips}</View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.topics, { marginHorizontal: -gutter }]} contentContainerStyle={[styles.topicsContent, { paddingHorizontal: gutter }]} accessibilityRole="radiogroup" accessibilityLabel="Topic">
              {topicChips}
            </ScrollView>
          )}

          {query.length > 0 && (
            <Text style={styles.resultCount} accessibilityLiveRegion="polite">
              {shown ? `${shown} answer${shown === 1 ? '' : 's'} for "${query}"` : `No answers for "${query}"`}
            </Text>
          )}

          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHead}>
                <View style={[styles.sectionIcon, { backgroundColor: `${section.color}1F` }]}>
                  <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={17} color={section.color} />
                </View>
                <Text style={styles.sectionTitle}>{section.title}</Text>
                <Text style={styles.sectionCount}>{section.items.length}</Text>
              </View>
              <View style={styles.card}>
                {section.items.map((item, index) => (
                  <FaqQuestion key={item.question} item={item} divider={index > 0} open={openQuestion === item.question} onToggle={() => setOpenQuestion((current) => (current === item.question ? null : item.question))} />
                ))}
              </View>
            </View>
          ))}

          {shown === 0 && (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name="search" size={24} color={themeColor('#5B42D8')} />
              </View>
              <Text style={styles.emptyTitle}>No matching answers</Text>
              <Text style={styles.emptyText}>Try another word or topic, or ask HabitAI.</Text>
              <View style={styles.emptyActions}>
                <Pressable style={({ pressed }) => [styles.button, styles.rowButton, styles.buttonPrimary, pressed && styles.pressed]} onPress={() => support.open(query || undefined)} accessibilityRole="button">
                  <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                  <Text style={styles.buttonPrimaryText}>Ask HabitAI</Text>
                </Pressable>
                <Pressable style={({ pressed }) => [styles.button, styles.rowButton, styles.buttonSecondary, pressed && styles.pressed]} onPress={() => { setSearch(''); setTopic(ALL); }} accessibilityRole="button">
                  <Text style={styles.buttonSecondaryText}>Show all</Text>
                </Pressable>
              </View>
            </View>
          )}

          <View style={styles.moreHelp}>
            <Text style={styles.moreTitle}>Still need help?</Text>
            <Text style={styles.moreText}>Ask HabitAI for a quick answer, or tell the team what went wrong.</Text>
            <View style={styles.moreActions}>
              <Pressable style={({ pressed }) => [styles.button, styles.buttonPrimary, pressed && styles.pressed]} onPress={() => support.open()} accessibilityRole="button">
                <Ionicons name="sparkles" size={16} color="#FFFFFF" />
                <Text style={styles.buttonPrimaryText}>Ask HabitAI</Text>
              </Pressable>
              <Pressable style={({ pressed }) => [styles.button, styles.buttonSecondary, pressed && styles.pressed]} onPress={() => router.push('/report-issue')} accessibilityRole="button">
                <Ionicons name="warning-outline" size={16} color={themeColor('#5B42D8')} />
                <Text style={styles.buttonSecondaryText}>Report an issue</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>
      <SupportChatSheet support={support} />
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  content: { paddingBottom: 110 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, marginBottom: 16 },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#1F1C26' },
  pressed: { opacity: 0.75 },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '900', color: '#1F1C26', letterSpacing: -0.4 },
  subtitle: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#736D7D', marginTop: 4, marginBottom: 16 },
  searchBox: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, borderWidth: 2, borderColor: '#ECE8F4' },
  searchBoxFocused: { borderColor: '#8E7AE8' },
  searchInput: { flex: 1, height: '100%', fontSize: 16, color: '#2B2A33', fontWeight: '600', paddingVertical: 0 },
  topics: { flexGrow: 0, marginTop: 14 },
  topicsContent: { gap: 8 },
  topicsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  topicChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 13, borderRadius: 999, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E0FB' },
  topicChipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  topicText: { fontSize: 13, fontWeight: '800', color: '#4A4553' },
  topicTextActive: { color: '#FFFFFF' },
  resultCount: { fontSize: 14, fontWeight: '900', color: '#1F1C26', marginTop: 18 },
  section: { marginTop: 20 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  sectionIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { flex: 1, fontSize: 16, fontWeight: '900', color: '#1F1C26' },
  sectionCount: { fontSize: 12, fontWeight: '800', color: '#8F8998' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 4, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  empty: { alignItems: 'center', marginTop: 20, padding: 20, borderRadius: 22, backgroundColor: '#FFFFFF' },
  emptyIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1ECFF', marginBottom: 10 },
  emptyTitle: { fontSize: 16, fontWeight: '900', color: '#1F1C26' },
  emptyText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#736D7D', textAlign: 'center', marginTop: 4 },
  emptyActions: { flexDirection: 'row', gap: 10, marginTop: 14, alignSelf: 'stretch' },
  moreHelp: { marginTop: 24, padding: 18, borderRadius: 22, backgroundColor: '#F4F1FF', borderWidth: 1, borderColor: '#E6E0FB' },
  moreTitle: { fontSize: 16, fontWeight: '900', color: '#1F1C26' },
  moreText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#736D7D', marginTop: 4 },
  moreActions: { gap: 10, marginTop: 14 },
  rowButton: { flex: 1 },
  button: { minHeight: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 12 },
  buttonPrimary: { backgroundColor: '#5B42D8' },
  buttonPrimaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  buttonSecondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DED6FA' },
  buttonSecondaryText: { fontSize: 14, fontWeight: '900', color: '#5B42D8' },
}, {
  // Dark mode: cards a step above the screen.
  screen: { backgroundColor: '#111018' },
  backButton: { backgroundColor: '#221E2B' },
  searchBox: { backgroundColor: '#1D1A24', borderColor: '#2A2633' },
  searchBoxFocused: { borderColor: '#8E7AE8' },
  topicChip: { backgroundColor: '#1D1A24', borderColor: '#2A2633' },
  topicChipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  card: { backgroundColor: '#1D1A24' },
  empty: { backgroundColor: '#1D1A24' },
  emptyIcon: { backgroundColor: '#2B2540' },
  moreHelp: { backgroundColor: '#211C33', borderColor: '#352C52' },
  buttonSecondary: { backgroundColor: '#2B2540', borderColor: '#352C52' },
});
