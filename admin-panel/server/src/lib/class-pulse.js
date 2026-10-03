// Class Pulse: how the students are doing as a group, for faculty. Only aggregates leave this
// module: no names, ids or per-student rows, and categories with fewer students than the
// anonymity threshold are folded together.
import { z } from 'zod';
import { addDays, dateRange, habitCreatedAt, todayInZone } from './metrics.js';
import { computeStreak, habitSchedule, isScheduledDay } from './streaks.js';

export const WINDOW_DAYS = 28;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const weekdayIndex = (dateKey) => (new Date(`${dateKey}T00:00:00Z`).getUTCDay() + 6) % 7;
const rate = (done, scheduled) => (scheduled ? done / scheduled : null);

function hourInZone(timestamp, timeZone) {
  return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(timestamp)));
}

function hourLabel(hour) {
  return `${hour % 12 || 12} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** Risk from the last 7 days when the ML service is not available. */
export function ruleRisk(student) {
  if (!student.habits) return 'notStarted';
  if (!student.scheduled7) return 'new';
  const recent = student.completed7 / student.scheduled7;
  if (recent < 0.3) return 'high';
  if (recent < 0.6) return 'medium';
  return 'low';
}

/** Bucket for an ML dropout risk (0..1). */
export function mlRisk(dropoutRisk) {
  if (dropoutRisk >= 0.6) return 'high';
  if (dropoutRisk >= 0.35) return 'medium';
  return 'low';
}

/** The ML service's input for one student (see ml-service/app/schemas.py HabitSignal). */
export function studentSignal(student) {
  return {
    habit_name: 'All habits',
    streak: student.streak,
    completion_rate: Math.round((student.scheduled ? student.completed / student.scheduled : 0) * 1000) / 1000,
    missed_days: student.scheduled - student.completed,
    last_7_days: student.last7Days,
    priority: 'balanced',
    goal_type: 'general',
  };
}

/**
 * @param {object} input
 * @param {{id:string}[]} input.students          active students
 * @param {{id:string,userId:string,category:string,meta:string,frequency:string,start_date:string,reminder_days:string[]}[]} input.habits
 * @param {{userId:string,habitId:string,date:string,completedAt:number}[]} input.completions  last WINDOW_DAYS days
 */
export function buildClassPulse({ students, habits, completions, timeZone, k, now = new Date() }) {
  const today = todayInZone(timeZone, now);
  const start = addDays(today, -(WINDOW_DAYS - 1));
  const days = dateRange(start, today);
  const last7 = new Set(days.slice(-7));
  // The trend shows whole days only: today is still in progress.
  const last14 = days.slice(-15, -1);
  const doneByHabit = new Map();
  for (const row of completions) {
    if (!doneByHabit.has(row.habitId)) doneByHabit.set(row.habitId, new Set());
    doneByHabit.get(row.habitId).add(row.date);
  }

  const perStudent = new Map(students.map((student) => [student.id, { habits: 0, scheduled: 0, completed: 0, scheduled7: 0, completed7: 0, streak: 0, last7Days: [0, 0, 0, 0, 0, 0, 0] }]));
  const byDay = new Map(days.map((day) => [day, { scheduled: 0, completed: 0 }]));
  const byWeekday = WEEKDAYS.map(() => ({ scheduled: 0, completed: 0 }));
  const byCategory = new Map();

  for (const habit of habits) {
    const student = perStudent.get(habit.userId);
    if (!student) continue;
    student.habits += 1;
    const schedule = habitSchedule(habit);
    const done = doneByHabit.get(habit.id) ?? new Set();
    const created = habitCreatedAt(habit.id);
    const firstDay = [habit.start_date, created ? todayInZone(timeZone, new Date(created)) : null].filter(Boolean).sort().at(-1) ?? start;
    const categoryName = String(habit.category || '').trim() || 'Other';
    if (!byCategory.has(categoryName)) byCategory.set(categoryName, { students: new Set(), scheduled: 0, completed: 0 });
    const category = byCategory.get(categoryName);
    category.students.add(habit.userId);
    student.streak = Math.max(student.streak, computeStreak(habit, [...done], today));

    for (const day of days) {
      if (day < firstDay || !isScheduledDay(schedule, day)) continue;
      const isDone = done.has(day);
      // Today is still open: it only counts once it is done.
      if (day === today && !isDone) continue;
      student.scheduled += 1;
      byDay.get(day).scheduled += 1;
      byWeekday[weekdayIndex(day)].scheduled += 1;
      category.scheduled += 1;
      if (last7.has(day)) student.scheduled7 += 1;
      if (!isDone) continue;
      student.completed += 1;
      byDay.get(day).completed += 1;
      byWeekday[weekdayIndex(day)].completed += 1;
      category.completed += 1;
      if (last7.has(day)) student.completed7 += 1;
    }
  }

  const hours = Array(24).fill(0);
  const activeThisWeek = new Set();
  const checkedInToday = new Set();
  let checkInsToday = 0;
  for (const row of completions) {
    const student = perStudent.get(row.userId);
    if (!student) continue;
    if (last7.has(row.date)) {
      activeThisWeek.add(row.userId);
      student.last7Days[days.slice(-7).indexOf(row.date)] = 1;
    }
    if (row.date === today) {
      checkInsToday += 1;
      checkedInToday.add(row.userId);
    }
    if (Number.isFinite(Number(row.completedAt))) hours[hourInZone(Number(row.completedAt), timeZone)] += 1;
  }

  // The busiest three-hour window of the day, from check-in times.
  let peak = null;
  for (let hour = 0; hour < 24; hour += 1) {
    const count = hours[hour] + hours[(hour + 1) % 24] + hours[(hour + 2) % 24];
    if (count && (!peak || count > peak.count)) peak = { start: hour, count };
  }
  const totalHours = hours.reduce((sum, count) => sum + count, 0);

  const studentList = [...perStudent.values()];
  const totals = studentList.reduce((sum, student) => ({ scheduled: sum.scheduled + student.scheduled, completed: sum.completed + student.completed }), { scheduled: 0, completed: 0 });
  const categoryRows = [...byCategory.entries()].map(([name, row]) => ({ category: name, students: row.students.size, scheduled: row.scheduled, completed: row.completed }));
  const visibleCategories = categoryRows.filter((row) => row.students >= k);
  const hidden = categoryRows.filter((row) => row.students < k);
  if (hidden.length) {
    visibleCategories.push({
      category: 'Other (small groups)',
      students: new Set(hidden.flatMap((row) => [...byCategory.get(row.category).students])).size,
      scheduled: hidden.reduce((sum, row) => sum + row.scheduled, 0),
      completed: hidden.reduce((sum, row) => sum + row.completed, 0),
    });
  }

  return {
    today,
    windowDays: WINDOW_DAYS,
    kpis: {
      students: students.length,
      studentsWithHabits: studentList.filter((student) => student.habits > 0).length,
      activeThisWeek: activeThisWeek.size,
      checkInsToday,
      studentsCheckedInToday: checkedInToday.size,
      consistency: rate(totals.completed, totals.scheduled),
      habits: habits.filter((habit) => perStudent.has(habit.userId)).length,
    },
    trend: last14.map((day) => ({ day, rate: rate(byDay.get(day).completed, byDay.get(day).scheduled), completed: byDay.get(day).completed, scheduled: byDay.get(day).scheduled })),
    weekdays: WEEKDAYS.map((label, index) => ({ weekday: label, rate: rate(byWeekday[index].completed, byWeekday[index].scheduled), scheduled: byWeekday[index].scheduled })),
    categories: visibleCategories
      .filter((row) => row.scheduled > 0)
      .map((row) => ({ ...row, rate: rate(row.completed, row.scheduled) }))
      .sort((a, b) => a.rate - b.rate),
    peakHours: peak && totalHours >= 3 ? { from: hourLabel(peak.start), to: hourLabel((peak.start + 3) % 24), share: peak.count / totalHours } : null,
    // Per-student facts for the risk step only; never sent to the browser.
    studentFacts: studentList,
  };
}

/** Counts per risk bucket: ML dropout risk where available, the last-7-days rule otherwise. */
export function riskSummary(studentFacts, mlRisks = new Map()) {
  const counts = { high: 0, medium: 0, low: 0, new: 0, notStarted: 0 };
  let fromModel = 0;
  studentFacts.forEach((student, index) => {
    const ml = mlRisks.get(index);
    if (ml !== undefined && student.habits && student.scheduled7) {
      counts[mlRisk(ml)] += 1;
      fromModel += 1;
    } else {
      counts[ruleRisk(student)] += 1;
    }
  });
  return { ...counts, fromModel };
}

export const CLASS_SUMMARY_SYSTEM = `You are the HabitAI class analyst for PSAU faculty. You get read-only, anonymized numbers about how a group of students is doing with their habits (no names, no individual data).
Write a short summary of the class's habit consistency and three practical suggestions a faculty adviser can act on this week (for example a reminder, a class activity, or a check-in with the group).
Rules:
- Use only the numbers given; never invent figures or claim to know individual students.
- Be specific and supportive; suggestions are for the group, not for identifying students.
- Plain text inside the JSON strings: no markdown or emojis.
- No medical or psychological diagnosis; if many students are at risk, suggest a supportive group check-in and the guidance office.`;

export const classSummaryJsonSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'Two or three sentences on how the class is doing.' },
    suggestions: { type: 'array', items: { type: 'string', description: 'One concrete action for faculty, at most 160 characters.' }, minItems: 3, maxItems: 3 },
  },
  required: ['summary', 'suggestions'],
};

const text = (max) => z.string().trim().min(1).transform((value) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value));
export const classSummarySchema = z.object({
  summary: text(600),
  suggestions: z.array(text(200)).min(3).transform((items) => items.slice(0, 3)),
});

export function classSummaryPrompt(pulse, risk) {
  const percent = (value) => (value === null || value === undefined ? 'no data' : `${Math.round(value * 100)}%`);
  const facts = {
    period: `last ${pulse.windowDays} days, as of ${pulse.today}`,
    students: pulse.kpis.students,
    studentsWithHabits: pulse.kpis.studentsWithHabits,
    activeThisWeek: pulse.kpis.activeThisWeek,
    checkInsToday: pulse.kpis.checkInsToday,
    classConsistency: percent(pulse.kpis.consistency),
    riskCounts: { high: risk.high, medium: risk.medium, low: risk.low, newHabitsOnly: risk.new, noHabitsYet: risk.notStarted },
    riskSource: risk.fromModel ? 'machine-learning dropout risk' : 'missed check-ins in the last 7 days',
    byWeekday: Object.fromEntries(pulse.weekdays.map((row) => [row.weekday, percent(row.rate)])),
    byCategory: Object.fromEntries(pulse.categories.map((row) => [row.category, percent(row.rate)])),
    busiestCheckInTime: pulse.peakHours ? `${pulse.peakHours.from} to ${pulse.peakHours.to}` : 'not enough data',
  };
  return ['CLASS NUMBERS (JSON, read-only):', JSON.stringify(facts), '', 'Write the summary and suggestions for faculty.'].join('\n');
}
