import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCurrentSession, resendEmailVerification, updateAuthenticatedProfile, verifyEmailCode, type SessionUser } from '@/authentication';
import { AppDialog, type AppDialogVariant } from '@/components/ui/app-dialog';
import { namesOf } from '@/utils/names';

// Shown after sign-up (or an email change) until the student enters the code we emailed.
// The root navigator sends unverified accounts here and moves on once the email is confirmed.
export default function VerifyEmailScreen() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'verify' | 'resend' | 'email' | null>(null);
  const [countdown, setCountdown] = useState(60);
  const [changingEmail, setChangingEmail] = useState(false);
  const [newEmail, setNewEmail] = useState('');
  const [dialog, setDialog] = useState<{ title: string; message: string; variant: AppDialogVariant } | null>(null);

  useEffect(() => {
    void getCurrentSession().then(setUser);
  }, []);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((current) => Math.max(0, current - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const showDialog = (title: string, message: string, variant: AppDialogVariant = 'error') => setDialog({ title, message, variant });

  const verify = async (value = code) => {
    if (busy || value.length !== 6) return;
    setBusy('verify');
    try {
      const result = await verifyEmailCode(value);
      if (!result.ok) {
        setCode('');
        showDialog('Invalid code', result.message);
      }
      // On success the stored session is refreshed and the app opens automatically.
    } finally {
      setBusy(null);
    }
  };

  const onCodeChange = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 6);
    setCode(digits);
    if (digits.length === 6 && code.length !== 6) void verify(digits);
  };

  const resend = async () => {
    if (busy || countdown > 0) return;
    setBusy('resend');
    try {
      const result = await resendEmailVerification();
      if ('retryAfterSeconds' in result && result.retryAfterSeconds) setCountdown(result.retryAfterSeconds);
      showDialog(result.ok ? 'New code sent' : 'Could not send code', result.message, result.ok ? 'success' : 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeEmail = async () => {
    if (busy || !user) return;
    const email = newEmail.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showDialog('Invalid email', 'Please enter a valid email address.');
      return;
    }
    setBusy('email');
    try {
      const { firstName, lastName } = namesOf(user);
      const result = await updateAuthenticatedProfile({
        firstName,
        lastName,
        username: user.username || '',
        email,
        dateOfBirth: user.dateOfBirth || '',
        gender: user.gender || '',
        about: user.about || '',
      });
      if (!result.ok || !result.user) {
        showDialog('Email not changed', result.message || 'Unable to change your email.');
        return;
      }
      setUser(result.user);
      setChangingEmail(false);
      setNewEmail('');
      setCode('');
      setCountdown(60);
      showDialog('Check your new inbox', `We sent a new code to ${email}.`, 'success');
    } finally {
      setBusy(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.iconBadge}>
            <Ionicons name="mail-unread-outline" size={30} color="#5B42D8" />
          </View>
          <Text style={styles.title}>Confirm your email</Text>
          <Text style={styles.subtitle}>
            Enter the 6-digit code we sent to <Text style={styles.email}>{user?.email ?? 'your email'}</Text>. It expires in 15 minutes. Check your Spam folder if you do not see it.
          </Text>

          <View style={styles.card}>
            <View style={styles.otpWrap}>
              <View style={styles.otpBoxes} pointerEvents="none">
                {Array.from({ length: 6 }, (_, index) => (
                  <View key={index} style={[styles.otpBox, index === code.length && styles.otpBoxActive]}>
                    <Text style={styles.otpText}>{code[index] ?? ''}</Text>
                  </View>
                ))}
              </View>
              <TextInput
                value={code}
                onChangeText={onCodeChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                maxLength={6}
                autoFocus
                editable={busy === null}
                style={styles.otpInput}
                accessibilityLabel="Email verification code"
              />
            </View>

            <Pressable style={[styles.primaryButton, (busy !== null || code.length !== 6) && styles.disabled]} onPress={() => void verify()} disabled={busy !== null || code.length !== 6}>
              {busy === 'verify' && <ActivityIndicator size="small" color="#FFFFFF" />}
              <Text style={styles.primaryText}>{busy === 'verify' ? 'Verifying...' : 'Confirm email'}</Text>
            </Pressable>

            <Pressable onPress={() => void resend()} disabled={busy !== null || countdown > 0} accessibilityRole="button" style={styles.linkButton}>
              <Text style={[styles.link, (busy !== null || countdown > 0) && styles.linkDisabled]}>
                {busy === 'resend' ? 'Sending...' : countdown > 0 ? `Resend code (${countdown}s)` : 'Resend code'}
              </Text>
            </Pressable>
          </View>

          {changingEmail ? (
            <View style={styles.card}>
              <Text style={styles.label}>Correct email address</Text>
              <TextInput value={newEmail} onChangeText={setNewEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} style={styles.input} />
              <View style={styles.row}>
                <Pressable style={styles.secondaryButton} onPress={() => setChangingEmail(false)}>
                  <Text style={styles.secondaryText}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.primaryButton, styles.flex, busy !== null && styles.disabled]} onPress={() => void changeEmail()} disabled={busy !== null}>
                  {busy === 'email' && <ActivityIndicator size="small" color="#FFFFFF" />}
                  <Text style={styles.primaryText}>Send code</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => setChangingEmail(true)} style={styles.linkButton}>
              <Text style={styles.link}>Wrong email? Change it</Text>
            </Pressable>
          )}

          <Pressable onPress={() => router.replace('/logout')} style={styles.linkButton}>
            <Text style={styles.mutedLink}>Sign out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
      <AppDialog visible={dialog !== null} title={dialog?.title ?? ''} message={dialog?.message ?? ''} variant={dialog?.variant} onClose={() => setDialog(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f4f7ff' },
  flex: { flex: 1 },
  page: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 },
  iconBadge: { width: 64, height: 64, borderRadius: 20, backgroundColor: '#EEEAFF', alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '800', color: '#1d1b26', textAlign: 'center' },
  subtitle: { fontSize: 14, lineHeight: 21, color: '#586074', textAlign: 'center', maxWidth: 380 },
  email: { fontWeight: '800', color: '#1d1b26' },
  card: { width: '100%', maxWidth: 420, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 20, gap: 14, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  otpWrap: { position: 'relative', height: 56 },
  otpBoxes: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  otpBox: { flex: 1, height: 56, borderRadius: 12, borderWidth: 1.5, borderColor: '#D9DDEA', alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8F9FD' },
  otpBoxActive: { borderColor: '#5B42D8' },
  otpText: { fontSize: 22, fontWeight: '800', color: '#1d1b26' },
  otpInput: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.01, fontSize: 22 },
  primaryButton: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8', borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16 },
  primaryText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  secondaryButton: { borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, backgroundColor: '#EEF0F6', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#3B3F4C', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
  linkButton: { alignSelf: 'center', paddingVertical: 6 },
  link: { color: '#5B42D8', fontSize: 14, fontWeight: '700' },
  linkDisabled: { color: '#9A94B8' },
  mutedLink: { color: '#777282', fontSize: 13, fontWeight: '600' },
  label: { fontSize: 13, fontWeight: '700', color: '#3B3F4C' },
  input: { borderWidth: 1, borderColor: '#D9DDEA', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#1d1b26', backgroundColor: '#F8F9FD' },
  row: { flexDirection: 'row', gap: 10 },
});
