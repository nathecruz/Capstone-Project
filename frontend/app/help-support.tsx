import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { submitFeatureSuggestion } from '@/authentication';
import { AskAiCard } from '@/components/ai-chat';
import { FaqQuestion } from '@/components/faq-question';
import { SupportChatSheet, useSupportChat } from '@/components/support-chat';
import { useAppDialog } from '@/components/ui/app-dialog';
import { faqCount, findFaq, popularQuestions, searchFaq, supportQuestions, type FaqMatch } from '@/constants/help-faq';
import { openExternalLink } from '@/utils/platform';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const supportEmail = process.env.EXPO_PUBLIC_SUPPORT_EMAIL?.trim() || '';
// Web: inputs show their own focus border instead of the browser's ring.
const WEB_NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

export default function HelpSupportScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const showAlert = useAppDialog();
  const support = useSupportChat();
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const [suggestionOpen, setSuggestionOpen] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [suggestionFocused, setSuggestionFocused] = useState(false);
  const [sending, setSending] = useState(false);

  const query = search.trim();
  const results = searchFaq(query);
  const popular = popularQuestions.map(findFaq).filter((item): item is FaqMatch => Boolean(item));
  const toggle = (question: string) => setOpenQuestion((current) => (current === question ? null : question));
  const canSend = suggestion.trim().length >= 3 && !sending;
  const contactOptions = [
    { title: 'Report an issue', subtitle: 'Something not working? Tell the team.', icon: 'warning-outline', color: '#D9822B', action: () => router.push('/report-issue') },
    { title: 'Suggest a feature', subtitle: 'Share an idea that would make HabitAI better.', icon: 'bulb-outline', color: '#2F9E6E', action: () => setSuggestionOpen(true) },
    // The real support inbox when one is configured; otherwise a question through the report form (it reaches the Admin Panel).
    { title: 'Contact support', subtitle: supportEmail ? `Email ${supportEmail}` : 'Send the team a question.', icon: 'mail-outline', color: '#2F7BD8', action: () => (supportEmail ? void openExternalLink(`mailto:${supportEmail}`) : router.push({ pathname: '/report-issue', params: { topic: 'question' } })) },
  ];

  const sendSuggestion = async () => {
    if (!canSend) return;
    setSending(true);
    const result = await submitFeatureSuggestion(suggestion.trim());
    setSending(false);
    if (!result.ok) {
      showAlert('Suggestion not sent', result.message || 'Please try again later.');
      return;
    }
    setSuggestion('');
    setSuggestionOpen(false);
    showAlert('Thanks for the idea!', 'The HabitAI team reads every suggestion.', undefined, 'success');
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 18 }]}>
          <View style={styles.headerRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={21} color={themeColor('#292633')} />
            </Pressable>
            <Text style={styles.headerTitle}>Help &amp; Support</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.hero}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>HELP CENTER</Text>
                <Text style={styles.heroTitle}>How can we help?</Text>
                <Text style={styles.heroText}>Search {faqCount} answers, ask HabitAI, or message the team.</Text>
              </View>
              <View style={styles.heroIcon}>
                <Ionicons name="help-buoy-outline" size={30} color="#FFFFFF" />
              </View>
            </View>
            <View style={[styles.searchBox, searchFocused && styles.searchBoxFocused]}>
              <Ionicons name="search-outline" size={18} color={themeColor('#8A8492')} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                placeholder="Search, e.g. streak or reminders"
                placeholderTextColor={themeColor('#9A94A4')}
                style={[styles.searchInput, WEB_NO_RING]}
                returnKeyType="search"
                maxLength={60}
                accessibilityLabel="Search help"
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear search">
                  <Ionicons name="close-circle" size={18} color={themeColor('#9A94A4')} />
                </Pressable>
              )}
            </View>
          </View>

          {query ? (
            <>
              <Text style={styles.resultsTitle} accessibilityLiveRegion="polite">
                {results.length ? `${results.length} answer${results.length === 1 ? '' : 's'} for "${query}"` : `No answers for "${query}"`}
              </Text>
              {results.length > 0 && (
                <View style={styles.card}>
                  {results.map((item, index) => (
                    <FaqQuestion key={item.question} item={item} topic={{ title: item.section, color: item.color }} divider={index > 0} open={openQuestion === item.question} onToggle={() => toggle(item.question)} />
                  ))}
                </View>
              )}
              <Pressable style={({ pressed }) => [styles.askSearch, pressed && styles.pressed]} onPress={() => support.open(query)} accessibilityRole="button" accessibilityLabel={`Ask HabitAI: ${query}`}>
                <View style={styles.askSearchIcon}>
                  <Ionicons name="sparkles" size={17} color="#FFFFFF" />
                </View>
                <View style={styles.askSearchCopy}>
                  <Text style={styles.askSearchTitle}>{results.length ? 'Not what you need? Ask HabitAI' : 'Ask HabitAI instead'}</Text>
                  <Text style={styles.askSearchText} numberOfLines={1}>&ldquo;{query}&rdquo;</Text>
                </View>
                <Ionicons name="arrow-forward" size={18} color={themeColor('#5B42D8')} />
              </Pressable>
            </>
          ) : (
            <>
              <AskAiCard
                title="Ask HabitAI"
                subtitle="Instant answers about using the app. Free."
                suggestions={supportQuestions.slice(0, 2)}
                onOpen={() => support.open()}
                onAsk={support.open}
              />

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Popular questions</Text>
              </View>
              <View style={styles.card}>
                {popular.map((item, index) => (
                  <FaqQuestion key={item.question} item={item} divider={index > 0} open={openQuestion === item.question} onToggle={() => toggle(item.question)} />
                ))}
                <Pressable style={({ pressed }) => [styles.browseAll, pressed && styles.pressed]} onPress={() => router.push('/help-support-faq')} accessibilityRole="button">
                  <Ionicons name="book-outline" size={17} color={themeColor('#5B42D8')} />
                  <Text style={styles.browseAllText}>Browse all {faqCount} answers</Text>
                  <Ionicons name="arrow-forward" size={16} color={themeColor('#5B42D8')} />
                </Pressable>
              </View>

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitle}>Contact the team</Text>
                <Text style={styles.sectionHint}>The team reads every message and can reply in your notifications.</Text>
              </View>
              <View style={styles.card}>
                {contactOptions.map((option, index) => (
                  <View key={option.title}>
                    {index > 0 && <View style={styles.divider} />}
                    <Pressable style={({ pressed }) => [styles.optionRow, pressed && styles.pressed]} onPress={option.action} accessibilityRole="button" accessibilityHint={option.subtitle}>
                      <View style={[styles.optionIcon, { backgroundColor: `${option.color}1F` }]}>
                        <Ionicons name={option.icon as keyof typeof Ionicons.glyphMap} size={20} color={option.color} />
                      </View>
                      <View style={styles.optionCopy}>
                        <Text style={styles.optionTitle}>{option.title}</Text>
                        <Text style={styles.optionSubtitle}>{option.subtitle}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={themeColor('#A19CAA')} />
                    </Pressable>
                  </View>
                ))}
              </View>
            </>
          )}

          <View style={styles.about}>
            <View style={styles.aboutLogo}>
              <Text style={styles.aboutLogoText}>H</Text>
            </View>
            <View style={styles.aboutCopy}>
              <Text style={styles.aboutTitle}>HabitAI</Text>
              <Text style={styles.aboutText}>Version 1.0.0</Text>
            </View>
            <Pressable style={({ pressed }) => [styles.aboutLink, pressed && styles.pressed]} onPress={() => router.push('/privacy-notice')} accessibilityRole="link">
              <Text style={styles.aboutLinkText}>Privacy</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={suggestionOpen} transparent animationType="fade" onRequestClose={() => setSuggestionOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setSuggestionOpen(false)} accessibilityLabel="Close" />
          <View style={styles.modalCard} accessibilityViewIsModal>
            <View style={styles.modalIcon}>
              <Ionicons name="bulb-outline" size={24} color={themeColor('#2F9E6E')} />
            </View>
            <Text style={styles.modalTitle}>Suggest a feature</Text>
            <Text style={styles.modalSubtitle}>What would make HabitAI more useful for you? The team reads every idea.</Text>
            <TextInput
              value={suggestion}
              onChangeText={setSuggestion}
              onFocus={() => setSuggestionFocused(true)}
              onBlur={() => setSuggestionFocused(false)}
              placeholder="e.g. A widget that shows today's habits"
              placeholderTextColor={themeColor('#96919E')}
              style={[styles.suggestionInput, suggestionFocused && styles.inputFocused, WEB_NO_RING]}
              multiline
              textAlignVertical="top"
              maxLength={500}
              accessibilityLabel="Your idea"
            />
            <Text style={styles.counter}>{suggestion.length}/500</Text>
            <View style={styles.modalActions}>
              <Pressable onPress={() => setSuggestionOpen(false)} style={({ pressed }) => [styles.modalButton, styles.modalCancel, pressed && styles.pressed]} accessibilityRole="button">
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => void sendSuggestion()} disabled={!canSend} style={({ pressed }) => [styles.modalButton, styles.modalSubmit, !canSend && styles.disabled, pressed && styles.pressed]} accessibilityRole="button" accessibilityState={{ disabled: !canSend, busy: sending }}>
                {sending ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.modalSubmitText}>Send idea</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
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
  disabled: { opacity: 0.45 },
  hero: { backgroundColor: '#5B42D8', borderRadius: 24, padding: 18, marginBottom: 20, gap: 16 },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroCopy: { flex: 1 },
  heroEyebrow: { fontSize: 11, fontWeight: '900', letterSpacing: 1.2, color: 'rgba(255, 255, 255, 0.72)' },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', marginTop: 4, letterSpacing: -0.3 },
  heroText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: 'rgba(255, 255, 255, 0.86)', marginTop: 4 },
  heroIcon: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'rgba(255, 255, 255, 0.16)', alignItems: 'center', justifyContent: 'center' },
  searchBox: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#FFFFFF', borderRadius: 16, paddingHorizontal: 14, borderWidth: 2, borderColor: 'transparent' },
  searchBoxFocused: { borderColor: '#C9BCFF' },
  searchInput: { flex: 1, height: '100%', fontSize: 16, color: '#2B2A33', fontWeight: '600', paddingVertical: 0 },
  resultsTitle: { fontSize: 15, fontWeight: '900', color: '#1F1C26', marginBottom: 10 },
  sectionHead: { marginTop: 22, marginBottom: 10, gap: 3 },
  sectionTitle: { fontSize: 17, fontWeight: '900', color: '#1F1C26' },
  sectionHint: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#736D7D' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 4, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  divider: { height: 1, backgroundColor: '#F0EEF5' },
  browseAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 48, marginHorizontal: -16, marginTop: 4, borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  browseAllText: { fontSize: 14, fontWeight: '900', color: '#5B42D8' },
  askSearch: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: '#F4F1FF', borderWidth: 1, borderColor: '#E6E0FB' },
  askSearchIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  askSearchCopy: { flex: 1, minWidth: 0 },
  askSearchTitle: { fontSize: 14, fontWeight: '900', color: '#2D2A3D' },
  askSearchText: { fontSize: 12, fontWeight: '600', color: '#736D7D', marginTop: 2 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14 },
  optionIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  optionCopy: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '800', color: '#2D2A3D' },
  optionSubtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#736D7D', marginTop: 2 },
  about: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: '#E8E4F0' },
  aboutLogo: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  aboutLogoText: { fontSize: 18, fontWeight: '900', color: '#FFFFFF' },
  aboutCopy: { flex: 1 },
  aboutTitle: { fontSize: 14, fontWeight: '900', color: '#2D2A3D' },
  aboutText: { fontSize: 12, fontWeight: '600', color: '#736D7D', marginTop: 2 },
  aboutLink: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#F1ECFF' },
  aboutLinkText: { fontSize: 12, fontWeight: '900', color: '#5B42D8' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20, 16, 32, 0.5)', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20 },
  modalIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E3F6EC', marginBottom: 12 },
  modalTitle: { fontSize: 19, fontWeight: '900', color: '#1F1C26' },
  modalSubtitle: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#736D7D', marginTop: 4, marginBottom: 14 },
  suggestionInput: { minHeight: 120, borderWidth: 2, borderColor: '#ECE8F4', borderRadius: 16, padding: 12, fontSize: 16, lineHeight: 22, color: '#2D2A3D', backgroundColor: '#FAF9FD' },
  inputFocused: { borderColor: '#8E7AE8' },
  counter: { alignSelf: 'flex-end', fontSize: 11, fontWeight: '700', color: '#8F8998', marginTop: 6 },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  modalButton: { flex: 1, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  modalCancel: { backgroundColor: '#F2F1F7' },
  modalCancelText: { fontSize: 14, fontWeight: '800', color: '#4A4553' },
  modalSubmit: { backgroundColor: '#5B42D8' },
  modalSubmitText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
}, {
  // Dark mode: cards a step above the screen; the search field is a dark field on the purple hero.
  screen: { backgroundColor: '#111018' },
  backButton: { backgroundColor: '#221E2B' },
  card: { backgroundColor: '#1D1A24' },
  divider: { backgroundColor: '#2A2633' },
  browseAll: { borderTopColor: '#2A2633' },
  askSearch: { backgroundColor: '#211C33', borderColor: '#352C52' },
  searchBox: { backgroundColor: '#1B1823' },
  searchBoxFocused: { borderColor: '#B9A8FF' },
  about: { borderColor: '#2A2633' },
  aboutLink: { backgroundColor: '#2B2540' },
  modalCard: { backgroundColor: '#1B1823' },
  modalIcon: { backgroundColor: '#1D3329' },
  suggestionInput: { borderColor: '#302B3B', backgroundColor: '#221E2B' },
  modalCancel: { backgroundColor: '#2A2633' },
});
