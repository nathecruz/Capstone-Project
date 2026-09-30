const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function todayInZone(timeZone, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

export function dateRange(startKey, endKey) {
  const days = [];
  for (let key = startKey; key <= endKey; key = addDays(key, 1)) days.push(key);
  return days;
}

// "Daily • 07:00 AM", "Weekly • Anytime", "Weekdays only • 08:00 PM • Mon, Tue, Wed"
export function habitFrequency(meta) {
  const first = String(meta || '').split('•')[0].trim();
  if (first === 'Daily' || first === 'Weekly' || first === 'Monthly') return first;
  return first ? 'Custom' : 'Daily';
}

export function expectedPerWeek(meta) {
  const parts = String(meta || '').split('•').map((part) => part.trim());
  switch (habitFrequency(meta)) {
    case 'Daily':
      return 7;
    case 'Weekly':
      return 1;
    case 'Monthly':
      return 7 / 30;
    default: {
      const days = parts.length >= 3 ? parts.at(-1).split(',').map((day) => day.trim()).filter((day) => WEEK_DAYS.includes(day)) : [];
      if (days.length) return days.length;
      if (/weekday/i.test(parts[0])) return 5;
      if (/twice/i.test(parts[0])) return 2;
      return 7;
    }
  }
}

// App habit ids look like "habit-1790708001257-1" (creation time in ms).
export function habitCreatedAt(habitId) {
  const match = /(?:^|:)habit-(\d{12,14})\b/.exec(String(habitId));
  return match ? Number(match[1]) : null;
}

/**
 * Scheduled check-ins a habit was expected to have in [startKey, endKey].
 * Habits created inside the window only count the days since creation.
 */
export function expectedCheckIns(habit, startKey, endKey, timeZone) {
  const perDay = expectedPerWeek(habit.meta) / 7;
  const created = habitCreatedAt(habit.id);
  let from = startKey;
  if (created) {
    const createdKey = todayInZone(timeZone, new Date(created));
    if (createdKey > endKey) return 0;
    if (createdKey > from) from = createdKey;
  }
  const days = dateRange(from, endKey).length;
  return perDay * days;
}

export function ratio(numerator, denominator) {
  if (!denominator) return null;
  return Math.min(1, numerator / denominator);
}

export function ageBracket(dateOfBirth, now = new Date()) {
  const parsed = new Date(String(dateOfBirth || ''));
  if (!dateOfBirth || Number.isNaN(parsed.getTime())) return 'Not specified';
  let age = now.getFullYear() - parsed.getFullYear();
  const beforeBirthday = now.getMonth() < parsed.getMonth() || (now.getMonth() === parsed.getMonth() && now.getDate() < parsed.getDate());
  if (beforeBirthday) age -= 1;
  if (age < 10 || age > 100) return 'Not specified';
  if (age < 18) return 'Under 18';
  if (age <= 20) return '18–20';
  if (age <= 23) return '21–23';
  if (age <= 26) return '24–26';
  return '27 and above';
}

export const AGE_BRACKET_ORDER = ['Under 18', '18–20', '21–23', '24–26', '27 and above', 'Not specified'];

export function reminderPeriod(reminderTime) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(reminderTime || '').trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour !== 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  if (hour >= 5 && hour < 12) return 'Morning (5 AM–12 PM)';
  if (hour >= 12 && hour < 17) return 'Afternoon (12–5 PM)';
  if (hour >= 17 && hour < 21) return 'Evening (5–9 PM)';
  return 'Night (9 PM–5 AM)';
}

export const REMINDER_PERIOD_ORDER = ['Morning (5 AM–12 PM)', 'Afternoon (12–5 PM)', 'Evening (5–9 PM)', 'Night (9 PM–5 AM)'];

export function streakBucket(streak) {
  const value = Number(streak) || 0;
  if (value === 0) return 'No streak';
  if (value <= 2) return '1–2 days';
  if (value <= 6) return '3–6 days';
  if (value <= 13) return '1–2 weeks';
  if (value <= 29) return '2–4 weeks';
  return '30+ days';
}

export const STREAK_BUCKET_ORDER = ['No streak', '1–2 days', '3–6 days', '1–2 weeks', '2–4 weeks', '30+ days'];

/**
 * k-anonymity for group breakdowns: groups with fewer than k students are merged
 * into one "Other groups" row; if even the merged row is below k it is withheld.
 * Rows must carry additive fields (students plus any sums) so merging stays exact.
 */
export function suppressSmallGroups(groups, threshold, sumKeys) {
  const visible = [];
  const small = [];
  for (const group of groups) {
    (group.students >= threshold ? visible : small).push(group);
  }
  let withheldStudents = 0;
  if (small.length) {
    const merged = { label: 'Other groups (combined)', students: 0, combined: small.length };
    for (const key of sumKeys) merged[key] = 0;
    for (const group of small) {
      merged.students += group.students;
      for (const key of sumKeys) merged[key] += group[key] || 0;
    }
    if (merged.students >= threshold && small.length > 1) visible.push(merged);
    else withheldStudents = merged.students;
  }
  return { rows: visible, suppressedGroups: small.length, withheldStudents };
}

/**
 * SQL for a "(user_id, day)" activity stream since $start (a local date) in $tz.
 * Activity = a login, a habit check-in, a day the app was opened (user_activity_days,
 * recorded by the app backend), or an app-state sync still in the snapshot history.
 */
export function activityEventsSql(startParam, tzParam) {
  return `
    SELECT la.user_id, (la.login_date_time AT TIME ZONE ${tzParam})::date AS day
      FROM login_activity la
     WHERE la.login_date_time >= (${startParam}::date::timestamp AT TIME ZONE ${tzParam})
    UNION
    SELECT hc.user_id, hc.completed_date AS day
      FROM habit_completions hc
     WHERE hc.completed_date >= ${startParam}::date
    UNION
    SELECT ad.user_id, ad.activity_date AS day
      FROM user_activity_days ad
     WHERE ad.activity_date >= ${startParam}::date
    UNION
    SELECT s.user_id, (to_timestamp(s.updated_at / 1000.0) AT TIME ZONE ${tzParam})::date AS day
      FROM user_app_state s
     WHERE s.updated_at >= extract(epoch FROM (${startParam}::date::timestamp AT TIME ZONE ${tzParam})) * 1000`;
}
