// Faculty mode: a shortcut from the app to Class Pulse in the HabitAI Admin Panel, which faculty
// sign in to with the same email and password as the app (both use the same accounts).
import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Linking, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ADMIN_PANEL_URL } from '@/constants/faculty';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

export function ClassPulseCard({ style }: { style?: StyleProp<ViewStyle> }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View style={[styles.card, style]}>
      <View style={styles.icon}><Ionicons name="pulse" size={20} color={themeColor('#5B42D8')} /></View>
      <View style={styles.copy}>
        <Text style={styles.title}>Your class</Text>
        <Text style={styles.body}>How your students are doing with their habits, as a group. No student is named.</Text>
        <Text style={styles.hint}>Opens the Admin Panel · sign in with this email and password</Text>
      </View>
      <Pressable
        style={styles.button}
        onPress={() => void Linking.openURL(`${ADMIN_PANEL_URL}/class-pulse`)}
        accessibilityRole="link"
        accessibilityLabel="Open Class Pulse in the HabitAI Admin Panel"
      >
        <Text style={styles.buttonText}>Open</Text>
        <Ionicons name="open-outline" size={14} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const themedStyles = createThemedStyles({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 18, backgroundColor: '#FFFFFF', shadowColor: '#201444', shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  icon: { width: 40, height: 40, borderRadius: 14, backgroundColor: '#F1EEFF', alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1 },
  title: { fontSize: 14, fontWeight: '800', color: '#2F2D3C' },
  body: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#777282' },
  hint: { marginTop: 4, fontSize: 11, lineHeight: 15, fontWeight: '700', color: '#5B42D8' },
  button: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: '#5B42D8' },
  buttonText: { fontSize: 13, fontWeight: '800', color: '#FFFFFF' },
});
