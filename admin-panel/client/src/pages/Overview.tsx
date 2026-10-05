import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CircleCheck, HeartPulse, LifeBuoy, Lightbulb, UserPlus, type LucideIcon } from 'lucide-react';
import { usePendingAccessRequests } from '../components/AccessRequests';
import { ActivityHeatmap, BarList, ChartCard, Funnel, heatmapRows, seriesColor, StatTile, TrendChart } from '../components/charts';
import { Alert, Card, cx, EmptyState, PageHeader, Segmented, Spinner } from '../components/ui';
import { useAuth } from '../lib/auth';
import { formatDate, formatNumber, formatPercent, formatRelative, formatShortDay } from '../lib/format';
import { useApi } from '../lib/useApi';

interface OverviewData {
  range: number;
  period: { start: string; end: string; timeZone: string };
  kpis: {
    students: number;
    deactivated: number;
    staff: number;
    newStudents: number;
    newStudentsPrev: number;
    activeStudents: number;
    activeStudentsPrev: number;
    dau: number;
    wau: number;
    mau: number;
    stickiness: number | null;
    habits: number;
    habitsPerStudent: number;
    studentsWithHabits: number;
    completions: number;
    completionsPrev: number;
    completionRate: number | null;
    completionRatePrev: number | null;
  };
  series: { day: string; activeUsers: number; newUsers: number; completions: number }[];
  categoryBreakdown: { category: string; slot: number; habits: number; completions: number }[];
  funnel: { stage: string; students: number }[];
  loginHeatmap: { dow: number; hour: number; count: number }[];
  support?: { openIssues: number; newSuggestions: number };
  recentActivity?: { id: string; actorEmail: string; action: string; summary: string; createdAt: number }[];
}

interface AttentionItem { to: string; icon: LucideIcon; count: number; label: string; hint: string }

/** What an administrator should look at first: requests, reports, ideas and students who may need support. */
function NeedsAttention({ support }: { support?: OverviewData['support'] }) {
  const { can } = useAuth();
  const pending = usePendingAccessRequests(can('users:manage'), 'overview');
  const { data: pulse } = useApi<{ pulse: { risk: { high: number; medium: number } } }>(can('class:view') ? '/class-pulse' : null);
  const risk = pulse?.pulse.risk;
  const items: AttentionItem[] = [
    ...(can('users:manage') ? [{ to: '/users', icon: UserPlus, count: pending, label: 'Access requests', hint: 'Waiting for approval' }] : []),
    ...(support ? [
      { to: '/support', icon: LifeBuoy, count: support.openIssues, label: 'Open issue reports', hint: 'Open or in progress' },
      { to: '/support?tab=suggestions', icon: Lightbulb, count: support.newSuggestions, label: 'Feature suggestions', hint: 'Waiting for review' },
    ] : []),
    ...(risk ? [{ to: '/class-pulse', icon: HeartPulse, count: risk.high + risk.medium, label: 'Students who may need support', hint: `${risk.high} at risk · ${risk.medium} to watch` }] : []),
  ];
  // Faculty start on Class Pulse; a single tile here would only repeat it.
  if (items.length < 2) return null;
  const waiting = items.reduce((total, item) => total + item.count, 0);
  return (
    <Card
      title="Needs your attention"
      subtitle={waiting ? 'Start here: each card opens the page where it is handled.' : 'All clear. Nothing is waiting right now.'}
      actions={!waiting ? <CircleCheck className="size-5 text-good-ink" aria-hidden /> : undefined}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className={cx('group flex items-center gap-3 rounded-xl border p-3 transition-colors hover:bg-surface-hover', item.count ? 'border-accent/40 bg-accent-soft/40' : 'border-line')}
          >
            <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg', item.count ? 'bg-accent text-on-accent' : 'bg-surface-2 text-muted')}>
              <item.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium leading-snug text-ink">{item.label}</span>
              <span className="block text-xs text-muted">{item.hint}</span>
            </span>
            <span className={cx('tabular text-2xl font-semibold', item.count ? 'text-ink' : 'text-muted')}>{formatNumber(item.count)}</span>
            <ArrowRight className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </div>
    </Card>
  );
}

const METRICS = [
  { value: 'activeUsers', label: 'Active students' },
  { value: 'completions', label: 'Check-ins' },
  { value: 'newUsers', label: 'New students' },
] as const;
type Metric = (typeof METRICS)[number]['value'];

