import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, ShieldCheck } from 'lucide-react';
import { BarList, ChartCard, CohortTable, ColumnChart, seriesColor, StatTile, TrendChart } from '../components/charts';
import { Alert, Badge, Button, Card, cx, EmptyState, PageHeader, Segmented, Select, Spinner, Table, Tabs, Td, Th, useToast } from '../components/ui';
import { download } from '../lib/api';
import { useAuth } from '../lib/auth';
import { formatDate, formatNumber, formatPercent, formatShortDay, formatTokenKind } from '../lib/format';
import type { TokenEconomy, TokenFlags, TokenFlagType } from '../lib/types';
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
  economy: TokenEconomy;
  achievements: { name: string; share: number }[];
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
const signed = (value: number) => `${value > 0 ? '+' : ''}${formatNumber(value)}`;

const FLAG_LABELS: Record<TokenFlagType, string> = {
  'big-day': 'Big day',
  'capped-day': 'Over the cap',
  'many-habits': 'Many habits',
  'many-gifts': 'Many gifts',
};

function EconomyTile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-lg bg-surface-2 p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-xl font-semibold text-ink tabular">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

/** A small titled table inside the token economy card. */
function EconomyTable({ title, note, head, children }: { title: string; note?: ReactNode; head: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg border border-line [&_tbody_tr:last-child_td]:border-b-0">
      <p className="px-5 pt-3 text-[13px] font-medium text-ink">{title}</p>
      {note && <p className="px-5 text-xs text-muted">{note}</p>}
      <Table className="mt-1">
        <thead><tr>{head}</tr></thead>
        <tbody>{children}</tbody>
      </Table>
    </div>
  );
}

/** Where tokens came from and went in the last 28 days, students only and aggregates only. */
function TokenEconomyCard({ economy }: { economy: TokenEconomy }) {
  const earned = economy.byKind28.filter((row) => row.earned > 0).sort((a, b) => b.earned - a.earned);
  const spent = economy.byKind28.filter((row) => row.spent > 0).sort((a, b) => b.spent - a.spent);
  const thisWeek = economy.drops.at(-1)?.weekStart;
  const { perDay, from: capFrom } = economy.checkInCap;
  const { balances, freezes, retired } = economy;
  return (
    <Card title="Token economy" subtitle={`Students only. The last 28 days (since ${formatDate(economy.since)}) unless noted, whatever the date range above.`}>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <EconomyTile label="Issued, 28 days" value={formatNumber(economy.issued28)} hint={`Plus ${formatNumber(economy.refunds28)} refunded`} />
        <EconomyTile label="Spent, 28 days" value={formatNumber(economy.spent28)} hint={`Plus ${formatNumber(economy.undone28)} taken back by undos`} />
        <EconomyTile label="Net, 28 days" value={signed(economy.issued28 - economy.spent28)} hint="Issued minus spent" />
        <EconomyTile label="Median balance" value={formatNumber(balances.median)} hint={`90th percentile ${formatNumber(balances.p90)}, ${formatNumber(balances.students)} active students`} />
        <EconomyTile label="Students over 1,000" value={formatNumber(balances.over1000)} hint="Many here means too few ways to spend" />
      </div>

      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-[13px] font-medium text-ink">Earned by source</p>
          {earned.length ? <BarList rows={earned} label={(row) => formatTokenKind(row.kind)} value={(row) => row.earned} /> : <p className="text-[13px] text-muted">No tokens earned in these days.</p>}
        </div>
        <div>
          <p className="mb-3 text-[13px] font-medium text-ink">Spent by</p>
          {spent.length ? <BarList rows={spent} label={(row) => formatTokenKind(row.kind)} value={(row) => row.spent} color={() => 'var(--series-2)'} /> : <p className="text-[13px] text-muted">No tokens spent in these days.</p>}
          <p className="mt-3 text-xs text-muted">{formatNumber(economy.gifts28)} treat gifts sent · {formatNumber(economy.showcaseOwners)} Buddy Showcase owners (all time)</p>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        <EconomyTable title="Weekly bonus claims" note="By the week the bonus is for" head={<><Th>Week of</Th><Th align="right">Claims</Th><Th align="right">+30</Th><Th align="right">+20</Th><Th align="right">+10</Th></>}>
          {economy.weeklyBonus.map((week) => (
            <tr key={week.weekStart}>
              <Td className="whitespace-nowrap">{formatShortDay(week.weekStart)}</Td>
              <Td align="right">{formatNumber(week.claims)}</Td>
              <Td align="right">{formatNumber(week.gold)}</Td>
              <Td align="right">{formatNumber(week.silver)}</Td>
              <Td align="right">{formatNumber(week.bronze)}</Td>
            </tr>
          ))}
        </EconomyTable>
        <EconomyTable title="Weekly drops bought" note="By the week they were bought" head={<><Th>Week of</Th><Th align="right">Bought</Th></>}>
          {economy.drops.map((week) => (
            <tr key={week.weekStart}>
              <Td className="whitespace-nowrap">{formatShortDay(week.weekStart)}{week.weekStart === thisWeek && <span className="ml-1 text-muted">(this week)</span>}</Td>
              <Td align="right">{formatNumber(week.bought)}</Td>
            </tr>
          ))}
        </EconomyTable>
        <EconomyTable title="Freezes bought vs used" note="Streak freezes, 28 days" head={<><Th>Freezes</Th><Th align="right">Count</Th></>}>
          <tr><Td>Bought</Td><Td align="right">{formatNumber(freezes.bought28)}</Td></tr>
          <tr><Td>Used</Td><Td align="right">{formatNumber(freezes.used28)}</Td></tr>
        </EconomyTable>
        <EconomyTable
          title="Capped check-in days"
          note={capFrom > economy.since ? `The cap counts from ${formatDate(capFrom)}` : '28 days'}
          head={<><Th>Student-days</Th><Th align="right">Count</Th></>}
        >
          <tr><Td>Over {perDay} check-ins</Td><Td align="right">{formatNumber(economy.cappedDays28)}</Td></tr>
        </EconomyTable>
      </div>

      <p className="mb-3 text-[13px] font-medium text-ink">Rewards on sale</p>
      {economy.rewards.length ? (
        <BarList rows={economy.rewards} label={(row) => row.name} value={(row) => row.redemptions} detail={(row) => `${formatNumber(row.tokenCost)} tokens`} />
      ) : <p className="text-[13px] text-muted">No rewards are on sale.</p>}
      <p className="mt-3 text-xs text-muted">Retired rewards: {formatNumber(retired.count)}, refunded {formatNumber(retired.refundedTokens)} tokens</p>
    </Card>
  );
}

