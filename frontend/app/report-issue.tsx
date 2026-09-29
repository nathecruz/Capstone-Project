import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { submitIssueReport } from '@/authentication/authService';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

const issueTopics = ['App is not working properly', 'A habit is not tracking', 'Sync is not working', 'Other'];
const timingOptions = ['Just now', 'Today', 'This week', 'More than a week ago'];

function Dropdown({
  value,
  options,
  isOpen,
  onToggle,
  onSelect,
}: {
  value: string;
  options: string[];
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (option: string) => void;
}) {
  return (
    <>
      <Pressable style={styles.selectField} onPress={onToggle} accessibilityRole="button">
        <Text style={styles.selectText}>{value}</Text>
        <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={15} color="#393440" />
      </Pressable>
      {isOpen && (
        <View style={styles.optionsMenu}>
          {options.map((option) => (
            <Pressable key={option} style={styles.option} onPress={() => onSelect(option)}>
              <Text style={[styles.optionText, option === value && styles.selectedOptionText]}>{option}</Text>
              {option === value && <Ionicons name="checkmark" size={15} color="#5B42D8" />}
            </Pressable>
          ))}
        </View>
      )}
    </>
  );
}

export default function ReportIssueScreen() {
  const showAlert = useAppDialog();
  const { isDarkMode } = useAppColorScheme();
  const [topic, setTopic] = useState(issueTopics[0]);
  const [timing, setTiming] = useState(timingOptions[0]);
  const [description, setDescription] = useState('');
  const [openMenu, setOpenMenu] = useState<'topic' | 'timing' | null>(null);
  const [hasAttachment, setHasAttachment] = useState(false);
  const [attachment, setAttachment] = useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const chooseAttachment = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*', 'video/*'], copyToCacheDirectory: true });
    if (!result.canceled) {
      const selected = result.assets[0];
      if (selected.size && selected.size > 10 * 1024 * 1024) {
        showAlert('Attachment is too large', 'Please choose an image or MP4 video up to 10MB.');
        return;
      }
      setAttachment(selected);
      setHasAttachment(true);
    }
  };

  const submitReport = async () => {
    if (!description.trim()) {
      showAlert('Add a description', 'Please tell us what happened before submitting your report.');
      return;
    }

    setIsSubmitting(true);
    const result = await submitIssueReport({
      topic,
      timing,
      description: description.trim(),
      attachment: attachment ? { uri: attachment.uri, name: attachment.name, type: attachment.mimeType } : undefined,
    });
    setIsSubmitting(false);
    if (!result.ok) {
      showAlert('Report could not be submitted', result.message || 'Please try again when the account service is available.');
      return;
    }
    showAlert(
      result.forwarded ? 'Report sent to support' : 'Report saved',
      result.forwarded ? 'Thanks for helping us improve the app.' : 'Your report is saved, but email forwarding is not configured or is currently unavailable.',
      [{ text: 'Done', onPress: () => router.back() }],
      'success',
    );
  };

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons name="arrow-back" size={19} color="#292633" />
            </Pressable>
            <Text style={styles.headerTitle}>Report an Issue</Text>
            <View style={styles.headerSpacer} />
          </View>

          <View style={styles.issueBanner}>
            <View style={styles.warningIcon}>
              <Ionicons name="warning" size={25} color="#FFFFFF" />
            </View>
            <View style={styles.bannerCopy}>
              <Text style={styles.bannerTitle}>Report an Issue</Text>
              <Text style={styles.bannerText}>Help us fix problems quickly by providing detailed information.</Text>
            </View>
          </View>

          <Text style={styles.fieldLabel}>What&apos;s the issue about?</Text>
          <Dropdown
            value={topic}
            options={issueTopics}
            isOpen={openMenu === 'topic'}
            onToggle={() => setOpenMenu(openMenu === 'topic' ? null : 'topic')}
            onSelect={(value) => { setTopic(value); setOpenMenu(null); }}
          />

          <Text style={styles.fieldLabel}>When did this happen?</Text>
          <Dropdown
            value={timing}
            options={timingOptions}
            isOpen={openMenu === 'timing'}
            onToggle={() => setOpenMenu(openMenu === 'timing' ? null : 'timing')}
            onSelect={(value) => { setTiming(value); setOpenMenu(null); }}
          />

          <View style={styles.descriptionHeader}>
            <Text style={styles.fieldLabel}>Describe the issue</Text>
            <Text style={styles.characterCount}>{description.length}/500</Text>
          </View>
          <TextInput
            value={description}
            onChangeText={(text) => setDescription(text.slice(0, 500))}
            placeholder="Please describe what happened..."
            placeholderTextColor="#A19CAA"
            multiline
            textAlignVertical="top"
            style={styles.descriptionInput}
          />

          <Text style={styles.fieldLabel}>Add Screenshots or Videos <Text style={styles.optional}>(optional)</Text></Text>
          <Pressable style={[styles.uploadBox, hasAttachment && styles.uploadBoxSelected]} onPress={() => { if (hasAttachment) { setAttachment(null); setHasAttachment(false); } else { void chooseAttachment(); } }} accessibilityRole="button">
            <Ionicons name={hasAttachment ? 'checkmark-circle-outline' : 'cloud-upload-outline'} size={24} color="#6742D8" />
            <Text style={styles.uploadTitle}>{hasAttachment ? attachment?.name || 'Attachment added' : 'Tap to upload or drag & drop'}</Text>
            <Text style={styles.uploadHint}>{hasAttachment ? 'Tap to remove attachment' : 'PNG, JPG or MP4 up to 10MB'}</Text>
          </Pressable>

          <Pressable style={styles.submitButton} onPress={() => void submitReport()} disabled={isSubmitting} accessibilityRole="button">
            {isSubmitting ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>Submit Report</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAF9FC', paddingTop: 28 }, darkScreen: { backgroundColor: '#111018' },
  content: { paddingBottom: 35 },
  container: { paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 },
  backButton: { width: 38, height: 38, justifyContent: 'center' },
  headerSpacer: { width: 38 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#24212D' },
  issueBanner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F8F7FC', borderRadius: 14, padding: 16, marginBottom: 27 },
  warningIcon: { width: 54, height: 54, borderRadius: 11, backgroundColor: '#F59D22', alignItems: 'center', justifyContent: 'center', marginRight: 13 },
  bannerCopy: { flex: 1 },
  bannerTitle: { fontSize: 15, fontWeight: '800', color: '#393440', marginBottom: 5 },
  bannerText: { fontSize: 11, lineHeight: 16, color: '#77717F', fontWeight: '600' },
  fieldLabel: { fontSize: 11, fontWeight: '800', color: '#393440', marginBottom: 8 },
  selectField: { height: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E3ED', borderRadius: 9, paddingHorizontal: 14, marginBottom: 17 },
  selectText: { fontSize: 13, color: '#5B5663', fontWeight: '600' },
  optionsMenu: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E3ED', borderRadius: 9, marginTop: -11, marginBottom: 17, overflow: 'hidden' },
  option: { minHeight: 45, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#F1EEF5' },
  optionText: { fontSize: 13, color: '#5F5A69' },
  selectedOptionText: { color: '#5B42D8', fontWeight: '700' },
  descriptionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  characterCount: { fontSize: 11, color: '#8F8998', marginBottom: 8 },
  descriptionInput: { height: 145, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E3ED', borderRadius: 9, paddingHorizontal: 14, paddingTop: 12, fontSize: 13, lineHeight: 19, color: '#393440', marginBottom: 19 },
  optional: { color: '#8F8998', fontWeight: '600' },
  uploadBox: { height: 96, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: '#BDB0E8', borderRadius: 9, backgroundColor: '#FFFFFF', marginBottom: 15 },
  uploadBoxSelected: { backgroundColor: '#F4F0FF', borderColor: '#7048D7' },
  uploadTitle: { fontSize: 12, color: '#5B42D8', fontWeight: '700', marginTop: 5 },
  uploadHint: { fontSize: 10, color: '#8F8998', marginTop: 3 },
  submitButton: { height: 48, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5425C9', borderRadius: 8 },
  submitButtonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
});

