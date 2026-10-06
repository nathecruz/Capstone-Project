// Smart reminders: the habit's own reminder times with a message from recent check-ins and the ML
// risk estimate, plus a nudge 30 minutes earlier when the habit is at risk (as on the server,
// backend/services/smart-reminders.js). Smart Reminder never moves the time the student set.
import { getApiBaseUrl, getAuthenticatedHeaders } from '@/authentication/authService';
import { computeStreak, isHabitScheduledOn } from '@/utils/streaks';
import { getLocalDateKey } from './habit-progress';
import { getHabitReminderTimes } from './reminders';
import type { Habit } from './types';

export function getSmartReminderMessage(habit: Habit, riskLevel: 'low' | 'medium' | 'high') {
  const riskMessages = {
    low: `You have a good rhythm with ${habit.label}. Keep the momentum going with one small win today.`,
    medium: `A quick ${habit.label} check-in now could help you stay on track before the day gets busy.`,
    high: `${habit.label} is at risk of being skipped today. A short action now will protect your streak.`,
  };
  return riskMessages[riskLevel];
}

export type HabitPrediction = {
  dropout_risk?: number;
  completion_probability?: number;
  recommended_action?: string;
};

function getRecentHabitSignals(habit: Habit, now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const last7Days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - (6 - index));
    return habit.completionDates.includes(getLocalDateKey(date)) ? 1 : 0;
  });

  return {
    last_7_days: last7Days,
    completion_rate: last7Days.reduce<number>((sum, value) => sum + value, 0) / last7Days.length,
    missed_days: last7Days.filter((value) => value === 0).length,
  };
}

function getRiskLevel(dropoutRisk: number, completionProbability: number): 'low' | 'medium' | 'high' {
  const risk = Number.isFinite(dropoutRisk) ? dropoutRisk : 1 - completionProbability;
  return risk >= 0.65 ? 'high' : risk >= 0.35 ? 'medium' : 'low';
}

/**
 * Risk without the ML model, with the same rule as the server's Web Push smart reminders
 * (backend/services/smart-reminders.js): the 7 scheduled days before today and the streak up to
 * yesterday. (Today's progress was used before; it is 0 until the habit is done, so every habit
 * looked at risk.)
 */
export function heuristicRisk(habit: Habit, now = new Date()): 'low' | 'medium' | 'high' {
  const dayKey = (back: number) => getLocalDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - back));
  let scheduled = 0;
  let completed = 0;
  for (let back = 1; back <= 7; back += 1) {
    const day = dayKey(back);
    if ((habit.startDate && day < habit.startDate) || !isHabitScheduledOn(habit, day)) continue;
    scheduled += 1;
    if (habit.completionDates.includes(day)) completed += 1;
  }
  const rate = scheduled ? completed / scheduled : 0;
  const streak = computeStreak(habit, habit.completionDates, dayKey(1));
  return rate < 0.4 || streak <= 1 ? 'high' : rate < 0.7 ? 'medium' : 'low';
}

export type SmartReminderTime = { hour: number; minute: number; early?: boolean };

/**
 * Today's smart reminder times: every set time (9:00 AM without one) and, when the habit is at
 * risk, a nudge 30 minutes before the earliest one (not before midnight), with the risk level.
 */
export function computeSmartReminderTimes(habit: Habit, now = new Date(), modelRisk?: { dropoutRisk: number; completionProbability: number }) {
  const set = getHabitReminderTimes(habit).sort((a, b) => a.hour * 60 + a.minute - (b.hour * 60 + b.minute));
  const base = set.length ? set : [{ hour: 9, minute: 0 }];
  const riskLevel = modelRisk
    ? getRiskLevel(modelRisk.dropoutRisk, modelRisk.completionProbability)
    : heuristicRisk(habit, now);
  const times: SmartReminderTime[] = base.map((time) => ({ hour: time.hour, minute: time.minute }));
  if (riskLevel === 'high') {
    const early = Math.max(0, base[0].hour * 60 + base[0].minute - 30);
    if (!times.some((time) => time.hour * 60 + time.minute === early)) times.unshift({ hour: Math.floor(early / 60), minute: early % 60, early: true });
  }
  return { times, riskLevel };
}

export async function requestHabitPrediction(habit: Habit): Promise<HabitPrediction | null> {
  const signals = getRecentHabitSignals(habit);
  const normalizedCategory = habit.category.toLowerCase();
  const goalType = normalizedCategory.includes('health')
    ? 'health'
    : normalizedCategory.includes('mind')
      ? 'mindfulness'
      : normalizedCategory.includes('productivity')
        ? 'productivity'
        : 'balanced';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);

  try {
    const headers = await getAuthenticatedHeaders();
    const response = await fetch(`${getApiBaseUrl()}/api/habit/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        habit_name: habit.label,
        streak: habit.streak,
        completion_rate: signals.completion_rate,
        missed_days: signals.missed_days,
        last_7_days: signals.last_7_days,
        priority: 'balanced',
        goal_type: goalType,
      }),
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const prediction = await response.json() as HabitPrediction;
    if (typeof prediction.dropout_risk !== 'number' && typeof prediction.completion_probability !== 'number') return null;
    const completionProbability = typeof prediction.completion_probability === 'number'
      ? Math.max(0, Math.min(1, prediction.completion_probability))
      : 1 - Math.max(0, Math.min(1, prediction.dropout_risk ?? 1));
    const dropoutRisk = typeof prediction.dropout_risk === 'number'
      ? Math.max(0, Math.min(1, prediction.dropout_risk))
      : 1 - completionProbability;
    return { ...prediction, dropout_risk: dropoutRisk, completion_probability: completionProbability };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
