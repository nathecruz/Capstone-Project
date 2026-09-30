// Builds the compact, factual snapshot of a student's habits that AI prompts are grounded in.
// It is computed on the server from database records, never taken from the client.

export function dateKeyInZone(date, timeZone = 'Asia/Manila') {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function shiftDay(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function daysBetween(fromKey, toKey) {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86_400_000);
}

export function habitFrequency(meta) {
  const first = String(meta || '').split('•')[0].trim();
  if (first === 'Daily' || first === 'Weekly' || first === 'Monthly') return first;
  if (!first) return 'Daily';
  const days = String(meta).split('•').at(-1).trim();
  return /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/.test(days) ? `Custom (${days})` : `Custom (${first})`;
}

/**
 * @param {object} input
 * @param {{id:string,label:string,category?:string,meta?:string,streak?:number,reminderEnabled?:boolean,reminderTime?:string}[]} input.habits
 * @param {{habitId:string,date:string}[]} input.completions  check-ins (YYYY-MM-DD), any order
 * @param {{title:string,category?:string,progress?:number,status?:string,details?:object}[]} [input.goals]
 * @param {Date} [input.now]
 * @param {string} [input.timeZone]
 */
export function buildHabitContext({ habits = [], completions = [], goals = [], now = new Date(), timeZone = 'Asia/Manila' }) {
  const today = dateKeyInZone(now, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(now);
  const last7 = Array.from({ length: 7 }, (_, index) => shiftDay(today, index - 6));
  const previous7Start = shiftDay(today, -13);

  const datesByHabit = new Map();
  for (const completion of completions) {
    if (!datesByHabit.has(completion.habitId)) datesByHabit.set(completion.habitId, new Set());
    datesByHabit.get(completion.habitId).add(completion.date);
  }

  let checkInsLast7 = 0;
  let checkInsPrevious7 = 0;
  const habitFacts = habits.slice(0, 25).map((habit) => {
    const dates = datesByHabit.get(habit.id) ?? new Set();
    const sorted = [...dates].filter((date) => date <= today).sort();
    const lastCheckIn = sorted.at(-1) ?? null;
    const week = last7.map((day) => (dates.has(day) ? 1 : 0));
    checkInsLast7 += week.reduce((sum, value) => sum + value, 0);
    checkInsPrevious7 += sorted.filter((date) => date >= previous7Start && date < last7[0]).length;
    return {
      name: String(habit.label || 'Habit').slice(0, 60),
      category: habit.category || 'Other',
      frequency: habitFrequency(habit.meta),
      reminder: habit.reminderEnabled ? habit.reminderTime || 'on' : 'off',
      currentStreakDays: Math.max(0, Number(habit.streak) || 0),
      doneToday: dates.has(today),
      last7Days: week,
      checkInsLast14Days: sorted.filter((date) => date >= previous7Start).length,
      lastCheckIn,
      daysSinceLastCheckIn: lastCheckIn ? daysBetween(lastCheckIn, today) : null,
    };
  });

  const daily = habitFacts.filter((habit) => habit.frequency === 'Daily' && !habit.doneToday);
  const needsAttention = daily.sort((a, b) => (b.daysSinceLastCheckIn ?? 99) - (a.daysSinceLastCheckIn ?? 99))[0];

  return {
    today,
    weekday,
    note: 'last7Days lists check-ins from 6 days ago to today (1 = checked in).',
    summary: {
      habitsTracked: habits.length,
      doneToday: habitFacts.filter((habit) => habit.doneToday).length,
      checkInsLast7Days: checkInsLast7,
      checkInsPrevious7Days: checkInsPrevious7,
      bestCurrentStreakDays: Math.max(0, ...habitFacts.map((habit) => habit.currentStreakDays)),
      dailyHabitNeedingAttention: needsAttention?.name ?? null,
    },
    habits: habitFacts,
    goals: goals.slice(0, 5).map((goal) => {
      const steps = Array.isArray(goal.details?.actionPlan) ? goal.details.actionPlan : [];
      const done = Array.isArray(goal.details?.completedSteps) ? goal.details.completedSteps : [];
      const nextIndex = steps.findIndex((_, index) => !done[index]);
      return {
        title: String(goal.title || '').slice(0, 80),
        category: goal.category || '',
        progressPercent: Math.max(0, Math.min(100, Number(goal.progress) || 0)),
        status: goal.status || '',
        nextStep: nextIndex >= 0 ? String(steps[nextIndex]).slice(0, 100) : null,
      };
    }),
  };
}
