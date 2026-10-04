// The AI chat used by the AI Assistant (Insights) and the AI Coach (Profile): a conversation of
// bubbles, a typing indicator while the server answers, suggested questions and a composer.
// The server reads the student's habits itself, so each question is sent on its own.
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

// Web: the composer shows its own focus border instead of the browser's ring.
const WEB_NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

/** What a screen's ask function gives back: an answer, or a message to show instead. */
export type ChatAnswer = { ok: true; answer: string; note?: string } | { ok: false; message: string; tone?: 'warning' | 'error' };
type ChatMessage = { id: number; role: 'user' | 'ai' | 'note'; text: string; note?: string; tone?: 'warning' | 'error' };

/** The conversation; kept by the screen so it survives closing and reopening the sheet. */
export function useAiChat(ask: (question: string) => Promise<ChatAnswer>) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const lastId = useRef(0);
  const add = (message: Omit<ChatMessage, 'id'>) => {
    lastId.current += 1;
    const id = lastId.current;
    setMessages((current) => [...current, { ...message, id }]);
  };
  const send = async (text: string) => {
    const question = text.trim().slice(0, 500);
    if (!question || loading) return;
    add({ role: 'user', text: question });
    setLoading(true);
    try {
      const result = await ask(question);
      if (result.ok) add({ role: 'ai', text: result.answer, note: result.note });
      else add({ role: 'note', text: result.message, tone: result.tone ?? 'error' });
    } finally {
      setLoading(false);
    }
  };
  return { messages, loading, send, reset: () => setMessages([]) };
}
export type AiChat = ReturnType<typeof useAiChat>;

export function AiAvatar({ size = 30 }: { size?: number }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
      <Ionicons name="sparkles" size={Math.round(size * 0.5)} color={themeColor('#FFFFFF')} />
    </View>
  );
}

function TypingDots() {
  const styles = useThemedStyles(themedStyles);
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(progress, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [progress]);
  return (
    <View style={styles.dots} accessibilityLabel="HabitAI is typing">
      {[0, 1, 2].map((index) => {
        const inputRange = [0, 0.2 + index * 0.2, 0.4 + index * 0.2, 1];
        return (
          <Animated.View
            key={index}
            style={[styles.dot, {
              opacity: progress.interpolate({ inputRange, outputRange: [0.35, 1, 0.35, 0.35] }),
              transform: [{ translateY: progress.interpolate({ inputRange, outputRange: [0, -3, 0, 0] }) }],
            }]}
          />
        );
      })}
    </View>
  );
}

type SheetProps = {
  chat: AiChat;
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle: string;
  /** The first message, written from the student's data before anything is asked. */
  greeting: string;
  suggestions: string[];
  placeholder: string;
  /** For example "10 tokens per answer · 120 left". */
  costLabel?: string;
  footnote: string;
  /** Focus the composer when the sheet opens (not when it opened to send a suggestion). */
  autoFocus?: boolean;
};

