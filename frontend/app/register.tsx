import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AuthField, AuthScreen, authStyles, BRAND, PasswordField, PrimaryButton, SelectField } from '@/components/auth-ui';
import { InstallAppCard } from '@/components/install-app';
import { supportedRegions } from '@/constants/i18n';
import { withReadableText } from '@/hooks/use-themed-styles';
import { joinName } from '@/utils/names';

import { AppDialog, type AppDialogVariant } from '@/components/ui/app-dialog';
import { SLOW_SERVER_HINT, useSlowHint } from '@/hooks/use-slow-hint';
import {
  getPasswordStrengthStatus,
  getSession,
  signUp,
  validatePasswordStrength,
  warmUpServer,
} from '@/authentication';

const genderOptions = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

const formatDateOfBirth = (date: Date) => date.toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const formatDateInputValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function RegisterScreen() {
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const fullName = joinName(firstName, lastName);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [region, setRegion] = useState('');
  const [birthDate, setBirthDate] = useState(new Date(1998, 4, 14));
  const [webDateValue, setWebDateValue] = useState('');
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const isWeb = Platform.OS === 'web';
  const [isRegionPickerOpen, setIsRegionPickerOpen] = useState(false);
  const [regionSearch, setRegionSearch] = useState('');
  // Very narrow phones stack first and last name.
  const compact = useWindowDimensions().width < 360;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const slowSubmit = useSlowHint(isSubmitting);
  const [privacyConsent, setPrivacyConsent] = useState(false);
  const [dialog, setDialog] = useState<{ title: string; message: string; variant: AppDialogVariant } | null>(null);
  const passwordStrength = getPasswordStrengthStatus(password, {
    fullName,
    email,
    serviceWords: ['habitai', 'habit'],
  });

  const showDialog = (title: string, message: string, variant: AppDialogVariant = 'error') => {
    setDialog({ title, message, variant });
  };

  const handleBirthDateValueChange = (_event: DateTimePickerChangeEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setIsDatePickerOpen(false);
    }
    if (!selectedDate) return;
    setBirthDate(selectedDate);
    setDateOfBirth(formatDateOfBirth(selectedDate));
  };

  useEffect(() => {
    warmUpServer();
    const checkSession = async () => {
      const session = await getSession();
      if (session) {
        router.replace('/(tabs)');
      }
    };

    void checkSession();
  }, []);

  const handleRegister = async () => {
    if (isSubmitting) {
      return;
    }

    if (!firstName.trim() || !lastName.trim() || !username.trim() || !email.trim() || !dateOfBirth.trim() || !gender.trim() || !region.trim() || !password.trim()) {
      showDialog('Missing details', 'Please complete all required fields.');
      return;
    }

    if (!/^[a-zA-Z0-9_.-]{2,30}$/.test(username.trim())) {
      showDialog('Invalid username', 'Use 2 to 30 letters, numbers, dots, underscores, or hyphens.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showDialog('Invalid email', 'Please enter a valid email address.');
      return;
    }

    if (!privacyConsent) {
      showDialog('Privacy Notice', 'Please read and agree to the Privacy Notice to create your account.');
      return;
    }

    if (password !== confirmPassword) {
      showDialog('Password mismatch', 'Please make sure both passwords match.');
      return;
    }

    const passwordValidation = validatePasswordStrength(password, {
      fullName,
      email,
      serviceWords: ['habitai', 'habit'],
    });

    if (!passwordValidation.ok) {
      showDialog('Weak password', passwordValidation.message || 'Choose a stronger password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUp({ firstName, lastName, username, email, password, dateOfBirth, gender, region, privacyConsent });

      if (!result.ok) {
        showDialog('Registration failed', result.message || 'Unable to create account.');
        return;
      }

      // The app now opens the email confirmation screen (if the server requires it).
      showDialog('Account created', result.message || 'Your account has been created.', 'success');
    } finally {
      setIsSubmitting(false);
    }
  };

  const strengthLevel = !password ? 0 : passwordStrength.label.startsWith('Strong') ? 3 : passwordStrength.label.startsWith('Moderate') ? 2 : 1;
  const regionQuery = regionSearch.trim().toLowerCase();
  const regionMatches = regionQuery ? supportedRegions.filter((option) => option.toLowerCase().includes(regionQuery)) : supportedRegions;

  return (
    <>
      <AuthScreen
        title="Create your account"
        subtitle="Start your habit journey in under a minute."
        footer={(
          <>
            <View style={authStyles.trust}>
              <Ionicons name="shield-checkmark" size={14} color="#2E9D5C" />
              <Text style={authStyles.trustText}>Protected under the Data Privacy Act of 2012.</Text>
            </View>
            <InstallAppCard variant="auth" />
          </>
        )}
      >
        <Section number={1} title="About you" />
        <View style={[styles.nameRow, compact && styles.nameRowStacked]}>
          <View style={styles.nameField}>
            <AuthField label="First Name" icon="person-outline" value={firstName} onChangeText={setFirstName} placeholder="First Name" autoCapitalize="words" autoComplete="given-name" textContentType="givenName" />
          </View>
          <View style={styles.nameField}>
            <AuthField label="Last Name" icon="person-outline" value={lastName} onChangeText={setLastName} placeholder="Last Name" autoCapitalize="words" autoComplete="family-name" textContentType="familyName" />
          </View>
        </View>
        <AuthField
          label="Username"
          icon="at-outline"
          value={username}
          onChangeText={setUsername}
          placeholder="Username"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          hint={<Text style={authStyles.hint}>2 to 30 letters, numbers, dots, underscores or hyphens.</Text>}
        />
        <AuthField label="Email Address" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="Email Address" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" hint={<Text style={authStyles.hint}>We will send a code to confirm it.</Text>} />

        <View style={authStyles.divider} />
        <Section number={2} title="Personal details" />
        {isWeb ? (
          <SelectField label="Date of Birth" icon="calendar-outline" value={dateOfBirth} placeholder="Select your birth date" accessibilityLabel="Date of birth">
            <input
              type="date"
              aria-label="Select date of birth"
              // The browser keeps what is being typed; the birthday is only taken once the
              // year is complete (a partial year like "2" used to reset the field).
              value={webDateValue}
              min="1900-01-01"
              max={formatDateInputValue(new Date())}
              // The field is invisible, so open the calendar wherever it is clicked.
              onClick={(event) => {
                try {
                  event.currentTarget.showPicker?.();
                } catch {
                  // Older browsers: the focused field still accepts typing.
                }
              }}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setWebDateValue(value);
                const selectedDate = value ? new Date(`${value}T00:00:00`) : null;
                const valid = selectedDate && !Number.isNaN(selectedDate.getTime()) && selectedDate.getFullYear() >= 1900 && selectedDate <= new Date();
                if (!valid) {
                  setDateOfBirth('');
                  return;
                }
                setBirthDate(selectedDate);
                setDateOfBirth(formatDateOfBirth(selectedDate));
              }}
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer' }}
            />
          </SelectField>
        ) : (
          <>
            <SelectField label="Date of Birth" icon="calendar-outline" value={dateOfBirth} placeholder="Select your birth date" onPress={() => setIsDatePickerOpen(true)} accessibilityLabel="Select date of birth" />
            {isDatePickerOpen && Platform.OS === 'ios' && (
              <View style={styles.datePickerContainer}>
                <DateTimePicker value={birthDate} mode="date" display="inline" maximumDate={new Date()} onChange={handleBirthDateValueChange} />
                <Pressable style={styles.pickerDoneButton} onPress={() => setIsDatePickerOpen(false)} accessibilityRole="button">
                  <Text style={styles.pickerDoneText}>Done</Text>
                </Pressable>
              </View>
            )}
            {isDatePickerOpen && Platform.OS === 'android' && (
              <DateTimePicker value={birthDate} mode="date" display="calendar" maximumDate={new Date()} onChange={handleBirthDateValueChange} />
            )}
          </>
        )}

        <Text style={styles.fieldLabel}>Gender</Text>
        <View style={styles.choiceRow} accessibilityRole="radiogroup" accessibilityLabel="Gender">
          {genderOptions.map((option) => {
            const selected = gender === option;
            return (
              <Pressable key={option} style={({ pressed }) => [styles.choice, selected && styles.choiceSelected, pressed && authStyles.pressed]} onPress={() => setGender(option)} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                {selected && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
                <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option}</Text>
              </Pressable>
            );
          })}
        </View>

        <SelectField
          label="Region"
          icon="location-outline"
          value={region}
          placeholder="Select your region"
          onPress={() => { setRegionSearch(''); setIsRegionPickerOpen(true); }}
          accessibilityLabel="Select region"
          hint={(
            <View style={styles.regionNote}>
              <Ionicons name="lock-closed" size={12} color="#8F5A12" />
              <Text style={styles.regionNoteText}>Choose carefully: your region is set once and cannot be changed later.</Text>
            </View>
          )}
        />

        <View style={authStyles.divider} />
        <Section number={3} title="Secure your account" />
        <PasswordField
          label="Password"
          value={password}
          onChangeText={setPassword}
          placeholder="Password"
          autoComplete="new-password"
          textContentType="newPassword"
          hint={(
            <View style={styles.strength}>
              <View style={styles.strengthBars}>
                {[1, 2, 3].map((level) => <View key={level} style={[styles.strengthBar, level <= strengthLevel && { backgroundColor: passwordStrength.color }]} />)}
              </View>
              <Text style={[styles.strengthLabel, { color: strengthLevel ? passwordStrength.color : '#8A8497' }]}>{passwordStrength.label}</Text>
              <Text style={authStyles.hint}>{passwordStrength.description}</Text>
            </View>
          )}
        />
        <PasswordField
          label="Confirm Password"
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          placeholder="Confirm Password"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={() => void handleRegister()}
          hint={confirmPassword ? (
            <Text style={[styles.matchText, confirmPassword === password ? styles.matchGood : styles.matchBad]}>
              {confirmPassword === password ? '✓ Passwords match' : 'Passwords do not match yet'}
            </Text>
          ) : null}
        />

        <Pressable style={styles.consentRow} onPress={() => setPrivacyConsent((current) => !current)} accessibilityRole="checkbox" accessibilityState={{ checked: privacyConsent }} accessibilityLabel="I agree to the Privacy Notice">
          <View style={[styles.consentBox, privacyConsent && styles.consentBoxChecked]}>
            {privacyConsent && <Ionicons name="checkmark" size={15} color="#FFFFFF" />}
          </View>
          <Text style={styles.consentText}>
            I have read and agree to the{' '}
            <Link href="/privacy-notice" style={authStyles.link}>Privacy Notice</Link>
            {' '}and allow HabitAI to process my data as described there (Data Privacy Act of 2012).
          </Text>
        </Pressable>

        <PrimaryButton label="Create Account" busy={isSubmitting} busyLabel="Creating account..." onPress={() => void handleRegister()} icon="checkmark-circle" />
        {slowSubmit && <Text style={[authStyles.hint, styles.centered]}>{SLOW_SERVER_HINT}</Text>}

        <View style={authStyles.orRow}>
          <View style={authStyles.orLine} />
          <Text style={authStyles.orText}>Already have an account?</Text>
          <View style={authStyles.orLine} />
        </View>
        <Link href="/login" asChild>
          <Pressable style={authStyles.secondary} accessibilityRole="button">
            <Ionicons name="log-in-outline" size={18} color={BRAND} />
            <Text style={authStyles.secondaryText}>Log In</Text>
          </Pressable>
        </Link>
      </AuthScreen>

      <Modal visible={isRegionPickerOpen} animationType="slide" transparent onRequestClose={() => setIsRegionPickerOpen(false)}>
        <View style={styles.sheetBackdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select your region</Text>
              <Pressable style={styles.closeButton} onPress={() => setIsRegionPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Close region picker">
                <Ionicons name="close" size={20} color="#6E6887" />
              </Pressable>
            </View>
            <View style={styles.regionNoteBox}>
              <Ionicons name="lock-closed" size={13} color="#8F5A12" />
              <Text style={styles.regionNoteText}>Your region is set once and cannot be changed later.</Text>
            </View>
            <AuthField label="Search" icon="search-outline" value={regionSearch} onChangeText={setRegionSearch} placeholder="Type a province or Metro Manila" autoCapitalize="none" autoCorrect={false} />
            <ScrollView style={styles.regionOptions} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
              {regionMatches.map((option) => {
                const selected = region === option;
                return (
                  <Pressable key={option} style={({ pressed }) => [styles.regionOption, selected && styles.regionOptionSelected, pressed && authStyles.pressed]} onPress={() => { setRegion(option); setIsRegionPickerOpen(false); }} accessibilityRole="radio" accessibilityState={{ checked: selected }}>
                    <Text style={[styles.regionOptionText, selected && styles.regionOptionTextSelected]}>{option}</Text>
                    {selected && <Ionicons name="checkmark-circle" size={21} color={BRAND} />}
                  </Pressable>
                );
              })}
              {regionMatches.length === 0 && <Text style={[authStyles.hint, styles.centered]}>No region matches &quot;{regionSearch.trim()}&quot;.</Text>}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <AppDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        variant={dialog?.variant}
        onClose={() => {
          const shouldGoToLogin = dialog?.variant === 'success';
          setDialog(null);
          if (shouldGoToLogin) {
            router.replace('/login');
          }
        }}
      />
    </>
  );
}

/** A numbered section heading inside the form. */
function Section({ number, title }: { number: number; title: string }) {
  return (
    <View style={authStyles.sectionTitle}>
      <View style={authStyles.sectionNumber}><Text style={authStyles.sectionNumberText}>{number}</Text></View>
      <Text style={authStyles.sectionText}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create(withReadableText({
  nameRow: { flexDirection: 'row', gap: 10 },
  nameRowStacked: { flexDirection: 'column', gap: 0 },
  nameField: { flex: 1, minWidth: 0 },
  fieldLabel: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginBottom: 7 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 42, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1.5, borderColor: '#E6E2F0', backgroundColor: '#FAF9FD' },
  choiceSelected: { backgroundColor: BRAND, borderColor: BRAND },
  choiceText: { fontSize: 14, fontWeight: '700', color: '#3B3650' },
  choiceTextSelected: { color: '#FFFFFF' },
  regionNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 7 },
  regionNoteBox: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 10, borderRadius: 12, backgroundColor: '#FFF6E5', marginBottom: 14 },
  regionNoteText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', color: '#8F5A12' },
  strength: { marginTop: 8 },
  strengthBars: { flexDirection: 'row', gap: 6 },
  strengthBar: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#ECE8F6' },
  strengthLabel: { fontSize: 13, fontWeight: '900', marginTop: 7 },
  matchText: { fontSize: 12, fontWeight: '800', marginTop: 6 },
  matchGood: { color: '#23774A' },
  matchBad: { color: '#B5701F' },
  consentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 4, marginBottom: 20 },
  consentBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, borderColor: '#C9C2DE', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  consentBoxChecked: { backgroundColor: BRAND, borderColor: BRAND },
  consentText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '500', color: '#4A4458' },
  centered: { textAlign: 'center' },
  datePickerContainer: { marginTop: -6, marginBottom: 14, borderRadius: 16, backgroundColor: '#FAF9FD', padding: 8 },
  pickerDoneButton: { alignSelf: 'flex-end', paddingHorizontal: 16, paddingVertical: 9, borderRadius: 12, backgroundColor: BRAND },
  pickerDoneText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  sheet: { width: '100%', maxWidth: 520, maxHeight: '86%', alignSelf: 'center', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sheetTitle: { fontSize: 20, fontWeight: '900', color: '#1E1B2E' },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F0F7' },
  regionOptions: { flexGrow: 0 },
  regionOption: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderRadius: 12 },
  regionOptionSelected: { backgroundColor: '#F0EBFF' },
  regionOptionText: { fontSize: 15, fontWeight: '700', color: '#2D2A3D' },
  regionOptionTextSelected: { color: BRAND, fontWeight: '900' },
}));
