import { useState } from 'react';
import { Activity, Brain, CalendarCheck, Clock, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { BarList, ChartCard, TrendChart } from '../components/charts';
import { Alert, Button, Card, cx, EmptyState, PageHeader, Spinner } from '../components/ui';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatNumber, formatPercent, formatRelative, formatShortDay } from '../lib/format';
import { useApi } from '../lib/useApi';

interface Pulse {
  today: string;
  windowDays: number;
  anonymityThreshold: number;
  kpis: { students: number; studentsWithHabits: number; activeThisWeek: number; checkInsToday: number; studentsCheckedInToday: number; consistency: number | null; habits: number };
  trend: { day: string; rate: number | null; completed: number; scheduled: number }[];
  weekdays: { weekday: string; rate: number | null; scheduled: number }[];
  categories: { category: string; students: number; scheduled: number; completed: number; rate: number | null }[];
  peakHours: { from: string; to: string; share: number } | null;
  risk: { high: number; medium: number; low: number; new: number; notStarted: number; fromModel: number; source: 'ml' | 'ml-fallback' | 'rules'; mlStatus: string };
  aiAvailable: boolean;
  generatedAt: number;
}

interface Summary { summary: string; suggestions: string[]; generatedAt: number }

const RISK_SOURCE: Record<Pulse['risk']['source'], string> = {
  ml: 'Dropout risk from the machine-learning model.',
  'ml-fallback': "Dropout risk from the ML service's rules-based estimate (until a trained model is approved).",
  rules: 'Estimated from missed check-ins in the last 7 days (the ML service was not reachable).',
};

function greeting(date = new Date()) {
  const hour = date.getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

/** The class consistency as a ring, like the progress ring in the student app. */
function ConsistencyRing({ value }: { value: number | null }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const share = value ?? 0;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`Class consistency ${formatPercent(value)}`}>
      <svg viewBox="0 0 100 100" className="size-full -rotate-90">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth="10" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#ffffff" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${circumference * share} ${circumference}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
        <span className="text-2xl font-extrabold">{value === null ? '—' : formatPercent(value)}</span>
        <span className="text-[10px] font-semibold uppercase tracking-wide opacity-80">consistency</span>
      </div>
    </div>
  );
}

function Tile({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]">{icon}</div>
      <div className="text-sm font-semibold text-[var(--ink-2)]">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-[var(--ink)]">{value}</div>
      <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>
    </div>
  );
}

