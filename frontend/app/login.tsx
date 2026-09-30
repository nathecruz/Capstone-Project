import { Link, router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar as RNStatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppDialog, type AppDialogVariant } from '@/components/ui/app-dialog';
import {
  getPasswordStrengthStatus,
  getSession,
  getRememberedEmail,
  rememberEmail,
  resetPassword,
  signIn,
  updatePasswordWithOtp,
  verifyPasswordReset,
} from '@/authentication';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetOtp, setResetOtp] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [confirmResetPassword, setConfirmResetPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const [codeLifetimeMinutes, setCodeLifetimeMinutes] = useState(10);
  const [resetBusy, setResetBusy] = useState<'send' | 'verify' | 'save' | null>(null);
  const [dialog, setDialog] = useState<{ title: string; message: string; variant: AppDialogVariant } | null>(null);
  const resetPasswordStrength = getPasswordStrengthStatus(newResetPassword, {
    email: resetEmail,
    serviceWords: ['habitai', 'habit'],
  });

  const showDialog = (title: string, message: string, variant: AppDialogVariant = 'error') => {
    setDialog({ title, message, variant });
  };

  useEffect(() => {
    const checkSession = async () => {
      try {
        const session = await getSession();
        if (session) {
          router.replace('/(tabs)');
          return;
        }

        const rememberedEmail = await getRememberedEmail();
        if (rememberedEmail) {
          setEmail(rememberedEmail);
          setRememberMe(true);
        }
      } finally {
        setIsCheckingSession(false);
      }
    };

    void checkSession();
  }, []);

  useEffect(() => {
    if (resendCountdown <= 0) {
      return;
    }

    const timer = setInterval(() => {
      setResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [resendCountdown]);

  if (isCheckingSession || isSubmitting) {
    return (
      <SafeAreaView style={styles.loadingSafeArea}>
        <RNStatusBar barStyle="dark-content" backgroundColor="#dff4ff" />
        <View style={styles.loadingPage}>
          <View style={styles.loadingMark}>
            <Text style={styles.loadingMarkText}>H</Text>
          </View>
          <Text style={styles.loadingBrand}>HabitAI</Text>
          <ActivityIndicator size="small" color="#5B42D8" style={styles.loadingIndicator} />
          <Text style={styles.loadingText}>{isSubmitting ? 'Signing you in...' : 'Preparing your habits...'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const handleRememberToggle = async () => {
    const nextValue = !rememberMe;
    setRememberMe(nextValue);

    if (nextValue && email.trim()) {
      await rememberEmail(email);
      return;
    }

    await rememberEmail('');
  };

  const handleLogin = async () => {
    if (isSubmitting) {
      return;
    }

    if (!email.trim() || !password.trim()) {
      showDialog('Missing details', 'Please enter both email and password.');
      return;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      showDialog('Invalid email', 'Please enter a valid email address.');
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await signIn(email, password);

      if (!result.ok) {
        showDialog('Login failed', result.message || 'Incorrect email or password.');
        return;
      }

      if (rememberMe) {
        await rememberEmail(email);
      } else {
        await rememberEmail('');
      }

      router.replace('/(tabs)');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetModalState = () => {
    setResetEmail(email.trim());
    setResetOtp('');
    setNewResetPassword('');
    setConfirmResetPassword('');
    setOtpSent(false);
    setOtpVerified(false);
    setResendCountdown(0);
    setShowResetModal(true);
  };

  const cancelResetFlow = () => {
    setShowResetModal(false);
    setResetEmail('');
    setResetOtp('');
    setNewResetPassword('');
    setConfirmResetPassword('');
    setOtpSent(false);
    setOtpVerified(false);
    setResendCountdown(0);
  };

  const handleForgotPassword = () => {
    resetModalState();
  };

  const sendResetCode = async (isResend: boolean) => {
    const targetEmail = resetEmail.trim();
    if (resetBusy || (isResend && resendCountdown > 0)) return;

    if (!targetEmail) {
      showDialog('Email required', 'Please enter the email address associated with your account.');
      return;
    }

    setResetBusy('send');
    try {
      const result = await resetPassword(targetEmail);
      if (!result.ok) {
        // The server enforces a resend cooldown; show it on the button instead of letting the user retry blindly.
        if ('retryAfterSeconds' in result && result.retryAfterSeconds) setResendCountdown(result.retryAfterSeconds);
        showDialog(isResend ? 'Resend failed' : 'Reset failed', result.message || 'Unable to process your password reset request.');
        return;
      }

      setEmail(targetEmail);
      setResetOtp('');
      setNewResetPassword('');
      setConfirmResetPassword('');
      setOtpSent(true);
      setOtpVerified(false);
      setResendCountdown('retryAfterSeconds' in result && result.retryAfterSeconds ? result.retryAfterSeconds : 60);
      setCodeLifetimeMinutes(Math.round(('expiresInSeconds' in result && result.expiresInSeconds ? result.expiresInSeconds : 600) / 60));
      showDialog(isResend ? 'New code sent' : 'Check your email', result.message || 'A verification code was sent to your email.', 'success');
    } finally {
      setResetBusy(null);
    }
  };

  const handleResetRequest = () => sendResetCode(false);
  const handleResendOtp = () => sendResetCode(true);

  const handleVerifyOtp = async (code = resetOtp) => {
    const targetEmail = resetEmail.trim();
    if (resetBusy) return;

    if (!targetEmail || code.trim().length !== 6) {
      showDialog('Missing code', 'Please enter the 6-digit code sent to your email.');
      return;
    }

    setResetBusy('verify');
    try {
      const otpCheck = await verifyPasswordReset(targetEmail, code);
      if (!otpCheck.ok) {
        setResetOtp('');
        if ('mustRequestNewCode' in otpCheck && otpCheck.mustRequestNewCode) {
          setOtpSent(false);
          setResendCountdown(0);
        }
        showDialog('Invalid code', otpCheck.message || 'The verification code is invalid.');
        return;
      }

      setOtpVerified(true);
    } finally {
      setResetBusy(null);
    }
  };

  const handleOtpChange = (value: string) => {
    const code = value.replace(/\D/g, '').slice(0, 6);
    setResetOtp(code);
    // Verify as soon as the sixth digit is typed or pasted.
    if (code.length === 6 && resetOtp.length !== 6) void handleVerifyOtp(code);
  };

  const handleSetNewPassword = async () => {
    const targetEmail = resetEmail.trim();
    if (resetBusy) return;

    if (!newResetPassword.trim() || !confirmResetPassword.trim()) {
      showDialog('New password required', 'Please enter your new password and confirm it.');
      return;
    }

    if (newResetPassword !== confirmResetPassword) {
      showDialog('Password mismatch', 'The new passwords do not match.');
      return;
    }

    setResetBusy('save');
    let result: Awaited<ReturnType<typeof updatePasswordWithOtp>>;
    try {
      result = await updatePasswordWithOtp(targetEmail, resetOtp, newResetPassword);
    } finally {
      setResetBusy(null);
    }
    if (!result.ok) {
      showDialog('Reset failed', result.message || 'Unable to update your password.');
      return;
    }

    setShowResetModal(false);
    setResetEmail('');
    setResetOtp('');
    setNewResetPassword('');
    setConfirmResetPassword('');
    setOtpSent(false);
    setOtpVerified(false);
    setResendCountdown(0);
    showDialog('Password reset successful', 'Your password has been updated. You can now sign in with your new password.', 'success');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <RNStatusBar barStyle="dark-content" backgroundColor="#dff4ff" />
      <View style={styles.page}>
        <View style={styles.decorCircleOne} />
        <View style={styles.decorCircleTwo} />

        <View style={styles.headlineWrap}>
          <Text style={styles.brand}>HabitAI</Text>
          <Text style={styles.subText}>Welcome back</Text>
          <Text style={styles.caption}>Build habits, track progress, and stay consistent.</Text>
        </View>

        <View style={styles.card}>
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

          <Text style={styles.label}>Password</Text>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="Password"
            secureTextEntry
            style={styles.input}
          />

          <View style={styles.rowBetween}>
            <Pressable
              style={styles.rememberWrap}
              onPress={handleRememberToggle}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: rememberMe }}
              accessibilityLabel="Remember me"
              hitSlop={8}
            >
              <View style={[styles.checkBox, rememberMe && styles.checkBoxActive]}>
                {rememberMe && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={styles.checkText}>Remember me</Text>
            </Pressable>
            <Pressable onPress={handleForgotPassword}>
              <Text style={styles.forgotText}>Forgot password?</Text>
            </Pressable>
          </View>

          <Pressable
            style={[styles.loginPrimaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={handleLogin}
            disabled={isSubmitting}
          >
            {isSubmitting && <ActivityIndicator size="small" color="#FFFFFF" />}
            <Text style={styles.primaryButtonText}>{isSubmitting ? 'Signing in...' : 'Log In'}</Text>
          </Pressable>

          <Text style={styles.footerText}>
            Don&apos;t have an account? <Link href="/register" style={styles.linkText}>Register</Link>
          </Text>
        </View>
      </View>

      <Modal visible={showResetModal} transparent animationType="slide" onRequestClose={cancelResetFlow}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView style={styles.keyboardModal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 70 : 0}>
            <ScrollView contentContainerStyle={styles.resetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.resetModal}>
            <Text style={styles.resetTitle}>Reset password</Text>
            {!otpSent ? (
              <>
                <Text style={styles.resetSubtitle}>Enter the email connected to your HabitAI account.</Text>
                <TextInput
                  value={resetEmail}
                  onChangeText={setResetEmail}
                  placeholder="Email address"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={styles.resetInput}
                />
                <View style={styles.resetActions}>
                  <Pressable style={styles.secondaryButton} onPress={cancelResetFlow}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={handleResetRequest} disabled={resetBusy !== null}>
                    {resetBusy === 'send' && <ActivityIndicator size="small" color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>{resetBusy === 'send' ? 'Sending...' : 'Send code'}</Text>
                  </Pressable>
                </View>
              </>
            ) : !otpVerified ? (
              <>
                <Text style={styles.resetSubtitle}>Enter the 6-digit code sent to {resetEmail}. It expires in {codeLifetimeMinutes} minutes. If you do not see it, check your Spam folder.</Text>
                <View style={styles.otpInputWrap}>
                  <View style={styles.otpBoxes} pointerEvents="none">
                    {Array.from({ length: 6 }, (_, index) => (
                      <View key={index} style={[styles.otpBox, index === resetOtp.length && styles.otpBoxActive]}>
                        <Text style={styles.otpBoxText}>{resetOtp[index] || ''}</Text>
                      </View>
                    ))}
                  </View>
                  <TextInput
                    value={resetOtp}
                    onChangeText={handleOtpChange}
                    keyboardType="number-pad"
                    textContentType="oneTimeCode"
                    autoComplete="one-time-code"
                    maxLength={6}
                    editable={resetBusy === null}
                    autoFocus
                    style={styles.otpTextInput}
                    accessibilityLabel="Verification code"
                  />
                </View>

                <View style={styles.resendRow}>
                  <Text style={styles.helpText}>Didn’t receive the code?</Text>
                  <Pressable onPress={handleResendOtp} disabled={resendCountdown > 0 || resetBusy !== null} accessibilityRole="button" accessibilityState={{ disabled: resendCountdown > 0 || resetBusy !== null }}>
                    <Text style={[styles.resendLink, (resendCountdown > 0 || resetBusy !== null) && styles.resendLinkDisabled]}>
                      {resetBusy === 'send' ? 'Sending...' : resendCountdown > 0 ? `Resend code (${resendCountdown}s)` : 'Resend code'}
                    </Text>
                  </Pressable>
                </View>

                <View style={styles.resetActions}>
                  <Pressable style={styles.secondaryButton} onPress={cancelResetFlow}>
                    <Text style={styles.secondaryButtonText}>Back</Text>
                  </Pressable>
                  <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={() => void handleVerifyOtp()} disabled={resetBusy !== null}>
                    {resetBusy === 'verify' && <ActivityIndicator size="small" color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>{resetBusy === 'verify' ? 'Verifying...' : 'Verify code'}</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.resetSubtitle}>Code verified. Create a new password for {resetEmail}. You will be signed out of your other devices.</Text>
                <Text style={styles.label}>New password</Text>
                <TextInput
                  value={newResetPassword}
                  onChangeText={setNewResetPassword}
                  placeholder="New password"
                  secureTextEntry
                  style={styles.resetInput}
                />

                {!!newResetPassword && (
                  <View style={[styles.validationBox, { borderColor: resetPasswordStrength.color }]}>
                    <Text style={[styles.validationTitle, { color: resetPasswordStrength.color }]}>
                      {resetPasswordStrength.label}
                    </Text>
                    <Text style={styles.validationText}>{resetPasswordStrength.description}</Text>
                  </View>
                )}

                <Text style={styles.label}>Confirm new password</Text>
                <TextInput
                  value={confirmResetPassword}
                  onChangeText={setConfirmResetPassword}
                  placeholder="Confirm new password"
                  secureTextEntry
                  style={styles.resetInput}
                />
                <View style={styles.resetActions}>
                  <Pressable style={styles.secondaryButton} onPress={cancelResetFlow} disabled={resetBusy !== null}>
                    <Text style={styles.secondaryButtonText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={handleSetNewPassword} disabled={resetBusy !== null}>
                    {resetBusy === 'save' && <ActivityIndicator size="small" color="#FFFFFF" />}
                    <Text style={styles.primaryButtonText}>{resetBusy === 'save' ? 'Saving...' : 'Set new password'}</Text>
                  </Pressable>
                </View>
              </>
            )}
              </View>
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </Modal>
      <AppDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        message={dialog?.message ?? ''}
        variant={dialog?.variant}
        onClose={() => setDialog(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  loadingSafeArea: {
    flex: 1,
    backgroundColor: '#f4f7ff',
  },
  loadingPage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7ff',
  },
  loadingMark: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#5B42D8',
    shadowColor: '#5B42D8',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 8,
  },
  loadingMarkText: {
    color: '#FFFFFF',
    fontSize: 32,
    fontWeight: '900',
  },
  loadingBrand: {
    marginTop: 16,
    color: '#24212D',
    fontSize: 24,
    fontWeight: '800',
  },
  loadingIndicator: {
    marginTop: 28,
  },
  loadingText: {
    marginTop: 10,
    color: '#777282',
    fontSize: 12,
    fontWeight: '600',
  },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f7ff',
    paddingHorizontal: 20,
    paddingVertical: 28,
    position: 'relative',
  },
  decorCircleOne: {
    position: 'absolute',
    top: -60,
    right: -30,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: '#dff0ff',
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
  resetLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#4a5167',
    marginBottom: 8,
    marginTop: 12,
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
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    marginBottom: 18,
  },
  rememberWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkBox: {
    width: 18,
    height: 18,
    borderRadius: 6,
    backgroundColor: '#ffffff',
    borderWidth: 1.5,
    borderColor: '#7d6ae7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkBoxActive: {
    backgroundColor: '#5a42d8',
    borderColor: '#5a42d8',
  },
  checkMark: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 14,
    textAlign: 'center',
  },
  checkText: {
    color: '#495167',
    fontSize: 12,
    fontWeight: '600',
  },
  forgotText: {
    color: '#5a42d8',
    fontSize: 12,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: 'rgba(17, 20, 33, 0.5)',
    paddingHorizontal: 20,
  },
  keyboardModal: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
  },
  resetScroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 20,
  },
  resetModal: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 22,
    borderWidth: 1,
    borderColor: '#edf1ff',
    shadowColor: '#1f2a57',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.14,
    shadowRadius: 18,
    elevation: 8,
  },
  resetTitle: {
    color: '#1d2435',
    fontSize: 24,
    fontWeight: '800',
  },
  resetSubtitle: {
    color: '#586074',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 16,
    lineHeight: 20,
  },
  resetInput: {
    backgroundColor: '#f8f9ff',
    borderWidth: 1,
    borderColor: '#dfe7ff',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 15,
    color: '#1a1a1e',
  },
  otpInputWrap: {
    height: 58,
    marginBottom: 6,
    position: 'relative',
  },
  otpBoxes: {
    flexDirection: 'row',
    gap: 7,
    height: 58,
  },
  otpBox: {
    flex: 1,
    minWidth: 0,
    borderWidth: 1,
    borderColor: '#dfe7ff',
    borderRadius: 8,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxActive: {
    borderColor: '#1769ff',
    borderWidth: 2,
  },
  otpBoxText: {
    color: '#1a1a1e',
    fontSize: 22,
    fontWeight: '700',
  },
  otpTextInput: {
    ...StyleSheet.absoluteFill,
    opacity: 0,
    color: 'transparent',
  },
  resendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    marginTop: 6,
  },
  helpText: {
    color: '#586074',
    fontSize: 12,
  },
  resendLink: {
    color: '#5a42d8',
    fontSize: 12,
    fontWeight: '800',
  },
  resendLinkDisabled: {
    color: '#9da3b3',
  },
  validationBox: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginTop: 8,
    marginBottom: 12,
    backgroundColor: '#f8f9ff',
  },
  validationTitle: {
    fontSize: 12,
    fontWeight: '800',
    marginBottom: 4,
  },
  validationText: {
    color: '#4f5b75',
    fontSize: 11,
    lineHeight: 16,
  },
  resetActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 18,
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#eef1ff',
  },
  secondaryButtonText: {
    color: '#3a466b',
    fontSize: 14,
    fontWeight: '700',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  primaryButton: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5a42d8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    shadowColor: '#5a42d8',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
  },
  loginPrimaryButton: {
    width: '100%',
    backgroundColor: '#5a42d8',
    borderRadius: 16,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5a42d8',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.23,
    shadowRadius: 18,
    elevation: 6,
    marginTop: 2,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '800',
  },
  primaryButtonDisabled: {
    opacity: 0.72,
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
