import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { type DateTimePickerChangeEvent } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { updateAuthenticatedProfile } from '@/authentication';
import { type Profile, useAppColorScheme } from '@/hooks/color-scheme-context';

const formatDateOfBirth = (date: Date) => date.toLocaleDateString('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

const parseDateOfBirth = (value: string) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date(1998, 4, 14) : date;
};

const detailFields: { key: keyof Profile; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'fullName', label: 'Full Name', icon: 'person-outline' },
  { key: 'email', label: 'Email', icon: 'mail-outline' },
  { key: 'username', label: 'Username', icon: 'at-outline' },
  { key: 'dateOfBirth', label: 'Date of Birth', icon: 'calendar-outline' },
  { key: 'gender', label: 'Gender', icon: 'female-outline' },
];

const genderOptions = ['Female', 'Male', 'Non-binary', 'Prefer not to say'];

export default function PersonalInformationScreen() {
  const showAlert = useAppDialog();
  const { isDarkMode, avatarImage, setAvatarImage, habits, profile, updateProfile } = useAppColorScheme();
  const [draftProfile, setDraftProfile] = useState(profile);
  const [isEditing, setIsEditing] = useState(false);
  const [isDatePickerOpen, setIsDatePickerOpen] = useState(false);
  const [isGenderPickerOpen, setIsGenderPickerOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [draftBirthDate, setDraftBirthDate] = useState(() => parseDateOfBirth(profile.dateOfBirth));
  const completedHabits = habits.filter((habit) => habit.done).length;
  const progress = habits.length
    ? Math.round(habits.reduce((total, habit) => total + habit.progress, 0) / habits.length)
    : 0;
  const timeManagementSummary = habits.length
    ? `${completedHabits}/${habits.length} habits completed today • ${progress}% progress`
    : 'No activity yet';

  const startEditing = () => {
    setDraftProfile(profile);
    setDraftBirthDate(parseDateOfBirth(profile.dateOfBirth));
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftProfile(profile);
    setDraftBirthDate(parseDateOfBirth(profile.dateOfBirth));
    setIsDatePickerOpen(false);
    setIsGenderPickerOpen(false);
    setIsEditing(false);
  };

  const chooseGender = (gender: string) => {
    setDraftProfile((current) => ({ ...current, gender }));
    setIsGenderPickerOpen(false);
  };

  const handleBirthDateValueChange = (_event: DateTimePickerChangeEvent, selectedDate: Date) => {
    if (Platform.OS === 'android') setIsDatePickerOpen(false);
    setDraftBirthDate(selectedDate);
    setDraftProfile((current) => ({ ...current, dateOfBirth: formatDateOfBirth(selectedDate) }));
  };

  const handleBirthDateDismiss = () => setIsDatePickerOpen(false);

  const saveProfile = async () => {
    if (isSaving) return;
    if (!draftProfile.fullName.trim() || !draftProfile.email.trim() || !draftProfile.username.trim()) {
      showAlert('Incomplete information', 'Please complete your name, email, and username.');
      return;
    }
    const nextProfile = {
      ...draftProfile,
      fullName: draftProfile.fullName.trim(),
      email: draftProfile.email.trim(),
      username: draftProfile.username.trim(),
      dateOfBirth: formatDateOfBirth(draftBirthDate),
      about: draftProfile.about.trim(),
    };
    setIsSaving(true);
    const result = await updateAuthenticatedProfile(nextProfile);
    setIsSaving(false);
    if (!result.ok || !result.user) {
      showAlert('Profile update failed', result.message || 'Unable to update your profile.');
      return;
    }
    updateProfile(result.user as Profile);
    setIsDatePickerOpen(false);
    setIsEditing(false);
    showAlert('Profile updated', 'Your personal information has been saved.', undefined, 'success');
  };

  const openAvatarActions = () => {
    showAlert('Profile Picture', 'Choose a profile picture.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Choose from Gallery', onPress: async () => {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) { showAlert('Permission needed', 'Allow photo library access to choose a profile picture.'); return; }
        const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
        if (!result.canceled) setAvatarImage(result.assets[0].uri);
      } },
      { text: 'Take a Photo', onPress: async () => {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) { showAlert('Permission needed', 'Allow camera access to take a profile picture.'); return; }
        const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.85 });
        if (!result.canceled) setAvatarImage(result.assets[0].uri);
      } },
    ]);
  };
  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.container}>
          <View style={styles.headerRow}>
            <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
              <Ionicons name="chevron-back" size={20} color={isDarkMode ? '#F2EFF8' : '#292633'} />
            </Pressable>
            <View style={styles.headerCopy}>
              <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>Personal Information</Text>
              <Text style={[styles.headerSubtitle, isDarkMode && styles.darkSecondaryText]}>Manage your profile details</Text>
            </View>
            <View style={styles.headerSpacer} />
          </View>

          <View style={[styles.profileHero, isDarkMode && styles.darkHero]}>
            <View style={styles.heroAccent} />
            <View style={styles.profileSummary}>
            <Pressable style={styles.avatarPressable} onPress={openAvatarActions} accessibilityLabel="Change profile picture">
              <View style={styles.avatarRing}>
                <View style={styles.avatarCircle}>
                  {avatarImage ? <Image source={{ uri: avatarImage }} style={styles.avatarImage} /> : <Text style={styles.avatarEmoji}>A</Text>}
                </View>
              </View>
              <View style={styles.cameraBadge}>
                <Ionicons name="camera" size={15} color="#FFFFFF" />
              </View>
            </Pressable>
            <Text style={[styles.name, isDarkMode && styles.darkText]}>{profile.fullName}</Text>
            <View style={styles.verifiedPill}>
              <Ionicons name="checkmark-circle" size={17} color="#2879D8" />
              <Text style={styles.verifiedText}>{profile.fullName && profile.email ? 'Profile complete' : 'Complete your profile'}</Text>
            </View>
            </View>
          </View>

          <View style={styles.sectionHeading}>
            <View>
              <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Personal details</Text>
              <Text style={[styles.sectionSubtitle, isDarkMode && styles.darkSecondaryText]}>Your information at a glance</Text>
            </View>
            <Ionicons name="shield-checkmark-outline" size={20} color="#5B42D8" />
          </View>
          <View style={[styles.detailsCard, isDarkMode && styles.darkCard]}>
            {detailFields.map((detail, index) => (
              <View key={detail.label} style={[styles.detailRow, index < detailFields.length - 1 && styles.detailBorder]}>
                <View style={styles.detailIcon}>
                  <Ionicons name={detail.icon as keyof typeof Ionicons.glyphMap} size={22} color="#5B42D8" />
                </View>
                <View style={styles.detailCopy}>
                  <Text style={styles.detailLabel}>{detail.label}</Text>
                  <Text style={[styles.detailValue, isDarkMode && styles.darkText]}>{profile[detail.key]}</Text>
                </View>
              </View>
            ))}
            <View style={styles.detailRow}>
              <View style={styles.detailIcon}>
                <Ionicons name="time-outline" size={22} color="#5B42D8" />
              </View>
              <View style={styles.detailCopy}>
                <Text style={styles.detailLabel}>Time Management</Text>
                <Text style={[styles.detailValue, isDarkMode && styles.darkText]}>{timeManagementSummary}</Text>
              </View>
            </View>
          </View>

          <View style={[styles.aboutCard, isDarkMode && styles.darkCard]}>
            <View style={styles.aboutIcon}>
              <Ionicons name="person" size={23} color="#5B42D8" />
            </View>
            <View style={styles.aboutCopy}>
              <Text style={styles.aboutLabel}>About Me</Text>
              <Text style={[styles.aboutText, isDarkMode && styles.darkText]}>{profile.about || 'Add an introduction about yourself'}</Text>
            </View>
          </View>

          <Pressable style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]} onPress={startEditing}>
            <Ionicons name="create-outline" size={16} color="#FFFFFF" />
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </Pressable>
        </View>
      </ScrollView>

      <Modal visible={isEditing} animationType="slide" transparent onRequestClose={cancelEditing}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalCard, isDarkMode && styles.darkModalCard]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>Edit Profile</Text>
              <Pressable onPress={cancelEditing} accessibilityLabel="Close edit profile">
                <Ionicons name="close" size={24} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {detailFields.map((field) => (
                <View key={field.key} style={styles.inputGroup}>
                  <Text style={[styles.inputLabel, isDarkMode && styles.darkSecondaryText]}>{field.label}</Text>
                  {field.key === 'gender' ? (
                    <Pressable style={[styles.input, styles.dateInput, isDarkMode && styles.darkInput]} onPress={() => setIsGenderPickerOpen(true)} accessibilityLabel="Select gender">
                      <Text style={[styles.dateInputText, isDarkMode && styles.darkText]}>{draftProfile.gender}</Text>
                      <Ionicons name="chevron-down" size={19} color={isDarkMode ? '#AAA4B7' : '#827C8C'} />
                    </Pressable>
                  ) : field.key === 'dateOfBirth' ? (
                    <>
                      <Pressable style={[styles.input, styles.dateInput, isDarkMode && styles.darkInput]} onPress={() => setIsDatePickerOpen(true)} accessibilityLabel="Select date of birth">
                        <Text style={[styles.dateInputText, isDarkMode && styles.darkText]}>{draftProfile.dateOfBirth}</Text>
                        <Ionicons name="calendar-outline" size={19} color={isDarkMode ? '#AAA4B7' : '#827C8C'} />
                      </Pressable>
                      {isDatePickerOpen && Platform.OS === 'ios' && (
                        <View style={[styles.datePickerContainer, isDarkMode && styles.darkInput]}>
                          <DateTimePicker
                            value={draftBirthDate}
                            mode="date"
                            display="spinner"
                            maximumDate={new Date()}
                            onValueChange={handleBirthDateValueChange}
                            onDismiss={handleBirthDateDismiss}
                            themeVariant={isDarkMode ? 'dark' : 'light'}
                          />
                        </View>
                      )}
                      {isDatePickerOpen && Platform.OS === 'android' && (
                        <DateTimePicker
                          value={draftBirthDate}
                          mode="date"
                          display="calendar"
                          maximumDate={new Date()}
                          onValueChange={handleBirthDateValueChange}
                          onDismiss={handleBirthDateDismiss}
                        />
                      )}
                    </>
                  ) : (
                    <TextInput
                      value={draftProfile[field.key]}
                      onChangeText={(value) => setDraftProfile((current) => ({ ...current, [field.key]: value }))}
                      style={[styles.input, isDarkMode && styles.darkInput]}
                      placeholder={`Enter ${field.label.toLowerCase()}`}
                      placeholderTextColor={isDarkMode ? '#827C8C' : '#A19CAA'}
                      keyboardType={field.key === 'email' ? 'email-address' : 'default'}
                      autoCapitalize={field.key === 'email' || field.key === 'username' ? 'none' : 'words'}
                    />
                  )}
                </View>
              ))}
              <View style={styles.inputGroup}>
                <Text style={[styles.inputLabel, isDarkMode && styles.darkSecondaryText]}>About Me</Text>
                <TextInput
                  value={draftProfile.about}
                  onChangeText={(value) => setDraftProfile((current) => ({ ...current, about: value }))}
                  style={[styles.input, styles.aboutInput, isDarkMode && styles.darkInput]}
                  placeholder="Tell us about yourself"
                  placeholderTextColor={isDarkMode ? '#827C8C' : '#A19CAA'}
                  multiline
                  maxLength={120}
                />
              </View>
              <View style={styles.modalActions}>
                <Pressable style={[styles.cancelButton, isDarkMode && styles.darkCancelButton]} onPress={cancelEditing}>
                  <Text style={[styles.cancelButtonText, isDarkMode && styles.darkText]}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.saveButton} onPress={saveProfile}>
                  <Ionicons name="checkmark" size={17} color="#FFFFFF" />
                  <Text style={styles.editButtonText}>Save Changes</Text>
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={isGenderPickerOpen} animationType="fade" transparent onRequestClose={() => setIsGenderPickerOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={[styles.genderCard, isDarkMode && styles.darkModalCard]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, isDarkMode && styles.darkText]}>Select Gender</Text>
              <Pressable onPress={() => setIsGenderPickerOpen(false)} accessibilityLabel="Close gender picker">
                <Ionicons name="close" size={24} color={isDarkMode ? '#F2EFF8' : '#292633'} />
              </Pressable>
            </View>
            {genderOptions.map((gender) => (
              <Pressable key={gender} style={[styles.genderOption, isDarkMode && styles.darkGenderOption]} onPress={() => chooseGender(gender)}>
                <Text style={[styles.genderOptionText, isDarkMode && styles.darkText]}>{gender}</Text>
                {draftProfile.gender === gender && <Ionicons name="checkmark-circle" size={22} color="#5B42D8" />}
              </Pressable>
            ))}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F4F9', paddingTop: 16 }, darkScreen: { backgroundColor: '#111018' },
  content: { paddingBottom: 110, paddingTop: 4 },
  container: { width: '100%', maxWidth: 680, alignSelf: 'center', paddingHorizontal: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 18 },
  backButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', marginRight: 12, shadowColor: '#30245F', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.08, shadowRadius: 7, elevation: 2 },
  headerCopy: { flex: 1 },
  headerSpacer: { width: 36 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#24212D' },
  headerSubtitle: { fontSize: 11, color: '#888291', fontWeight: '600', marginTop: 2 },
  darkText: { color: '#F2EFF8' },
  darkSecondaryText: { color: '#AAA4B7' },
  profileHero: { position: 'relative', overflow: 'hidden', backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#EEEAF7', paddingVertical: 20, marginBottom: 22, shadowColor: '#30245F', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.07, shadowRadius: 12, elevation: 3 },
  darkHero: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  heroAccent: { position: 'absolute', width: 180, height: 180, borderRadius: 90, backgroundColor: '#F2EEFF', right: -70, top: -100 },
  profileSummary: { alignItems: 'center', position: 'relative' },
  avatarPressable: { position: 'relative', marginBottom: 10 },
  avatarRing: { width: 106, height: 106, borderRadius: 53, backgroundColor: '#BDA5EF', borderWidth: 4, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: '#5B42D8', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 },
  avatarCircle: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#F3DAD5', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 48 },
  avatarImage: { width: '100%', height: '100%', borderRadius: 44 },
  cameraBadge: { position: 'absolute', right: -1, bottom: 0, width: 34, height: 34, borderRadius: 17, backgroundColor: '#5B42D8', borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 22, fontWeight: '800', color: '#24212D', marginBottom: 7 },
  verifiedPill: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderColor: '#B9D2F2', backgroundColor: '#F2F7FF', borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5 },
  verifiedText: { fontSize: 11, fontWeight: '700', color: '#2879D8' },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#292435' },
  sectionSubtitle: { fontSize: 11, color: '#888291', fontWeight: '600', marginTop: 3 },
  detailsCard: { backgroundColor: '#FFFFFF', borderRadius: 18, paddingHorizontal: 14, marginBottom: 14, shadowColor: '#30245F', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.06, shadowRadius: 10, elevation: 2 }, darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935' },
  detailRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center' },
  detailBorder: { borderBottomWidth: 1, borderBottomColor: '#F0EEF3' },
  detailIcon: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F2EEFF', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  detailCopy: { flex: 1 },
  detailLabel: { fontSize: 11, color: '#888291', fontWeight: '600', marginBottom: 3 },
  detailValue: { fontSize: 14, color: '#302B3B', fontWeight: '800' },
  aboutCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 18, padding: 14, marginBottom: 16, borderWidth: 1, borderColor: '#EEEAF7' },
  aboutIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#F0EAFF', alignItems: 'center', justifyContent: 'center', marginRight: 11 },
  aboutCopy: { flex: 1 },
  aboutLabel: { fontSize: 13, color: '#5B42D8', fontWeight: '700', marginBottom: 5 },
  aboutText: { fontSize: 12, color: '#3D3848', fontWeight: '600' },
  editButton: { height: 50, borderRadius: 14, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, shadowColor: '#5B42D8', shadowOffset: { width: 0, height: 5 }, shadowOpacity: 0.22, shadowRadius: 9, elevation: 4 },
  editButtonPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  editButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  modalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(20, 16, 32, 0.5)' },
  modalCard: { maxHeight: '92%', backgroundColor: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20 },
  darkModalCard: { backgroundColor: '#1D1A24' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#24212D' },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 12, color: '#827C8C', fontWeight: '700', marginBottom: 6 },
  input: { minHeight: 46, borderWidth: 1, borderColor: '#E2DEEA', borderRadius: 12, paddingHorizontal: 13, color: '#302B3B', fontSize: 14, backgroundColor: '#FBFAFD' },
  dateInput: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateInputText: { color: '#302B3B', fontSize: 14 },
  darkInput: { borderColor: '#3B3647', color: '#F2EFF8', backgroundColor: '#25212E' },
  datePickerContainer: { alignItems: 'center', borderRadius: 12, marginTop: 8, overflow: 'hidden' },
  genderCard: { backgroundColor: '#FFFFFF', borderRadius: 20, marginHorizontal: 24, padding: 20 },
  genderOption: { minHeight: 52, borderBottomWidth: 1, borderBottomColor: '#ECE9F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  darkGenderOption: { borderBottomColor: '#342F3F' },
  genderOptionText: { color: '#302B3B', fontSize: 15, fontWeight: '700' },
  aboutInput: { minHeight: 82, paddingTop: 12, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 10, marginTop: 6, marginBottom: 8 },
  cancelButton: { flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: '#DED9E9', alignItems: 'center', justifyContent: 'center' },
  darkCancelButton: { borderColor: '#4A4357' },
  cancelButtonText: { color: '#4D4758', fontSize: 14, fontWeight: '800' },
  saveButton: { flex: 1.4, height: 48, borderRadius: 12, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
});