/** Students whose last 14 days look like token farming. It names them, so administrators only. */
function TokenFlagsCard() {
  const navigate = useNavigate();
  const { data, error, loading } = useApi<TokenFlags>('/users/token-flags');
  const limits = data?.limits;
  return (
    <Card
      title="Token flags"
      subtitle={data && limits
        ? `${formatDate(data.from)} – ${formatDate(data.to)}: a day over ${limits.dayTokens} tokens (without streak, refund and weekly bonus payouts), a day over ${limits.dayCheckIns} check-ins, over ${limits.weekHabits} habits starting in one week, or ${limits.giftsSent} or more treat gifts sent. Administrators only.`
        : 'The last 14 days. Administrators only.'}
      bodyClassName="!px-0 !pb-0"
    >
      {error && <div className="px-5 pb-5"><Alert tone="critical" title="Could not load token flags">{error}</Alert></div>}
      {!data ? (loading && <Spinner />) : data.items.length ? (
        <Table>
          <thead>
            <tr><Th>Student</Th><Th>Flags</Th></tr>
          </thead>
          <tbody>
            {data.items.map((item) => (
              <tr key={item.userId} className="cursor-pointer hover:bg-surface-hover" onClick={() => navigate(`/users/${item.userId}`)}>
                <Td className="whitespace-nowrap font-medium">
                  <Link to={`/users/${item.userId}`} className="hover:underline" onClick={(event) => event.stopPropagation()}>{item.name}</Link>
                </Td>
                <Td>
                  <ul className="flex flex-col gap-1">
                    {item.flags.map((flag) => (
                      <li key={flag.type} className="flex flex-wrap items-center gap-2">
                        <Badge tone="warning">{FLAG_LABELS[flag.type] ?? flag.type}</Badge>
                        <span className="text-ink-2">{flag.detail}</span>
                      </li>
                    ))}
                  </ul>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      ) : <EmptyState title="No students flagged">No student passed a threshold in these days.</EmptyState>}
    </Card>
  );
}

export function AnalyticsPage() {
  const toast = useToast();
  const { can } = useAuth();
  // Token flags name students: only for those who may open their accounts (administrators).
  const showFlags = can('users:view');
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
              {showFlags && ' Only the Token flags card names students, and only administrators see it.'}
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

          <TokenEconomyCard economy={data.economy} />

          <div className={cx('grid grid-cols-1 gap-5', showFlags && 'lg:grid-cols-2')}>
            {showFlags && <TokenFlagsCard />}
            <Card title="Achievements unlocked" subtitle="Share of students who earned each achievement">
              <BarList rows={data.achievements} max={1} label={(row) => row.name} value={(row) => row.share} format={(value) => formatPercent(value)} />
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
