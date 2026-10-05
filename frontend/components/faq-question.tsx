// One FAQ question on Help & Support and the FAQ screen; tap it to show the answer.
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import type { FaqItem } from '@/constants/help-faq';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

type Props = {
  item: FaqItem;
  open: boolean;
  onToggle: () => void;
  /** Shows the topic above the question (search results mix topics). */
  topic?: { title: string; color: string };
  /** Draws a line above the row (every row but the first in a card). */
  divider?: boolean;
};

export function FaqQuestion({ item, open, onToggle, topic, divider = false }: Props) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <Pressable style={({ pressed }) => [styles.row, divider && styles.divider, pressed && styles.pressed]} onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={item.question}>
      <View style={styles.top}>
        <View style={styles.copy}>
          {topic && (
            <View style={styles.topic}>
              <View style={[styles.topicDot, { backgroundColor: topic.color }]} />
              <Text style={styles.topicText}>{topic.title}</Text>
            </View>
          )}
          <Text style={styles.question}>{item.question}</Text>
        </View>
        <View style={[styles.toggle, open && styles.toggleOpen]}>
          <Ionicons name={open ? 'remove' : 'add'} size={16} color={open ? '#FFFFFF' : themeColor('#5B42D8')} />
        </View>
      </View>
      {open && <Text style={styles.answer}>{item.answer}</Text>}
    </Pressable>
  );
}

const themedStyles = createThemedStyles({
  row: { paddingVertical: 14 },
  divider: { borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  pressed: { opacity: 0.75 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  copy: { flex: 1, gap: 4 },
  topic: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  topicDot: { width: 7, height: 7, borderRadius: 4 },
  topicText: { fontSize: 11, fontWeight: '800', color: '#736D7D' },
  question: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#2D2A3D' },
  toggle: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F1ECFF' },
  toggleOpen: { backgroundColor: '#5B42D8' },
  answer: { fontSize: 13, lineHeight: 20, fontWeight: '600', color: '#5F5A69', marginTop: 8, paddingRight: 42 },
}, {
  divider: { borderTopColor: '#2A2633' },
  toggle: { backgroundColor: '#2B2540' },
});
