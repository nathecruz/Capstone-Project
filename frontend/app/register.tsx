import { Link, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Modal,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supportedRegions } from '@/constants/i18n';

import { AppDialog, type AppDialogVariant } from '@/components/ui/app-dialog';
import {
  getPasswordStrengthStatus,
  getSession,
  signUp,
  validatePasswordStrength,
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
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [gender, setGender] = useState('');
  const [region, setRegion] = useState('');
  const [birthDate, setBirthDate] = useState(new Date(1998, 4, 14));
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isGenderPickerOpen, setIsGenderPickerOpen] = useState(false);
  const isWeb = Platform.OS === 'web';
  const [isRegionPickerOpen, setIsRegionPickerOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
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

    if (!fullName.trim() || !username.trim() || !email.trim() || !dateOfBirth.trim() || !gender.trim() || !region.trim() || !password.trim()) {
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
      setPassword('');
      setConfirmPassword('');
      showDialog('Weak password', passwordValidation.message || 'Choose a stronger password.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signUp({ fullName, username, email, password, dateOfBirth, gender, region });

      if (!result.ok) {
        showDialog('Registration failed', result.message || 'Unable to create account.');
        return;
      }

      showDialog('Success', 'Your account has been created.', 'success');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <RNStatusBar barStyle="dark-content" backgroundColor="#dff4ff" />
      <KeyboardAvoidingView
        style={styles.keyboardAvoidingView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 24}
      >
        <ScrollView
          contentContainerStyle={styles.page}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.decorCircleOne} />
          <View style={styles.decorCircleTwo} />

          <View style={styles.headlineWrap}>
            <Text style={styles.brand}>HabitAI</Text>
            <Text style={styles.subText}>Create your account</Text>
            <Text style={styles.caption}>Start your healthy habit journey today.</Text>
          </View>

          <View style={styles.card}>
          <Text style={styles.label}>Full Name</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            placeholder="Full Name"
            autoCapitalize="words"
            style={styles.input}
          />

          <Text style={styles.label}>Username</Text>
          <TextInput
            value={username}
            onChangeText={setUsername}
            placeholder="Username"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Email Address</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="Email Address"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />

          <Text style={styles.label}>Date of Birth</Text>
          {isWeb ? (
            <input
              type="date"
              aria-label="Date of birth"
              value={dateOfBirth ? formatDateInputValue(birthDate) : ''}
              max={formatDateInputValue(new Date())}
              onChange={(event) => {
                if (!event.currentTarget.value) return;
                const selectedDate = new Date(`${event.currentTarget.value}T00:00:00`);
                setBirthDate(selectedDate);
                setDateOfBirth(formatDateOfBirth(selectedDate));
              }}
              style={{
                backgroundColor: '#f7f9ff',
                border: '1px solid #e3eaff',
                borderRadius: 14,
                boxSizing: 'border-box',
                color: '#1a1a1e',
                fontFamily: 'inherit',
                fontSize: 15,
                marginBottom: 12,
                padding: '13px 14px',
                width: '100%',
              }}
            />
          ) : (
            <>
              <Pressable
                style={[styles.input, styles.selectorInput]}
                onPress={() => setIsDatePickerOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Select date of birth"
              >
                <Text style={[styles.selectorText, !dateOfBirth && styles.placeholderText]}>{dateOfBirth || 'Select your birth date'}</Text>
                <Ionicons name="calendar-outline" size={19} color="#657089" />
              </Pressable>
              {isDatePickerOpen && Platform.OS === 'ios' && (
                <View style={styles.datePickerContainer}>
                  <DateTimePicker
                    value={birthDate}
                    mode="date"
                    display="inline"
                    maximumDate={new Date()}
                    onChange={handleBirthDateValueChange}
                  />
                  <Pressable style={styles.pickerDoneButton} onPress={() => setIsDatePickerOpen(false)}>
                    <Text style={styles.pickerDoneText}>Done</Text>
                  </Pressable>
                </View>
              )}
              {isDatePickerOpen && Platform.OS === 'android' && (
                <DateTimePicker
                  value={birthDate}
                  mode="date"
                  display="calendar"
                  maximumDate={new Date()}
                  onChange={handleBirthDateValueChange}
                />
              )}
            </>
          )}

          <Text style={styles.label}>Gender</Text>
          <Pressable style={[styles.input, styles.selectorInput]} onPress={() => setIsGenderPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Select gender">
            <Text style={[styles.selectorText, !gender && styles.placeholderText]}>{gender || 'Select your gender'}</Text>
            <Ionicons name="chevron-down" size={19} color="#657089" />
          </Pressable>

          <Text style={styles.label}>Region</Text>
          <Pressable style={[styles.input, styles.selectorInput]} onPress={() => setIsRegionPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Select region">
            <Text style={[styles.selectorText, !region && styles.placeholderText]}>{region || 'Select your region'}</Text>
            <Ionicons name="location-outline" size={19} color="#657089" />
          </Pressable>

          <Text style={styles.label}>Password</Text>
          <View style={styles.passwordInputWrap}>
            <TextInput
              value={password}
              onChangeText={setPassword}
              placeholder="Password"
              secureTextEntry={!showPassword}
              style={styles.passwordInput}
            />
            <Pressable
              onPress={() => setShowPassword((current) => !current)}
              style={styles.passwordToggle}
              accessibilityRole="button"
              accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
            >
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#657089" />
            </Pressable>
          </View>

          <View style={styles.strengthWrap}>
            <View style={[styles.strengthBar, { backgroundColor: passwordStrength.color }]} />
            <Text style={[styles.strengthText, { color: passwordStrength.color }]}>{passwordStrength.label}</Text>
          </View>
          <Text style={styles.strengthHint}>{passwordStrength.description}</Text>

          <Text style={styles.label}>Confirm Password</Text>
          <View style={styles.passwordInputWrap}>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm Password"
              secureTextEntry={!showConfirmPassword}
              style={styles.passwordInput}
            />
            <Pressable
              onPress={() => setShowConfirmPassword((current) => !current)}
              style={styles.passwordToggle}
              accessibilityRole="button"
              accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
            >
              <Ionicons name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color="#657089" />
            </Pressable>
          </View>

          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={handleRegister}
            disabled={isSubmitting}
          >
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Creating account...' : 'Create Account'}</Text>
          </Pressable>

          <Text style={styles.footerText}>Already have an account? <Link href="/login" style={styles.linkText}>Log In</Link></Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {isGenderPickerOpen && (
      <Modal visible animationType="fade" transparent onRequestClose={() => setIsGenderPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.genderCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Gender</Text>
              <Pressable onPress={() => setIsGenderPickerOpen(false)} accessibilityLabel="Close gender picker">
                <Ionicons name="close" size={24} color="#292633" />
              </Pressable>
            </View>
            {genderOptions.map((option) => (
              <Pressable key={option} style={styles.genderOption} onPress={() => { setGender(option); setIsGenderPickerOpen(false); }}>
                <Text style={styles.genderOptionText}>{option}</Text>
                {gender === option && <Ionicons name="checkmark-circle" size={22} color="#5B42D8" />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>
      )}
      {isRegionPickerOpen && (
      <Modal visible animationType="fade" transparent onRequestClose={() => setIsRegionPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.genderCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Select Region</Text>
              <Pressable onPress={() => setIsRegionPickerOpen(false)} accessibilityLabel="Close region picker">
                <Ionicons name="close" size={24} color="#292633" />
              </Pressable>
            </View>
            <ScrollView style={styles.regionOptions} showsVerticalScrollIndicator={false}>
              {supportedRegions.map((option) => (
                <Pressable key={option} style={styles.genderOption} onPress={() => { setRegion(option); setIsRegionPickerOpen(false); }}>
                  <Text style={styles.genderOptionText}>{option}</Text>
                  {region === option && <Ionicons name="checkmark-circle" size={22} color="#5B42D8" />}
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  keyboardAvoidingView: {
    flex: 1,
  },
  page: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7ff',
    paddingHorizontal: 20,
    paddingVertical: 28,
    paddingBottom: 180,
    position: 'relative',
  },
  decorCircleOne: {
    position: 'absolute',
    top: -60,
    opacity: 0.9,
  },
  decorCircleTwo: {
    position: 'absolute',
    bottom: -80,
    left: -50,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: '#eae3ff',
    opacity: 0.9,
  },
  headlineWrap: {
    marginBottom: 18,
    alignItems: 'center',
    zIndex: 1,
  },
  brand: {
    fontSize: 15,
    fontWeight: '800',
    color: '#4a3bd5',
    letterSpacing: 1.2,
    backgroundColor: '#ebe7ff',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    overflow: 'hidden',
    marginBottom: 12,
  },
  subText: {
    marginTop: 0,
    fontSize: 30,
    fontWeight: '800',
    color: '#141b2d',
  },
  caption: {
    marginTop: 6,
    fontSize: 13,
    color: '#5c6478',
    textAlign: 'center',
    maxWidth: 270,
  },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 28,
    padding: 24,
    shadowColor: '#1e2b5b',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 10,
    borderWidth: 1,
    borderColor: '#edf2ff',
    zIndex: 1,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4a5167',
    marginBottom: 8,
    marginTop: 8,
  },
  optionalLabel: {
    fontSize: 10,
    fontWeight: '500',
    color: '#8a91a3',
  },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -4,
    marginBottom: 4,
  },
  strengthBar: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  strengthText: {
    fontSize: 11,
    fontWeight: '700',
  },
  strengthHint: {
    fontSize: 11,
    color: '#657089',
    marginBottom: 10,
  },
  input: {
    backgroundColor: '#f7f9ff',
    borderWidth: 1,
    borderColor: '#e3eaff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#1a1a1e',
    marginBottom: 12,
    shadowColor: '#dfe7ff',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  selectorInput: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectorText: {
    fontSize: 15,
    color: '#1a1a1e',
  },
  placeholderText: {
    color: '#8a91a3',
  },
  datePickerContainer: {
    backgroundColor: '#f7f9ff',
    borderWidth: 1,
    borderColor: '#e3eaff',
    borderRadius: 14,
    marginBottom: 12,
    alignItems: 'flex-end',
    overflow: 'hidden',
  },
  pickerDoneButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  pickerDoneText: {
    color: '#5B42D8',
    fontWeight: '800',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(18, 22, 40, 0.42)',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  genderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: {
    color: '#292633',
    fontSize: 18,
    fontWeight: '800',
  },
  regionOptions: {
    maxHeight: 420,
  },
  genderOption: {
    minHeight: 52,
    borderBottomWidth: 1,
    borderBottomColor: '#ECE9F0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  genderOptionText: {
    color: '#302B3B',
    fontSize: 15,
    fontWeight: '700',
  },
  passwordInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    backgroundColor: '#f7f9ff',
    borderWidth: 1,
    borderColor: '#e3eaff',
    borderRadius: 14,
    marginBottom: 12,
    shadowColor: '#dfe7ff',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  passwordInput: {
    flex: 1,
    height: 48,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#1a1a1e',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  passwordToggle: {
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: '#5a42d8',
    borderRadius: 14,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 12,
    shadowColor: '#5a42d8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '800',
  },
  primaryButtonDisabled: {
    opacity: 0.7,
  },
  footerText: {
    textAlign: 'center',
    marginTop: 18,
    color: '#586074',
    fontSize: 13,
  },
  linkText: {
    color: '#5a42d8',
    fontWeight: '800',
  },
});
