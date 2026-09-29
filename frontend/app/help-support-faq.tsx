import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

const faqList = [
  {
    title: 'Getting Started',
    icon: 'rocket-outline',
    items: [
      { question: 'How do I create my first habit?', answer: 'Open the Add tab, enter a name, choose a target, and save your habit.' },
      { question: 'Can I customize reminder times?', answer: 'Open Settings & Preferences and choose Reminder Time.' },
      { question: 'What happens when I miss a day?', answer: 'Your completed history stays intact, but the active streak stops until you complete the habit again.' },
    ],
  },
  {
    title: 'Habits & Tracking',
    icon: 'checkbox-outline',
    items: [
      { question: 'How do I mark a habit as complete?', answer: 'Tap the check control on the Habits tab. Tap it again to undo today\'s completion.' },
      { question: 'Can I edit an existing habit?', answer: 'Open the habit from the Habits tab to update its reminder and target.' },
      { question: 'How do streaks work?', answer: 'A streak increases when you complete a habit for the current day.' },
    ],
  },
  {
    title: 'Account & Profile',
    icon: 'person-outline',
    items: [
      { question: 'How do I update my profile information?', answer: 'Open Profile, choose Personal Information, then tap Edit Profile.' },
      { question: 'Can I change my email address?', answer: 'Yes. Edit Personal Information and save the new email address.' },
      { question: 'How do I manage notifications?', answer: 'Open Notifications from your Profile settings and adjust your reminders.' },
    ],
  },
  {
    title: 'Goals & Rewards',
    icon: 'trophy-outline',
    items: [
      { question: 'How do I earn points and badges?', answer: 'Complete habits consistently to earn points and unlock achievements.' },
      { question: 'Can I set multiple goals?', answer: 'Yes. Use Set New Goal as often as needed.' },
      { question: 'How are levels calculated?', answer: 'Levels are based on your total points and completed habits.' },
    ],
  },
  {
    title: 'Privacy & Data',
    icon: 'shield-checkmark-outline',
    items: [
      { question: 'Are my habits stored securely?', answer: 'Your habits, progress, points, tokens, and preferences are stored on this device and synced to your account when you are signed in.' },
      { question: 'Can I export my data?', answer: 'Use Export My Data in Settings & Preferences to view your current profile summary.' },
      { question: 'How do I delete my account data?', answer: 'Use Clear Local Data in Settings & Preferences to reset the app on this device.' },
    ],
  },
];

export default function HelpSupportFaqScreen() {
  const { isDarkMode } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const [search, setSearch] = useState('');
  const [openSection, setOpenSection] = useState<string>('Getting Started');
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);

  const filteredFaq = faqList.filter((section) => {
    const query = search.trim().toLowerCase();
    if (!query) return true;

    return (
      section.title.toLowerCase().includes(query) ||
      section.items.some((item) => item.question.toLowerCase().includes(query) || item.answer.toLowerCase().includes(query))
    );
  });

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 20 }]}>
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={22} color="#1F1F29" />
            </Pressable>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>FAQ</Text>
            <View style={styles.headerAction}>
              <Ionicons name="help-circle" size={20} color="#5B42D8" />
            </View>
          </View>

          <View style={styles.heroBlock}>
            <Text style={[styles.heroTitle, isDarkMode && styles.darkText]}>Frequently Asked</Text>
            <Text style={styles.heroTitleAccent}>Questions</Text>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#8A8492" />
              <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search question..."
              placeholderTextColor="#9A94A4"
              style={[styles.searchInput, isDarkMode && styles.darkText]}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={17} color="#9A94A4" />
              </Pressable>
            )}
          </View>

          <View style={styles.faqList}>
            {filteredFaq.map((section) => {
              const isOpen = openSection === section.title;
              return (
                <View key={section.title} style={[styles.faqCard, isDarkMode && styles.darkCard]}>
                  <Pressable style={styles.faqHeader} onPress={() => setOpenSection(isOpen ? '' : section.title)}>
                    <View style={styles.faqIconWrap}>
                      <Ionicons name={section.icon as keyof typeof Ionicons.glyphMap} size={18} color="#5B42D8" />
                    </View>

                    <Text style={[styles.faqTitle, isDarkMode && styles.darkText]}>{section.title}</Text>

                    <View style={styles.toggleWrap}>
                      <Ionicons name={isOpen ? 'remove' : 'add'} size={18} color="#2A2A33" />
                    </View>
                  </Pressable>

                  {isOpen && (
                    <View style={styles.answerList}>
                      {section.items.map((item) => (
                        <Pressable key={item.question} style={styles.answerRow} onPress={() => setOpenQuestion(openQuestion === item.question ? null : item.question)}>
                          <Ionicons name="checkmark-circle" size={14} color="#6A4AE4" />
                          <View style={styles.answerCopy}><Text style={[styles.answerText, isDarkMode && styles.darkMutedText]}>{item.question}</Text>{openQuestion === item.question && <Text style={[styles.answerDetail, isDarkMode && styles.darkMutedText]}>{item.answer}</Text>}</View>
                          <Ionicons name={openQuestion === item.question ? 'chevron-up' : 'chevron-down'} size={15} color="#8A8492" />
                        </Pressable>
                      ))}
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F3F2F7',
    paddingTop: 16,
  },
  darkScreen: { backgroundColor: '#111018' },
  darkText: { color: '#F2EFF8' },
  darkMutedText: { color: '#AAA4B7' },
  darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  content: {
    paddingBottom: 100,
  },
  container: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  backButton: {
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#24212D',
  },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F3EEFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroBlock: {
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#1F1D2B',
    lineHeight: 34,
  },
  heroTitleAccent: {
    fontSize: 28,
    fontWeight: '800',
    color: '#5B42D8',
    lineHeight: 34,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 48,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E9E5F3',
    paddingHorizontal: 14,
    marginBottom: 18,
  },
  searchInput: {
    flex: 1,
    marginLeft: 9,
    fontSize: 12,
    color: '#2B2A33',
    fontWeight: '600',
    paddingVertical: 0,
  },
  faqList: {
    gap: 12,
  },
  faqCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EEEAF7',
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  faqIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F3EEFF',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  faqTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: '#272633',
  },
  toggleWrap: {
    width: 30,
    height: 30,
    borderRadius: 10,
    backgroundColor: '#F6F4FB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  answerList: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    gap: 10,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  answerCopy: { flex: 1 },
  answerText: {
    fontSize: 12,
    color: '#5F5A69',
    lineHeight: 18,
    fontWeight: '600',
  },
  answerDetail: { fontSize: 11, color: '#827C8C', lineHeight: 17, marginTop: 4 },
});

