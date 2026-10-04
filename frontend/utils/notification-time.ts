// When a notification arrived, for grouping (Today, Yesterday, Earlier) and its time label.
export type Section = 'Today' | 'Yesterday' | 'Earlier';

const startOfDay = (time: number) => {
  const day = new Date(time);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

export function sectionFor(createdAt: number, now: number): Section {
  const days = Math.round((startOfDay(now) - startOfDay(createdAt)) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier';
}

/** "Just now", "5 min ago", "3 h ago", then the time or the date. */
export function timeLabel(createdAt: number, now: number) {
  const minutes = Math.floor((now - createdAt) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 6 * 60) return `${Math.floor(minutes / 60)} h ago`;
  const date = new Date(createdAt);
  return sectionFor(createdAt, now) === 'Earlier'
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
