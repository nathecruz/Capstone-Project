import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ThemeSheet, useChosenTheme } from '@/components/reward-sheets';
import { StorageDetailsSheet } from '@/components/storage-notice';
import { useAppDialog } from '@/components/ui/app-dialog';
import { supportedLanguages, type TranslationKey } from '@/constants/i18n';
import { enableWebReminders, getWebReminderStatus, sendTestReminder, useAppColorScheme, type WebReminderStatus } from '@/hooks/color-scheme-context';
import { exportMyData, changePassword, deleteAccount, getLoginActivity, getPasswordStrengthStatus, validatePasswordStrength, type LoginActivity } from '@/authentication';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { useRewards } from '@/hooks/use-rewards';
import { APP_THEMES, createThemedStyles, themedColor, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

function Toggle({ enabled, onPress, label, isDarkMode }: { enabled: boolean; onPress: () => void; label: string; isDarkMode: boolean }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  const appTheme = useAppTheme();
  return <Pressable style={[styles.toggle, { backgroundColor: enabled ? themedColor('#5B42D8', appTheme) : isDarkMode ? '#5A5664' : '#D7D9E3' }]} onPress={onPress} accessibilityRole="switch" accessibilityLabel={label} accessibilityState={{ checked: enabled }}><View style={[styles.toggleKnob, enabled && styles.toggleKnobOn]} /></Pressable>;
}

function SettingRow({ icon, iconColor, title, subtitle, value, onPress, trailing, danger, last, isDarkMode }: { icon: keyof typeof Ionicons.glyphMap; iconColor: string; title: string; subtitle: string; value?: string; onPress?: () => void; trailing?: React.ReactNode; danger?: boolean; last?: boolean; isDarkMode: boolean }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  iconColor = themedColor(iconColor, useAppTheme());
  return <Pressable style={[styles.settingRow, { borderBottomColor: isDarkMode ? '#302C3B' : '#F0F0F5' }, last && styles.lastRow]} onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={title}>
    <View style={[styles.rowIcon, { backgroundColor: `${iconColor}18` }]}><Ionicons name={icon} size={20} color={iconColor} /></View>
    <View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: isDarkMode ? '#F5F2FA' : '#182044' }, danger && styles.dangerText]}>{title}</Text><Text style={[styles.rowSubtitle, { color: isDarkMode ? '#AAA4B7' : '#8990A5' }]}>{subtitle}</Text></View>
    {value ? <Text style={[styles.rowValue, { color: isDarkMode ? '#CFC8E7' : '#6545C8' }]}>{value}</Text> : null}
    {trailing || (onPress && <Ionicons name="chevron-forward" size={19} color={isDarkMode ? '#AAA4B7' : '#778099'} />)}
  </Pressable>;
}

/** What the "Reminders on this device" row says for each state of the browser. */
const WEB_REMINDER_TEXT: Record<WebReminderStatus, string> = {
  on: 'On. Reminders arrive with your phone\'s notification sound.',
  off: 'Not set up on this device yet. Turn on to get habit reminders here.',
  blocked: 'Blocked by the browser. Allow notifications for this site in its settings, then reopen HabitAI.',
  'needs-home-screen': 'On iPhone: tap Share, then Add to Home Screen, and open HabitAI from the Home Screen.',
  unsupported: 'This browser cannot show reminders. Use Chrome, or HabitAI from the Home Screen.',
};

function SectionHeader({ icon, title, subtitle, isDarkMode }: { icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; isDarkMode: boolean }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return <View style={styles.sectionHeader}><Ionicons name={icon} size={23} color={themeColor('#6844D8')} /><View><Text style={styles.sectionTitle}>{title}</Text><Text style={[styles.sectionSubtitle, isDarkMode && styles.darkMutedText]}>{subtitle}</Text></View></View>;
}

/** Language can be changed here; the region is the one set at sign-up and is shown locked. */
function LocaleCard({ language, region, isDarkMode, onLanguagePress, t }: { language: string; region: string; isDarkMode: boolean; onLanguagePress: () => void; t: (key: TranslationKey) => string }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return <View style={[styles.localeCard, isDarkMode && styles.darkLocaleCard]}>
    <View style={styles.localeIntro}>
      <View style={styles.localeIcon}><Ionicons name="globe-outline" size={21} color={themeColor('#6844D8')} /></View>
      <View style={styles.localeCopy}><Text style={[styles.localeTitle, isDarkMode && styles.darkText]}>{t('languageRegion')}</Text><Text style={[styles.localeSubtitle, isDarkMode && styles.darkMutedText]}>{t('personalizeExperience')}</Text></View>
      <View style={styles.localeReady}><Ionicons name="checkmark-circle" size={15} color={themeColor('#2DAA76')} /><Text style={styles.localeReadyText}>{t('active')}</Text></View>
    </View>
    <View style={[styles.localeDivider, isDarkMode && styles.darkDivider]} />
    <View style={styles.localeValues}>
      <Pressable style={({ pressed }) => [styles.localeValueBlock, pressed && styles.localePressed]} onPress={onLanguagePress} accessibilityRole="button" accessibilityLabel={`${t('language')}: ${language}. Change language`}>
        <Text style={[styles.localeLabel, isDarkMode && styles.darkMutedText]}>{t('language')}</Text>
        <View style={styles.localeValueRow}><Text style={[styles.localeValue, isDarkMode && styles.darkText]} numberOfLines={1}>{language}</Text><Ionicons name="chevron-down" size={15} color={themeColor('#6844D8')} /></View>
        <Text style={[styles.localeHint, isDarkMode && styles.darkMutedText]}>Tap to change</Text>
      </Pressable>
      <View style={[styles.localeValueDivider, isDarkMode && styles.darkDivider]} />
      <View style={styles.localeValueBlock} accessible accessibilityLabel={`${t('region')}: ${region}. Set when you signed up. It cannot be changed.`}>
        <View style={styles.localeValueRow}><Text style={[styles.localeLabel, isDarkMode && styles.darkMutedText]}>{t('region')}</Text><Ionicons name="lock-closed" size={11} color={isDarkMode ? '#AAA4B7' : '#77708F'} /></View>
        <Text style={[styles.localeValue, isDarkMode && styles.darkText]} numberOfLines={1}>{region}</Text>
        <Text style={[styles.localeHint, isDarkMode && styles.darkMutedText]}>Set when you signed up</Text>
      </View>
    </View>
  </View>;
}

