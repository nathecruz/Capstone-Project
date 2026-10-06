import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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

import { AuthField, AuthScreen, authStyles, BRAND, BrandMark, PasswordField, PrimaryButton } from '@/components/auth-ui';
import { InstallAppCard } from '@/components/install-app';
import { AppDialog, type AppDialogVariant } from '@/components/ui/app-dialog';
import { withReadableText } from '@/hooks/use-themed-styles';
import { SLOW_SERVER_HINT, useSlowHint } from '@/hooks/use-slow-hint';
import {
  getPasswordStrengthStatus,
  getSession,
  getRememberedEmail,
  rememberEmail,
  resetPassword,
  signIn,
  updatePasswordWithOtp,
  verifyPasswordReset,
  warmUpServer,
} from '@/authentication';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const slowSignIn = useSlowHint(isSubmitting);
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
  const slowReset = useSlowHint(resetBusy !== null);
  const [dialog, setDialog] = useState<{ title: string; message: string; variant: AppDialogVariant } | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const resetPasswordStrength = getPasswordStrengthStatus(newResetPassword, {
    email: resetEmail,
    serviceWords: ['habitai', 'habit'],
  });

  const showDialog = (title: string, message: string, variant: AppDialogVariant = 'error') => {
    setDialog({ title, message, variant });
  };

  useEffect(() => {
    warmUpServer();
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
        <RNStatusBar barStyle="dark-content" backgroundColor="#F3F1FB" />
        <View style={styles.loadingPage}>
          <BrandMark size={64} />
          <Text style={styles.loadingBrand}>HabitAI</Text>
          <ActivityIndicator size="small" color={BRAND} style={styles.loadingIndicator} />
          <Text style={styles.loadingText}>{isSubmitting ? 'Signing you in...' : 'Preparing your habits...'}</Text>
          {slowSignIn && <Text style={[styles.loadingText, styles.slowHint]}>{SLOW_SERVER_HINT}</Text>}
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
    warmUpServer();
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
    <>
      <AuthScreen
        title="Welcome back"
        subtitle="Sign in to keep your streak going."
        footer={(
          <>
            <View style={authStyles.trust}>
              <Ionicons name="shield-checkmark" size={14} color="#2E9D5C" />
              <Text style={authStyles.trustText}>Secure sign-in. Your data stays private.</Text>
            </View>
            <InstallAppCard variant="auth" />
          </>
        )}
      >
        <AuthField
          label="Email Address"
          icon="mail-outline"
          value={email}
          onChangeText={setEmail}
          placeholder="Email Address"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
        />
        <PasswordField
          ref={passwordRef}
          label="Password"
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={() => void handleLogin()}
          returnKeyType="go"
          placeholder="Password"
          autoComplete="current-password"
          textContentType="password"
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
              {rememberMe && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
            </View>
            <Text style={styles.checkText}>Remember me</Text>
          </Pressable>
          <Pressable onPress={handleForgotPassword} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.forgotText}>Forgot password?</Text>
          </Pressable>
        </View>

        <PrimaryButton label="Log In" busy={isSubmitting} busyLabel="Signing in..." onPress={() => void handleLogin()} />

        <View style={authStyles.orRow}>
          <View style={authStyles.orLine} />
          <Text style={authStyles.orText}>New to HabitAI?</Text>
          <View style={authStyles.orLine} />
        </View>
        <Link href="/register" asChild>
          <Pressable style={authStyles.secondary} accessibilityRole="button">
            <Ionicons name="person-add-outline" size={18} color={BRAND} />
            <Text style={authStyles.secondaryText}>Create an account</Text>
          </Pressable>
        </Link>
      </AuthScreen>

      <Modal visible={showResetModal} transparent animationType="slide" onRequestClose={cancelResetFlow}>
        <View style={styles.modalBackdrop}>
          <KeyboardAvoidingView style={styles.keyboardModal} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS === 'ios' ? 70 : 0}>
            <ScrollView contentContainerStyle={styles.resetScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={styles.resetModal}>
                <View style={styles.resetHeader}>
                  <View style={styles.resetIcon}><Ionicons name={otpVerified ? 'key' : otpSent ? 'mail-open' : 'lock-open'} size={22} color={BRAND} /></View>
                  <View style={styles.resetHeaderCopy}>
                    <Text style={styles.resetStep}>Step {otpVerified ? 3 : otpSent ? 2 : 1} of 3</Text>
                    <Text style={styles.resetTitle}>{otpVerified ? 'Create a new password' : otpSent ? 'Enter the code' : 'Reset password'}</Text>
                  </View>
                  <Pressable style={styles.closeButton} onPress={cancelResetFlow} accessibilityRole="button" accessibilityLabel="Close password reset" disabled={resetBusy === 'save'}>
                    <Ionicons name="close" size={20} color="#6E6887" />
                  </Pressable>
                </View>
                <View style={styles.stepBar}>
                  {[1, 2, 3].map((step) => <View key={step} style={[styles.stepSegment, step <= (otpVerified ? 3 : otpSent ? 2 : 1) && styles.stepSegmentDone]} />)}
                </View>
                {!otpSent ? (
                  <>
                    <Text style={styles.resetSubtitle}>Enter the email connected to your HabitAI account. We will send you a 6-digit code.</Text>
                    <AuthField
                      label="Email address"
                      icon="mail-outline"
                      value={resetEmail}
                      onChangeText={setResetEmail}
                      onSubmitEditing={() => void sendResetCode(false)}
                      returnKeyType="send"
                      placeholder="Email address"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                    <View style={styles.resetActions}>
                      <Pressable style={styles.secondaryButton} onPress={cancelResetFlow} accessibilityRole="button">
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </Pressable>
                      <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={handleResetRequest} disabled={resetBusy !== null} accessibilityRole="button">
                        {resetBusy === 'send' && <ActivityIndicator size="small" color="#FFFFFF" />}
                        <Text style={styles.primaryButtonText}>{resetBusy === 'send' ? 'Sending...' : 'Send code'}</Text>
                      </Pressable>
                    </View>
                  </>
                ) : !otpVerified ? (
                  <>
                    <Text style={styles.resetSubtitle}>We sent a 6-digit code to <Text style={styles.strong}>{resetEmail}</Text>. It expires in {codeLifetimeMinutes} minutes. If you do not see it, check your Spam folder.</Text>
                    <View style={styles.otpInputWrap}>
                      <View style={styles.otpBoxes} pointerEvents="none">
                        {Array.from({ length: 6 }, (_, index) => (
                          <View key={index} style={[styles.otpBox, index === resetOtp.length && styles.otpBoxActive, index < resetOtp.length && styles.otpBoxFilled]}>
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
                      <Pressable style={styles.secondaryButton} onPress={cancelResetFlow} accessibilityRole="button">
                        <Text style={styles.secondaryButtonText}>Back</Text>
                      </Pressable>
                      <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={() => void handleVerifyOtp()} disabled={resetBusy !== null} accessibilityRole="button">
                        {resetBusy === 'verify' && <ActivityIndicator size="small" color="#FFFFFF" />}
                        <Text style={styles.primaryButtonText}>{resetBusy === 'verify' ? 'Verifying...' : 'Verify code'}</Text>
                      </Pressable>
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.resetSubtitle}>Code verified. Create a new password for <Text style={styles.strong}>{resetEmail}</Text>. You will be signed out of your other devices.</Text>
                    <PasswordField
                      label="New password"
                      value={newResetPassword}
                      onChangeText={setNewResetPassword}
                      placeholder="New password"
                      autoComplete="new-password"
                      hint={newResetPassword ? (
                        <View style={[styles.validationBox, { borderColor: resetPasswordStrength.color }]}>
                          <Text style={[styles.validationTitle, { color: resetPasswordStrength.color }]}>{resetPasswordStrength.label}</Text>
                          <Text style={styles.validationText}>{resetPasswordStrength.description}</Text>
                        </View>
                      ) : null}
                    />
                    <PasswordField
                      label="Confirm new password"
                      value={confirmResetPassword}
                      onChangeText={setConfirmResetPassword}
                      onSubmitEditing={() => void handleSetNewPassword()}
                      returnKeyType="done"
                      placeholder="Confirm new password"
                      autoComplete="new-password"
                      hint={confirmResetPassword ? (
                        <Text style={[styles.matchText, confirmResetPassword === newResetPassword ? styles.matchGood : styles.matchBad]}>
                          {confirmResetPassword === newResetPassword ? '✓ Passwords match' : 'Passwords do not match yet'}
                        </Text>
                      ) : null}
                    />
                    <View style={styles.resetActions}>
                      <Pressable style={styles.secondaryButton} onPress={cancelResetFlow} disabled={resetBusy !== null} accessibilityRole="button">
                        <Text style={styles.secondaryButtonText}>Cancel</Text>
                      </Pressable>
                      <Pressable style={[styles.primaryButton, resetBusy !== null && styles.buttonDisabled]} onPress={handleSetNewPassword} disabled={resetBusy !== null} accessibilityRole="button">
                        {resetBusy === 'save' && <ActivityIndicator size="small" color="#FFFFFF" />}
                        <Text style={styles.primaryButtonText}>{resetBusy === 'save' ? 'Saving...' : 'Set new password'}</Text>
                      </Pressable>
                    </View>
                  </>
                )}
                {slowReset && <Text style={[styles.helpText, styles.resetSlowHint]}>{SLOW_SERVER_HINT}</Text>}
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
    </>
  );
}

const styles = StyleSheet.create(withReadableText({
  loadingSafeArea: { flex: 1, backgroundColor: '#F3F1FB' },
  loadingPage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F3F1FB', paddingHorizontal: 24 },
  loadingBrand: { marginTop: 16, color: '#24212D', fontSize: 24, fontWeight: '900' },
  loadingIndicator: { marginTop: 26 },
  loadingText: { marginTop: 10, color: '#6E6887', fontSize: 13, fontWeight: '600' },
  slowHint: { marginTop: 8, maxWidth: 300, textAlign: 'center' },
  resetSlowHint: { marginTop: 12, textAlign: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2, marginBottom: 20 },
  rememberWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  checkBox: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, borderColor: '#C9C2DE', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  checkBoxActive: { backgroundColor: BRAND, borderColor: BRAND },
  checkText: { fontSize: 14, fontWeight: '600', color: '#4A4458' },
  forgotText: { fontSize: 14, fontWeight: '800', color: BRAND },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  keyboardModal: { flex: 1, justifyContent: 'flex-end' },
  resetScroll: { flexGrow: 1, justifyContent: 'flex-end' },
  resetModal: { width: '100%', maxWidth: 480, alignSelf: 'center', backgroundColor: '#FFFFFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 28 },
  resetHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  resetIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE9FF' },
  resetHeaderCopy: { flex: 1, minWidth: 0 },
  resetStep: { fontSize: 12, fontWeight: '800', color: BRAND },
  resetTitle: { fontSize: 20, fontWeight: '900', color: '#1E1B2E', marginTop: 1 },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F0F7' },
  stepBar: { flexDirection: 'row', gap: 6, marginTop: 16, marginBottom: 14 },
  stepSegment: { flex: 1, height: 5, borderRadius: 3, backgroundColor: '#ECE8F6' },
  stepSegmentDone: { backgroundColor: BRAND },
  resetSubtitle: { fontSize: 14, lineHeight: 21, fontWeight: '500', color: '#5C5670', marginBottom: 16 },
  strong: { fontWeight: '800', color: '#24212D' },
  otpInputWrap: { position: 'relative', marginBottom: 6 },
  otpBoxes: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBox: { flex: 1, maxWidth: 54, aspectRatio: 0.85, borderRadius: 14, borderWidth: 1.5, borderColor: '#E1DCEE', backgroundColor: '#FAF9FD', alignItems: 'center', justifyContent: 'center' },
  otpBoxActive: { borderColor: BRAND, backgroundColor: '#FFFFFF' },
  otpBoxFilled: { borderColor: '#C8BDF5', backgroundColor: '#F6F3FF' },
  otpBoxText: { fontSize: 24, fontWeight: '900', color: '#1E1B2E' },
  otpTextInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, fontSize: 16 },
  resendRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 14, flexWrap: 'wrap' },
  helpText: { fontSize: 13, color: '#6E6887', fontWeight: '600' },
  resendLink: { fontSize: 13, fontWeight: '900', color: BRAND },
  resendLinkDisabled: { color: '#A69FB8' },
  validationBox: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, marginTop: 8 },
  validationTitle: { fontSize: 13, fontWeight: '900' },
  validationText: { fontSize: 12, lineHeight: 17, color: '#5C5670', marginTop: 2 },
  matchText: { fontSize: 12, fontWeight: '800', marginTop: 6 },
  matchGood: { color: '#23774A' },
  matchBad: { color: '#B5701F' },
  resetActions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  secondaryButton: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: '#F1EEF8', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '800', color: '#3B3650' },
  primaryButton: { flex: 1.4, minHeight: 50, borderRadius: 14, backgroundColor: BRAND, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryButtonText: { fontSize: 15, fontWeight: '900', color: '#FFFFFF' },
  buttonDisabled: { opacity: 0.6 },
}));
