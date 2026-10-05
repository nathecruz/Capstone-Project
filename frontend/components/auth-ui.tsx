// The shared look of the sign-in and sign-up screens: a brand header (or, on laptops, a brand
// panel beside the form), a white card for the form, and fields with an icon and a focus ring.
// These screens are shown before an account (and its dark mode) is known, so they are light only.
import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StatusBar as RNStatusBar, StyleSheet, Text, TextInput, useWindowDimensions, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { withReadableText } from '@/hooks/use-themed-styles';

export const BRAND = '#5B42D8';
/** Laptops and wide tablets get the brand panel beside the form. */
const WIDE_LAYOUT = 900;
// Web: fields show their own focus border instead of the browser's ring.
const NO_RING = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;

const FEATURES: { icon: keyof typeof Ionicons.glyphMap; title: string; text: string }[] = [
  { icon: 'checkmark-done-circle', title: 'Daily check-ins', text: 'Streaks, tokens and a habit buddy that grows with you.' },
  { icon: 'sparkles', title: 'AI from your own data', text: 'Insights, predictions and a coach that knows your habits.' },
  { icon: 'flag', title: 'Goals in clear steps', text: 'Turn a goal into a plan you can tick off.' },
];

export function BrandMark({ size = 48, inverted = false }: { size?: number; inverted?: boolean }) {
  return (
    <View style={[styles.mark, { width: size, height: size, borderRadius: size * 0.32 }, inverted && styles.markInverted]}>
      <Ionicons name="checkmark-done" size={size * 0.55} color={inverted ? BRAND : '#FFFFFF'} />
      <View style={[styles.markSpark, inverted && styles.markSparkInverted]}>
        <Ionicons name="sparkles" size={size * 0.24} color={inverted ? '#FFFFFF' : BRAND} />
      </View>
    </View>
  );
}

export function AuthScreen({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer?: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= WIDE_LAYOUT;
  return (
    <SafeAreaView style={styles.safe}>
      <RNStatusBar barStyle="dark-content" backgroundColor="#F3F1FB" />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scroll, wide && styles.scrollWide]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.blobOne} pointerEvents="none" />
          <View style={styles.blobTwo} pointerEvents="none" />
          <View style={[styles.layout, wide && styles.layoutWide]}>
            {wide && (
              <View style={styles.panel}>
                <View style={styles.panelBrand}>
                  <BrandMark size={52} inverted />
                  <Text style={styles.panelName}>HabitAI</Text>
                </View>
                <Text style={styles.panelTitle}>Build habits that stick.</Text>
                <Text style={styles.panelText}>Small daily steps, tracked for you, with AI that learns from your own check-ins.</Text>
                <View style={styles.features}>
                  {FEATURES.map((feature) => (
                    <View key={feature.title} style={styles.feature}>
                      <View style={styles.featureIcon}><Ionicons name={feature.icon} size={20} color="#FFFFFF" /></View>
                      <View style={styles.featureCopy}>
                        <Text style={styles.featureTitle}>{feature.title}</Text>
                        <Text style={styles.featureText}>{feature.text}</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.panelFoot}>
                  <Ionicons name="shield-checkmark" size={15} color="#D8D0FF" />
                  <Text style={styles.panelFootText}>Your data is protected under the Data Privacy Act of 2012.</Text>
                </View>
              </View>
            )}
            <View style={[styles.column, wide && styles.columnWide]}>
              {!wide && (
                <View style={styles.brandRow}>
                  <BrandMark />
                  <Text style={styles.brandName}>HabitAI</Text>
                </View>
              )}
              <Text style={[styles.title, wide && styles.titleWide]}>{title}</Text>
              <Text style={[styles.subtitle, wide && styles.subtitleWide]}>{subtitle}</Text>
              <View style={styles.card}>{children}</View>
              {footer}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Something at the end of the field, like a show-password button. */
  right?: React.ReactNode;
  /** Shown under the field. */
  hint?: React.ReactNode;
};

export const AuthField = React.forwardRef<TextInput, FieldProps>(function AuthField({ label, icon, right, hint, style, onFocus, onBlur, ...input }, ref) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <Ionicons name={icon} size={19} color={focused ? BRAND : '#8A8497'} />
        <TextInput
          ref={ref}
          placeholderTextColor="#9A94A8"
          style={[styles.input, NO_RING, style]}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          accessibilityLabel={label}
          {...input}
        />
        {right}
      </View>
      {hint}
    </View>
  );
});