function OptionSheet({ visible, title, options, selected, onSelect, onClose, isDarkMode }: { visible: boolean; title: string; options: readonly string[]; selected: string; onSelect: (value: string) => void; onClose: () => void; isDarkMode: boolean }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.modalBackdrop}><View style={[styles.bottomSheet, isDarkMode && styles.darkSheet]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>{title}</Text><Pressable style={styles.closeButton} onPress={onClose} accessibilityLabel="Close selection"><Ionicons name="close" size={20} color={themeColor('#6A6580')} /></Pressable></View><ScrollView style={styles.optionsScroll} contentContainerStyle={styles.optionsContent} showsVerticalScrollIndicator>{options.map((option) => <Pressable key={option} style={[styles.optionRow, isDarkMode && styles.darkOptionRow, selected === option && styles.selectedOption]} onPress={() => onSelect(option)} accessibilityRole="radio" accessibilityState={{ selected: selected === option }}><Text style={[styles.optionText, isDarkMode && styles.darkText]}>{option}</Text>{selected === option && <Ionicons name="checkmark-circle" size={22} color={themeColor('#6844D8')} />}</Pressable>)}</ScrollView></View></View></Modal>;
}

function PasswordField({ value, onChangeText, placeholder, showPassword, onToggle, toggleLabel, isDarkMode, onFocus, inputRef }: { value: string; onChangeText: (value: string) => void; placeholder: string; showPassword: boolean; onToggle: () => void; toggleLabel: string; isDarkMode: boolean; onFocus?: () => void; inputRef?: React.Ref<TextInput> }) {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  return <View style={[styles.passwordInputWrap, isDarkMode && styles.darkInput]}><TextInput ref={inputRef} secureTextEntry={!showPassword} value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={isDarkMode ? '#D8D3E3' : '#657089'} style={[styles.passwordInput, isDarkMode && styles.darkInputText, { paddingRight: 42 }]} onFocus={onFocus} /><Pressable style={styles.passwordToggle} onPress={onToggle} accessibilityRole="button" accessibilityLabel={toggleLabel}><Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={isDarkMode ? '#CFC8E7' : '#657089'} /></Pressable></View>;
}

