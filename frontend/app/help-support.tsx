import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { submitFeatureSuggestion } from '@/authentication';
import { askAi } from '@/utils/ai-client';
import { useAppDialog } from '@/components/ui/app-dialog';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { openExternalLink } from '@/utils/platform';

const assistantSuggestions = [
  { label: 'How do I add a new habit?', icon: 'add' },
  { label: "Why isn't my streak updating?", icon: 'flame-outline' },
  { label: 'How do I earn more points?', icon: 'star-outline' },
];

const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || '';

export default function HelpSupportScreen() {
  const { isDarkMode } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const showAlert = useAppDialog();
  const helpItems = [
    { title: 'FAQ', subtitle: 'Find answers to common questions', icon: 'help-circle-outline', action: () => router.push('/help-support-faq') },
    // Uses the real support inbox when configured; otherwise the in-app report form (which reaches the Admin Panel).
    { title: 'Contact Support', subtitle: 'Get in touch with our team', icon: 'chatbubble-ellipses-outline', action: () => (supportEmail ? void openExternalLink(`mailto:${supportEmail}`) : router.push('/report-issue')) },
    { title: 'Report an Issue', subtitle: 'Help us improve the app', icon: 'warning-outline', action: () => router.push('/report-issue') },
    { title: 'Suggest a Feature', subtitle: 'We would love to hear your idea.', icon: 'sparkles-outline', action: () => setSuggestionOpen(true) },
  ];
  const [search, setSearch] = useState('');
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantQuestion, setAssistantQuestion] = useState('');
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const answerAssistant = async () => {
    const question = assistantQuestion.trim().toLowerCase();
    if (!question) return;
    const localAnswer = question.includes('streak')
      ? 'Complete the habit for today. Your streak updates when the current date is recorded.'
      : question.includes('point')
        ? 'You earn points when you complete habits. Check Leaderboards to see your current total.'
        : question.includes('add') || question.includes('habit')
          ? 'Open the Add tab, enter a habit name, choose a target, and save it.'
          : 'Try the FAQ for common answers, or contact support for account-specific help.';
    // The support mode answers from the app guide on the server; the local answer covers offline use.
    const result = await askAi('support', assistantQuestion);
    showAlert('AI Assistant', result.ok ? result.answer : localAnswer);
    setAssistantQuestion('');
  };
  const filteredItems = helpItems.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 20 }]}>
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={21} color="#292633" />
            </Pressable>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>Help &amp; Support</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.helpBanner}>
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerEyebrow}>HABITAI SUPPORT</Text>
              <Text style={styles.bannerTitle}>We&apos;re here to help!</Text>
              <Text style={styles.bannerText}>Find answers and get support whenever you need.</Text>
              <View style={styles.availability}>
                <View style={styles.availabilityDot} />
                <Text style={styles.availabilityText}>Usually replies in a few minutes</Text>
              </View>
            </View>
            <View style={styles.supportAvatar}>
              <Ionicons name="person" size={29} color="#5B42D8" />
              <View style={styles.avatarSpark}>
                <Ionicons name="sparkles" size={9} color="#E7A72F" />
              </View>
            </View>
          </View>

          <View style={styles.searchBox}>
            <Ionicons name="search-outline" size={18} color="#8A8492" />
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search for help..."
              placeholderTextColor="#9A94A4"
              style={styles.searchInput}
            />
            {search.length > 0 && (
              <Pressable onPress={() => setSearch('')} accessibilityLabel="Clear search">
                <Ionicons name="close-circle" size={17} color="#9A94A4" />
              </Pressable>
            )}
          </View>

          <Text style={styles.sectionLabel}>Quick Actions</Text>
          <View style={styles.quickGrid}>
            {filteredItems.map((item) => {
              const isFaq = item.title === 'FAQ';
              return (
                <Pressable
                  key={item.title}
                  style={[styles.quickCard, isFaq && styles.faqQuickCard]}
                  onPress={item.action}
                >
                  <View style={[styles.optionIcon, isFaq && styles.faqOptionIcon]}>
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={isFaq ? 20 : 19} color="#5B42D8" />
                  </View>
                  <Text style={[styles.optionTitle, isFaq && styles.faqOptionTitle]}>{item.title}</Text>
                  <Text style={[styles.optionSubtitle, isFaq && styles.faqOptionSubtitle]}>{item.subtitle}</Text>
                  <View style={[styles.quickArrowWrap, isFaq && styles.faqArrowWrap]}>
                    <Ionicons name="arrow-forward" size={isFaq ? 20 : 15} color={isFaq ? '#5B42D8' : '#A19CAA'} />
                  </View>
                </Pressable>
              );
            })}
          </View>

          {filteredItems.length === 0 && <Text style={styles.emptyText}>No help topics found.</Text>}

          <View style={styles.immediateCard}>
            <View style={styles.immediateHeader}>
              <View style={styles.immediateIcon}>
                <Ionicons name="chatbubbles-outline" size={25} color="#FFFFFF" />
              </View>
              <View style={styles.immediateCopy}>
                <Text style={styles.immediateTitle}>Need immediate help?</Text>
                <Text style={styles.immediateText}>Chat with our AI Assistant for quick answers.</Text>
              </View>
              <Pressable
                style={styles.chatButton}
                onPress={() => setAssistantOpen((open) => !open)}
                accessibilityLabel={assistantOpen ? 'Close AI assistant' : 'Open AI assistant'}
              >
                <Ionicons name={assistantOpen ? 'chevron-up' : 'chevron-down'} size={19} color="#FFFFFF" />
              </Pressable>
            </View>

            {assistantOpen && (
              <View style={styles.assistantPanel}>
                <Text style={styles.assistantGreeting}>Hi there!</Text>
                <Text style={styles.assistantMessage}>I&apos;m your AI Assistant. Ask me anything about{`\n`}HabitAI and I&apos;ll do my best to help!</Text>
                <View style={styles.suggestionList}>
                  {assistantSuggestions.map((suggestion) => (
                    <Pressable key={suggestion.label} style={styles.suggestionChip} onPress={() => setAssistantQuestion(suggestion.label)}>
                      <Ionicons name={suggestion.icon as keyof typeof Ionicons.glyphMap} size={17} color="#6042C5" />
                      <Text style={styles.suggestionText}>{suggestion.label}</Text>
                    </Pressable>
                  ))}
                </View>
                <View style={styles.questionInputWrap}>
                  <TextInput
                    value={assistantQuestion}
                    onChangeText={setAssistantQuestion}
                    placeholder="Type your question here..."
                    placeholderTextColor="#96919E"
                    style={styles.questionInput}
                  />
                  <Pressable
                    style={styles.sendQuestionButton}
                    onPress={() => {
                      answerAssistant();
                    }}
                    accessibilityLabel="Send question"
                  >
                    <Ionicons name="paper-plane-outline" size={18} color="#FFFFFF" />
                  </Pressable>
                </View>
              </View>
            )}
          </View>

          <View style={styles.aboutCard}>
            <View style={styles.aboutAccent} />
            <View style={styles.aboutCopy}>
              <Text style={styles.aboutTitle}>About HabitAI</Text>
              <Text style={styles.aboutText}>Version 1.0.0</Text>
              <Text style={styles.aboutText}>Built with love to help you build better habits every day.</Text>
            </View>
            <View style={styles.aboutIcon}>
              <Ionicons name="phone-portrait-outline" size={38} color="#5B42D8" />
              <Ionicons name="sparkles" size={15} color="#E7A72F" />
            </View>
          </View>
        </View>
      </ScrollView>
      <Modal visible={suggestionOpen} transparent animationType="fade" onRequestClose={() => setSuggestionOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.suggestionModal}>
            <Text style={styles.modalTitle}>Suggest a Feature</Text>
            <Text style={styles.modalSubtitle}>Tell us what would make HabitAI more useful.</Text>
            <TextInput value={suggestion} onChangeText={setSuggestion} placeholder="Your idea" placeholderTextColor="#96919E" style={styles.suggestionInput} multiline maxLength={500} />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setSuggestionOpen(false)} style={styles.modalCancel}><Text style={styles.modalCancelText}>Cancel</Text></Pressable>
              <Pressable onPress={async () => {
                const result = await submitFeatureSuggestion(suggestion.trim());
                if (!result.ok) { showAlert('Suggestion not sent', result.message || 'Please try again later.'); return; }
                setSuggestion('');
                setSuggestionOpen(false);
                showAlert('Suggestion received', 'Thanks for helping improve HabitAI.', undefined, 'success');
              }} style={styles.modalSubmit}><Text style={styles.modalSubmitText}>Send</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 35 }, darkScreen: { backgroundColor: '#111018' }, darkText: { color: '#F2EFF8' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20, 17, 30, 0.45)', justifyContent: 'center', padding: 20 },
  suggestionModal: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '800', color: '#302B3B' },
  modalSubtitle: { fontSize: 12, color: '#777282', marginTop: 6, marginBottom: 14 },
  suggestionInput: { minHeight: 110, borderWidth: 1, borderColor: '#DDD8E7', borderRadius: 12, padding: 12, color: '#302B3B', textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 },
  modalCancel: { paddingHorizontal: 14, paddingVertical: 10 },
  modalCancelText: { color: '#6F687A', fontWeight: '700' },
  modalSubmit: { backgroundColor: '#5B42D8', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 },
  modalSubmitText: { color: '#FFFFFF', fontWeight: '800' },
  content: { paddingBottom: 110 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 21, fontWeight: '800', color: '#24212D' },
  helpBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#EDE6FF', borderRadius: 22, padding: 18, marginBottom: 22, borderWidth: 1, borderColor: '#E1D6FF' },
  bannerCopy: { flex: 1 },
  bannerEyebrow: { fontSize: 8, fontWeight: '800', letterSpacing: 1, color: '#7A68B5', marginBottom: 6 },
  bannerTitle: { fontSize: 17, fontWeight: '800', color: '#3D335B', marginBottom: 5 },
  bannerText: { fontSize: 11, lineHeight: 16, color: '#716A80', fontWeight: '600' },
  availability: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 5 },
  availabilityDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#48A66A' },
  availabilityText: { fontSize: 8, color: '#5D8B6B', fontWeight: '700' },
  supportAvatar: { width: 68, height: 68, borderRadius: 34, backgroundColor: '#E8CFC8', alignItems: 'center', justifyContent: 'center', marginLeft: 10, borderWidth: 3, borderColor: '#FFFFFF' },
  avatarSpark: { position: 'absolute', right: -2, top: 2, width: 20, height: 20, borderRadius: 10, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 46, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 14, paddingHorizontal: 14, marginBottom: 20, borderWidth: 1, borderColor: '#ECE8F4' },
  searchInput: { flex: 1, fontSize: 12, color: '#393440', fontWeight: '600', marginLeft: 9, paddingVertical: 0 },
  sectionLabel: { fontSize: 14, fontWeight: '800', color: '#4A4553', marginBottom: 10 },
  quickGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginBottom: 18 },
  quickCard: { width: '48.2%', minHeight: 132, backgroundColor: '#FFFFFF', borderRadius: 17, padding: 13, borderWidth: 1, borderColor: '#F0ECF7', shadowColor: '#292047', shadowOpacity: 0.035, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 1 },
  faqQuickCard: { backgroundColor: '#FFFFFF' },
  optionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#F1ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  faqOptionIcon: { backgroundColor: '#EEE6FF', borderWidth: 1, borderColor: '#D9CCFF' },
  optionTitle: { fontSize: 13, fontWeight: '800', color: '#393440' },
  faqOptionTitle: { fontSize: 20, fontWeight: '800', color: '#2B2A33' },
  optionSubtitle: { fontSize: 10, color: '#888291', fontWeight: '600', marginTop: 4 },
  faqOptionSubtitle: { fontSize: 12, color: '#5C5866', lineHeight: 18 },
  quickArrowWrap: {
    position: 'absolute',
    right: 13,
    bottom: 13,
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  faqArrowWrap: {
    right: 12,
    bottom: 12,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E3D8FF',
  },
  emptyText: { textAlign: 'center', color: '#888291', fontSize: 12, marginBottom: 18 },
  immediateCard: { backgroundColor: '#F0EAFF', borderRadius: 18, padding: 14, marginBottom: 18, borderWidth: 1, borderColor: '#E2D7FF' },
  immediateHeader: { flexDirection: 'row', alignItems: 'center' },
  immediateIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  immediateCopy: { flex: 1 },
  immediateTitle: { fontSize: 15, fontWeight: '800', color: '#3D335B', marginBottom: 4 },
  immediateText: { fontSize: 11, lineHeight: 16, color: '#716A80', fontWeight: '600' },
  chatButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  assistantPanel: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginTop: 14 },
  assistantGreeting: { fontSize: 15, fontWeight: '800', color: '#292633', marginBottom: 4 },
  assistantMessage: { fontSize: 11, lineHeight: 17, color: '#716A80', fontWeight: '600', marginBottom: 12 },
  suggestionList: { gap: 8, marginBottom: 16 },
  suggestionChip: { alignSelf: 'flex-start', minHeight: 35, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#CDBFF2', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 7 },
  suggestionText: { fontSize: 11, color: '#6042C5', fontWeight: '700', marginLeft: 8 },
  questionInputWrap: { height: 48, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E6E1ED', borderRadius: 24, paddingLeft: 14, paddingRight: 5 },
  questionInput: { flex: 1, fontSize: 11, color: '#393440', fontWeight: '600', paddingVertical: 0 },
  sendQuestionButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  aboutCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, padding: 17, overflow: 'hidden', shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  aboutAccent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, backgroundColor: '#5B42D8' },
  aboutCopy: { flex: 1 },
  aboutTitle: { fontSize: 14, fontWeight: '800', color: '#302B3B', marginBottom: 6 },
  aboutText: { fontSize: 10, lineHeight: 16, color: '#827C8C', fontWeight: '600' },
  aboutIcon: { width: 58, height: 70, borderRadius: 13, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', position: 'relative' },
});

