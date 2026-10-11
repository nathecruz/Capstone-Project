import React from 'react';
import { FlexWidget, TextWidget } from 'react-native-android-widget';
import { EMPTY_WIDGET_DATA, type WidgetData } from './widget-data';

/** The Android home-screen widget: today's habit progress and best streak. Tapping it opens the app. */
export function HabitWidget({ data = EMPTY_WIDGET_DATA }: { data?: WidgetData }) {
  const { doneToday, totalToday, bestStreak, dateLabel } = data;
  const allDone = totalToday > 0 && doneToday >= totalToday;
  const headline = totalToday === 0 ? 'No habits today' : `${doneToday} / ${totalToday} done`;
  const subtitle = totalToday === 0 ? 'Add a habit to get started' : allDone ? 'All done — nice work!' : 'Tap to check in your habits';

  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: 14,
        backgroundColor: '#1D1A24',
        borderRadius: 20,
      }}
    >
      <FlexWidget style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', width: 'match_parent' }}>
        <TextWidget text="HabitAI" style={{ fontSize: 13, fontFamily: 'sans-serif-medium', color: '#B9A9FF' }} />
        <TextWidget text={dateLabel} style={{ fontSize: 11, color: '#8B83A6' }} />
      </FlexWidget>
      <TextWidget text={headline} style={{ fontSize: 24, fontFamily: 'sans-serif-medium', color: allDone ? '#57B991' : '#F5F2FA', marginTop: 6 }} />
      <TextWidget text={subtitle} style={{ fontSize: 11, color: '#AAA4B7', marginTop: 2 }} />
      <TextWidget text={`\u{1F525} ${bestStreak}-day streak`} style={{ fontSize: 12, color: '#E07B1F', marginTop: 8 }} />
    </FlexWidget>
  );
}
