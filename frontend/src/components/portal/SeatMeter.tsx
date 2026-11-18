import { Seats, seatsFull } from "@/lib/portal";

export function SeatMeter({ seats }: { seats: Seats }) {
  if (seats.cap === null) {
    return (
      <div className="card px-5 py-4" aria-label="Seats">
        <p className="font-display text-2xl font-bold">{seats.used} seats in use</p>
        <p className="text-sm text-muted">Unlimited seats</p>
      </div>
    );
  }
  const share = seats.cap === 0 ? 100 : Math.min(100, Math.round((seats.used / seats.cap) * 100));
  const full = seatsFull(seats);
  return (
    <div className="card min-w-[240px] px-5 py-4" aria-label="Seats">
      <p className="font-display text-2xl font-bold">
        {seats.used} / {seats.cap} seats
      </p>
      <div
        role="meter"
        aria-label="Seats used"
        aria-valuemin={0}
        aria-valuemax={seats.cap}
        aria-valuenow={Math.min(seats.used, seats.cap)}
        className="mt-2 h-2 overflow-hidden rounded-full bg-ground"
      >
        <span className={`block h-full rounded-full ${full ? "bg-brand-strong" : "bg-ink"}`} style={{ width: `${share}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {full ? "No free seats" : `${seats.cap - seats.used} free`} · active members and pending invitations count
      </p>
    </div>
  );
}
