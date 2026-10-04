// What the Premium Themes and Custom Title rewards unlock: the theme picker and the title editor.
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { useAppColorScheme } from '@/hooks/color-scheme-context';
import { FramedAvatar, PROFILE_FRAMES } from '@/components/framed-avatar';
import { saveFrame, saveTitle, useRewards } from '@/hooks/use-rewards';
import { APP_THEMES, createThemedStyles, isAppTheme, themedColor, useThemeColor, useThemedStyles, type AppTheme } from '@/hooks/use-themed-styles';

const TITLE_IDEAS = ['Early Riser', 'Night Owl', 'Bookworm', 'Hydration Hero', 'Streak Master', 'Gym Buddy', 'Focus Mode', 'Habit Builder'];
const TITLE_PATTERN = /^[\p{L}\p{N} .,'!&-]+$/u;

/** The app colour themes as swatches; the chosen one is ticked. */
export function ThemePicker({ value, onChange }: { value: AppTheme; onChange: (theme: AppTheme) => void }) {
  const styles = useThemedStyles(themedStyles);
  return (
    <View style={styles.themeRow} accessibilityRole="radiogroup" accessibilityLabel="App theme">
      {APP_THEMES.map((theme) => {
        const selected = theme.id === value;
        return (
          <Pressable
            key={theme.id}
            style={({ pressed }) => [styles.themeOption, pressed && styles.pressed]}
            onPress={() => onChange(theme.id)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={`${theme.name} theme`}
          >
            <View style={[styles.swatchRing, selected && { borderColor: themedColor('#5B42D8', theme.id) }]}>
              <View style={[styles.swatch, { backgroundColor: themedColor('#5B42D8', theme.id) }]}>
                <View style={[styles.swatchTint, { backgroundColor: themedColor('#EEE8FF', theme.id) }]} />
                {selected && <Ionicons name="checkmark" size={18} color="#FFFFFF" />}
              </View>
            </View>
            <Text style={[styles.themeName, selected && styles.themeNameSelected]}>{theme.name}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The app theme in the student's preferences ('classic' when unset). */
export function useChosenTheme(): [AppTheme, (theme: AppTheme) => void] {
  const { preferences, updatePreferences } = useAppColorScheme();
  return [isAppTheme(preferences.appTheme) ? preferences.appTheme : 'classic', (theme) => updatePreferences({ appTheme: theme })];
}

/** Picks the frame around the student's photo (Profile Frames reward). */
export function FrameSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const { avatarImage, profile } = useAppColorScheme();
  const { frame } = useRewards();
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const initial = (profile.firstName || profile.fullName || 'H').trim().charAt(0).toUpperCase();
  const choose = async (id: string) => {
    setSaving(id || 'none');
    setError('');
    const result = await saveFrame(id);
    setSaving('');
    if (!result.ok) setError(result.message);
  };
  const face = (size: number) => (
    <View style={[styles.frameFace, { width: size, height: size, borderRadius: size / 2 }]}>
      {avatarImage ? <Image source={{ uri: avatarImage }} style={{ width: size, height: size }} /> : <Text style={[styles.frameInitial, { fontSize: size * 0.42 }]}>{initial}</Text>}
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close profile frames">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={[styles.icon, styles.frameIcon]}><Ionicons name="person-circle" size={24} color="#FFFFFF" /></View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Profile frame</Text>
              <Text style={styles.subtitle}>Shown on your profile and the leaderboard.</Text>
            </View>
          </View>
          <View style={styles.framePreview}>
            <FramedAvatar frame={frame} size={78}>{face(78)}</FramedAvatar>
          </View>
          <View style={styles.frameRow} accessibilityRole="radiogroup">
            {[{ id: '', name: 'None' }, ...PROFILE_FRAMES].map((item) => {
              const selected = frame === item.id;
              return (
                <Pressable key={item.id || 'none'} style={({ pressed }) => [styles.frameOption, selected && styles.frameOptionOn, pressed && styles.pressed]} onPress={() => void choose(item.id)} disabled={Boolean(saving)} accessibilityRole="radio" accessibilityState={{ selected }} accessibilityLabel={`${item.name} frame`}>
                  <FramedAvatar frame={item.id} size={34}>{face(34)}</FramedAvatar>
                  <Text style={[styles.themeName, selected && styles.themeNameSelected]}>{saving === (item.id || 'none') ? 'Saving…' : item.name}</Text>
                </Pressable>
              );
            })}
          </View>
          {Boolean(error) && <Text style={styles.errorText}>{error}</Text>}
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
          <Text style={[styles.hintText, styles.centerHint]}>Other students see your frame on the leaderboard.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function ThemeSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [theme, setTheme] = useChosenTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close app themes">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={styles.icon}><Ionicons name="color-palette" size={24} color="#FFFFFF" /></View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>App theme</Text>
              <Text style={styles.subtitle}>Buttons, tabs and highlights take its colour.</Text>
            </View>
          </View>
          <ThemePicker value={theme} onChange={setTheme} />
          <View style={styles.hint}>
            <Ionicons name="information-circle" size={16} color={themeColor('#5B42D8')} />
            <Text style={styles.hintText}>Streaks stay orange, done stays green and freezes stay blue, so they always mean the same thing. Change it any time in Settings.</Text>
          </View>
          <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={onClose} accessibilityRole="button">
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Sets the title under the student's name, with ideas to tap. Render it only while it is open. */
export function TitleSheet({ current, onClose, onSaved }: { current: string; onClose: () => void; onSaved?: (title: string) => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const [draft, setDraft] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cleaned = draft.replace(/\s+/g, ' ').trim();
  const invalid = cleaned.length > 0 && (cleaned.length < 2 || !TITLE_PATTERN.test(cleaned));

  const save = async (title: string) => {
    setBusy(true);
    setError('');
    const result = await saveTitle(title);
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSaved?.(result.title);
    onClose();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close title editor">
        <Pressable style={styles.sheet} onPress={() => undefined} accessibilityViewIsModal>
          <View style={styles.header}>
            <View style={[styles.icon, styles.titleIcon]}><Ionicons name="ribbon" size={24} color="#FFFFFF" /></View>
            <View style={styles.headerCopy}>
              <Text style={styles.title}>Your title</Text>
              <Text style={styles.subtitle}>Shown under your name on your profile and the leaderboard.</Text>
            </View>
          </View>
          <TextInput
            value={draft}
            onChangeText={(text) => {
              setDraft(text);
              setError('');
            }}
            maxLength={24}
            placeholder="e.g. Early Riser"
            placeholderTextColor={themeColor('#A09AAA')}
            style={[styles.input, invalid && styles.inputInvalid]}
            accessibilityLabel="Title"
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!invalid && !busy && cleaned !== current) void save(cleaned);
            }}
          />
          <Text style={[styles.inputHint, invalid && styles.errorText]}>
            {invalid ? 'Use 2 to 24 letters, numbers, spaces or . , \' ! & -' : `${cleaned.length}/24`}
          </Text>
          <View style={styles.ideas}>
            {TITLE_IDEAS.map((idea) => (
              <Pressable key={idea} style={({ pressed }) => [styles.idea, cleaned === idea && styles.ideaSelected, pressed && styles.pressed]} onPress={() => setDraft(idea)} accessibilityRole="button">
                <Text style={[styles.ideaText, cleaned === idea && styles.ideaTextSelected]}>{idea}</Text>
              </Pressable>
            ))}
          </View>
          {Boolean(error) && <Text style={styles.errorText}>{error}</Text>}
          <Pressable
            style={({ pressed }) => [styles.primary, (invalid || busy || cleaned === current) && styles.primaryDisabled, pressed && styles.pressed]}
            onPress={() => void save(cleaned)}
            disabled={invalid || busy || cleaned === current}
            accessibilityRole="button"
          >
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryText}>{cleaned ? 'Save title' : 'Remove title'}</Text>}
          </Pressable>
          {Boolean(current) && cleaned === current && (
            <Pressable style={styles.secondary} onPress={() => void save('')} disabled={busy} accessibilityRole="button">
              <Text style={styles.secondaryText}>Remove title</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** The title as a small pill under a name. */
export function TitleBadge({ title, onPress, style }: { title: string; onPress?: () => void; style?: object }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const content = (
    <>
      <Ionicons name={title ? 'ribbon' : 'add-circle-outline'} size={12} color={themeColor('#5B42D8')} />
      <Text style={styles.badgeText} numberOfLines={1}>{title || 'Add your title'}</Text>
      {onPress && <Ionicons name="pencil" size={10} color={themeColor('#8A7BD5')} />}
    </>
  );
  if (!onPress) return <View style={[styles.badge, style]}>{content}</View>;
  return (
    <Pressable style={({ pressed }) => [styles.badge, style, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button" accessibilityLabel={title ? `Your title: ${title}. Edit` : 'Add your title'}>
      {content}
    </Pressable>
  );
}

const themedStyles = createThemedStyles({
  backdrop: { flex: 1, backgroundColor: 'rgba(29, 23, 49, 0.45)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  sheet: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 26, padding: 20, gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  titleIcon: { backgroundColor: '#C2549B' },
  frameIcon: { backgroundColor: '#E9A21B' },
  framePreview: { alignItems: 'center', paddingVertical: 6 },
  frameFace: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: '#EEE9FF' },
  frameInitial: { fontWeight: '900', color: '#5B42D8' },
  frameRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 6 },
  frameOption: { flexGrow: 1, flexBasis: '18%', alignItems: 'center', gap: 6, paddingVertical: 8, borderRadius: 14, borderWidth: 2, borderColor: 'transparent' },
  frameOptionOn: { borderColor: '#5B42D8', backgroundColor: '#F4F0FF' },
  centerHint: { textAlign: 'center', marginTop: -4 },
  headerCopy: { flex: 1 },
  title: { fontSize: 20, fontWeight: '900', color: '#24212D' },
  subtitle: { marginTop: 2, fontSize: 13, fontWeight: '600', color: '#6A6573' },
  themeRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 6 },
  themeOption: { flex: 1, alignItems: 'center', gap: 6, paddingVertical: 4 },
  swatchRing: { width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: 'transparent', alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  swatchTint: { position: 'absolute', right: -10, bottom: -10, width: 26, height: 26, borderRadius: 13 },
  themeName: { fontSize: 11, fontWeight: '700', color: '#6A6573' },
  themeNameSelected: { color: '#24212D', fontWeight: '900' },
  hint: { flexDirection: 'row', gap: 8, padding: 12, borderRadius: 14, backgroundColor: '#F4F1FF' },
  hintText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#4A4556' },
  input: { height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: '#E4DDF4', backgroundColor: '#FAF9FD', paddingHorizontal: 14, fontSize: 16, fontWeight: '700', color: '#24212D' },
  inputInvalid: { borderColor: '#D9705C' },
  inputHint: { marginTop: -8, fontSize: 11, fontWeight: '700', color: '#8A8492', textAlign: 'right' },
  ideas: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  idea: { borderRadius: 999, borderWidth: 1, borderColor: '#E4DDF4', paddingHorizontal: 11, paddingVertical: 7 },
  ideaSelected: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  ideaText: { fontSize: 12, fontWeight: '700', color: '#4A4556' },
  ideaTextSelected: { color: '#FFFFFF' },
  errorText: { fontSize: 12, fontWeight: '700', color: '#C2543E' },
  primary: { height: 50, borderRadius: 16, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  primaryDisabled: { backgroundColor: '#B8AEDF' },
  primaryText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  secondary: { marginTop: -6, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 13, fontWeight: '800', color: '#C2543E' },
  badge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, maxWidth: '100%', borderRadius: 999, backgroundColor: '#F1EDFF', paddingHorizontal: 9, paddingVertical: 4 },
  badgeText: { flexShrink: 1, fontSize: 11, fontWeight: '800', color: '#4A3BA0' },
  pressed: { opacity: 0.85 },
});