export function AiChatSheet({ chat, visible, onClose, title, subtitle, greeting, suggestions, placeholder, costLabel, footnote, autoFocus = false }: SheetProps) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [input, setInput] = useState('');
  const [focused, setFocused] = useState(false);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const scrollRef = useRef<ScrollView | null>(null);

  // Android: lift the sheet above the keyboard (iOS uses KeyboardAvoidingView; the web resizes itself).
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const shown = Keyboard.addListener('keyboardDidShow', (event) => setKeyboardInset(event.endCoordinates?.height ?? 0));
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardInset(0));
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, []);

  const submit = (text = input) => {
    if (!text.trim() || chat.loading) return;
    void chat.send(text);
    setInput('');
  };
  const canSend = Boolean(input.trim()) && !chat.loading;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView style={styles.backdrop} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Tapping above the sheet closes it; keyboards and screen readers use the close button. */}
        <Pressable style={styles.backdropTap} onPress={onClose} accessible={false} focusable={false} />
        <View style={[styles.sheet, keyboardInset > 0 && { marginBottom: keyboardInset }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View>
              <AiAvatar size={44} />
              <View style={styles.onlineDot} />
            </View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text>
            </View>
            {chat.messages.length > 0 && (
              <Pressable style={styles.iconButton} onPress={chat.reset} disabled={chat.loading} accessibilityRole="button" accessibilityLabel="Start a new chat">
                <Ionicons name="refresh" size={18} color={themeColor('#6A6580')} />
              </Pressable>
            )}
            <Pressable style={styles.iconButton} onPress={onClose} accessibilityRole="button" accessibilityLabel={`Close ${title}`}>
              <Ionicons name="close" size={20} color={themeColor('#6A6580')} />
            </Pressable>
          </View>
          {costLabel ? (
            <View style={styles.costPill}>
              <Ionicons name="diamond" size={12} color={themeColor('#5B42D8')} />
              <Text style={styles.costText}>{costLabel}</Text>
            </View>
          ) : null}

          <ScrollView
            ref={scrollRef}
            style={styles.messages}
            contentContainerStyle={styles.messagesContent}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.aiRow}>
              <AiAvatar />
              <View style={styles.aiBubble}><Text style={styles.aiText} selectable>{greeting}</Text></View>
            </View>
            {chat.messages.map((message) => message.role === 'user' ? (
              <View key={message.id} style={styles.userRow}>
                <View style={styles.userBubble}><Text style={styles.userText} selectable>{message.text}</Text></View>
              </View>
            ) : message.role === 'ai' ? (
              <View key={message.id} style={styles.aiRow} accessibilityLiveRegion="polite">
                <AiAvatar />
                <View style={styles.aiColumn}>
                  <View style={styles.aiBubble}><Text style={styles.aiText} selectable>{message.text}</Text></View>
                  {message.note ? <Text style={styles.bubbleNote}>{message.note}</Text> : null}
                </View>
              </View>
            ) : (
              <View key={message.id} style={[styles.note, message.tone === 'warning' && styles.noteWarning]} accessibilityLiveRegion="polite">
                <Ionicons name={message.tone === 'warning' ? 'information-circle' : 'alert-circle'} size={15} color={message.tone === 'warning' ? themeColor('#A0661A') : themeColor('#B52E4D')} />
                <Text style={[styles.noteText, message.tone === 'warning' && styles.noteTextWarning]}>{message.text}</Text>
              </View>
            ))}
            {chat.loading && (
              <View style={styles.aiRow}>
                <AiAvatar />
                <View style={styles.aiBubble}><TypingDots /></View>
              </View>
            )}
          </ScrollView>

          {!chat.loading && suggestions.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.suggestions} contentContainerStyle={styles.suggestionsContent} keyboardShouldPersistTaps="handled">
              {suggestions.map((suggestion) => (
                <Pressable key={suggestion} style={({ pressed }) => [styles.chip, pressed && styles.pressed]} onPress={() => submit(suggestion)} accessibilityRole="button" accessibilityLabel={`Ask: ${suggestion}`}>
                  <Text style={styles.chipText}>{suggestion}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}

          <View style={styles.composer}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder={placeholder}
              placeholderTextColor={themeColor('#9A94A4')}
              style={[styles.input, focused && styles.inputFocused, WEB_NO_RING]}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              multiline
              maxLength={500}
              autoCapitalize="sentences"
              autoFocus={autoFocus}
              accessibilityLabel={placeholder}
              onKeyPress={(event) => {
                // Web: Enter sends, Shift+Enter adds a line.
                const key = event.nativeEvent as unknown as { key: string; shiftKey?: boolean };
                if (Platform.OS === 'web' && key.key === 'Enter' && !key.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
            />
            <Pressable style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && styles.pressed]} onPress={() => submit()} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Send question">
              <Ionicons name="arrow-up" size={21} color={themeColor('#FFFFFF')} />
            </Pressable>
          </View>
          <Text style={styles.footnote}>{footnote}</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** The way into the chat on a screen: suggested questions start it straight away. */
export function AskAiCard({ title, subtitle, suggestions, onOpen, onAsk }: { title: string; subtitle: string; suggestions: string[]; onOpen: () => void; onAsk: (question: string) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <AiAvatar size={40} />
        <View style={styles.headerCopy}>
          <Text style={styles.cardTitle}>{title}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.cardChips}>
        {suggestions.map((suggestion) => (
          <Pressable key={suggestion} style={({ pressed }) => [styles.cardChip, pressed && styles.pressed]} onPress={() => onAsk(suggestion)} accessibilityRole="button" accessibilityLabel={`Ask: ${suggestion}`}>
            <Ionicons name="chatbubble-ellipses-outline" size={14} color={themeColor('#5B42D8')} />
            <Text style={styles.cardChipText} numberOfLines={1}>{suggestion}</Text>
            <Ionicons name="arrow-forward" size={14} color={themeColor('#8E7AE8')} />
          </Pressable>
        ))}
      </View>
      <Pressable style={({ pressed }) => [styles.cardButton, pressed && styles.pressed]} onPress={onOpen} accessibilityRole="button">
        <Ionicons name="chatbubbles" size={17} color={themeColor('#FFFFFF')} />
        <Text style={styles.cardButtonText}>Ask your own question</Text>
      </Pressable>
    </View>
  );
}

const themedStyles = createThemedStyles({
  avatar: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 21, paddingHorizontal: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#7C64E6' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  backdropTap: { flex: 1 },
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', height: '88%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#DCD7E8', marginTop: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: '#F0EEF5' },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: '#2DAA76', borderWidth: 2, borderColor: '#FFFFFF' },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 18, fontWeight: '900', color: '#24212D' },
  subtitle: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A728B', marginTop: 2 },
  iconButton: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F1F7' },
  costPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center', marginTop: 10, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: '#F1ECFF' },
  costText: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  messages: { flex: 1 },
  messagesContent: { padding: 16, gap: 14 },
  aiRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, maxWidth: '90%' },
  aiColumn: { flexShrink: 1, gap: 4 },
  aiBubble: { flexShrink: 1, backgroundColor: '#F3F0FF', borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11 },
  aiText: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: '#2D2A3D' },
  bubbleNote: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: '#8A8492', paddingLeft: 4 },
  userRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  userBubble: { maxWidth: '82%', backgroundColor: '#5B42D8', borderRadius: 18, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 11 },
  userText: { fontSize: 14, lineHeight: 21, fontWeight: '600', color: '#FFFFFF' },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, alignSelf: 'stretch', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 14, backgroundColor: '#FFF0F1' },
  noteWarning: { backgroundColor: '#FFF6E5' },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#B52E4D' },
  noteTextWarning: { color: '#8A5A12' },
  suggestions: { flexGrow: 0 },
  suggestionsContent: { gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  chip: { paddingHorizontal: 13, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: '#DED6FA', backgroundColor: '#FAF8FF' },
  chipText: { fontSize: 12, fontWeight: '800', color: '#5B42D8' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 14, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  input: { flex: 1, minHeight: 46, maxHeight: 110, borderRadius: 23, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, fontSize: 16, lineHeight: 21, color: '#2D2A3D', backgroundColor: '#F5F3FA', borderWidth: 2, borderColor: 'transparent' },
  inputFocused: { borderColor: '#8E7AE8' },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  sendDisabled: { opacity: 0.4 },
  pressed: { opacity: 0.8 },
  footnote: { fontSize: 11, lineHeight: 15, fontWeight: '600', color: '#8A8492', textAlign: 'center', paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14 },
  card: { backgroundColor: '#F4F1FF', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: '#E6E0FB' },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardTitle: { fontSize: 16, fontWeight: '900', color: '#24212D' },
  cardChips: { gap: 8 },
  cardChip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#FFFFFF' },
  cardChipText: { flex: 1, fontSize: 13, fontWeight: '700', color: '#3B3650' },
  cardButton: { height: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#5B42D8' },
  cardButtonText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
}, {
  // Dark mode: the card and bubbles sit a step above the sheet.
  sheet: { width: '100%', maxWidth: 640, alignSelf: 'center', height: '88%', backgroundColor: '#1B1823', borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' },
  card: { backgroundColor: '#211C33', borderRadius: 22, padding: 16, gap: 12, borderWidth: 1, borderColor: '#352C52' },
  cardChip: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 12, borderRadius: 14, backgroundColor: '#2B2540' },
  aiBubble: { flexShrink: 1, backgroundColor: '#2B2540', borderRadius: 18, borderBottomLeftRadius: 6, paddingHorizontal: 14, paddingVertical: 11 },
  onlineDot: { position: 'absolute', right: 0, bottom: 0, width: 13, height: 13, borderRadius: 7, backgroundColor: '#2DAA76', borderWidth: 2, borderColor: '#1B1823' },
});
