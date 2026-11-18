import type { ReactNode } from 'react';
import type { UsageDay } from './types';
import { formatAmount, formatDay } from './period';
import { cn } from '@/lib/cn';

/** "▲ 12.5% vs the previous 7 days"; a null change means there was nothing to compare with. */
function Change({ change, period }: { change: number | null; period: string }) {
  if (change === null) return <p className="text-xs text-ink-muted">Nothing to compare with the previous {period}</p>;
  const word = change > 0 ? 'up' : change < 0 ? 'down' : 'no change';
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '■';
  return (
    <p className="text-xs text-ink-muted">
      <span aria-hidden="true" className={change < 0 ? 'text-danger-fg' : 'text-success-fg'}>
        {arrow}
      </span>{' '}
      <span className="sr-only">{word} </span>
      {formatAmount(Math.abs(change))}% vs the previous {period}
    </p>
  );
}

/** One key figure; `change` (a percent) compares it with the previous period. */
export function Kpi({ label, value, hint, change, period }: { label: string; value: string; hint?: string; change?: number | null; period?: string }) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-1.5 rounded-xl border border-stroke bg-surface p-4">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="tabular text-2xl leading-tight font-bold tracking-tight text-ink">{value}</p>
      {change !== undefined && period ? <Change change={change} period={period} /> : null}
      {hint ? <p className="text-xs text-ink-muted">{hint}</p> : null}
    </div>
  );
}

export function KpiRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {children}
    </section>
  );
}

const BAR = 10;

/** Daily usage as bars with the trailing 7-day average as a line, plus the same figures as a table for screen readers. */
export function DayBars({ days, title, average = true }: { days: UsageDay[]; title: string; average?: boolean }) {
  const top = Math.max(1, ...days.map((day) => Math.max(day.quantity, average ? day.quantity_avg_7d : 0)));
  const y = (value: number) => 100 - (value / top) * 96;
  const step = Math.max(1, Math.ceil(days.length / 7));
  const line = days.map((day, index) => `${index * BAR + BAR / 2},${y(day.quantity_avg_7d)}`).join(' ');
  const empty = days.every((day) => day.quantity === 0);

  return (
    <figure className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-5">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-3">
        <span className="text-[15px] font-semibold text-ink">{title}</span>
        {average ? (
          <span className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span aria-hidden="true" className="inline-block size-2.5 rounded-sm bg-chart-1" />
            Daily usage
            <span aria-hidden="true" className="ml-2 inline-block h-0.5 w-4 bg-chart-2" />
            7-day average
          </span>
        ) : null}
      </figcaption>
      {empty ? <p className="text-[13px] text-ink-muted">No usage in this period.</p> : null}
      <svg viewBox={`0 0 ${Math.max(days.length, 1) * BAR} 100`} preserveAspectRatio="none" aria-hidden="true" className="h-40 w-full">
        {days.map((day, index) => (
          <rect key={day.day} x={index * BAR + 1.5} y={y(day.quantity)} width={BAR - 3} height={100 - y(day.quantity)} rx={1} className="fill-chart-1">
            <title>{`${formatDay(day.day)}: ${formatAmount(day.quantity)}`}</title>
          </rect>
        ))}
        {average && !empty ? (
          <polyline points={line} fill="none" strokeWidth={2} vectorEffect="non-scaling-stroke" className="stroke-chart-2" />
        ) : null}
      </svg>
      <div aria-hidden="true" className="grid text-[11px] text-ink-muted" style={{ gridTemplateColumns: `repeat(${Math.max(days.length, 1)}, minmax(0, 1fr))` }}>
        {days.map((day, index) => (
          <span key={day.day} className="truncate text-center">
            {index % step === 0 ? formatDay(day.day) : ''}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            <th scope="col">Usage</th>
            {average ? <th scope="col">7-day average</th> : null}
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <th scope="row">{formatDay(day.day, true)}</th>
              <td>{formatAmount(day.quantity)}</td>
              {average ? <td>{formatAmount(day.quantity_avg_7d)}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** A 0..1 share as a small bar and a percentage. */
export function ShareBar({ share }: { share: number }) {
  const percent = Math.round(share * 1000) / 10;
  return (
    <span className="flex items-center gap-2">
      <span aria-hidden="true" className="block h-1.5 w-24 overflow-hidden rounded-full bg-track">
        <span className={cn('block h-full rounded-full bg-chart-1')} style={{ width: `${Math.min(100, percent)}%` }} />
      </span>
      <span className="tabular">{formatAmount(percent)}%</span>
    </span>
  );
}
