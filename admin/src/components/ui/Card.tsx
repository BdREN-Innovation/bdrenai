import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Seats } from '@/api/types';
import { formatNumber, seatRatio } from '@/lib/format';
import { cn } from '@/lib/cn';

interface CardProps {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Card({ title, description, action, children, className, bodyClassName }: CardProps) {
  const headingId = title ? `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}` : undefined;
  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col rounded-xl border border-stroke bg-surface', className)}>
      {title ? (
        <div className="flex items-start gap-3 px-5 pt-5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={headingId} className="text-[15px] font-semibold text-ink">
              {title}
            </h2>
            {description ? <p className="text-[13px] text-ink-muted">{description}</p> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={cn('flex flex-col gap-4 p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

interface KpiTileProps {
  label: string;
  value: number | string;
  detail?: ReactNode;
  icon: LucideIcon;
}

export function KpiTile({ label, value, detail, icon: Icon }: KpiTileProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-stroke bg-surface p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-lg bg-brand-tint text-brand-ink">
          <Icon size={16} />
        </span>
        <span className="text-xs font-medium text-ink-muted">{label}</span>
      </div>
      <span className="tabular text-2xl leading-none font-bold tracking-tight text-ink">
        {typeof value === 'number' ? formatNumber(value) : value}
      </span>
      {detail ? <span className="text-xs text-ink-muted">{detail}</span> : null}
    </div>
  );
}

/** Pill meter of seats used against the cap; teal under 90%, warning from 90%, danger when full. */
export function SeatMeter({ seats, compact = false }: { seats: Seats; compact?: boolean }) {
  const ratio = seatRatio(seats);
  const percent = ratio === null ? 0 : Math.round(ratio * 100);
  const tone = ratio === null || ratio < 0.9 ? 'bg-chart-1' : ratio < 1 ? 'bg-chart-2' : 'bg-danger-fg';
  const text =
    seats.cap === null
      ? `${formatNumber(seats.used)} seats used, no cap`
      : `${formatNumber(seats.used)} of ${formatNumber(seats.cap)} seats used`;
  return (
    <div className={cn('flex flex-col gap-1.5', compact ? 'min-w-28' : 'w-full')}>
      <div
        role="meter"
        aria-label="Seats"
        aria-valuemin={0}
        aria-valuemax={seats.cap ?? seats.used}
        aria-valuenow={seats.used}
        aria-valuetext={text}
        className={cn('w-full overflow-hidden rounded-full bg-track', compact ? 'h-1.5' : 'h-2')}
      >
        {ratio !== null ? <div className={cn('h-full rounded-full', tone)} style={{ width: `${percent}%` }} /> : null}
      </div>
      <span className="tabular text-xs text-ink-muted">
        {seats.cap === null ? `${formatNumber(seats.used)} · no cap` : `${formatNumber(seats.used)} / ${formatNumber(seats.cap)}`}
      </span>
    </div>
  );
}