export function OverviewPage() {
  const [range, setRange] = useState(30);
  const [metric, setMetric] = useState<Metric>('activeUsers');
  const { data, error, loading } = useApi<OverviewData>(`/overview?range=${range}`);
  const period = `previous ${range} days`;

  return (
    <>
      <PageHeader
        title="Overview"
        description={data ? `Student engagement from ${formatDate(data.period.start)} to ${formatDate(data.period.end)} (${data.period.timeZone} time).` : 'Student engagement across HabitAI.'}
        actions={<Segmented label="Date range" value={range} onChange={setRange} options={[{ value: 7, label: '7 days' }, { value: 30, label: '30 days' }, { value: 90, label: '90 days' }]} />}
      />
      {error && <div className="mb-4"><Alert tone="critical" title="Could not load the overview">{error}</Alert></div>}
      {!data ? (loading && <Spinner />) : (
        <div className={cx('flex flex-col gap-5 transition-opacity', loading && 'opacity-60')}>
          <NeedsAttention support={data.support} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile label="Active students" value={formatNumber(data.kpis.activeStudents)} current={data.kpis.activeStudents} previous={data.kpis.activeStudentsPrev} period={period} />
            <StatTile label="Habit check-ins" value={formatNumber(data.kpis.completions)} current={data.kpis.completions} previous={data.kpis.completionsPrev} period={period} />
            <StatTile label="Completion rate" value={formatPercent(data.kpis.completionRate)} current={data.kpis.completionRate} previous={data.kpis.completionRatePrev} format="percent" period={period} hint="Check-ins ÷ scheduled check-ins" />
            <StatTile label="New students" value={formatNumber(data.kpis.newStudents)} current={data.kpis.newStudents} previous={data.kpis.newStudentsPrev} period={period} />
          </div>
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <StatTile label="Total students" value={formatNumber(data.kpis.students)} hint={`${data.kpis.deactivated} deactivated · ${data.kpis.staff} staff accounts`} />
            <StatTile label="Active today" value={formatNumber(data.kpis.dau)} hint={`${data.kpis.wau} this week · ${data.kpis.mau} in 30 days`} />
            <StatTile label="Stickiness (DAU ÷ MAU)" value={formatPercent(data.kpis.stickiness)} hint="Share of monthly students who return daily" />
            <StatTile label="Habits tracked" value={formatNumber(data.kpis.habits)} hint={`${data.kpis.habitsPerStudent.toFixed(1)} per student · ${data.kpis.studentsWithHabits} students with habits`} />
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <ChartCard
              className="xl:col-span-2"
              title="Daily trend"
              subtitle={METRICS.find((item) => item.value === metric)?.label + ' per day'}
              actions={<Segmented label="Metric" value={metric} onChange={setMetric} options={METRICS.map((item) => ({ value: item.value, label: item.label }))} />}
              rows={data.series}
              columns={[
                { key: 'day', label: 'Date', render: (row) => formatDate(row.day) },
                { key: 'active', label: 'Active students', align: 'right', render: (row) => row.activeUsers },
                { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
                { key: 'new', label: 'New students', align: 'right', render: (row) => row.newUsers },
              ]}
            >
              <TrendChart data={data.series} xKey="day" yKey={metric} seriesLabel={METRICS.find((item) => item.value === metric)!.label.toLowerCase()} formatX={formatShortDay} height={260} />
            </ChartCard>

            <ChartCard
              title="Engagement funnel"
              subtitle="How far students get with HabitAI"
              rows={data.funnel}
              columns={[
                { key: 'stage', label: 'Stage', render: (row) => row.stage },
                { key: 'students', label: 'Students', align: 'right', render: (row) => row.students },
              ]}
            >
              <Funnel stages={data.funnel} />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <ChartCard
              title="Habits by category"
              subtitle={`Habits tracked, with check-ins in the last ${range} days`}
              rows={data.categoryBreakdown}
              columns={[
                { key: 'category', label: 'Category', render: (row) => row.category },
                { key: 'habits', label: 'Habits', align: 'right', render: (row) => row.habits },
                { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
              ]}
            >
              {data.categoryBreakdown.length ? (
                <BarList
                  rows={data.categoryBreakdown}
                  label={(row) => (
                    <span className="inline-flex items-center gap-2">
                      <span className="size-2.5 rounded-sm" style={{ background: seriesColor(row.slot) }} aria-hidden />
                      {row.category}
                    </span>
                  )}
                  value={(row) => row.habits}
                  detail={(row) => `${row.completions} check-ins`}
                  color={(row) => seriesColor(row.slot)}
                />
              ) : <EmptyState title="No habits yet">Categories appear once students create habits in the app.</EmptyState>}
            </ChartCard>

            <ChartCard
              className="xl:col-span-2"
              title="When students open the app"
              subtitle={`Sign-ins by weekday and hour, last ${range} days`}
              rows={heatmapRows(data.loginHeatmap)}
              columns={[
                { key: 'when', label: 'Weekday and hour', render: (row) => row.when },
                { key: 'count', label: 'Sign-ins', align: 'right', render: (row) => row.count },
              ]}
            >
              <ActivityHeatmap cells={data.loginHeatmap} />
            </ChartCard>
          </div>

          {data.recentActivity && (
            <Card title="Recent admin activity" actions={<Link to="/audit" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">Audit log <ArrowRight className="size-3.5" /></Link>}>
              {data.recentActivity.length ? (
                <ul className="-my-2 divide-y divide-[var(--border)]">
                  {data.recentActivity.map((entry) => (
                    <li key={entry.id} className="flex items-start justify-between gap-4 py-2.5 text-[13px]">
                      <div className="min-w-0">
                        <p className="text-ink">{entry.summary}</p>
                        <p className="text-xs text-muted">{entry.actorEmail}</p>
                      </div>
                      <span className="shrink-0 text-xs text-muted">{formatRelative(entry.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title="No admin actions yet" />}
            </Card>
          )}
        </div>
      )}
    </>
  );
}
