import type { Seats } from '@/api/types';
import { freeSeats, seatsFull } from './support';
import { formatNumber, seatRatio } from '@/lib/format';
import { cn } from '@/lib/cn';

/** Seats used against the cap, with how many are free and what counts. */
export function SeatSummary({ seats }: { seats: Seats }) {
  const free = freeSeats(seats);
  const ratio = seatRatio(seats);
  return (
    <section aria-label="Seats" className="flex min-w-60 flex-col gap-2 rounded-xl border border-stroke bg-surface px-4 py-3">
      <p className="tabular text-lg font-bold text-ink">
        {seats.cap === null ? `${formatNumber(seats.used)} seats in use` : `${formatNumber(seats.used)} / ${formatNumber(seats.cap)} seats`}
      </p>
      {seats.cap !== null && ratio !== null ? (
        <div
          role="meter"
          aria-label="Seats used"
          aria-valuemin={0}
          aria-valuemax={seats.cap}
          aria-valuenow={Math.min(seats.used, seats.cap)}
          className="h-2 w-full overflow-hidden rounded-full bg-track"
        >
          <div
            className={cn('h-full rounded-full', ratio < 0.9 ? 'bg-chart-1' : ratio < 1 ? 'bg-chart-2' : 'bg-danger-fg')}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </div>
      ) : null}
      <p className="text-xs text-ink-muted">
        {free === null
          ? 'Unlimited seats'
          : `${seatsFull(seats) ? 'No free seats' : `${formatNumber(free)} free`} · covered members and pending invitations count`}
      </p>
    </section>
  );
}
