// The AI Practice Quiz maker (a reward in the Rewards Shop): pick what the quiz is made from, a file
// (PDF, DOCX, PPTX), a link (a web page or a YouTube video), typed or pasted text, or a recording
// (MP3, MP4, M4A, WAV), about 1,500 words at most. Then pick the kinds of question and how many,
// and the AI writes the quiz. A file, link or recording is read first (free), so the student sees
// what the quiz will be made from; the tokens are charged only for the quiz, and given back when it
// cannot be made. The quiz opens in the player (app/practice-quiz.tsx) and is kept in My Rewards.
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { useRewards } from '@/hooks/use-rewards';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import { plannedQuestions, QUIZ_TYPE_OPTIONS } from '@/utils/quiz';
import { readQuizSource, redeemMadeReward, rememberRewardItem, type QuizType, type ReadSource } from '@/utils/rewards-client';

type Mode = 'file' | 'link' | 'text' | 'recording';

const SOURCE_WORDS = 1500;
const MODES: { mode: Mode; label: string; formats: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { mode: 'file', label: 'File', formats: 'PDF, DOCX, PPTX', icon: 'document-attach-outline' },
  { mode: 'link', label: 'Link', formats: 'URL / YouTube', icon: 'link-outline' },
  { mode: 'text', label: 'Text', formats: 'Copy or type', icon: 'create-outline' },
  { mode: 'recording', label: 'Recording', formats: 'MP3, MP4, M4A', icon: 'mic-outline' },
];
const PICK = {
  file: {
    types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    extensions: /\.(pdf|docx|pptx)$/i,
    maxBytes: 10 * 1024 * 1024,
    limit: 'PDF, DOCX or PPTX · up to 10 MB',
  },
  recording: {
    types: ['audio/*', 'video/mp4'],
    extensions: /\.(mp3|mp4|m4a|wav)$/i,
    maxBytes: 25 * 1024 * 1024,
    limit: 'MP3, MP4, M4A or WAV · up to 25 MB',
  },
};
const COUNTS = [10, 20, 30] as const;
const STEPS = ['Reading your material…', 'Identifying testable concepts…', 'Writing the questions…', 'Checking every answer…'];
const wordCount = (text: string) => (text.match(/\S+/g) ?? []).length;

/** "Generating quiz": steps and a bar that moves while the AI writes (it slows near the end; the quiz opens when it is ready). */
function Making() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, []);
  const share = 0.92 * (1 - Math.exp(-elapsed / 14));
  return (
    <View style={[styles.card, styles.making]} accessibilityLiveRegion="polite">
      <View style={styles.makingIcon}>
        <ActivityIndicator size="large" color={themeColor('#5B42D8')} />
        <Ionicons name="sparkles" size={22} color={themeColor('#5B42D8')} style={styles.makingSparkle} />
      </View>
      <Text style={styles.makingTitle}>Generating quiz</Text>
      <Text style={styles.makingStep}>{STEPS[Math.min(STEPS.length - 1, Math.floor(elapsed / 4))]}</Text>
      <View style={styles.bar}><View style={[styles.barFill, { width: `${Math.round(share * 100)}%` }]} /></View>
      <Text style={styles.tip}>💡 Tip: answering practice questions helps you remember longer than reading again.</Text>
    </View>
  );
}

