const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('en-US');

export function formatNumber(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (Math.abs(value) >= 10_000) return compact.format(value);
  return digits ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : whole.format(Math.round(value));
}

export function formatPercent(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDate(value: number | string | null | undefined, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (value === null || value === undefined || value === '') return '—';
  const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-US', options);
}

export function formatDateTime(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function formatRelative(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return 'Never';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return '—';
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 45) return 'Just now';
  const units: [number, string][] = [[60, 'minute'], [60, 'hour'], [24, 'day'], [7, 'week'], [4.35, 'month'], [12, 'year']];
  let amount = seconds;
  let unit = 'second';
  for (const [size, name] of units) {
    if (Math.abs(amount) < size) break;
    amount /= size;
    unit = name;
  }
  const rounded = Math.round(amount);
  return `${rounded} ${unit}${rounded === 1 ? '' : 's'} ago`;
}

export function formatShortDay(value: string) {
  return formatDate(value, { month: 'short', day: 'numeric' });
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/** Relative change between two periods, or null when there is no baseline. */
export function change(current: number | null | undefined, previous: number | null | undefined) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (previous === 0) return current === 0 ? 0 : null;
  return (current - previous) / previous;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}
