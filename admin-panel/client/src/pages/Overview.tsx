import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, LifeBuoy, Lightbulb } from 'lucide-react';
import { ActivityHeatmap, BarList, ChartCard, Funnel, heatmapRows, seriesColor, StatTile, TrendChart } from '../components/charts';
import { Alert, Card, cx, EmptyState, PageHeader, Segmented, Spinner } from '../components/ui';
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

          {(data.recentActivity || data.support) && (
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
              {data.recentActivity && (
                <Card className="xl:col-span-2" title="Recent admin activity" actions={<Link to="/audit" className="inline-flex items-center gap-1 text-[13px] font-medium text-accent-ink hover:underline">Audit log <ArrowRight className="size-3.5" /></Link>}>
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
              {data.support && (
                <Card title="Support queue">
                  <div className="flex flex-col gap-3">
                    <Link to="/support" className="flex items-center gap-3 rounded-lg border border-line p-3 hover:bg-surface-hover">
                      <LifeBuoy className="size-5 text-muted" aria-hidden />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-ink">{data.support.openIssues} open issue report{data.support.openIssues === 1 ? '' : 's'}</p>
                        <p className="text-xs text-muted">Open or in progress</p>
                      </div>
                      <ArrowRight className="size-4 text-muted" aria-hidden />
                    </Link>
                    <Link to="/support?tab=suggestions" className="flex items-center gap-3 rounded-lg border border-line p-3 hover:bg-surface-hover">
                      <Lightbulb className="size-5 text-muted" aria-hidden />
                      <div className="flex-1">
                        <p className="text-sm font-medium text-ink">{data.support.newSuggestions} new feature suggestion{data.support.newSuggestions === 1 ? '' : 's'}</p>
                        <p className="text-xs text-muted">Waiting for review</p>
                      </div>
                      <ArrowRight className="size-4 text-muted" aria-hidden />
                    </Link>
                  </div>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