export default function QuizMakerScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const { tokens, applyWallet, isFaculty } = useAppColorScheme();
  const catalog = useRewards();
  const cost = catalog.rewards.find((reward) => reward.id === 'practice-quiz')?.cost ?? 15;
  const [mode, setMode] = useState<Mode>('file');
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [read, setRead] = useState<Partial<Record<Mode, ReadSource>>>({});
  const [reading, setReading] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  const [types, setTypes] = useState<QuizType[]>(['multiple-choice', 'true-false', 'identification']);
  const [count, setCount] = useState<(typeof COUNTS)[number]>(10);
  const [making, setMaking] = useState(false);

  const source = mode === 'text' ? null : read[mode] ?? null;
  const typedWords = wordCount(text);
  const ready = mode === 'text' ? text.trim().length >= 3 : Boolean(source);
  const total = plannedQuestions(types, count);
  const short = tokens < cost;
  const canMake = ready && types.length > 0 && !short && !reading && !making;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPreview(false);
  };
  const toggleType = (type: QuizType) => setTypes((current) => (current.includes(type) ? current.filter((entry) => entry !== type) : [...current, type]));

  const readFrom = async (which: Mode, request: Parameters<typeof readQuizSource>[0], label: string) => {
    setReading(label);
    setError('');
    const result = await readQuizSource(request);
    setReading('');
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setRead((current) => ({ ...current, [which]: result.source }));
    setPreview(false);
  };

  const pickFile = async (which: 'file' | 'recording') => {
    const rules = PICK[which];
    const picked = await DocumentPicker.getDocumentAsync({ type: rules.types, copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.[0]) return;
    const asset = picked.assets[0];
    if (!rules.extensions.test(asset.name)) {
      setError(`Choose ${which === 'file' ? 'a PDF, DOCX or PPTX file' : 'an MP3, MP4, M4A or WAV recording'}.`);
      return;
    }
    if (asset.size && asset.size > rules.maxBytes) {
      setError(`This file is over ${rules.maxBytes / (1024 * 1024)} MB. Choose a smaller one.`);
      return;
    }
    await readFrom(which, { kind: 'file', file: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: asset.file } }, which === 'file' ? `Reading ${asset.name}…` : `Turning ${asset.name} into text… This can take a minute.`);
  };

  const readLink = () => {
    if (!/^https?:\/\/\S+\.\S+/i.test(link.trim())) {
      setError('Enter the full link, starting with https://');
      return;
    }
    void readFrom('link', { kind: 'link', url: link }, 'Opening the link…');
  };

  const make = async () => {
    if (!canMake) return;
    setMaking(true);
    setError('');
    const material = mode === 'text' ? { kind: 'text' as const, name: '', text: text.trim() } : { kind: source!.kind, name: source!.name, text: source!.text };
    const result = await redeemMadeReward({ rewardId: 'practice-quiz', source: material, types, count });
    if (!result.ok) {
      if (result.wallet) applyWallet(result.wallet);
      setMaking(false);
      setError(result.message);
      return;
    }
    applyWallet(result.wallet);
    rememberRewardItem(result.item);
    router.replace({ pathname: '/practice-quiz', params: { id: result.item.id } });
  };

  const sourceCard = source && (
    <View style={styles.sourceCard}>
      <View style={styles.sourceRow}>
        <View style={styles.sourceIcon}><Ionicons name={MODES.find((entry) => entry.mode === mode)?.icon ?? 'document-outline'} size={20} color={themeColor('#5B42D8')} /></View>
        <View style={styles.sourceCopy}>
          <Text style={styles.sourceName} numberOfLines={2}>{source.name}</Text>
          <Text style={styles.sourceMeta}>{source.words.toLocaleString('en-US')} words{source.truncated ? ' · the first 1,500 are used' : ''}</Text>
        </View>
        <Ionicons name="checkmark-circle" size={22} color={themeColor('#2E8F5E')} />
      </View>
      <View style={styles.sourceActions}>
        <Pressable onPress={() => setPreview((value) => !value)} accessibilityRole="button" hitSlop={8}><Text style={styles.link}>{preview ? 'Hide text' : 'Preview text'}</Text></Pressable>
        <Pressable
          onPress={() => {
            setRead((current) => ({ ...current, [mode]: undefined }));
            setPreview(false);
          }}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.link}>{mode === 'link' ? 'Use another link' : 'Choose another'}</Text>
        </Pressable>
      </View>
      {preview && (
        <ScrollView style={styles.previewBox} nestedScrollEnabled>
          <Text style={styles.previewText}>{source.text}</Text>
        </ScrollView>
      )}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} style={styles.back} accessibilityRole="button" accessibilityLabel="Go back" disabled={making}>
            <Ionicons name="chevron-back" size={24} color={themeColor('#352B88')} />
          </Pressable>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>AI Practice Quiz</Text>
            <Text style={styles.subtitle}>{isFaculty ? 'Turn a lesson, a file, a link or a recording into a quiz for your class.' : 'Turn your notes, a file, a link or a recording into a quiz.'}</Text>
          </View>
        </View>

        {making ? (
          <Making />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.step}>1 · Select option</Text>
              <View style={styles.modes} accessibilityRole="radiogroup">
                {MODES.map((entry) => {
                  const selected = entry.mode === mode;
                  return (
                    <Pressable
                      key={entry.mode}
                      style={({ pressed }) => [styles.mode, selected && styles.modeSelected, pressed && styles.pressed]}
                      onPress={() => switchMode(entry.mode)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${entry.label}: ${entry.formats}`}
                    >
                      <Ionicons name={entry.icon} size={22} color={themeColor(selected ? '#5B42D8' : '#8A80B8')} />
                      <Text style={[styles.modeLabel, selected && styles.modeLabelSelected]}>{entry.label}</Text>
                      <Text style={styles.modeFormats}>{entry.formats}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <View style={styles.limitRow}>
                <Ionicons name="lock-closed-outline" size={12} color={themeColor('#8A8492')} />
                <Text style={styles.limit}>Limited to about 1,500 words</Text>
              </View>

              {(mode === 'file' || mode === 'recording') && (source ? sourceCard : (
                <View style={styles.drop}>
                  {reading ? (
                    <>
                      <ActivityIndicator color={themeColor('#5B42D8')} />
                      <Text style={styles.dropText}>{reading}</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name={mode === 'file' ? 'cloud-upload-outline' : 'musical-notes-outline'} size={30} color={themeColor('#7E5EE8')} />
                      <Text style={styles.dropTitle}>{mode === 'file' ? 'Choose a file' : 'Choose a recording'}</Text>
                      <Text style={styles.dropText}>{PICK[mode].limit}</Text>
                      <Pressable style={({ pressed }) => [styles.primarySmall, pressed && styles.pressed]} onPress={() => void pickFile(mode)} accessibilityRole="button">
                        <Text style={styles.primaryText}>Choose {mode === 'file' ? 'file' : 'recording'}</Text>
                      </Pressable>
                      {mode === 'recording' && <Text style={styles.hint}>The AI turns the speech into text, in English or Filipino.</Text>}
                    </>
                  )}
                </View>
              ))}

              {mode === 'link' && (source ? sourceCard : (
                <View style={styles.linkBox}>
                  <TextInput
                    value={link}
                    onChangeText={(value) => {
                      setLink(value);
                      setError('');
                    }}
                    placeholder="https://… a web page or a YouTube video"
                    placeholderTextColor={themeColor('#A19AAA')}
                    style={[styles.input, Platform.OS === 'web' && styles.webInput]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                    inputMode="url"
                    accessibilityLabel="Link"
                    editable={!reading}
                    onSubmitEditing={readLink}
                  />
                  <Pressable style={({ pressed }) => [styles.primarySmall, (!link.trim() || Boolean(reading)) && styles.disabled, pressed && styles.pressed]} onPress={readLink} disabled={!link.trim() || Boolean(reading)} accessibilityRole="button">
                    {reading ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>Read link</Text>}
                  </Pressable>
                  <Text style={styles.hint}>A YouTube video is read from its captions.</Text>
                </View>
              ))}

              {mode === 'text' && (
                <View>
                  <TextInput
                    value={text}
                    onChangeText={(value) => {
                      setText(value);
                      setError('');
                    }}
                    placeholder={isFaculty ? 'Paste your lesson notes, or type a topic (like "Photosynthesis")' : 'Paste your notes or reviewer, or type a topic (like "Photosynthesis")'}
                    placeholderTextColor={themeColor('#A19AAA')}
                    style={[styles.input, styles.textArea, Platform.OS === 'web' && styles.webInput]}
                    multiline
                    textAlignVertical="top"
                    accessibilityLabel="Notes or topic"
                  />
                  <Text style={[styles.counter, typedWords > SOURCE_WORDS && styles.counterOver]}>
                    {typedWords.toLocaleString('en-US')} / 1,500 words{typedWords > SOURCE_WORDS ? ' · the first 1,500 are used' : typedWords > 0 && typedWords <= 12 ? ' · a topic: the AI writes from what it knows' : ''}
                  </Text>
                </View>
              )}

              {error ? <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text> : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.step}>2 · Question types</Text>
              <View style={styles.chips}>
                {QUIZ_TYPE_OPTIONS.map((option) => {
                  const selected = types.includes(option.type);
                  return (
                    <Pressable
                      key={option.type}
                      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
                      onPress={() => toggleType(option.type)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      accessibilityLabel={`${option.label}: ${option.hint}`}
                    >
                      <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={themeColor(selected ? '#5B42D8' : '#A19AAA')} />
                      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{option.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {!types.length && <Text style={styles.error}>Pick at least one kind of question.</Text>}
              {(types.includes('essay') || types.includes('matching')) && <Text style={styles.hint}>Essay and Matching Type: up to 5 of each in a quiz.</Text>}
            </View>

            <View style={styles.card}>
              <Text style={styles.step}>3 · Number of questions</Text>
              <View style={styles.segment} accessibilityRole="radiogroup">
                {COUNTS.map((value) => {
                  const selected = value === count;
                  return (
                    <Pressable key={value} style={[styles.segmentOption, selected && styles.segmentSelected]} onPress={() => setCount(value)} accessibilityRole="radio" accessibilityState={{ selected }}>
                      <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>{value}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {types.length > 0 && total < count ? <Text style={styles.hint}>With only these kinds, the quiz has {total} questions.</Text> : null}
            </View>

            <Pressable style={({ pressed }) => [styles.primary, !canMake && styles.disabled, pressed && styles.pressed]} onPress={() => void make()} disabled={!canMake} accessibilityRole="button" accessibilityLabel={`Generate quiz for ${cost} tokens`}>
              <Ionicons name="sparkles" size={18} color="#FFFFFF" />
              <Text style={styles.primaryText}>Generate quiz · {cost} tokens</Text>
            </Pressable>
            <Text style={styles.footnote}>
              {short ? `You have ${tokens} tokens: ${cost - tokens} more needed. Check in your habits to earn them.` : `You have ${tokens} tokens. If the quiz cannot be made, the tokens come back.`}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F7F8FF' },
  content: { width: '100%', maxWidth: 720, alignSelf: 'center', padding: 16, paddingBottom: 40, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontWeight: '900', color: '#24212D' },
  subtitle: { fontSize: 13, lineHeight: 18, fontWeight: '600', color: '#7A7488', marginTop: 2 },
  card: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#ECE8F6' },
  step: { fontSize: 15, fontWeight: '900', color: '#2D2A3D' },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mode: { flexGrow: 1, flexBasis: 140, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 10, borderRadius: 16, borderWidth: 1.5, borderColor: '#E6E0FB', backgroundColor: '#FFFFFF' },
  modeSelected: { borderColor: '#7E5EE8', backgroundColor: '#F5F1FF' },
  modeLabel: { fontSize: 15, fontWeight: '800', color: '#6D5BC8' },
  modeLabelSelected: { color: '#5B42D8' },
  modeFormats: { fontSize: 11, fontWeight: '600', color: '#8A8492' },
  limitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  limit: { fontSize: 12, fontWeight: '600', color: '#8A8492' },
  drop: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#CBB9F7', backgroundColor: '#FAF7FF' },
  dropTitle: { fontSize: 17, fontWeight: '800', color: '#6D4FE0' },
  dropText: { fontSize: 13, fontWeight: '600', color: '#6E6887', textAlign: 'center' },
  linkBox: { gap: 10 },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#E0D9F5', backgroundColor: '#FBFAFF', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#24212D' },
  webInput: { outlineStyle: 'none' } as object,
  textArea: { minHeight: 170 },
  counter: { marginTop: 6, fontSize: 12, fontWeight: '700', color: '#8A8492' },
  counterOver: { color: '#B4701C' },
  sourceCard: { gap: 10, padding: 12, borderRadius: 16, backgroundColor: '#F5F1FF', borderWidth: 1, borderColor: '#E3DAFB' },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  sourceCopy: { flex: 1 },
  sourceName: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  sourceMeta: { marginTop: 2, fontSize: 12, fontWeight: '600', color: '#7A7488' },
  sourceActions: { flexDirection: 'row', gap: 18 },
  previewBox: { maxHeight: 220, padding: 10, borderRadius: 12, backgroundColor: '#FFFFFF' },
  previewText: { fontSize: 13, lineHeight: 19, color: '#3A3648' },
  link: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  error: { fontSize: 13, lineHeight: 18, fontWeight: '700', color: '#C2412F' },
  hint: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#E0D9F5', backgroundColor: '#FFFFFF' },
  chipSelected: { borderColor: '#7E5EE8', backgroundColor: '#F1ECFF' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#5F5A70' },
  chipTextSelected: { color: '#4A34C4' },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: '#F1EEF8' },
  segmentOption: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  segmentSelected: { backgroundColor: '#FFFFFF', shadowColor: '#201444', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 } },
  segmentText: { fontSize: 15, fontWeight: '800', color: '#7A7488' },
  segmentTextSelected: { color: '#5B42D8' },
  primary: { flexDirection: 'row', gap: 8, minHeight: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  primarySmall: { minHeight: 46, minWidth: 150, paddingHorizontal: 22, borderRadius: 999, alignItems: 'center', justifyContent: 'center', backgroundColor: '#7E5EE8' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.85 },
  footnote: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488', textAlign: 'center' },
  making: { alignItems: 'center', paddingVertical: 44, gap: 12 },
  makingIcon: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  makingSparkle: { position: 'absolute' },
  makingTitle: { fontSize: 20, fontWeight: '900', color: '#24212D' },
  makingStep: { fontSize: 14, fontWeight: '600', color: '#5F5A70' },
  bar: { width: '80%', maxWidth: 320, height: 8, borderRadius: 4, backgroundColor: '#EEEAF5', overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: '#7E5EE8' },
  tip: { maxWidth: 360, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#8A8492', textAlign: 'center' },
}, {
  screen: { flex: 1, backgroundColor: '#14121A' },
  back: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D1A24' },
  card: { gap: 12, padding: 16, borderRadius: 20, backgroundColor: '#1D1A24', borderWidth: 1, borderColor: '#2E2940' },
  mode: { flexGrow: 1, flexBasis: 140, minHeight: 96, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 10, borderRadius: 16, borderWidth: 1.5, borderColor: '#352C52', backgroundColor: '#1D1A24' },
  modeSelected: { borderColor: '#9C86F5', backgroundColor: '#2A2440' },
  drop: { alignItems: 'center', gap: 8, paddingVertical: 26, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1.5, borderStyle: 'dashed', borderColor: '#4A3F70', backgroundColor: '#211D2D' },
  input: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: '#352C52', backgroundColor: '#211D2D', paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#F2EFF8' },
  sourceCard: { gap: 10, padding: 12, borderRadius: 16, backgroundColor: '#2A2440', borderWidth: 1, borderColor: '#3B3260' },
  sourceIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D1A24' },
  previewBox: { maxHeight: 220, padding: 10, borderRadius: 12, backgroundColor: '#1D1A24' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#352C52', backgroundColor: '#1D1A24' },
  chipSelected: { borderColor: '#9C86F5', backgroundColor: '#2A2440' },
  segment: { flexDirection: 'row', gap: 6, padding: 4, borderRadius: 14, backgroundColor: '#211D2D' },
  segmentSelected: { backgroundColor: '#2E2940' },
  bar: { width: '80%', maxWidth: 320, height: 8, borderRadius: 4, backgroundColor: '#2E2940', overflow: 'hidden' },
});