/** A password field with a show/hide button. */
export const PasswordField = React.forwardRef<TextInput, Omit<FieldProps, 'right' | 'icon' | 'secureTextEntry'> & { icon?: keyof typeof Ionicons.glyphMap }>(function PasswordField({ icon = 'lock-closed-outline', label, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  return (
    <AuthField
      ref={ref}
      label={label}
      icon={icon}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      right={(
        <Pressable onPress={() => setVisible((current) => !current)} style={styles.eye} accessibilityRole="button" accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`} hitSlop={6}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color="#6E6887" />
        </Pressable>
      )}
      {...props}
    />
  );
});

/**
 * A field that opens a picker (date, list). Without onPress it is a plain box, for a picker
 * that sits inside it (the web date input).
 */
export function SelectField({ label, icon, value, placeholder, onPress, accessibilityLabel, children, hint }: { label: string; icon: keyof typeof Ionicons.glyphMap; value: string; placeholder: string; onPress?: () => void; accessibilityLabel: string; children?: React.ReactNode; hint?: React.ReactNode }) {
  const content = (
    <>
      <Ionicons name={icon} size={19} color="#8A8497" />
      <Text style={[styles.selectText, !value && styles.placeholder]} numberOfLines={1}>{value || placeholder}</Text>
      <Ionicons name="chevron-down" size={18} color="#6E6887" />
      {children}
    </>
  );
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {onPress ? (
        <Pressable style={({ pressed }) => [styles.inputWrap, pressed && styles.inputWrapFocused]} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel}>
          {content}
        </Pressable>
      ) : (
        <View style={styles.inputWrap}>{content}</View>
      )}
      {hint}
    </View>
  );
}

export function PrimaryButton({ label, busyLabel, busy, onPress, icon = 'arrow-forward' }: { label: string; busyLabel?: string; busy?: boolean; onPress: () => void; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <Pressable style={({ pressed }) => [styles.primary, busy && styles.primaryBusy, pressed && styles.pressed]} onPress={onPress} disabled={busy} accessibilityRole="button" accessibilityState={{ busy: Boolean(busy), disabled: Boolean(busy) }}>
      <Text style={styles.primaryText}>{busy && busyLabel ? busyLabel : label}</Text>
      {!busy && <Ionicons name={icon} size={18} color="#FFFFFF" />}
    </Pressable>
  );
}

export const authStyles = StyleSheet.create(withReadableText({
  sectionTitle: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE9FF' },
  sectionNumberText: { fontSize: 12, fontWeight: '900', color: BRAND },
  sectionText: { fontSize: 15, fontWeight: '900', color: '#24212D' },
  divider: { height: 1, backgroundColor: '#EFEDF5', marginVertical: 18 },
  hint: { fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#6E6887', marginTop: 6 },
  link: { color: BRAND, fontWeight: '900' },
  // A fixed style: the router's Link wrapper does not pass a pressed-state style on.
  secondary: { minHeight: 50, borderRadius: 14, borderWidth: 1.5, borderColor: '#DCD5F7', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8, marginTop: 14 },
  secondaryText: { fontSize: 15, fontWeight: '900', color: BRAND },
  orRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 20 },
  orLine: { flex: 1, height: 1, backgroundColor: '#E7E3F1' },
  orText: { fontSize: 12, fontWeight: '700', color: '#8A8497' },
  trust: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 18 },
  trustText: { fontSize: 12, fontWeight: '600', color: '#7A7488' },
  pressed: { opacity: 0.8 },
}));

const styles = StyleSheet.create(withReadableText({
  safe: { flex: 1, backgroundColor: '#F3F1FB' },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 28, overflow: 'hidden' },
  scrollWide: { paddingHorizontal: 40, paddingVertical: 40 },
  blobOne: { position: 'absolute', top: -120, right: -90, width: 300, height: 300, borderRadius: 150, backgroundColor: '#E4DEFF' },
  blobTwo: { position: 'absolute', bottom: -110, left: -100, width: 280, height: 280, borderRadius: 140, backgroundColor: '#DDF1FF' },
  layout: { width: '100%', maxWidth: 460, alignSelf: 'center' },
  layoutWide: { maxWidth: 1040, flexDirection: 'row', alignItems: 'center', gap: 32 },
  panel: { flex: 1, borderRadius: 32, padding: 36, backgroundColor: BRAND, justifyContent: 'center' },
  panelBrand: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  panelName: { fontSize: 24, fontWeight: '900', color: '#FFFFFF' },
  panelTitle: { fontSize: 34, lineHeight: 40, fontWeight: '900', color: '#FFFFFF', marginTop: 32 },
  panelText: { fontSize: 15, lineHeight: 22, fontWeight: '600', color: '#E3DCFF', marginTop: 10 },
  features: { gap: 18, marginTop: 30 },
  feature: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  featureIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  featureCopy: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  featureText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#D8D0FF', marginTop: 2 },
  panelFoot: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 34 },
  panelFootText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#D8D0FF' },
  column: { width: '100%' },
  columnWide: { flex: 1, maxWidth: 460, justifyContent: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 22 },
  brandName: { fontSize: 22, fontWeight: '900', color: '#24212D', letterSpacing: -0.3 },
  mark: { alignItems: 'center', justifyContent: 'center', backgroundColor: BRAND, shadowColor: BRAND, shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6 },
  markInverted: { backgroundColor: '#FFFFFF', shadowOpacity: 0 },
  markSpark: { position: 'absolute', top: -5, right: -5, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#F3F1FB' },
  markSparkInverted: { backgroundColor: '#F2B53C', borderColor: BRAND },
  title: { fontSize: 30, lineHeight: 36, fontWeight: '900', color: '#1E1B2E', textAlign: 'center', letterSpacing: -0.5 },
  titleWide: { textAlign: 'left' },
  subtitle: { fontSize: 15, lineHeight: 21, fontWeight: '600', color: '#6E6887', textAlign: 'center', marginTop: 6, marginBottom: 22 },
  subtitleWide: { textAlign: 'left' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 28, padding: 22, shadowColor: '#2A1F5C', shadowOpacity: 0.08, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginBottom: 7 },
  inputWrap: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1.5, borderColor: '#E6E2F0', backgroundColor: '#FAF9FD' },
  inputWrapFocused: { borderColor: '#8E7AE8', backgroundColor: '#FFFFFF' },
  input: { flex: 1, minHeight: 48, fontSize: 16, color: '#1E1B2E' },
  selectText: { flex: 1, fontSize: 16, color: '#1E1B2E' },
  placeholder: { color: '#9A94A8' },
  eye: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', marginRight: -6 },
  primary: { minHeight: 54, borderRadius: 16, backgroundColor: BRAND, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: BRAND, shadowOpacity: 0.28, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 },
  primaryBusy: { opacity: 0.7 },
  primaryText: { fontSize: 16, fontWeight: '900', color: '#FFFFFF' },
  pressed: { opacity: 0.8 },
}));
