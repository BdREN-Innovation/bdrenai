/** Date ranges for the usage pages, as calendar days (`YYYY-MM-DD`) in the zone the usage rollup counts days in. */

export type Preset = '7d' | '30d' | 'this_month' | 'last_month' | 'custom';

export interface DayRange {
  start: string;
  end: string;
}

export const USAGE_TIMEZONE = 'Asia/Dhaka';
export const MAX_RANGE_DAYS = 366;

export const PRESETS: { key: Preset; label: string }[] = [
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
  { key: 'custom', label: 'Custom' },
];

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function toDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  return toDay(new Date(toDate(day).getTime() + n * DAY_MS));
}

/** Today's calendar day in `timeZone`. */
export function todayIn(timeZone: string = USAGE_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Inclusive length of a range in days. */
export function rangeDays(range: DayRange): number {
  return Math.round((toDate(range.end).getTime() - toDate(range.start).getTime()) / DAY_MS) + 1;
}

export function presetRange(preset: Exclude<Preset, 'custom'>, today: string): DayRange {
  if (preset === '7d') return { start: addDays(today, -6), end: today };
  if (preset === '30d') return { start: addDays(today, -29), end: today };
  const first = `${today.slice(0, 8)}01`;
  if (preset === 'this_month') return { start: first, end: today };
  const lastOfPrevious = addDays(first, -1);
  return { start: `${lastOfPrevious.slice(0, 8)}01`, end: lastOfPrevious };
}

/** Why a custom range can't be used, or null when it can. Mirrors the server's rules. */
export function rangeProblem(range: DayRange): string | null {
  if (!DAY_RE.test(range.start) || Number.isNaN(toDate(range.start).getTime())) return 'Choose a start date.';
  if (!DAY_RE.test(range.end) || Number.isNaN(toDate(range.end).getTime())) return 'Choose an end date.';
  if (range.start > range.end) return 'The start date must not be after the end date.';
  if (rangeDays(range) > MAX_RANGE_DAYS) return `Choose a range of at most ${MAX_RANGE_DAYS} days.`;
  return null;
}

/** `2026-11-18` → `18 Nov`; `withYear` adds the year. Calendar days are read as written, never shifted by time zone. */
export function formatDay(day: string | null, withYear = false): string {
  if (!day) return '—';
  return toDate(day).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** Whole number with thousands separators, or one decimal place for a fraction. */
export function formatAmount(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: Number.isInteger(n) ? 0 : 1 });
}
