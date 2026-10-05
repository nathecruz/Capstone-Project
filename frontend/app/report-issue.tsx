import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { submitIssueReport } from '@/authentication/authService';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

const QUESTION = 'A question for the team';
const issueTopics = [
  { label: 'App is not working properly', icon: 'bug-outline' },
  { label: 'A habit is not tracking', icon: 'checkbox-outline' },
  { label: 'Sync is not working', icon: 'sync-outline' },
  { label: QUESTION, icon: 'chatbubble-ellipses-outline' },
  { label: 'Other', icon: 'ellipsis-horizontal' },
];
const timingOptions = ['Just now', 'Today', 'This week', 'More than a week ago'];
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
// Web: the description shows its own focus border instead of the browser's ring.
const WEB_NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const fileSize = (bytes?: number) => (!bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default function ReportIssueScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { width } = useWindowDimensions();
  // Contact support (without a support inbox) opens this form for a question.
  const { topic: initialTopic } = useLocalSearchParams<{ topic?: string }>();
  const [topic, setTopic] = useState(initialTopic === 'question' ? QUESTION : issueTopics[0].label);
  const [timing, setTiming] = useState(timingOptions[0]);
  const [description, setDescription] = useState('');
  const [focused, setFocused] = useState(false);
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isQuestion = topic === QUESTION;
  const canSubmit = description.trim().length > 0 && !isSubmitting;

  const chooseAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'video/*'], copyToCacheDirectory: true });
    if (result.canceled) return;
    const selected = result.assets[0];
    if (selected.size && selected.size > MAX_ATTACHMENT_BYTES) {
      showAlert('Attachment is too large', 'Please choose an image or MP4 video up to 10 MB.');
      return;
    }
    setAttachment(selected);
  };

  const submitReport = async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    const result = await submitIssueReport({
      topic,
      // A question has no "when"; the report still needs one.
      timing: isQuestion ? 'Not applicable' : timing,
      description: description.trim(),
      attachment: attachment ? { uri: attachment.uri, name: attachment.name, type: attachment.mimeType } : undefined,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      showAlert(isQuestion ? 'Question not sent' : 'Report not sent', result.message || 'Please try again when the account service is available.');
      return;
    }
    showAlert(
      isQuestion ? 'Question sent' : result.forwarded ? 'Report sent to support' : 'Report saved',
      result.forwarded || isQuestion ? 'Thanks! The team can reply in your notifications.' : 'Your report is saved, but email forwarding is not configured or is currently unavailable.',
      [{ text: 'Done', onPress: () => router.back() }],
      'success',
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={[styles.container, { paddingHorizontal: width < 360 ? 12 : 18 }]}>
          <View style={styles.headerRow}>
            <Pressable style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={21} color={themeColor('#292633')} />
            </Pressable>
            <Text style={styles.headerTitle}>{initialTopic === 'question' ? 'Contact support' : 'Report an issue'}</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.intro}>
            <View style={[styles.introIcon, isQuestion && styles.introIconQuestion]}>
              <Ionicons name={isQuestion ? 'chatbubble-ellipses' : 'construct'} size={22} color="#FFFFFF" />
            </View>
            <View style={styles.introCopy}>
              <Text style={styles.introTitle}>{isQuestion ? 'Ask the team anything' : 'Tell us what went wrong'}</Text>
              <Text style={styles.introText}>The HabitAI team reads every message and can reply in your notifications.</Text>
            </View>
          </View>

          <Text style={styles.label}>What is it about?</Text>
          <View style={styles.card} accessibilityRole="radiogroup" accessibilityLabel="Topic">
            {issueTopics.map((item, index) => {
              const active = topic === item.label;
              return (
                <Pressable key={item.label} style={({ pressed }) => [styles.topicRow, index > 0 && styles.topicDivider, pressed && styles.pressed]} onPress={() => setTopic(item.label)} accessibilityRole="radio" accessibilityState={{ checked: active }} accessibilityLabel={item.label}>
                  <View style={[styles.topicIcon, active && styles.topicIconActive]}>
                    <Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={18} color={active ? '#FFFFFF' : themeColor('#5B42D8')} />
                  </View>
                  <Text style={[styles.topicText, active && styles.topicTextActive]}>{item.label}</Text>
                  <View style={[styles.radio, active && styles.radioActive]}>{active && <View style={styles.radioDot} />}</View>
                </Pressable>
              );
            })}
          </View>

          {!isQuestion && (
            <>
              <Text style={styles.label}>When did it happen?</Text>
              <View style={styles.chips} accessibilityRole="radiogroup" accessibilityLabel="When did it happen">
                {timingOptions.map((option) => {
                  const active = timing === option;
                  return (
                    <Pressable key={option} style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]} onPress={() => setTiming(option)} accessibilityRole="radio" accessibilityState={{ checked: active }}>
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>{option}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <View style={styles.labelRow}>
            <Text style={styles.labelInline}>{isQuestion ? 'Your question' : 'What happened?'}</Text>
            <Text style={styles.counter}>{description.length}/500</Text>
          </View>
          <TextInput
            value={description}
            onChangeText={(text) => setDescription(text.slice(0, 500))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={isQuestion ? 'Ask the team anything about HabitAI...' : 'What you did, what you expected, and what happened instead...'}
            placeholderTextColor={themeColor('#A19CAA')}
            multiline
            textAlignVertical="top"
            maxLength={500}
            style={[styles.description, focused && styles.descriptionFocused, WEB_NO_RING]}
            accessibilityLabel={isQuestion ? 'Your question' : 'What happened'}
          />
          <View style={styles.privacyNote}>
            <Ionicons name="lock-closed-outline" size={13} color={themeColor('#8F8998')} />
            <Text style={styles.privacyText}>Never include your password or verification codes.</Text>
          </View>

          <Text style={styles.label}>
            Screenshot or video <Text style={styles.optional}>(optional)</Text>
          </Text>
          {attachment ? (
            <View style={styles.fileRow}>
              <View style={styles.fileIcon}>
                <Ionicons name={attachment.mimeType?.startsWith('video') ? 'videocam-outline' : 'image-outline'} size={20} color={themeColor('#5B42D8')} />
              </View>
              <View style={styles.fileCopy}>
                <Text style={styles.fileName} numberOfLines={1}>{attachment.name}</Text>
                <Text style={styles.fileMeta}>{fileSize(attachment.size) || 'Attached'}</Text>
              </View>
              <Pressable style={({ pressed }) => [styles.fileRemove, pressed && styles.pressed]} onPress={() => setAttachment(null)} hitSlop={6} accessibilityRole="button" accessibilityLabel="Remove attachment">
                <Ionicons name="close" size={18} color={themeColor('#6F687A')} />
              </Pressable>
            </View>
          ) : (
            <Pressable style={({ pressed }) => [styles.uploadBox, pressed && styles.pressed]} onPress={() => void chooseAttachment()} accessibilityRole="button" accessibilityLabel="Add a screenshot or video">
              <View style={styles.uploadIcon}>
                <Ionicons name="cloud-upload-outline" size={22} color={themeColor('#5B42D8')} />
              </View>
              <Text style={styles.uploadTitle}>Add a screenshot or video</Text>
              <Text style={styles.uploadHint}>PNG, JPG or MP4 up to 10 MB</Text>
            </Pressable>
          )}

          <Pressable style={({ pressed }) => [styles.submitButton, !canSubmit && styles.submitDisabled, pressed && styles.pressed]} onPress={() => void submitReport()} disabled={!canSubmit} accessibilityRole="button" accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}>
            {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : (
              <>
                <Ionicons name="paper-plane" size={17} color="#FFFFFF" />
                <Text style={styles.submitText}>{isQuestion ? 'Send question' : 'Send report'}</Text>
              </>
            )}
          </Pressable>
          {!description.trim() && <Text style={styles.submitHint}>{isQuestion ? 'Type your question to send it.' : 'Describe what happened to send the report.'}</Text>}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  content: { paddingBottom: 60 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 8, marginBottom: 16 },
  backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerSpacer: { width: 42 },
  headerTitle: { fontSize: 18, fontWeight: '900', color: '#1F1C26' },
  pressed: { opacity: 0.75 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 22, backgroundColor: '#FFF4E6', borderWidth: 1, borderColor: '#FBE3C4' },
  introIcon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E07B1F' },
  introIconQuestion: { backgroundColor: '#2F7BD8' },
  introCopy: { flex: 1 },
  introTitle: { fontSize: 16, fontWeight: '900', color: '#1F1C26' },
  introText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#6F687A', marginTop: 3 },
  label: { fontSize: 14, fontWeight: '900', color: '#2D2A3D', marginTop: 22, marginBottom: 10 },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 },
  labelInline: { fontSize: 14, fontWeight: '900', color: '#2D2A3D' },
  optional: { fontSize: 13, fontWeight: '600', color: '#8F8998' },
  counter: { fontSize: 12, fontWeight: '700', color: '#8F8998' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, paddingHorizontal: 14, paddingVertical: 2, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  topicRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  topicDivider: { borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  topicIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1ECFF' },
  topicIconActive: { backgroundColor: '#5B42D8' },
  topicText: { flex: 1, fontSize: 14, fontWeight: '700', color: '#4A4553' },
  topicTextActive: { fontWeight: '900', color: '#1F1C26' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#CFC8DC', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: '#5B42D8' },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#5B42D8' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E6E0FB' },
  chipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  chipText: { fontSize: 13, fontWeight: '800', color: '#4A4553' },
  chipTextActive: { color: '#FFFFFF' },
  description: { minHeight: 140, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#ECE8F4', borderRadius: 18, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 22, color: '#2D2A3D' },
  descriptionFocused: { borderColor: '#8E7AE8' },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  privacyText: { fontSize: 12, fontWeight: '600', color: '#8F8998' },
  uploadBox: { alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#C9BCF2', borderRadius: 18, backgroundColor: '#FFFFFF' },
  uploadIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1ECFF', marginBottom: 8 },
  uploadTitle: { fontSize: 14, fontWeight: '900', color: '#5B42D8' },
  uploadHint: { fontSize: 12, fontWeight: '600', color: '#8F8998', marginTop: 3 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DED6FA' },
  fileIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1ECFF' },
  fileCopy: { flex: 1, minWidth: 0 },
  fileName: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  fileMeta: { fontSize: 12, fontWeight: '600', color: '#8F8998', marginTop: 2 },
  fileRemove: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F1F7' },
  submitButton: { flexDirection: 'row', gap: 8, minHeight: 54, marginTop: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8', borderRadius: 16 },
  submitDisabled: { opacity: 0.45 },
  submitText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  submitHint: { fontSize: 12, fontWeight: '600', color: '#8F8998', textAlign: 'center', marginTop: 8 },
}, {
  // Dark mode: cards a step above the screen; the intro keeps a warm tint.
  screen: { backgroundColor: '#111018' },
  backButton: { backgroundColor: '#221E2B' },
  intro: { backgroundColor: '#2A2018', borderColor: '#3D2E1F' },
  card: { backgroundColor: '#1D1A24' },
  topicDivider: { borderTopColor: '#2A2633' },
  topicIcon: { backgroundColor: '#2B2540' },
  topicIconActive: { backgroundColor: '#5B42D8' },
  radio: { borderColor: '#4A4458' },
  radioActive: { borderColor: '#8E7AE8' },
  radioDot: { backgroundColor: '#8E7AE8' },
  chip: { backgroundColor: '#1D1A24', borderColor: '#2A2633' },
  chipActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  description: { backgroundColor: '#1D1A24', borderColor: '#2A2633' },
  descriptionFocused: { borderColor: '#8E7AE8' },
  uploadBox: { backgroundColor: '#1D1A24', borderColor: '#4A3F70' },
  uploadIcon: { backgroundColor: '#2B2540' },
  fileRow: { backgroundColor: '#1D1A24', borderColor: '#352C52' },
  fileIcon: { backgroundColor: '#2B2540' },
  fileRemove: { backgroundColor: '#2A2633' },
});
