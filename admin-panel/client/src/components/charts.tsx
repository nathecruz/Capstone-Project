import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, BarChart3, Table2 } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { change, formatNumber, formatPercent } from '../lib/format';
import { Card, cx, IconButton, Table, Td, Th } from './ui';

// Colors -------------------------------------------------------------------------------

export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)', 'var(--series-7)', 'var(--series-8)'];

/** Fixed categorical order: the slot follows the entity; a 9th+ entity folds into "Other" gray. */
export function seriesColor(slot: number) {
  return slot >= 0 && slot < SERIES.length ? SERIES[slot] : 'var(--series-other)';
}

// One-hue ramp; each theme defines its own steps so "more" always reads as more contrast.
const SEQUENTIAL = ['var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)', 'var(--heat-5)'];
const SEQUENTIAL_INK = ['var(--heat-ink-1)', 'var(--heat-ink-2)', 'var(--heat-ink-3)', 'var(--heat-ink-4)', 'var(--heat-ink-5)'];

function sequentialStep(value: number, max: number) {
  return Math.max(0, Math.min(SEQUENTIAL.length - 1, Math.floor((value / max) * SEQUENTIAL.length - 1e-9)));
}

export function sequentialColor(value: number, max: number) {
  if (!value || !max) return 'var(--seq-empty)';
  return SEQUENTIAL[sequentialStep(value, max)];
}

/** Label color for text set inside a sequential cell (white or ink by the fill's luminance). */
export function sequentialInk(value: number, max: number) {
  if (!value || !max) return 'var(--ink)';
  return SEQUENTIAL_INK[sequentialStep(value, max)];
}

const AXIS_TICK = { fill: 'var(--muted)', fontSize: 12 };

// Stat tile ----------------------------------------------------------------------------

