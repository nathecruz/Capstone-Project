// A made reward from the Rewards Shop, opened from My Rewards: an AI study or work plan (with a way
// to turn it into a habit), a weekly report, or a certificate with its public link to open, share
// or delete. A practice quiz opens in its own player (app/practice-quiz.tsx).
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { openBrowserAsync } from 'expo-web-browser';
import React from 'react';
import { Pressable, Share, Text, View } from 'react-native';
import { createThemedStyles, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';
import type { Certificate, RewardItem, StudyPlan, WeeklyReport } from '@/utils/rewards-client';

const dayLabel = (dateKey: string) => new Date(`${dateKey}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function Bullets({ items, icon, color }: { items: string[]; icon: keyof typeof Ionicons.glyphMap; color: string }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.bullet}>
          <Ionicons name={icon} size={15} color={themeColor(color)} />
          <Text style={styles.bulletText}>{item}</Text>
        </View>
      ))}
    </View>
  );
}

function PlanView({ plan }: { plan: StudyPlan }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  // The plan's daily step as a habit for this week: the time it takes each day.
  const habitName = `${plan.task}`.slice(0, 40);
  return (
    <View style={styles.body}>
      {plan.summary ? <Text style={styles.lead}>{plan.summary}</Text> : null}
      <Text style={styles.meta}>Due {dayLabel(plan.dueDate)} · up to {plan.minutesPerDay} minutes a day</Text>
      <View style={styles.list}>
        {plan.days.map((day) => (
          <View key={day.date} style={styles.dayRow}>
            <View style={styles.dayBadge}><Text style={styles.dayBadgeText}>{dayLabel(day.date)}</Text></View>
            <View style={styles.dayCopy}>
              <Text style={styles.dayTask}>{day.task}</Text>
              <Text style={styles.dayMinutes}>{day.minutes ? `${day.minutes} minutes` : 'Light day'}</Text>
            </View>
          </View>
        ))}
      </View>
      {plan.tips.length ? (
        <>
          <Text style={styles.heading}>Tips</Text>
          <Bullets items={plan.tips} icon="bulb-outline" color="#C98A0E" />
        </>
      ) : null}
      <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => router.push({ pathname: '/(tabs)/add', params: { habit: habitName, category: 'Academics' } })} accessibilityRole="button">
        <Ionicons name="add-circle" size={18} color={themeColor('#FFFFFF')} />
        <Text style={styles.primaryText}>Make it a habit this week</Text>
      </Pressable>
    </View>
  );
}

function ReportView({ report }: { report: WeeklyReport }) {
  const styles = useThemedStyles(themedStyles);
  return (
    <View style={styles.body}>
      <Text style={styles.lead}>{report.headline}</Text>
      <Text style={styles.heading}>What went well</Text>
      <Bullets items={report.wins} icon="checkmark-circle-outline" color="#2E8F5E" />
      {report.watchOuts.length ? (
        <>
          <Text style={styles.heading}>What slipped</Text>
          <Bullets items={report.watchOuts} icon="alert-circle-outline" color="#C07A1C" />
        </>
      ) : null}
      <Text style={styles.heading}>Plan for the week ahead</Text>
      <Bullets items={report.plan} icon="arrow-forward-circle-outline" color="#5B42D8" />
      {report.encouragement ? <Text style={styles.encouragement}>{report.encouragement}</Text> : null}
    </View>
  );
}

function CertificateView({ certificate, url }: { certificate: Certificate; url: string }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const stats: [string, string][] = [
    [String(certificate.checkIns), 'check-ins'],
    [String(certificate.activeDays), 'active days'],
    [String(certificate.streak), 'day streak'],
    [`${certificate.health} · ${certificate.academics}`, 'Health · Academics'],
  ];
  return (
    <View style={styles.body}>
      <Text style={styles.lead}>Certificate of Achievement for {certificate.name}, issued {dayLabel(certificate.issuedOn)}.</Text>
      <View style={styles.statGrid}>
        {stats.map(([value, label]) => (
          <View key={label} style={styles.stat}><Text style={styles.statValue}>{value}</Text><Text style={styles.statLabel}>{label}</Text></View>
        ))}
      </View>
      <Text style={styles.meta}>Anyone with its link can open it to check it. Delete it here and the link stops working.</Text>
      <Pressable style={({ pressed }) => [styles.primary, pressed && styles.pressed]} onPress={() => void openBrowserAsync(url)} accessibilityRole="button">
        <Ionicons name="open-outline" size={18} color={themeColor('#FFFFFF')} />
        <Text style={styles.primaryText}>Open certificate</Text>
      </Pressable>
      <Pressable style={({ pressed }) => [styles.secondary, pressed && styles.pressed]} onPress={() => void Share.share({ message: `My HabitAI Certificate of Achievement: ${url}`, url })} accessibilityRole="button">
        <Ionicons name="share-social-outline" size={18} color={themeColor('#5B42D8')} />
        <Text style={styles.secondaryText}>Share link</Text>
      </Pressable>
    </View>
  );
}

/** One made reward (a practice quiz is taken in app/practice-quiz.tsx, so it shows nothing here). */
export function RewardItemView({ item }: { item: RewardItem }) {
  if (item.rewardId === 'study-planner') return <PlanView plan={item.output} />;
  if (item.rewardId === 'practice-quiz') return null;
  if (item.rewardId === 'weekly-report') return <ReportView report={item.output} />;
  return <CertificateView certificate={item.output} url={item.url} />;
}

const themedStyles = createThemedStyles({
  body: { gap: 12 },
  lead: { fontSize: 15, lineHeight: 22, fontWeight: '700', color: '#2D2A3D' },
  meta: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '600', color: '#7A7488' },
  heading: { fontSize: 14, fontWeight: '900', color: '#24212D', marginTop: 4 },
  list: { gap: 8 },
  bullet: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  bulletText: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '600', color: '#3B3650' },
  dayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 14, backgroundColor: '#F7F5FC' },
  dayBadge: { minWidth: 86, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#EEE9FF', alignItems: 'center' },
  dayBadgeText: { fontSize: 11, fontWeight: '800', color: '#5B42D8' },
  dayCopy: { flex: 1, gap: 2 },
  dayTask: { fontSize: 14, lineHeight: 19, fontWeight: '700', color: '#2D2A3D' },
  dayMinutes: { fontSize: 12, fontWeight: '600', color: '#7A7488' },
  primary: { minHeight: 48, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#5B42D8', marginTop: 4 },
  primaryText: { fontSize: 14, fontWeight: '900', color: '#FFFFFF' },
  secondary: { minHeight: 46, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: '#DCD3F5' },
  secondaryText: { fontSize: 14, fontWeight: '800', color: '#5B42D8' },
  pressed: { opacity: 0.8 },
  encouragement: { fontSize: 14, lineHeight: 20, fontWeight: '800', color: '#5B42D8' },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexGrow: 1, minWidth: 120, padding: 12, borderRadius: 14, backgroundColor: '#F4F1FF' },
  statValue: { fontSize: 20, fontWeight: '900', color: '#3A2C8C' },
  statLabel: { fontSize: 12, fontWeight: '700', color: '#5E5872' },
}, {
  dayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 10, borderRadius: 14, backgroundColor: '#25212E' },
  dayBadge: { minWidth: 86, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: '#2A2440', alignItems: 'center' },
  stat: { flexGrow: 1, minWidth: 120, padding: 12, borderRadius: 14, backgroundColor: '#2A2440' },
});
