
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppColorScheme } from '@/hooks/color-scheme-context';

const quickIntervals = [15, 10, 5];
const frequencies = [
  { value: 'Once', title: '1 time', subtitle: 'Once' },
  { value: '2 times', title: '2 times', subtitle: 'Twice' },
  { value: '3 times', title: '3 times', subtitle: 'Three times' },
  { value: '5 times', title: '5 times', subtitle: 'Five times' },
];

export default function SnoozeSettingsScreen() {
  const { isDarkMode, ringInterval, snoozeFrequency, setSnoozeSettings } = useAppColorScheme();
  const [interval, setIntervalValue] = useState(ringInterval);
  const [selectedQuickInterval, setSelectedQuickInterval] = useState<number | null>(quickIntervals.includes(ringInterval) ? ringInterval : null);
  const [frequency, setFrequency] = useState(snoozeFrequency);
  const [trackWidth, setTrackWidth] = useState(0);

  const updateIntervalFromTouch = (locationX: number) => {
    if (!trackWidth) return;
    const ratio = Math.max(0, Math.min(1, locationX / trackWidth));
    setIntervalValue(Math.round(5 + ratio * 25));
    setSelectedQuickInterval(null);
  };

  const save = () => {
    setSnoozeSettings(interval, frequency);
    router.back();
  };

  return (
    <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={[styles.card, isDarkMode && styles.darkCard]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <View style={styles.alarmIcon}><Ionicons name="alarm-outline" size={34} color="#5B42D8" /></View>
            <View style={styles.headerCopy}><Text style={[styles.title, isDarkMode && styles.darkText]}>Snooze Settings</Text><Text style={[styles.subtitle, isDarkMode && styles.darkMutedText]}>Customize how your reminder{`\n`}rings again.</Text></View>
            <Pressable style={styles.closeButton} onPress={() => router.back()} accessibilityLabel="Close Snooze Settings"><Ionicons name="close" size={22} color="#666170" /></Pressable>
          </View>

          <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Quick Options</Text>
          {quickIntervals.map((option) => (
            <Pressable key={option} style={[styles.quickOption, selectedQuickInterval === option && styles.quickOptionSelected, isDarkMode && styles.darkOption]} onPress={() => { setIntervalValue(option); setSelectedQuickInterval(option); }}>
              <Ionicons name={selectedQuickInterval === option ? 'radio-button-on' : 'radio-button-off'} size={22} color="#5B42D8" />
              <View style={styles.optionCopy}><Text style={[styles.optionTitle, isDarkMode && styles.darkText]}>{option} minutes{option === 15 ? '  Recommended' : ''}</Text><Text style={[styles.optionSubtitle, isDarkMode && styles.darkMutedText]}>{option === 15 ? 'Balanced reminder interval' : option === 10 ? 'Shorter interval' : 'Quick reminder'}</Text></View>
              <Ionicons name="alarm-outline" size={25} color="#5B42D8" />
            </Pressable>
          ))}

          <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Custom Interval</Text>
          <View style={styles.intervalRow}><Pressable style={styles.adjustButton} onPress={() => { setIntervalValue((value) => Math.max(5, value - 1)); setSelectedQuickInterval(null); }}><Text style={styles.adjustText}>-</Text></Pressable><Text style={[styles.intervalValue, isDarkMode && styles.darkText]}>{interval} <Text style={styles.intervalUnit}>minutes</Text></Text><Pressable style={styles.adjustButton} onPress={() => { setIntervalValue((value) => Math.min(30, value + 1)); setSelectedQuickInterval(null); }}><Text style={styles.adjustText}>+</Text></Pressable></View>
          <View
            style={styles.rangeTrack}
            onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={(event) => updateIntervalFromTouch(event.nativeEvent.locationX)}
            onResponderMove={(event) => updateIntervalFromTouch(event.nativeEvent.locationX)}
            accessibilityRole="adjustable"
            accessibilityLabel="Custom snooze interval"
            accessibilityValue={{ min: 5, max: 30, now: interval, text: `${interval} minutes` }}
          >
            <View style={[styles.rangeFill, { width: `${((interval - 5) / 25) * 100}%` }]} />
            <View style={[styles.rangeThumb, { left: `${((interval - 5) / 25) * 100}%` }]} />
          </View>
          <View style={styles.rangeLabels}><Text style={styles.rangeText}>5 min</Text><Text style={styles.rangeText}>30 min</Text></View>

          <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>Frequency <Text style={styles.frequencyHint}>(How many times to pop up)</Text></Text>
          <View style={styles.frequencyRow}>{frequencies.map((item) => <Pressable key={item.value} style={[styles.frequencyOption, frequency === item.value && styles.frequencySelected, isDarkMode && styles.darkOption]} onPress={() => setFrequency(item.value)}><Text style={[styles.frequencyTitle, isDarkMode && styles.darkText]}>{item.title}</Text><Text style={[styles.frequencySubtitle, isDarkMode && styles.darkMutedText]}>{item.subtitle}</Text></Pressable>)}</View>

          <Pressable style={styles.saveButton} onPress={save}><Ionicons name="checkmark" size={18} color="#FFFFFF" /><Text style={styles.saveText}>Save Snooze Setting</Text></Pressable>
          <Pressable onPress={() => router.back()}><Text style={styles.cancelText}>Cancel</Text></Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: 'rgba(15, 12, 24, 0.48)' }, darkScreen: { backgroundColor: 'rgba(15, 12, 24, 0.62)' }, content: { flexGrow: 1, justifyContent: 'flex-end', padding: 14 }, card: { maxHeight: '92%', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18 }, darkCard: { backgroundColor: '#1D1A24', borderColor: '#2C2935', borderWidth: 1 }, handle: { alignSelf: 'center', width: 56, height: 5, borderRadius: 3, backgroundColor: '#C6C1CE', marginBottom: 20 }, header: { flexDirection: 'row', alignItems: 'center', marginBottom: 22 }, alarmIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginRight: 12 }, headerCopy: { flex: 1 }, title: { fontSize: 22, fontWeight: '800', color: '#292633' }, subtitle: { fontSize: 12, lineHeight: 18, color: '#777282', marginTop: 4 }, closeButton: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#F3F1F7', alignItems: 'center', justifyContent: 'center' }, sectionTitle: { fontSize: 15, fontWeight: '800', color: '#292633', marginBottom: 10, marginTop: 5 }, quickOption: { minHeight: 70, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#E3DFEA', borderRadius: 12, paddingHorizontal: 13, marginBottom: 10 }, quickOptionSelected: { borderColor: '#5B42D8', backgroundColor: '#FAF8FF' }, darkOption: { borderColor: '#3A3548', backgroundColor: '#24202F' }, optionCopy: { flex: 1, marginLeft: 11 }, optionTitle: { fontSize: 15, fontWeight: '800', color: '#302B3B' }, optionSubtitle: { fontSize: 11, color: '#777282', marginTop: 4 }, intervalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 5 }, adjustButton: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, borderColor: '#E0DCE8', alignItems: 'center', justifyContent: 'center' }, adjustText: { fontSize: 24, color: '#5B42D8', fontWeight: '600' }, intervalValue: { fontSize: 25, color: '#5B42D8', fontWeight: '800' }, intervalUnit: { fontSize: 14, color: '#777282', fontWeight: '600' }, rangeTrack: { height: 4, backgroundColor: '#DAD7E0', marginHorizontal: 8, marginTop: 10, position: 'relative' }, rangeFill: { height: 4, backgroundColor: '#5B42D8' }, rangeThumb: { position: 'absolute', top: -7, width: 18, height: 18, marginLeft: -9, borderRadius: 9, backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: '#5B42D8' }, rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 5, marginTop: 6 }, rangeText: { fontSize: 10, color: '#777282' }, frequencyHint: { fontSize: 10, color: '#8E8999', fontWeight: '600' }, frequencyRow: { flexDirection: 'row', gap: 7, marginBottom: 20 }, frequencyOption: { flex: 1, minHeight: 62, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E3DFEA', borderRadius: 10 }, frequencySelected: { borderColor: '#5B42D8', backgroundColor: '#FAF8FF' }, frequencyTitle: { fontSize: 11, fontWeight: '800', color: '#302B3B' }, frequencySubtitle: { fontSize: 9, color: '#777282', marginTop: 4 }, saveButton: { height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#5425C9', borderRadius: 9 }, saveText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, cancelText: { textAlign: 'center', color: '#5B42D8', fontSize: 13, fontWeight: '800', marginTop: 13 }, darkText: { color: '#F2EFF8' }, darkMutedText: { color: '#AAA4B7' },
});

