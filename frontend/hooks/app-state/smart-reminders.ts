// Smart reminders: pick a reminder time and message from recent check-ins and the ML risk estimate.
import { getApiBaseUrl, getAuthenticatedHeaders } from '@/authentication/authService';
import { getLocalDateKey } from './habit-progress';
import { parseReminderTime } from './reminders';
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

export function computeSmartReminderTime(habit: Habit, now = new Date(), modelRisk?: { dropoutRisk: number; completionProbability: number }) {
  const fallbackTime = parseReminderTime(habit.reminderTime) ?? { hour: 9, minute: 0 };
  const recentSignals = getRecentHabitSignals(habit, now);
  const riskLevel = modelRisk
    ? getRiskLevel(modelRisk.dropoutRisk, modelRisk.completionProbability)
    : habit.progress < 35 || habit.streak <= 1 || recentSignals.completion_rate < 0.4
      ? 'high'
      : habit.progress < 70 || recentSignals.completion_rate < 0.7
        ? 'medium'
        : 'low';

  const target = new Date(now);
  const minuteOffset = riskLevel === 'high' ? -30 : riskLevel === 'medium' ? 15 : 45;
  const baseMinutes = fallbackTime.hour * 60 + fallbackTime.minute + minuteOffset;

  target.setHours(Math.floor(baseMinutes / 60), baseMinutes % 60, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }

  return { target, riskLevel };
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
