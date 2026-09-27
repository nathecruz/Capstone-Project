export type SupportedLanguage = 'English' | 'Tagalog';

const languageCodes = ['en', 'tl'];
const philippineProvinces = ['Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique', 'Apayao', 'Aurora', 'Basilan', 'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite', 'Cebu', 'Cotabato', 'Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands', 'Eastern Samar', 'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union', 'Laguna', 'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao del Norte', 'Maguindanao del Sur', 'Marinduque', 'Masbate', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province', 'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar', 'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu', 'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay'];

const languageFallbackNames: Record<string, string> = {
  af: 'Afrikaans', am: 'Amharic', ar: 'Arabic', az: 'Azerbaijani', be: 'Belarusian', bg: 'Bulgarian', bn: 'Bengali', bs: 'Bosnian', ca: 'Catalan', cs: 'Czech', cy: 'Welsh', da: 'Danish', de: 'German', el: 'Greek', en: 'English', es: 'Spanish', et: 'Estonian', eu: 'Basque', fa: 'Persian', fi: 'Finnish', fil: 'Filipino', fr: 'French', ga: 'Irish', gl: 'Galician', gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hr: 'Croatian', hu: 'Hungarian', hy: 'Armenian', id: 'Indonesian', is: 'Icelandic', it: 'Italian', ja: 'Japanese', ka: 'Georgian', kk: 'Kazakh', km: 'Khmer', kn: 'Kannada', ko: 'Korean', lo: 'Lao', lt: 'Lithuanian', lv: 'Latvian', mk: 'Macedonian', ml: 'Malayalam', mn: 'Mongolian', mr: 'Marathi', ms: 'Malay', mt: 'Maltese', my: 'Burmese', ne: 'Nepali', nl: 'Dutch', no: 'Norwegian', pa: 'Punjabi', pl: 'Polish', pt: 'Portuguese', ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sl: 'Slovenian', so: 'Somali', sq: 'Albanian', sr: 'Serbian', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil', te: 'Telugu', th: 'Thai', tl: 'Tagalog', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', uz: 'Uzbek', vi: 'Vietnamese', zh: 'Chinese', zu: 'Zulu',
};

function getDisplayNames(type: 'language' | 'region') {
  try {
    if (typeof Intl === 'undefined' || typeof Intl.DisplayNames !== 'function') return null;
    return new Intl.DisplayNames(['en'], { type });
  } catch {
    return null;
  }
}

const displayLanguage = getDisplayNames('language');

export const supportedLanguages = languageCodes.map((code) => displayLanguage?.of(code) ?? languageFallbackNames[code] ?? code).sort();
export const supportedRegions = ['Metro Manila', ...philippineProvinces].sort();

export type TranslationKey =
  | 'home'
  | 'habits'
  | 'add'
  | 'insights'
  | 'profile'
  | 'settingsPreferences'
  | 'preferences'
  | 'setHowAppWorks'
  | 'notifications'
  | 'receiveUpdates'
  | 'completedHabits'
  | 'keepFinishedHabits'
  | 'shown'
  | 'hidden'
  | 'darkMode'
  | 'switchTheme'
  | 'weekStartsOn'
  | 'chooseFirstDay'
  | 'languageRegion'
  | 'personalizeExperience'
  | 'language'
  | 'region'
  | 'active'
  | 'privacyData'
  | 'controlData'
  | 'deleteAccount'
  | 'deleteAccountDescription'
  | 'loginActivity'
  | 'loginActivityDescription'
  | 'privacyPolicy'
  | 'privacyPolicyDescription'
  | 'termsConditions'
  | 'termsConditionsDescription'
  | 'aboutData'
  | 'aboutDataDescription'
  | 'account'
  | 'manageAccount'
  | 'changePassword'
  | 'updatePassword'
  | 'logOut'
  | 'signOut'
  | 'profileSettings'
  | 'personalInformation'
  | 'statsProgress'
  | 'leaderboards'
  | 'activityHistory'
  | 'achievementsBadges'
  | 'goals'
  | 'helpSupport'
  | 'currentProgress'
  | 'keepMomentum'
  | 'dayStreak'
  | 'totalPoints'
  | 'viewLeaderboards'
  | 'tokens'
  | 'goToAiCoach'
  | 'aiCoach'
  | 'askCoach';

const translations: Record<SupportedLanguage, Record<TranslationKey, string>> = {
  English: {
    home: 'Home', habits: 'Habits', add: 'Add', insights: 'Insights', profile: 'Profile', settingsPreferences: 'Settings & Preferences',
    preferences: 'PREFERENCES', setHowAppWorks: 'Set how your app works for you.', notifications: 'Notifications', receiveUpdates: 'Receive updates, reminders and more.', completedHabits: 'Keep the Wins', keepFinishedHabits: 'Keep completed habits visible so your progress feels rewarding.', shown: 'Shown', hidden: 'Hidden', darkMode: 'Dark Mode', switchTheme: 'Switch between light and dark theme.', weekStartsOn: 'Set Your Weekly Rhythm', chooseFirstDay: 'Choose the day that begins your personal progress rhythm.', languageRegion: 'Language & Region', personalizeExperience: 'Personalize your local experience.', language: 'Language', region: 'Region', active: 'Active', privacyData: 'PRIVACY & DATA', controlData: 'Control your data and account security.', deleteAccount: 'Delete Account', deleteAccountDescription: 'Permanently remove your account and associated data.', loginActivity: 'Login Activity', loginActivityDescription: 'Review the account currently signed in on this device.', privacyPolicy: 'Privacy Policy', privacyPolicyDescription: 'Read how HabitAI handles your information.', termsConditions: 'Terms & Conditions', termsConditionsDescription: 'Review the rules for using HabitAI.', aboutData: 'About Data', aboutDataDescription: 'Learn what data is stored and why.', account: 'ACCOUNT', manageAccount: 'Manage your account and profile.', changePassword: 'Change Password', updatePassword: 'Update your account password.', logOut: 'Log Out', signOut: 'Sign out from your account.', profileSettings: 'Profile settings', personalInformation: 'Personal Information', statsProgress: 'Stats & Progress', leaderboards: 'Leaderboards', activityHistory: 'Activity History', achievementsBadges: 'Achievements & Badges', goals: 'Goals', helpSupport: 'Help & Support', currentProgress: 'Current Progress', keepMomentum: 'Keep your momentum going!', dayStreak: 'Day Streak', totalPoints: 'Total Points', viewLeaderboards: 'View Leaderboards', tokens: 'Tokens', goToAiCoach: 'Go to AI Coach', aiCoach: 'AI Coach', askCoach: 'Ask Coach',
  },
  Tagalog: {
    home: 'Tahanan', habits: 'Mga Gawi', add: 'Idagdag', insights: 'Mga Kaalaman', profile: 'Profile', settingsPreferences: 'Mga Setting at Kagustuhan',
    preferences: 'MGA KAGUSTUHAN', setHowAppWorks: 'Ayusin kung paano gagana ang app para sa iyo.', notifications: 'Mga Abiso', receiveUpdates: 'Tumanggap ng mga update at paalala.', completedHabits: 'Itago ang Mga Panalo', keepFinishedHabits: 'Panatilihing nakikita ang natapos na gawi para mas dama ang progress.', shown: 'Ipinapakita', hidden: 'Nakatago', darkMode: 'Dark Mode', switchTheme: 'Lumipat sa maliwanag o madilim na tema.', weekStartsOn: 'Itakda ang Weekly Rhythm', chooseFirstDay: 'Piliin ang araw na magsisimula ng iyong personal na rhythm.', languageRegion: 'Wika at Rehiyon', personalizeExperience: 'Iangkop ang iyong lokal na karanasan.', language: 'Wika', region: 'Rehiyon', active: 'Aktibo', privacyData: 'PRIBASIYA AT DATA', controlData: 'Pamahalaan ang data at seguridad ng account.', deleteAccount: 'Burahin ang Account', deleteAccountDescription: 'Permanenteng burahin ang account at kaugnay na data.', loginActivity: 'Aktibidad ng Pag-login', loginActivityDescription: 'Tingnan ang account na kasalukuyang naka-sign in sa device na ito.', privacyPolicy: 'Privacy Policy', privacyPolicyDescription: 'Basahin kung paano pinangangasiwaan ng HabitAI ang iyong impormasyon.', termsConditions: 'Terms at Conditions', termsConditionsDescription: 'Suriin ang mga tuntunin sa paggamit ng HabitAI.', aboutData: 'Tungkol sa Data', aboutDataDescription: 'Alamin kung anong data ang iniimbak at bakit.', account: 'ACCOUNT', manageAccount: 'Pamahalaan ang account at profile.', changePassword: 'Palitan ang Password', updatePassword: 'I-update ang password ng account.', logOut: 'Mag-Log Out', signOut: 'Mag-sign out sa account.', profileSettings: 'Mga setting ng profile', personalInformation: 'Personal na Impormasyon', statsProgress: 'Stats at Progress', leaderboards: 'Leaderboard', activityHistory: 'Kasaysayan ng Aktibidad', achievementsBadges: 'Mga Achievement at Badge', goals: 'Mga Layunin', helpSupport: 'Tulong at Suporta', currentProgress: 'Kasalukuyang Progress', keepMomentum: 'Ipagpatuloy ang iyong momentum!', dayStreak: 'Streak ng Araw', totalPoints: 'Kabuuang Points', viewLeaderboards: 'Tingnan ang Leaderboard', tokens: 'Mga Token', goToAiCoach: 'Pumunta sa AI Coach', aiCoach: 'AI Coach', askCoach: 'Magtanong sa Coach',
  },
};

export function translate(language: string, key: TranslationKey) {
  const selectedLanguage: SupportedLanguage = Object.prototype.hasOwnProperty.call(translations, language)
    ? language as SupportedLanguage
    : 'English';
  const selectedTranslations = translations[selectedLanguage] ?? translations.English;
  return selectedTranslations[key] ?? translations.English[key] ?? key;
}
