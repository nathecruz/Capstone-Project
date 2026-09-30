import { useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { BarList, ChartCard, CohortTable, ColumnChart, seriesColor, StatTile, TrendChart } from '../components/charts';
import { Alert, Button, Card, cx, EmptyState, PageHeader, Segmented, Select, Spinner, Table, Tabs, Td, Th, useToast } from '../components/ui';
import { download } from '../lib/api';
import { formatDate, formatNumber, formatPercent, formatShortDay } from '../lib/format';
import { useApi } from '../lib/useApi';

interface GroupRow { label: string; students: number; combined: number; habitsPerStudent: number; weeklyCheckInsPerStudent: number; completionRate: number | null }
interface Breakdown { rows: GroupRow[]; suppressedGroups: number; withheldStudents: number }

interface AnalyticsData {
  meta: { range: number; start: string; end: string; timeZone: string; anonymityThreshold: number; generatedAt: number };
  summary: {
    students: number;
    activeStudents: number;
    habits: number;
    completions: number;
    completionRate: number | null;
    weeklyCheckInsPerActiveStudent: number;
    avgBestStreak: number;
    avgHabitStreak: number;
    reminderAdoption: number | null;
  };
  weeklyTrend: { week: string; activeStudents: number; completions: number; checkInsPerActiveStudent: number; completionRate: number | null; partial: boolean }[];
  categories: { category: string; slot: number; habits: number; students: number; completions: number; completionRate: number | null; avgStreak: number }[];
  frequencyMix: { label: string; count: number }[];
  streakDistribution: { label: string; count: number }[];
  dayOfWeek: { label: string; completions: number }[];
  reminders: { habitsWithReminders: number; adoption: number | null; byPeriod: { label: string; count: number }[] };
  demographics: { gender: Breakdown; age: Breakdown; region: Breakdown };
  cohorts: { week: string; size: number | null; suppressed: boolean; retention: (number | null)[] }[];
  goals: { category: string; goals: number; avgProgress: number }[];
  gamification: { tokensEarned: number; tokensSpent: number; rewards: { name: string; redemptions: number; tokenCost: number }[]; achievements: { name: string; share: number }[] };
}

const TREND_METRICS = [
  { value: 'completionRate', label: 'Completion rate' },
  { value: 'checkInsPerActiveStudent', label: 'Check-ins per active student' },
  { value: 'activeStudents', label: 'Active students' },
] as const;
type TrendMetric = (typeof TREND_METRICS)[number]['value'];

const DATASETS = [
  { value: 'weekly_trend', label: 'Weekly engagement trend' },
  { value: 'categories', label: 'Category performance' },
  { value: 'demographics', label: 'Demographic groups (k-anonymized)' },
  { value: 'cohorts', label: 'Retention cohorts' },
  { value: 'habit_patterns', label: 'Habit patterns' },
];

const weekLabel = (week: string) => `Week of ${formatShortDay(week)}`;

export function AnalyticsPage() {
  const toast = useToast();
  const [range, setRange] = useState(90);
  const [metric, setMetric] = useState<TrendMetric>('completionRate');
  const [dimension, setDimension] = useState<'gender' | 'age' | 'region'>('gender');
  const [dataset, setDataset] = useState('weekly_trend');
  const [exporting, setExporting] = useState(false);
  const { data, error, loading } = useApi<AnalyticsData>(`/analytics?range=${range}`);

  async function exportCsv() {
    setExporting(true);
    try {
      await download(`/analytics/export.csv?dataset=${dataset}&range=${range}`, `habitai-${dataset}.csv`);
      toast('Export downloaded. It contains aggregated data only.');
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : 'Export failed.', 'critical');
    } finally {
      setExporting(false);
    }
  }

  const k = data?.meta.anonymityThreshold ?? 0;
  const breakdown = data?.demographics[dimension];
  const metricInfo = TREND_METRICS.find((item) => item.value === metric)!;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Aggregated, anonymized analytics across all students, to assess how HabitAI affects student lifestyle habits."
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: 30, label: '30 days' }, { value: 90, label: '90 days' }, { value: 180, label: '6 months' }, { value: 365, label: '1 year' }]} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select aria-label="Dataset to export" value={dataset} onChange={(event) => setDataset(event.target.value)} className="w-auto">
            {DATASETS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </Select>
          <Button icon={<Download className="size-4" />} loading={exporting} onClick={exportCsv}>Export CSV</Button>
        </div>
      </div>

      {error && <div className="mb-4"><Alert tone="critical" title="Could not load analytics">{error}</Alert></div>}
      {!data ? (loading && <Spinner />) : (
        <div className={cx('flex flex-col gap-5 transition-opacity', loading && 'opacity-60')}>
          <div className="flex items-start gap-2.5 rounded-lg border border-line bg-surface px-4 py-3 text-[13px] text-ink-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-good-ink" aria-hidden />
            <p>
              Privacy by design: these views contain no names, emails or individual records. Demographic groups with fewer than <strong className="text-ink">{k} students</strong> are
              combined or withheld (k-anonymity). Staff accounts are excluded. Period: {formatDate(data.meta.start)} – {formatDate(data.meta.end)}.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
            <StatTile label="Students analyzed" value={formatNumber(data.summary.students)} hint={`${data.summary.activeStudents} active in period`} />
            <StatTile label="Completion rate" value={formatPercent(data.summary.completionRate)} hint="Check-ins ÷ scheduled" />
            <StatTile label="Weekly check-ins" value={formatNumber(data.summary.weeklyCheckInsPerActiveStudent, data.summary.weeklyCheckInsPerActiveStudent < 1 ? 2 : 1)} hint="Per active student" />
            <StatTile label="Average best streak" value={`${formatNumber(data.summary.avgBestStreak, 1)} d`} hint="Per student with habits" />
            <StatTile label="Habits tracked" value={formatNumber(data.summary.habits)} hint={`${formatNumber(data.summary.completions)} check-ins in period`} />
            <StatTile label="Reminder adoption" value={formatPercent(data.summary.reminderAdoption)} hint="Habits with reminders on" />
          </div>

          <ChartCard
            title="Impact over time"
            subtitle={`${metricInfo.label} per week. The first and current weeks may be partial.`}
            actions={<Segmented label="Metric" value={metric} onChange={setMetric} options={TREND_METRICS.map((item) => ({ value: item.value, label: item.label }))} />}
            rows={data.weeklyTrend}
            columns={[
              { key: 'week', label: 'Week starting', render: (row) => `${formatDate(row.week)}${row.partial ? ' (partial)' : ''}` },
              { key: 'active', label: 'Active students', align: 'right', render: (row) => row.activeStudents },
              { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
              { key: 'per', label: 'Check-ins per active student', align: 'right', render: (row) => formatNumber(row.checkInsPerActiveStudent, 2) },
              { key: 'rate', label: 'Completion rate', align: 'right', render: (row) => formatPercent(row.completionRate, 1) },
            ]}
          >
            <TrendChart
              data={data.weeklyTrend}
              xKey="week"
              yKey={metric}
              seriesLabel={metricInfo.label.toLowerCase()}
              formatX={weekLabel}
              percent={metric === 'completionRate'}
              formatValue={(value) => (metric === 'completionRate' ? formatPercent(value, 1) : metric === 'checkInsPerActiveStudent' ? formatNumber(value, 2) : formatNumber(value))}
              height={280}
            />
          </ChartCard>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ChartCard
              title="Completion rate by habit category"
              subtitle="Which kinds of habits students keep"
              rows={data.categories}
              columns={[
                { key: 'category', label: 'Category', render: (row) => row.category },
                { key: 'habits', label: 'Habits', align: 'right', render: (row) => row.habits },
                { key: 'students', label: 'Students', align: 'right', render: (row) => row.students },
                { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
                { key: 'rate', label: 'Completion rate', align: 'right', render: (row) => formatPercent(row.completionRate, 1) },
                { key: 'streak', label: 'Avg streak', align: 'right', render: (row) => formatNumber(row.avgStreak, 1) },
              ]}
            >
              {data.categories.length ? (
                <BarList
                  rows={data.categories}
                  max={1}
                  label={(row) => <span className="inline-flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: seriesColor(row.slot) }} aria-hidden />{row.category}</span>}
                  value={(row) => row.completionRate}
                  format={(value) => formatPercent(value)}
                  detail={(row) => `${row.habits} habits · ${formatNumber(row.avgStreak, 1)}-day avg streak`}
                  color={(row) => seriesColor(row.slot)}
                />
              ) : <EmptyState title="No habits in this period" />}
            </ChartCard>

            <ChartCard
              title="Check-ins by weekday"
              subtitle="When students complete their habits"
              rows={data.dayOfWeek}
              columns={[
                { key: 'day', label: 'Weekday', render: (row) => row.label },
                { key: 'completions', label: 'Check-ins', align: 'right', render: (row) => row.completions },
              ]}
            >
              <ColumnChart data={data.dayOfWeek} xKey="label" yKey="completions" seriesLabel="check-ins" height={240} />
            </ChartCard>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <ChartCard
              title="Current streaks"
              subtitle="Habits by current streak length"
              rows={data.streakDistribution}
              columns={[{ key: 'label', label: 'Streak', render: (row) => row.label }, { key: 'count', label: 'Habits', align: 'right', render: (row) => row.count }]}
            >
              <BarList rows={data.streakDistribution} label={(row) => row.label} value={(row) => row.count} />
            </ChartCard>
            <ChartCard
              title="Reminder times"
              subtitle={`${data.reminders.habitsWithReminders} habits with reminders`}
              rows={data.reminders.byPeriod}
              columns={[{ key: 'label', label: 'Time of day', render: (row) => row.label }, { key: 'count', label: 'Habits', align: 'right', render: (row) => row.count }]}
            >
              <BarList rows={data.reminders.byPeriod} label={(row) => row.label} value={(row) => row.count} />
            </ChartCard>
            <ChartCard
              title="Habit frequency"
              subtitle="How often habits are scheduled"
              rows={data.frequencyMix}
              columns={[{ key: 'label', label: 'Frequency', render: (row) => row.label }, { key: 'count', label: 'Habits', align: 'right', render: (row) => row.count }]}
            >
              <BarList rows={data.frequencyMix} label={(row) => row.label} value={(row) => row.count} />
            </ChartCard>
          </div>

          <Card title="Engagement by demographic group" subtitle="Compare groups without exposing individuals">
            <Tabs value={dimension} onChange={setDimension} tabs={[{ value: 'gender', label: 'Gender' }, { value: 'age', label: 'Age group' }, { value: 'region', label: 'Region' }]} />
            {breakdown && breakdown.rows.length ? (
              <div className="-mx-5">
                <Table>
                  <thead>
                    <tr><Th>Group</Th><Th align="right">Students</Th><Th align="right">Habits per student</Th><Th align="right">Weekly check-ins per student</Th><Th>Completion rate</Th></tr>
                  </thead>
                  <tbody>
                    {breakdown.rows.map((row) => (
                      <tr key={row.label}>
                        <Td className="font-medium">{row.label}{row.combined > 0 && <span className="ml-1 font-normal text-muted">({row.combined} small groups)</span>}</Td>
                        <Td align="right">{row.students}</Td>
                        <Td align="right">{formatNumber(row.habitsPerStudent, 1)}</Td>
                        <Td align="right">{formatNumber(row.weeklyCheckInsPerStudent, 2)}</Td>
                        <Td>
                          <div className="flex min-w-40 items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-surface-2"><div className="h-full rounded-full" style={{ width: `${(row.completionRate ?? 0) * 100}%`, background: 'var(--series-1)' }} /></div>
                            <span className="w-12 text-right text-ink tabular">{formatPercent(row.completionRate)}</span>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            ) : <EmptyState title="Not enough students to show this breakdown">Every group is smaller than {k} students, so it is withheld to protect privacy.</EmptyState>}
            {breakdown && (breakdown.suppressedGroups > 0) && (
              <p className="mt-3 text-xs text-muted">
                {breakdown.suppressedGroups} group{breakdown.suppressedGroups === 1 ? '' : 's'} had fewer than {k} students and {breakdown.withheldStudents ? `were withheld (${breakdown.withheldStudents} students)` : 'were combined into “Other groups”'}.
              </p>
            )}
          </Card>

          <Card title="Weekly retention" subtitle={`Share of each registration cohort active in the weeks after joining. Cohorts under ${k} students are hidden (•).`}>
            <CohortTable cohorts={data.cohorts} threshold={k} formatWeek={(week) => formatShortDay(week)} />
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Card title="Gamification" subtitle="Tokens and rewards across all students">
              <div className="mb-5 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">Tokens earned</p><p className="text-xl font-semibold text-ink">{formatNumber(data.gamification.tokensEarned)}</p></div>
                <div className="rounded-lg bg-surface-2 p-3"><p className="text-xs text-muted">Tokens spent</p><p className="text-xl font-semibold text-ink">{formatNumber(data.gamification.tokensSpent)}</p></div>
              </div>
              <p className="mb-3 text-[13px] font-medium text-ink">Reward redemptions</p>
              <BarList rows={data.gamification.rewards} label={(row) => row.name} value={(row) => row.redemptions} detail={(row) => `${row.tokenCost} tokens`} />
            </Card>
            <Card title="Achievements unlocked" subtitle="Share of students who earned each achievement">
              <BarList rows={data.gamification.achievements} max={1} label={(row) => row.name} value={(row) => row.share} format={(value) => formatPercent(value)} />
              {data.goals.length > 0 && (
                <>
                  <p className="mb-2 mt-6 text-[13px] font-medium text-ink">Goals by category</p>
                  <BarList rows={data.goals} label={(row) => row.category} value={(row) => row.goals} detail={(row) => `${row.avgProgress}% avg progress`} />
                </>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