export function StatTile({ label, value, previous, current, format = 'number', upIsGood = true, hint, period }: {
  label: string;
  value: ReactNode;
  current?: number | null;
  previous?: number | null;
  format?: 'number' | 'percent';
  upIsGood?: boolean;
  hint?: ReactNode;
  period?: string;
}) {
  let delta: ReactNode = null;
  if (previous !== undefined && current !== undefined && current !== null && previous !== null) {
    const diff = format === 'percent' ? current - previous : change(current, previous);
    if (diff !== null) {
      const up = diff > 0;
      const flat = Math.abs(diff) < 0.0005;
      const good = flat ? null : up === upIsGood;
      const text = format === 'percent' ? `${Math.abs(diff * 100).toFixed(1)} pts` : formatPercent(Math.abs(diff), Math.abs(diff) < 0.1 ? 1 : 0);
      delta = (
        <span className={cx('inline-flex items-center gap-0.5 text-xs font-medium', good === null ? 'text-muted' : good ? 'text-good-ink' : 'text-critical-ink')}>
          {!flat && (up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
          {flat ? 'No change' : `${up ? '+' : '−'}${text}`}
          {period && <span className="font-normal text-muted">&nbsp;vs {period}</span>}
        </span>
      );
    } else if (previous === 0 && current > 0) {
      delta = <span className="text-xs text-muted">New this period</span>;
    }
  }
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5 shadow-card">
      <p className="text-[13px] text-ink-2">{label}</p>
      <p className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-ink">{value}</p>
      <div className="mt-1 min-h-4">{delta ?? (hint && <span className="text-xs text-muted">{hint}</span>)}</div>
    </div>
  );
}

// Chart card with table view -----------------------------------------------------------------

export interface Column<T> {
  key: string;
  label: string;
  align?: 'left' | 'right';
  render: (row: T) => ReactNode;
}

export function ChartCard<T>({ title, subtitle, children, rows, columns, actions, className }: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  rows: T[];
  columns: Column<T>[];
  actions?: ReactNode;
  className?: string;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <Card
      title={title}
      subtitle={subtitle}
      className={className}
      actions={(
        <>
          {actions}
          <IconButton label={view === 'chart' ? 'Show as table' : 'Show as chart'} onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
            {view === 'chart' ? <Table2 className="size-4" /> : <BarChart3 className="size-4" />}
          </IconButton>
        </>
      )}
    >
      {view === 'chart' ? children : (
        <div className="-mx-5 max-h-80 overflow-y-auto">
          <Table>
            <thead>
              <tr>{columns.map((column) => <Th key={column.key} align={column.align}>{column.label}</Th>)}</tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>{columns.map((column) => <Td key={column.key} align={column.align}>{column.render(row)}</Td>)}</tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}

// Tooltip ----------------------------------------------------------------------------------

type TooltipPayload = ReadonlyArray<{ value?: unknown; name?: unknown; color?: string; payload?: Record<string, unknown> }>;

function ChartTooltip({ active, payload, label, formatLabel, formatValue, seriesLabel }: {
  active?: boolean;
  payload?: TooltipPayload;
  label?: unknown;
  formatLabel?: (label: string) => string;
  formatValue: (value: number) => string;
  seriesLabel: string;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px] shadow-pop">
      <p className="mb-1 text-xs text-muted">{formatLabel ? formatLabel(String(label)) : String(label)}</p>
      <div className="flex items-center gap-2">
        <span className="h-0.5 w-3 rounded-full" style={{ background: item.color ?? 'var(--series-1)' }} aria-hidden />
        <span className="font-semibold text-ink tabular">{formatValue(Number(item.value ?? 0))}</span>
        <span className="text-ink-2">{seriesLabel}</span>
      </div>
    </div>
  );
}

// Trend (area) chart -------------------------------------------------------------------------

export function TrendChart<T extends Record<string, unknown>>({ data, xKey, yKey, seriesLabel, formatX, formatValue = (value) => formatNumber(value), percent = false, height = 240 }: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  seriesLabel: string;
  formatX: (value: string) => string;
  formatValue?: (value: number) => string;
  percent?: boolean;
  height?: number;
}) {
  const last = useMemo(() => [...data].reverse().find((row) => row[yKey] !== null && row[yKey] !== undefined), [data, yKey]);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 16, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={xKey as string} tickFormatter={formatX} tick={AXIS_TICK} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} minTickGap={28} />
          <YAxis
            allowDecimals={percent}
            width={percent ? 44 : 36}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            domain={percent ? [0, 1] : [0, 'auto']}
            tickFormatter={(value: number) => (percent ? formatPercent(value) : formatNumber(value))}
          />
          <Tooltip
            cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
            content={(props) => <ChartTooltip {...(props as object)} formatLabel={formatX} formatValue={formatValue} seriesLabel={seriesLabel} />}
          />
          <Area
            type="linear"
            dataKey={yKey as string}
            stroke="var(--series-1)"
            strokeWidth={2}
            fill="var(--series-1)"
            fillOpacity={0.1}
            connectNulls
            dot={(props: { cx?: number; cy?: number; index?: number }) => {
              // End-dot marker on the latest value, so even a single data point is visible.
              if (props.index === undefined || data[props.index] !== last || props.cx === undefined || props.cy === undefined) return <g key={props.index} />;
              return <circle key={props.index} cx={props.cx} cy={props.cy} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />;
            }}
            activeDot={{ r: 4, fill: 'var(--series-1)', stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          >
            <LabelList
              dataKey={yKey as string}
              content={(props) => {
                const { x, y, index } = props as { x?: number; y?: number; index?: number };
                if (index === undefined || data[index] !== last || x === undefined || y === undefined) return null;
                return (
                  <text x={Number(x)} y={Number(y) - 8} textAnchor="end" fontSize={12} fontWeight={600} fill="var(--ink)">
                    {formatValue(Number(last?.[yKey] ?? 0))}
                  </text>
                );
              }}
            />
          </Area>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// Column chart --------------------------------------------------------------------------------

export function ColumnChart<T extends Record<string, unknown>>({ data, xKey, yKey, seriesLabel, formatValue = (value) => formatNumber(value), formatX = (value) => value, height = 220, labels = true }: {
  data: T[];
  xKey: keyof T & string;
  yKey: keyof T & string;
  seriesLabel: string;
  formatValue?: (value: number) => string;
  formatX?: (value: string) => string;
  height?: number;
  labels?: boolean;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey={xKey as string} tickFormatter={formatX} tick={AXIS_TICK} axisLine={{ stroke: 'var(--axis)' }} tickLine={false} interval={data.length > 12 ? 'preserveStartEnd' : 0} minTickGap={16} />
          <YAxis allowDecimals={false} width={36} tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={(value: number) => formatNumber(value)} />
          <Tooltip
            cursor={{ fill: 'var(--surface-hover)' }}
            content={(props) => <ChartTooltip {...(props as object)} formatLabel={formatX} formatValue={formatValue} seriesLabel={seriesLabel} />}
          />
          <Bar dataKey={yKey as string} fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false}>
            {labels && (
              <LabelList
                dataKey={yKey as string}
                position="top"
                fontSize={12}
                fill="var(--ink-2)"
                formatter={(value: unknown) => (Number(value) ? formatValue(Number(value)) : '')}
              />
            )}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// Horizontal bars (HTML, so long labels wrap instead of clipping) -----------------------------------

export function BarList<T>({ rows, label, value, max, format = (valueNumber) => formatNumber(valueNumber), detail, color }: {
  rows: T[];
  label: (row: T) => ReactNode;
  value: (row: T) => number | null;
  max?: number;
  format?: (value: number) => string;
  detail?: (row: T) => ReactNode;
  color?: (row: T) => string;
}) {
  const top = max ?? Math.max(1, ...rows.map((row) => value(row) ?? 0));
  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row, index) => {
        const amount = value(row);
        const width = amount ? Math.max(1.5, (amount / top) * 100) : 0;
        return (
          <li key={index} className="group" title={amount === null ? 'No data' : format(amount)}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 truncate text-ink">{label(row)}</span>
              <span className="shrink-0 font-semibold text-ink tabular">{amount === null ? '—' : format(amount)}{detail && <span className="ml-2 font-normal text-muted">{detail(row)}</span>}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full transition-[width] group-hover:brightness-110" style={{ width: `${width}%`, background: color ? color(row) : 'var(--series-1)' }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Funnel -------------------------------------------------------------------------------------

export function Funnel({ stages }: { stages: { stage: string; students: number }[] }) {
  const first = stages[0]?.students || 0;
  return (
    <ol className="flex flex-col gap-3">
      {stages.map((stage, index) => {
        const share = first ? stage.students / first : 0;
        const previous = index > 0 ? stages[index - 1].students : null;
        const step = previous ? stage.students / previous : null;
        return (
          <li key={stage.stage}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-[13px]">
              <span className="text-ink">{stage.stage}</span>
              <span className="tabular">
                <span className="font-semibold text-ink">{formatNumber(stage.students)}</span>
                <span className="ml-2 text-muted">{index === 0 ? '100%' : `${formatPercent(share)} of registered`}</span>
              </span>
            </div>
            <div className="h-6 w-full rounded-md bg-surface-2">
              <div className="h-full rounded-md" style={{ width: `${Math.max(share * 100, stage.students ? 2 : 0)}%`, background: 'var(--series-1)', opacity: 1 - index * 0.14 }} />
            </div>
            {step !== null && <p className="mt-1 text-xs text-muted">{formatPercent(step)} continued from the previous step</p>}
          </li>
        );
      })}
    </ol>
  );
}

// Heatmap (weekday x hour) -------------------------------------------------------------------------

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? 'AM' : 'PM'}`;

export function ActivityHeatmap({ cells, unit = 'sign-ins' }: { cells: { dow: number; hour: number; count: number }[]; unit?: string }) {
  const grid = useMemo(() => {
    const values = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
    for (const cell of cells) values[cell.dow - 1][cell.hour] += cell.count;
    return values;
  }, [cells]);
  const max = Math.max(0, ...grid.flat());
  const [hover, setHover] = useState<{ dow: number; hour: number } | null>(null);
  const total = grid.flat().reduce((sum, value) => sum + value, 0);
  const peak = useMemo(() => {
    let best = { dow: 0, hour: 0, count: 0 };
    grid.forEach((row, dow) => row.forEach((count, hour) => { if (count > best.count) best = { dow, hour, count }; }));
    return best;
  }, [grid]);

  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[520px]" role="img" aria-label={total ? `Busiest time: ${WEEKDAYS[peak.dow]} around ${hourLabel(peak.hour)} with ${peak.count} ${unit}.` : `No ${unit} in this period.`}>
          <div className="grid gap-[2px]" style={{ gridTemplateColumns: '36px repeat(24, minmax(0, 1fr))' }}>
            {grid.map((row, dow) => (
              <div key={dow} className="contents">
                <span className="pr-2 text-right text-xs leading-5 text-muted">{WEEKDAYS[dow]}</span>
                {row.map((count, hour) => (
                  <span
                    key={hour}
                    className={cx('heat-cell h-5 rounded-[3px]', hover?.dow === dow && hover.hour === hour && 'ring-2 ring-ink')}
                    style={{ background: sequentialColor(count, max) }}
                    onMouseEnter={() => setHover({ dow, hour })}
                    onMouseLeave={() => setHover(null)}
                  />
                ))}
              </div>
            ))}
            <span />
            {Array.from({ length: 24 }, (_, hour) => (
              <span key={hour} className="whitespace-nowrap text-[10px] text-muted">{hour % 6 === 0 ? `${hour % 12 === 0 ? 12 : hour % 12}${hour < 12 ? 'a' : 'p'}` : ''}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
        <span className="min-h-4 text-ink-2">
          {hover
            ? <><strong className="text-ink tabular">{grid[hover.dow][hover.hour]}</strong> {unit} · {WEEKDAYS[hover.dow]} {hourLabel(hover.hour)}–{hourLabel((hover.hour + 1) % 24)}</>
            : total ? <>Busiest: <strong className="text-ink">{WEEKDAYS[peak.dow]} {hourLabel(peak.hour)}</strong> ({peak.count} {unit})</> : `No ${unit} yet`}
        </span>
        <span className="flex items-center gap-1.5">
          Fewer
          {['var(--seq-empty)', ...SEQUENTIAL].map((color) => <span key={color} className="size-3 rounded-[3px]" style={{ background: color }} />)}
          More
        </span>
      </div>
    </div>
  );
}

export function heatmapRows(cells: { dow: number; hour: number; count: number }[]) {
  return [...cells].sort((a, b) => b.count - a.count).map((cell) => ({ when: `${WEEKDAYS[cell.dow - 1]} ${hourLabel(cell.hour)}`, count: cell.count }));
}

// Cohort retention table ------------------------------------------------------------------------------

export function CohortTable({ cohorts, threshold, formatWeek }: {
  cohorts: { week: string; size: number | null; suppressed: boolean; retention: (number | null)[] }[];
  threshold: number;
  formatWeek: (week: string) => string;
}) {
  const weeks = Math.max(1, ...cohorts.map((cohort) => cohort.retention.length));
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full border-separate border-spacing-[2px] px-4 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left font-medium text-muted">Joined week of</th>
            <th scope="col" className="px-2 py-1.5 text-right font-medium text-muted">Students</th>
            {Array.from({ length: weeks }, (_, index) => <th key={index} scope="col" className="px-2 py-1.5 text-center font-medium text-muted">Wk {index}</th>)}
          </tr>
        </thead>
        <tbody>
          {cohorts.map((cohort) => (
            <tr key={cohort.week}>
              <th scope="row" className="whitespace-nowrap px-2 py-1.5 text-left font-normal text-ink">{formatWeek(cohort.week)}</th>
              <td className="px-2 py-1.5 text-right text-ink tabular">{cohort.suppressed ? `<${threshold}` : cohort.size ?? 0}</td>
              {!cohort.suppressed && !cohort.size ? <td colSpan={weeks} className="px-2 py-1.5 text-xs text-muted">No new students this week</td> : Array.from({ length: weeks }, (_, index) => {
                const value = cohort.retention[index];
                const known = value !== null && value !== undefined;
                return (
                  <td
                    key={index}
                    className="heat-cell min-w-12 rounded-[3px] px-2 py-1.5 text-center tabular"
                    style={{ background: known ? sequentialColor(value, 1) : 'transparent', color: known ? sequentialInk(value, 1) : 'var(--ink)' }}
                  >
                    {index >= cohort.retention.length ? '' : cohort.suppressed ? '•' : known ? formatPercent(value) : '0%'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