export default function SettingsPreferencesScreen() {
  const styles: Record<string, any> = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const showAlert = useAppDialog();
  const { width } = useWindowDimensions();
  const compactLayout = width < 360;
  const { isDarkMode, setDarkMode, clearLocalData, profile, preferences, updatePreferences, t, isFaculty } = useAppColorScheme();
  // App theme: one of the Premium Themes once that reward is bought.
  const rewards = useRewards();
  const ownsThemes = rewards.owns('premium-theme');
  const [appTheme] = useChosenTheme();
  const [themeOpen, setThemeOpen] = useState(false);
  const [storageOpen, setStorageOpen] = useState(false);
  const themeCost = rewards.rewards.find((reward) => reward.id === 'premium-theme')?.cost ?? 200;
  const [option, setOption] = useState<'language' | null>(null);
  // Web: whether this browser gets reminders (Web Push), with Turn on and Send test.
  const [webReminders, setWebReminders] = useState<WebReminderStatus | null>(null);
  const [webReminderBusy, setWebReminderBusy] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    let active = true;
    void getWebReminderStatus().then((status) => { if (active) setWebReminders(status); });
    return () => { active = false; };
  }, []);
  const turnOnWebReminders = async () => {
    setWebReminderBusy(true);
    const enabled = await enableWebReminders({ prompt: true });
    const status = await getWebReminderStatus();
    setWebReminders(status);
    setWebReminderBusy(false);
    if (enabled) {
      if (!preferences.notificationsEnabled) updatePreferences({ notificationsEnabled: true });
      showAlert('Reminders are on', 'This device will get your habit reminders. Tap Send test to check the sound.');
    } else {
      showAlert('Reminders are not on', status === 'off' ? 'Allow notifications when your browser asks, then try again.' : WEB_REMINDER_TEXT[status]);
    }
  };
  const testWebReminder = async () => {
    setWebReminderBusy(true);
    const result = await sendTestReminder();
    setWebReminderBusy(false);
    showAlert(result.ok ? 'Test reminder sent' : 'Test reminder failed', result.message);
  };
  const toggleNotifications = () => {
    const enabled = !preferences.notificationsEnabled;
    updatePreferences({ notificationsEnabled: enabled });
    // Turning notifications on from a tap is when the browser may ask for permission.
    if (enabled && Platform.OS === 'web') void enableWebReminders({ prompt: true }).then(() => getWebReminderStatus()).then(setWebReminders);
  };
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [infoPage, setInfoPage] = useState<'login' | 'privacy' | 'terms' | 'about' | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [loginActivities, setLoginActivities] = useState<LoginActivity[]>([]);
  const [loginActivityLoading, setLoginActivityLoading] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const passwordScrollRef = useRef<ScrollView>(null);
  const passwordInputRefs = useRef<Record<'current' | 'new' | 'confirm', TextInput | null>>({ current: null, new: null, confirm: null });
  const scrollToPasswordField = (field: 'current' | 'new' | 'confirm') => {
    const targetInput = passwordInputRefs.current[field];
    if (!targetInput || !passwordScrollRef.current) return;

    targetInput.measure((x, y, width, height, pageX, pageY) => {
      const adjustment = Platform.OS === 'ios' ? 120 : 80;
      passwordScrollRef.current?.scrollTo({ y: Math.max(0, pageY - adjustment), animated: true });
    });
  };
  const resetPasswordForm = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  };
  const resetDeleteForm = () => {
    setDeletePassword('');
    setDeleteConfirmation('');
    setShowDeletePassword(false);
  };
  const newPasswordStrength = getPasswordStrengthStatus(newPassword, {
    fullName: profile.fullName,
    email: profile.email,
    username: profile.username,
    serviceWords: ['habitai', 'habit'],
  });
  const selectLanguage = (value: string) => { updatePreferences({ language: value }); setOption(null); };
  const openLoginActivity = () => {
    setLoginActivities([]);
    setInfoPage('login');
  };
  useEffect(() => {
    if (infoPage !== 'login') return;
    let cancelled = false;
    const loadLoginActivity = async () => {
      setLoginActivityLoading(true);
      const result = await getLoginActivity();
      if (!cancelled) {
        setLoginActivities(result.activities);
        setLoginActivityLoading(false);
      }
    };
    void loadLoginActivity();
    const refreshTimer = setInterval(() => void loadLoginActivity(), 5000);
    return () => {
      cancelled = true;
      clearInterval(refreshTimer);
    };
  }, [infoPage]);
  const openDeleteAccount = () => setDeleteOpen(true);
  const savePassword = async () => {
    if (!currentPassword) {
      return showAlert('Current password required', 'Enter your current password before choosing a new one.');
    }

    if (newPassword !== confirmPassword) {
      return showAlert('Passwords do not match', 'Check both password fields and try again.');
    }

    const passwordValidation = validatePasswordStrength(newPassword, {
      fullName: profile.fullName,
      email: profile.email,
      username: profile.username,
      serviceWords: ['habitai', 'habit'],
    });

    if (!passwordValidation.ok) {
      return showAlert('Weak password', passwordValidation.message || 'Choose a stronger password.');
    }

    const result = await changePassword(currentPassword, newPassword);
    if (!result.ok) {
      return showAlert('Password update failed', result.message || 'Unable to update your password.');
    }

    resetPasswordForm();
    setPasswordOpen(false);
    showAlert('Password updated', 'Your password has been updated. Please sign in again.');
  };
  const confirmDeleteAccount = async () => {
    if (!deletePassword) {
      showAlert('Password required', 'Enter your current password to delete your account.');
      return;
    }

    if (deleteConfirmation.trim().toUpperCase() !== 'DELETE') {
      showAlert('Confirmation required', 'Type DELETE exactly to confirm permanent account deletion.');
      return;
    }

    setDeleteBusy(true);
    const result = await deleteAccount(deletePassword);
    setDeleteBusy(false);
    if (!result.ok) {
      showAlert('Account deletion failed', result.message || 'Unable to delete your account.');
      return;
    }

    resetDeleteForm();
    setDeleteOpen(false);
    clearLocalData();
    showAlert('Account deleted', 'Your account and associated data have been permanently deleted.', [{ text: 'OK', onPress: () => router.replace('/login') }]);
  };
  const infoContent = infoPage === 'login'
    ? { title: t('loginActivity'), body: `Current session\n\nAccount: ${profile.email || 'Signed-in account'}\nStatus: Active now\nDevice: This device\n\nOnly this active session is shown here. Sign out below to end it on this device.` }
    : infoPage === 'privacy'
      ? { title: t('privacyPolicy'), body: 'HabitAI stores the account details needed to sign you in and the habit data you create. We use this information to provide app features, protect accounts, and improve the experience. You can review Login Activity or permanently delete your account from this screen.' }
      : infoPage === 'terms'
        ? { title: t('termsConditions'), body: 'Use HabitAI responsibly and keep your account credentials private. AI suggestions are for general guidance and are not professional medical, financial, or legal advice. You are responsible for the habits and information you add to the app.' }
        : infoPage === 'about'
          ? { title: t('aboutData'), body: 'Your profile, preferences, habits, points, tokens, and activity history are app data. Account credentials and sessions are protected by the account service. AI features only receive the minimum habit context needed to generate a response.' }
          : null;
  const loginActivityTime = loginActivities[0]
    ? new Date(loginActivities[0].createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : 'the latest sign-in';

  return <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><View style={[styles.container, { paddingHorizontal: compactLayout ? 12 : 16 }]}>
    <View style={styles.topBar}><Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back"><Ionicons name="chevron-back" size={22} color={isDarkMode ? '#F5F2FA' : '#192044'} /></Pressable><View style={styles.topIcon}><Ionicons name="settings" size={22} color={themeColor('#6844D8')} /></View></View>
    <View style={[styles.hero, { paddingHorizontal: compactLayout ? 18 : 50 }]}><Text style={[styles.heroTitle, isDarkMode && styles.darkText]}>{t('settingsPreferences')}</Text><Text style={[styles.heroSubtitle, isDarkMode && styles.darkMutedText]}>Customize your experience and{`\n`}manage your app settings.</Text></View>
    <Pressable style={[styles.progressBanner, isDarkMode && styles.darkBanner]} onPress={() => router.push('/progress')} accessibilityRole="button"><View style={styles.bannerIcon}><Ionicons name="trending-up" size={23} color={themeColor('#6844D8')} /></View><View style={styles.bannerCopy}><Text style={[styles.bannerTitle, isDarkMode && styles.darkText]}>Your Progress &amp; Goals</Text><Text style={[styles.bannerSubtitle, isDarkMode && styles.darkMutedText]}>Stay consistent. Build a better you.</Text></View><Ionicons name="chevron-forward" size={20} color={themeColor('#5E6178')} /></Pressable>
    <SectionHeader icon="options-outline" title={t('preferences')} subtitle={t('setHowAppWorks')} isDarkMode={isDarkMode} /><View style={[styles.card, isDarkMode && styles.darkCard]}>
      <SettingRow icon="notifications" iconColor="#6C51DC" title={t('notifications')} subtitle={t('receiveUpdates')} trailing={<Toggle enabled={preferences.notificationsEnabled} onPress={toggleNotifications} label={t('notifications')} isDarkMode={isDarkMode} />} isDarkMode={isDarkMode} />
      {Platform.OS === 'web' && <SettingRow icon="phone-portrait" iconColor="#2F9E6E" title="Reminders on this device" subtitle={webReminders ? WEB_REMINDER_TEXT[webReminders] : 'Checking this device...'} trailing={webReminders === 'on' || webReminders === 'off' ? <Pressable style={[styles.smallButton, webReminderBusy && styles.disabledButton]} onPress={webReminders === 'on' ? testWebReminder : turnOnWebReminders} disabled={webReminderBusy} accessibilityRole="button" accessibilityLabel={webReminders === 'on' ? 'Send a test reminder' : 'Turn on reminders on this device'}><Text style={styles.smallButtonText}>{webReminderBusy ? '...' : webReminders === 'on' ? 'Send test' : 'Turn on'}</Text></Pressable> : undefined} isDarkMode={isDarkMode} />}
      <SettingRow icon="trophy" iconColor="#E0A21B" title="Show me on leaderboards" subtitle="Others see only your first name and last initial" trailing={<Toggle enabled={preferences.showOnLeaderboard !== false} onPress={() => updatePreferences({ showOnLeaderboard: preferences.showOnLeaderboard === false })} label="Show me on leaderboards" isDarkMode={isDarkMode} />} isDarkMode={isDarkMode} />
      <SettingRow icon="moon" iconColor="#3564D8" title={t('darkMode')} subtitle={t('switchTheme')} trailing={<Toggle enabled={isDarkMode} onPress={() => setDarkMode(!isDarkMode)} label={t('darkMode')} isDarkMode={isDarkMode} />} last={!ownsThemes && isFaculty} isDarkMode={isDarkMode} />
      {(ownsThemes || !isFaculty) && <SettingRow icon="color-palette" iconColor="#C2549B" title="App theme" subtitle={ownsThemes ? 'Ocean, Sunset, Forest or Midnight' : `Unlock Premium Themes for ${themeCost} tokens`} value={ownsThemes ? APP_THEMES.find((theme) => theme.id === appTheme)?.name : 'Locked'} onPress={() => (ownsThemes ? setThemeOpen(true) : router.push('/leaderboards'))} last isDarkMode={isDarkMode} />}
    </View>
    <LocaleCard language={preferences.language} region={preferences.region} isDarkMode={isDarkMode} onLanguagePress={() => setOption('language')} t={t} />
    <SectionHeader icon="shield-checkmark-outline" title={t('privacyData')} subtitle={t('controlData')} isDarkMode={isDarkMode} /><View style={[styles.card, isDarkMode && styles.darkCard]}>
      <SettingRow icon="time" iconColor="#6844D8" title={t('loginActivity')} subtitle={t('loginActivityDescription')} onPress={openLoginActivity} isDarkMode={isDarkMode} />
      <SettingRow icon="shield-checkmark" iconColor="#5B42D8" title="Cookies and storage" subtitle="Only what the app needs. No tracking cookies." onPress={() => setStorageOpen(true)} isDarkMode={isDarkMode} />
      <SettingRow icon="download" iconColor="#2F9E6E" title="Download my data" subtitle="Get a copy of everything HabitAI stores about you" onPress={() => void exportMyData().then((result) => showAlert(result.ok ? 'Your data' : 'Export failed', result.message))} isDarkMode={isDarkMode} />
      <SettingRow icon="document-text" iconColor="#3564D8" title={t('privacyPolicy')} subtitle={t('privacyPolicyDescription')} onPress={() => router.push('/privacy-notice')} isDarkMode={isDarkMode} />
      <SettingRow icon="reader" iconColor="#3564D8" title={t('termsConditions')} subtitle={t('termsConditionsDescription')} onPress={() => setInfoPage('terms')} isDarkMode={isDarkMode} />
      <SettingRow icon="information-circle" iconColor="#3564D8" title={t('aboutData')} subtitle={t('aboutDataDescription')} onPress={() => setInfoPage('about')} isDarkMode={isDarkMode} />
      <SettingRow icon="trash" iconColor="#E65B77" title={t('deleteAccount')} subtitle={t('deleteAccountDescription')} onPress={() => showAlert('Delete Account?', 'This permanently deletes your account, sessions, and associated data. This action cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Continue', style: 'destructive', onPress: openDeleteAccount }])} danger last isDarkMode={isDarkMode} />
    </View><View style={[styles.securityNote, isDarkMode && styles.darkBanner]}><Ionicons name="information-circle" size={16} color={themeColor('#6844D8')} /><Text style={[styles.securityText, isDarkMode && styles.darkMutedText]}>Your data is safe and always in your control.</Text></View>
    <SectionHeader icon="person-outline" title={t('account')} subtitle={t('manageAccount')} isDarkMode={isDarkMode} /><View style={[styles.card, isDarkMode && styles.darkCard]}>
      <SettingRow icon="lock-closed" iconColor="#6C51DC" title={t('changePassword')} subtitle={t('updatePassword')} onPress={() => setPasswordOpen(true)} isDarkMode={isDarkMode} />
      <SettingRow icon="log-out" iconColor="#E65B77" title={t('logOut')} subtitle={t('signOut')} onPress={() => showAlert('Log Out?', 'Are you sure you want to log out?', [{ text: 'Cancel', style: 'cancel' }, { text: 'Log Out', style: 'destructive', onPress: () => router.replace('/logout') }])} danger last isDarkMode={isDarkMode} />
    </View>
  </View></ScrollView>
  <OptionSheet visible={option === 'language'} title={t('language')} options={supportedLanguages} selected={preferences.language} onSelect={selectLanguage} onClose={() => setOption(null)} isDarkMode={isDarkMode} />
  <Modal visible={passwordOpen} transparent animationType="slide" onRequestClose={() => { resetPasswordForm(); setPasswordOpen(false); }}><View style={styles.modalBackdrop}><KeyboardAvoidingView style={styles.keyboardSheet} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}><View style={[styles.bottomSheet, styles.passwordSheet, isDarkMode && styles.darkSheet]}><View style={styles.sheetHandle} /><View style={[styles.passwordHero, isDarkMode && styles.darkPasswordHero]}><View style={styles.passwordHeroIcon}><Ionicons name="shield-checkmark" size={26} color={themeColor('#6844D8')} /></View><View style={styles.passwordHeroCopy}><Text style={[styles.passwordHeroTitle, isDarkMode && styles.darkText]}>Secure your account</Text><Text style={[styles.passwordHeroText, isDarkMode && styles.darkMutedText]}>Create a new password you will remember.</Text></View></View><View style={styles.sheetHeader}><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>Change Password</Text><Pressable style={styles.closeButton} onPress={() => { resetPasswordForm(); setPasswordOpen(false); }} accessibilityLabel="Close change password"><Ionicons name="close" size={20} color={themeColor('#6A6580')} /></Pressable></View><ScrollView ref={passwordScrollRef} style={styles.passwordScroll} contentContainerStyle={styles.passwordContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View style={[styles.passwordForm, isDarkMode && styles.darkPasswordForm]}><Text style={[styles.passwordIntro, isDarkMode && styles.darkMutedText]}>Your new password must be at least 8 characters and should not include personal information.</Text><Text style={[styles.inputLabel, isDarkMode && styles.darkMutedText]}>Current password</Text><PasswordField value={currentPassword} onChangeText={setCurrentPassword} placeholder="Enter current password" showPassword={showCurrentPassword} onToggle={() => setShowCurrentPassword((current) => !current)} toggleLabel={showCurrentPassword ? 'Hide current password' : 'Show current password'} isDarkMode={isDarkMode} inputRef={(node) => { passwordInputRefs.current.current = node; }} onFocus={() => scrollToPasswordField('current')} /><Text style={[styles.inputLabel, isDarkMode && styles.darkMutedText]}>New password</Text><PasswordField value={newPassword} onChangeText={setNewPassword} placeholder="At least 8 characters" showPassword={showNewPassword} onToggle={() => setShowNewPassword((current) => !current)} toggleLabel={showNewPassword ? 'Hide new password' : 'Show new password'} isDarkMode={isDarkMode} inputRef={(node) => { passwordInputRefs.current.new = node; }} onFocus={() => scrollToPasswordField('new')} />{newPassword ? <View style={[styles.passwordStrength, { borderColor: newPasswordStrength.color }]}><Text style={[styles.passwordStrengthTitle, { color: newPasswordStrength.color }]}>{newPasswordStrength.label}</Text><Text style={[styles.passwordStrengthText, isDarkMode && styles.darkMutedText]}>{newPasswordStrength.description}</Text></View> : null}<Text style={[styles.inputLabel, isDarkMode && styles.darkMutedText]}>Confirm password</Text><PasswordField value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Repeat your password" showPassword={showConfirmPassword} onToggle={() => setShowConfirmPassword((current) => !current)} toggleLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'} isDarkMode={isDarkMode} inputRef={(node) => { passwordInputRefs.current.confirm = node; }} onFocus={() => scrollToPasswordField('confirm')} /><Pressable style={styles.primaryButton} onPress={savePassword}><Ionicons name="checkmark-circle-outline" size={18} color={themeColor('#FFF')} /><Text style={styles.primaryButtonText}>Update Password</Text></Pressable></View></ScrollView></View></KeyboardAvoidingView></View></Modal>
  <Modal visible={Boolean(infoContent)} transparent animationType="slide" onRequestClose={() => setInfoPage(null)}><View style={styles.modalBackdrop}><View style={[styles.bottomSheet, isDarkMode && styles.darkSheet]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>{infoContent?.title}</Text><Pressable style={styles.closeButton} onPress={() => setInfoPage(null)}><Ionicons name="close" size={20} color={themeColor('#6A6580')} /></Pressable></View><ScrollView><Text style={[styles.infoText, isDarkMode && styles.darkMutedText]}>{infoContent?.body}</Text></ScrollView><Pressable style={styles.primaryButton} onPress={() => setInfoPage(null)}><Text style={styles.primaryButtonText}>Done</Text></Pressable></View></View></Modal>
  <Modal visible={infoPage === 'login'} transparent animationType="slide" onRequestClose={() => setInfoPage(null)}><View style={styles.modalBackdrop}><View style={[styles.bottomSheet, styles.loginSheet, isDarkMode && styles.darkSheet]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View style={styles.loginTitleWrap}><View style={styles.loginTitleIcon}><Ionicons name="shield-checkmark" size={21} color={themeColor('#6844D8')} /></View><View><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>Login Activity</Text><View style={styles.liveLabel}><View style={styles.activeDot} /><Text style={styles.liveLabelText}>Live updates every 5 seconds</Text></View></View></View><Pressable style={styles.closeButton} onPress={() => setInfoPage(null)} accessibilityLabel="Close login activity"><Ionicons name="close" size={20} color={themeColor('#6A6580')} /></Pressable></View><View style={[styles.activeSessionCard, isDarkMode && styles.darkActiveSessionCard]}><View style={styles.sessionDeviceIcon}><Ionicons name="phone-portrait-outline" size={25} color={themeColor('#6844D8')} /></View><View style={styles.sessionCopy}><Text style={[styles.sessionDeviceTitle, isDarkMode && styles.darkText]}>Current session</Text><Text style={[styles.sessionEmail, isDarkMode && styles.darkMutedText]} numberOfLines={1}>{loginActivities[0]?.device || 'Detecting device...'}</Text><Text style={[styles.sessionTime, isDarkMode && styles.darkMutedText]}>{profile.email || 'Signed-in account'} | Active since {loginActivityTime}</Text></View><View style={styles.activeBadge}><View style={styles.activeDot} /><Text style={styles.activeBadgeText}>Active</Text></View></View><Text style={[styles.activityHeading, isDarkMode && styles.darkText]}>Recent sign-ins</Text>{loginActivityLoading ? <View style={styles.activityLoading}><Text style={[styles.sessionTime, isDarkMode && styles.darkMutedText]}>Loading activity...</Text></View> : loginActivities.length === 0 ? <View style={[styles.emptyActivity, isDarkMode && styles.darkActiveSessionCard]}><Ionicons name="time-outline" size={19} color={themeColor('#8B83A6')} /><Text style={[styles.sessionTime, isDarkMode && styles.darkMutedText]}>No saved sign-ins yet.</Text></View> : <ScrollView style={styles.activityList}>{loginActivities.map((activity, index) => <View key={`${activity.createdAt}-${index}`} style={[styles.activityRow, isDarkMode && styles.darkActivityRow]}><View style={styles.activityRowIcon}><Ionicons name="log-in-outline" size={17} color={themeColor('#6844D8')} /></View><View style={styles.sessionCopy}><Text style={[styles.sessionDeviceTitle, isDarkMode && styles.darkText]}>{index === 0 ? 'Most recent sign-in' : 'Previous sign-in'}</Text><Text style={[styles.sessionEmail, isDarkMode && styles.darkMutedText]} numberOfLines={1}>{activity.device}</Text><Text style={[styles.sessionTime, isDarkMode && styles.darkMutedText]}>{new Date(activity.createdAt).toLocaleString()}</Text></View></View>)}</ScrollView>}<View style={[styles.securityCallout, isDarkMode && styles.darkSecurityCallout]}><Ionicons name="lock-closed" size={17} color={themeColor('#2DAA76')} /><Text style={[styles.securityCalloutText, isDarkMode && styles.darkMutedText]}>Only you should see this activity. Sign out if this device is not yours.</Text></View><Pressable style={styles.secondaryAction} onPress={() => showAlert('Sign out this device?', 'You will need to sign in again to access HabitAI.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: () => router.replace('/logout') }])}><Ionicons name="log-out-outline" size={18} color={themeColor('#D94868')} /><Text style={styles.secondaryActionText}>Sign out this device</Text></Pressable><Pressable style={styles.primaryButton} onPress={() => setInfoPage(null)}><Text style={styles.primaryButtonText}>Done</Text></Pressable></View></View></Modal>
  <Modal visible={deleteOpen} transparent statusBarTranslucent presentationStyle="overFullScreen" animationType="slide" onRequestClose={() => { if (!deleteBusy) { resetDeleteForm(); setDeleteOpen(false); } }}><View style={styles.modalBackdrop}><KeyboardAvoidingView style={styles.keyboardSheet} behavior="padding" keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}><View style={[styles.bottomSheet, styles.deleteSheet, isDarkMode && styles.darkSheet]}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><Text style={[styles.sheetTitle, isDarkMode && styles.darkText]}>Delete Account</Text><Pressable style={styles.closeButton} onPress={() => { if (!deleteBusy) { resetDeleteForm(); setDeleteOpen(false); } }} accessibilityLabel="Close delete account"><Ionicons name="close" size={20} color={themeColor('#6A6580')} /></Pressable></View><ScrollView style={styles.deleteScroll} contentContainerStyle={styles.deleteContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View style={styles.deleteWarning}><Ionicons name="warning" size={22} color={themeColor('#D94868')} /><View style={styles.deleteWarningCopy}><Text style={styles.deleteWarningTitle}>This action is permanent</Text><Text style={styles.deleteWarningText}>Your profile, habits, progress, and sessions will be permanently removed.</Text></View></View><Text style={[styles.inputLabel, isDarkMode && styles.darkMutedText]}>Type DELETE to continue</Text><TextInput autoCapitalize="characters" autoCorrect={false} value={deleteConfirmation} onChangeText={setDeleteConfirmation} placeholder="DELETE" placeholderTextColor={themeColor('#9A94A4')} style={[styles.input, styles.deleteConfirmationInput, isDarkMode && styles.darkInput]} returnKeyType="next" /><Text style={[styles.inputLabel, isDarkMode && styles.darkMutedText]}>Current password</Text><View style={[styles.passwordInputWrap, styles.deletePasswordWrap, isDarkMode && styles.darkInput]}><TextInput secureTextEntry={!showDeletePassword} value={deletePassword} onChangeText={setDeletePassword} placeholder="Enter your current password" placeholderTextColor={themeColor('#9A94A4')} style={[styles.passwordInput, isDarkMode && styles.darkInputText]} returnKeyType="done" onSubmitEditing={confirmDeleteAccount} /><Pressable style={styles.passwordToggle} onPress={() => setShowDeletePassword((current) => !current)} accessibilityRole="button" accessibilityLabel={showDeletePassword ? 'Hide current password' : 'Show current password'}><Ionicons name={showDeletePassword ? 'eye-off-outline' : 'eye-outline'} size={21} color={isDarkMode ? '#CFC8E7' : '#657089'} /></Pressable></View><Pressable style={[styles.primaryButton, styles.deleteButton, (!deletePassword || deleteConfirmation.trim().toUpperCase() !== 'DELETE' || deleteBusy) && styles.disabledButton]} onPress={confirmDeleteAccount} disabled={deleteBusy}><Ionicons name="trash-outline" size={18} color={themeColor('#FFF')} /><Text style={styles.primaryButtonText}>{deleteBusy ? 'Deleting...' : 'Delete Account Permanently'}</Text></Pressable></ScrollView></View></KeyboardAvoidingView></View></Modal>
  <ThemeSheet visible={themeOpen} onClose={() => setThemeOpen(false)} />
  {storageOpen && <StorageDetailsSheet onClose={() => setStorageOpen(false)} />}
  </SafeAreaView>;
}

const themedStyles = createThemedStyles({
  smallButton: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#5B42D8', marginLeft: 8 }, smallButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  screen: { flex: 1, backgroundColor: '#F7F8FC' }, darkScreen: { backgroundColor: '#111018' }, content: { paddingBottom: 110 }, container: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4, marginBottom: 10 }, backButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EEF0FA', alignItems: 'center', justifyContent: 'center' }, topIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#EDE7FF', alignItems: 'center', justifyContent: 'center' },
  hero: { paddingHorizontal: 50, marginBottom: 20 }, heroTitle: { fontSize: 25, lineHeight: 30, fontWeight: '900', color: '#172043' }, heroSubtitle: { fontSize: 14, lineHeight: 19, color: '#7A8298', marginTop: 5, fontWeight: '600' }, darkText: { color: '#F5F2FA' }, darkMutedText: { color: '#AAA4B7' },
  progressBanner: { minHeight: 78, flexDirection: 'row', alignItems: 'center', backgroundColor: '#E8E6FF', borderRadius: 16, padding: 14, marginBottom: 23 }, darkBanner: { backgroundColor: '#292340' }, bannerIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 }, bannerCopy: { flex: 1 }, bannerTitle: { color: '#172043', fontSize: 14, fontWeight: '900' }, bannerSubtitle: { color: '#7A8298', fontSize: 11, marginTop: 4, fontWeight: '600' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 9, paddingHorizontal: 7 }, sectionTitle: { color: '#6844D8', fontSize: 14, fontWeight: '900', letterSpacing: 0.3 }, sectionSubtitle: { color: '#8A91A5', fontSize: 11, marginTop: 2, fontWeight: '600' }, card: { backgroundColor: '#FFF', borderRadius: 17, paddingHorizontal: 14, marginBottom: 19 }, darkCard: { backgroundColor: '#1D1A24' },
  localeCard: { backgroundColor: '#F0ECFF', borderRadius: 17, padding: 15, marginBottom: 22, borderWidth: 1, borderColor: '#E1D9FF' }, darkLocaleCard: { backgroundColor: '#292340', borderColor: '#40365C' }, localeIntro: { flexDirection: 'row', alignItems: 'center' }, localeIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 }, localeCopy: { flex: 1 }, localeTitle: { color: '#282047', fontSize: 14, fontWeight: '900' }, localeSubtitle: { color: '#77708F', fontSize: 11, marginTop: 3, fontWeight: '600' }, localeReady: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12, backgroundColor: '#E1F5EA' }, localeReadyText: { color: '#23835A', fontSize: 10, fontWeight: '900' }, localeDivider: { height: 1, backgroundColor: '#DFD7F8', marginVertical: 14 }, darkDivider: { backgroundColor: '#40365C' }, localeValues: { flexDirection: 'row', alignItems: 'center' }, localeValueBlock: { flex: 1, minWidth: 0, borderRadius: 10 }, localePressed: { opacity: 0.7 }, localeValueRow: { flexDirection: 'row', alignItems: 'center', gap: 5 }, localeHint: { color: '#77708F', fontSize: 11, fontWeight: '600', marginTop: 3 }, localeLabel: { color: '#77708F', fontSize: 10, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.5 }, localeValue: { flexShrink: 1, color: '#282047', fontSize: 14, fontWeight: '900', marginTop: 4 }, localeValueDivider: { width: 1, height: 30, backgroundColor: '#DFD7F8', marginHorizontal: 18 },
  settingRow: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 }, lastRow: { borderBottomWidth: 0 }, rowIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 12 }, rowCopy: { flex: 1 }, rowTitle: { fontSize: 14, fontWeight: '900' }, rowSubtitle: { fontSize: 11, marginTop: 4, fontWeight: '600' }, rowValue: { fontSize: 12, fontWeight: '800', marginRight: 8 }, dangerText: { color: '#E65B77' }, toggle: { width: 54, height: 31, borderRadius: 16, padding: 4, justifyContent: 'center' }, toggleKnob: { width: 23, height: 23, borderRadius: 12, backgroundColor: '#FFF' }, toggleKnobOn: { alignSelf: 'flex-end' },
  securityNote: { minHeight: 32, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#EEE9FF', borderRadius: 13, marginTop: -5, marginBottom: 21 }, securityText: { color: '#7469A3', fontSize: 10, fontWeight: '700' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.38)' }, bottomSheet: { backgroundColor: '#FFF', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 18, maxHeight: '82%', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: -4 }, elevation: 8 }, darkSheet: { backgroundColor: '#1D1A24' }, sheetHandle: { alignSelf: 'center', width: 52, height: 5, borderRadius: 3, backgroundColor: '#D5D0E2', marginBottom: 14 }, sheetHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }, sheetTitle: { fontSize: 22, fontWeight: '900', color: '#182044', letterSpacing: -0.3 }, closeButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F2F1F7', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E9E5F3' }, optionsScroll: { maxHeight: 520 }, optionsContent: { paddingBottom: 4 }, optionRow: { minHeight: 52, borderWidth: 1, borderColor: '#E7E4EF', borderRadius: 13, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 9 }, darkOptionRow: { borderColor: '#3B3647' }, selectedOption: { backgroundColor: '#F0ECFF', borderColor: '#8E7AE8' }, optionText: { color: '#302B3B', fontSize: 14, fontWeight: '800' }, modalDescription: { color: '#7A8298', fontSize: 11, marginTop: 3 }, inputLabel: { color: '#7A8298', fontSize: 12, fontWeight: '800', marginBottom: 6, marginTop: 10 }, strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 4 }, strengthDot: { width: 10, height: 10, borderRadius: 5 }, strengthText: { fontSize: 11, fontWeight: '800' }, strengthHint: { color: '#657089', fontSize: 11, marginBottom: 10 }, input: { height: 47, borderWidth: 1, borderColor: '#E2DEEA', borderRadius: 12, paddingHorizontal: 13, color: '#302B3B', backgroundColor: '#FBFAFD' }, darkInput: { borderColor: '#3B3647', color: '#F5F2FA', backgroundColor: '#25212E' }, primaryButton: { height: 52, borderRadius: 14, backgroundColor: '#6844D8', alignItems: 'center', justifyContent: 'center', marginTop: 18, shadowColor: '#6844D8', shadowOpacity: 0.22, shadowRadius: 10, shadowOffset: { width: 0, height: 6 }, elevation: 4 }, primaryButtonText: { color: '#FFF', fontSize: 15, fontWeight: '900' }, exportPreview: { maxHeight: 270, backgroundColor: '#FBFAFD', borderRadius: 12, padding: 12 }, exportText: { color: '#302B3B', fontSize: 11, lineHeight: 17 },
  keyboardSheet: { flex: 1, justifyContent: 'flex-end' }, passwordSheet: { width: '100%', height: '92%', maxHeight: '92%', flexShrink: 1, paddingBottom: 12 }, passwordHero: { flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, backgroundColor: '#F2EEFF', borderWidth: 1, borderColor: '#E4D9FF', marginBottom: 14 }, darkPasswordHero: { backgroundColor: '#292340', borderColor: '#40365C' }, passwordHeroIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF', marginRight: 12 }, passwordHeroCopy: { flex: 1 }, passwordHeroTitle: { color: '#282047', fontSize: 17, fontWeight: '900' }, passwordHeroText: { color: '#77708F', fontSize: 11.5, lineHeight: 16, marginTop: 3 }, passwordScroll: { flex: 1, minHeight: 0 }, passwordForm: { padding: 14, borderRadius: 18, backgroundColor: '#F9F8FC', borderWidth: 1, borderColor: '#EFEAF9' }, darkPasswordForm: { backgroundColor: '#25212E', borderColor: '#3B3647' }, passwordIntro: { color: '#77708F', fontSize: 12.5, lineHeight: 18, marginBottom: 8 },
  deleteSheet: { width: '100%', height: '78%', maxHeight: '78%', flexShrink: 1, paddingBottom: 12 },
  deleteScroll: { flex: 1 },
  deleteContent: { paddingBottom: 150 },
  deleteWarning: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 12, borderRadius: 13, backgroundColor: '#FFF0F1', marginBottom: 8 },
  deleteWarningCopy: { flex: 1 },
  deleteWarningTitle: { color: '#B52E4D', fontSize: 13, fontWeight: '900' },
  deleteWarningText: { color: '#8D5363', fontSize: 11, lineHeight: 16, marginTop: 3 },
  deleteConfirmationInput: { marginTop: 0 },
  deletePasswordWrap: { marginTop: 0 },
  disabledButton: { opacity: 0.55 },
  passwordInputWrap: { height: 52, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E2DEEA', borderRadius: 14, backgroundColor: '#FFF' },
  passwordInput: { flex: 1, height: 50, paddingHorizontal: 13, paddingRight: 42, color: '#302B3B', fontSize: 15 },
  passwordToggle: { width: 46, height: 50, alignItems: 'center', justifyContent: 'center', marginLeft: -4 },
  darkInputText: { color: '#F5F2FA' },
  passwordStrength: { borderWidth: 1, borderRadius: 10, padding: 10, marginTop: 8 },
  passwordStrengthTitle: { fontSize: 12, fontWeight: '800' },
  passwordStrengthText: { fontSize: 11, marginTop: 3 },
  infoText: { color: '#596178', fontSize: 14, lineHeight: 22 },
  loginSheet: { paddingBottom: 24 },
  loginTitleWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  loginTitleIcon: { width: 40, height: 40, borderRadius: 13, backgroundColor: '#EDE7FF', alignItems: 'center', justifyContent: 'center' },
  liveLabel: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 3 },
  liveLabelText: { color: '#23835A', fontSize: 10, fontWeight: '800' },
  activeSessionCard: { flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 17, backgroundColor: '#F3F0FF', borderWidth: 1, borderColor: '#E0D8FF', marginBottom: 14 },
  darkActiveSessionCard: { backgroundColor: '#292340', borderColor: '#40365C' },
  sessionDeviceIcon: { width: 47, height: 47, borderRadius: 15, backgroundColor: '#FFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  sessionCopy: { flex: 1, minWidth: 0 },
  sessionDeviceTitle: { color: '#282047', fontSize: 14, fontWeight: '900' },
  sessionEmail: { color: '#77708F', fontSize: 11, marginTop: 3 },
  sessionTime: { color: '#77708F', fontSize: 10, marginTop: 5, fontWeight: '600' },
  activeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 10, backgroundColor: '#E1F5EA', marginLeft: 8 },
  activeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#2DAA76' },
  activeBadgeText: { color: '#23835A', fontSize: 10, fontWeight: '900' },
  securityCallout: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 13, backgroundColor: '#EDF8F2', marginBottom: 14 },
  darkSecurityCallout: { backgroundColor: '#1D3028' },
  securityCalloutText: { flex: 1, color: '#50705E', fontSize: 11, lineHeight: 16, fontWeight: '600' },
  activityHeading: { color: '#282047', fontSize: 13, fontWeight: '900', marginBottom: 8 },
  activityLoading: { minHeight: 48, justifyContent: 'center' },
  activityList: { maxHeight: 150, marginBottom: 12 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#EEEAF7' },
  darkActivityRow: { borderBottomColor: '#3B3647' },
  activityRowIcon: { width: 32, height: 32, borderRadius: 10, backgroundColor: '#F0ECFF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  emptyActivity: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  secondaryAction: { height: 45, borderRadius: 13, borderWidth: 1, borderColor: '#F1B4C1', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  secondaryActionText: { color: '#D94868', fontSize: 13, fontWeight: '900' },
  deletePasswordInput: { borderWidth: 1, borderColor: '#E2DEEA', borderRadius: 12, backgroundColor: '#FBFAFD', marginTop: 18 },
  deleteButton: { backgroundColor: '#D94868' },
  passwordContent: { paddingBottom: 160 },
});