function RiskBar({ risk }: { risk: Pulse['risk'] }) {
  const parts = [
    { key: 'high', label: 'At risk', count: risk.high, color: 'var(--critical)' },
    { key: 'medium', label: 'Watch', count: risk.medium, color: 'var(--warning)' },
    { key: 'low', label: 'On track', count: risk.low, color: 'var(--good)' },
  ];
  const total = parts.reduce((sum, part) => sum + part.count, 0);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-[var(--surface-2)]" role="img" aria-label={parts.map((part) => `${part.label}: ${part.count}`).join(', ')}>
        {total > 0 && parts.map((part) => part.count > 0 && <div key={part.key} style={{ width: `${(part.count / total) * 100}%`, background: part.color }} />)}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {parts.map((part) => (
          <div key={part.key} className="rounded-xl bg-[var(--surface-2)] p-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-2)]"><span className="size-2.5 rounded-full" style={{ background: part.color }} aria-hidden />{part.label}</div>
            <div className="mt-1 text-xl font-extrabold text-[var(--ink)]">{part.count}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-[var(--muted)]">
        {risk.new > 0 && `${risk.new} with habits too new to judge · `}
        {risk.notStarted > 0 && `${risk.notStarted} without habits yet · `}
        {RISK_SOURCE[risk.source]}
      </p>
    </div>
  );
}

export function ClassPulsePage() {
  const { admin } = useAuth();
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, error, loading } = useApi<{ pulse: Pulse }>(`/class-pulse${refreshKey ? `?refresh=1&v=${refreshKey}` : ''}`);
  const pulse = data?.pulse;
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const title = admin?.role === 'faculty' ? `Prof. ${admin.fullName.split(' ').at(-1) || admin.fullName}` : admin?.fullName.split(' ')[0] ?? '';

  const generateSummary = async (refresh: boolean) => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await post<Summary>(`/class-pulse/summary${refresh ? '?refresh=1' : ''}`));
    } catch (problem) {
      setSummaryError(problem instanceof Error ? problem.message : 'The AI summary is unavailable right now.');
    } finally {
      setSummaryLoading(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Class Pulse"
        description="How your students are doing with their habits, as a group. Anonymized: no student is named or listed."
        actions={<Button icon={<RefreshCw className="size-4" />} onClick={() => setRefreshKey((value) => value + 1)} loading={loading && Boolean(pulse)}>Refresh</Button>}
      />
      {error && <div className="mb-4"><Alert tone="critical" title="Could not load the class pulse">{error}</Alert></div>}
      {!pulse ? (loading && <Spinner label="Reading check-ins and asking the ML service" />) : (
        <div className={cx('flex flex-col gap-5 transition-opacity', loading && 'opacity-60')}>
          <section className="flex flex-col gap-5 rounded-3xl bg-gradient-to-br from-[#5b42d8] to-[#7a5cf0] p-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold opacity-85">{greeting()}, {title}!</p>
              <h2 className="mt-1 text-2xl font-extrabold sm:text-3xl">Your class this month</h2>
              <p className="mt-2 max-w-xl text-sm opacity-90">
                {pulse.kpis.studentsWithHabits
                  ? `${formatNumber(pulse.kpis.activeThisWeek)} of ${formatNumber(pulse.kpis.students)} students checked in this week. Consistency is the share of scheduled habit days that were completed in the last ${pulse.windowDays} days.`
                  : 'No student has created a habit yet. The pulse fills in as students start checking in.'}
              </p>
              <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><ShieldCheck className="size-3.5" /> Groups under {pulse.anonymityThreshold} students are merged</p>
            </div>
            <ConsistencyRing value={pulse.kpis.consistency} />
          </section>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile icon={<Users className="size-4" />} label="Active this week" value={formatNumber(pulse.kpis.activeThisWeek)} hint={`of ${formatNumber(pulse.kpis.students)} students`} />
            <Tile icon={<CalendarCheck className="size-4" />} label="Check-ins today" value={formatNumber(pulse.kpis.checkInsToday)} hint={`by ${formatNumber(pulse.kpis.studentsCheckedInToday)} students`} />
            <Tile icon={<Activity className="size-4" />} label="Students with habits" value={formatNumber(pulse.kpis.studentsWithHabits)} hint={`${formatNumber(pulse.kpis.habits)} habits tracked`} />
            <Tile icon={<Clock className="size-4" />} label="Busiest check-in time" value={pulse.peakHours ? `${pulse.peakHours.from}–${pulse.peakHours.to}` : '—'} hint={pulse.peakHours ? `${formatPercent(pulse.peakHours.share)} of check-ins` : 'Not enough check-ins yet'} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card title="Students who may need support" subtitle="Counts only — no student is identified" className="xl:col-span-1">
              <RiskBar risk={pulse.risk} />
            </Card>

            <Card
              title="AI class summary"
              subtitle="Written by the AI from the class numbers on this page"
              className="xl:col-span-2"
              actions={pulse.aiAvailable && summary ? <Button size="sm" icon={<RefreshCw className="size-3.5" />} onClick={() => void generateSummary(true)} loading={summaryLoading}>Regenerate</Button> : undefined}
            >
              {!pulse.aiAvailable ? (
                <EmptyState icon={<Brain className="size-5" />} title="AI is not configured">Add GROQ_API_KEY to the Admin Panel service to get an AI summary.</EmptyState>
              ) : summary ? (
                <div className="flex flex-col gap-3">
                  <p className="text-sm leading-6 text-[var(--ink)]">{summary.summary}</p>
                  <ol className="flex flex-col gap-2">
                    {summary.suggestions.map((suggestion, index) => (
                      <li key={suggestion} className="flex gap-3 rounded-xl bg-[var(--accent-soft)] p-3 text-sm text-[var(--ink)]">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-bold text-[var(--on-accent)]">{index + 1}</span>
                        {suggestion}
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-[var(--muted)]">Generated {formatRelative(summary.generatedAt)}. Suggestions are for the whole class, not individual students.</p>
                </div>
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-sm text-[var(--ink-2)]">Get a short summary of how the class is doing and three things you can do this week.</p>
                  {summaryError && <Alert tone="warning">{summaryError}</Alert>}
                  <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void generateSummary(false)} loading={summaryLoading}>Generate AI summary</Button>
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title="Daily consistency"
              subtitle="Share of scheduled habits completed each day, last 14 full days"
              rows={pulse.trend}
              columns={[
                { key: 'day', label: 'Date', render: (row) => formatDate(row.day) },
                { key: 'completed', label: 'Completed', align: 'right', render: (row) => row.completed },
                { key: 'scheduled', label: 'Scheduled', align: 'right', render: (row) => row.scheduled },
                { key: 'rate', label: 'Consistency', align: 'right', render: (row) => formatPercent(row.rate) },
              ]}
            >
              <TrendChart data={pulse.trend} xKey="day" yKey="rate" seriesLabel="consistency" formatX={formatShortDay} formatValue={(value) => formatPercent(value)} percent height={240} />
            </ChartCard>

            <ChartCard
              title="Hardest days of the week"
              subtitle={`Consistency by weekday, last ${pulse.windowDays} days`}
              rows={pulse.weekdays}
              columns={[
                { key: 'weekday', label: 'Day', render: (row) => row.weekday },
                { key: 'rate', label: 'Consistency', align: 'right', render: (row) => formatPercent(row.rate) },
              ]}
            >
              <BarList
                rows={pulse.weekdays}
                label={(row) => row.weekday}
                value={(row) => row.rate}
                max={1}
                format={(value) => formatPercent(value)}
                // The weakest day stands out: a good day for a reminder or a check-in with the class.
                color={(row) => (row.rate !== null && row.rate === Math.min(...pulse.weekdays.filter((day) => day.rate !== null).map((day) => day.rate as number)) ? 'var(--warning)' : 'var(--accent)')}
              />
            </ChartCard>
          </div>

          <ChartCard
            title="Habit categories, hardest first"
            subtitle={`Consistency per category, last ${pulse.windowDays} days. Categories with fewer than ${pulse.anonymityThreshold} students are merged.`}
            rows={pulse.categories}
            columns={[
              { key: 'category', label: 'Category', render: (row) => row.category },
              { key: 'students', label: 'Students', align: 'right', render: (row) => row.students },
              { key: 'rate', label: 'Consistency', align: 'right', render: (row) => formatPercent(row.rate) },
            ]}
          >
            {pulse.categories.length ? (
              <BarList rows={pulse.categories} label={(row) => row.category} value={(row) => row.rate} max={1} format={(value) => formatPercent(value)} detail={(row) => `${row.students} students · ${row.completed}/${row.scheduled} days`} />
            ) : <EmptyState title="No scheduled habits yet">Categories appear once students check in.</EmptyState>}
          </ChartCard>

          <p className="text-xs text-[var(--muted)]">Updated {formatRelative(pulse.generatedAt)} · {pulse.kpis.students} active students · {pulse.risk.fromModel} analysed by the ML service.</p>
        </div>
      )}
    </>
  );
}
