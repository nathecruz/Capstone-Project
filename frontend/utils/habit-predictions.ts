import type { Habit } from '@/hooks/color-scheme-context';

type HabitFeatures = { progress: number; streak: number; done: number; reminder: number };

function features(habit: Habit): HabitFeatures {
  return {
    progress: habit.progress / 100,
    streak: Math.min(habit.streak, 14) / 14,
    done: habit.done ? 1 : 0,
    reminder: habit.reminderEnabled ? 1 : 0,
  };
}

function logisticRegression(value: number) {
  return 1 / (1 + Math.exp(-8 * (value - 0.5)));
}

function naiveBayes(featuresList: HabitFeatures[]) {
  if (!featuresList.length) return 0.5;
  const success = featuresList.filter((item) => item.done || item.progress >= 0.7).length;
  return (success + 1) / (featuresList.length + 2);
}

function randomForestVote(featuresList: HabitFeatures[]) {
  if (!featuresList.length) return 0.5;
  const votes = featuresList.map((item) => [
    item.progress >= 0.5,
    item.streak >= 0.35 && item.reminder === 1,
    item.done === 1 || item.progress >= 0.8,
  ].filter(Boolean).length >= 2 ? 1 : 0);
  return votes.reduce<number>((sum, vote) => sum + vote, 0) / featuresList.length;
}

export function predictHabitOutcomes(habits: Habit[]) {
  const featuresList = habits.map(features);
  const averageSignal = featuresList.length
    ? featuresList.reduce((sum, item) => sum + (item.progress * 0.55 + item.streak * 0.25 + item.done * 0.15 + item.reminder * 0.05), 0) / featuresList.length
    : 0.5;
  const logistic = logisticRegression(averageSignal);
  const bayes = naiveBayes(featuresList);
  const forest = randomForestVote(featuresList);
  const confidence = Math.round(((logistic + bayes + forest) / 3) * 100);

  return {
    confidence,
    logistic,
    bayes,
    forest,
    forecast: confidence >= 70 ? 'Likely to improve next week' : confidence >= 45 ? 'Stable with room to improve' : 'Start with smaller repeatable actions',
  };
}
