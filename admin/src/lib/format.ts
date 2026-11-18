import type { BillingInterval, PackageTerms, PriceUnit, Seats } from '@/api/types';

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});
const numberFormat = new Intl.NumberFormat('en-US');
const relativeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

export function formatDate(value: string | null | undefined): string {
  return value ? dateFormat.format(new Date(value)) : '—';
}

export function formatDateTime(value: string | null | undefined): string {
  return value ? dateTimeFormat.format(new Date(value)) : '—';
}

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

export function formatRelative(value: string | null | undefined, now: number = Date.now()): string {
  if (!value) return '—';
  const seconds = Math.round((new Date(value).getTime() - now) / 1000);
  const unit = UNITS.find(([, size]) => Math.abs(seconds) >= size);
  if (!unit) return 'just now';
  return relativeFormat.format(Math.round(seconds / unit[1]), unit[0]);
}

export function formatSeats(seats: Seats): string {
  return seats.cap === null
    ? `${formatNumber(seats.used)} seats · no cap`
    : `${formatNumber(seats.used)} / ${formatNumber(seats.cap)} seats`;
}

export function seatRatio(seats: Seats): number | null {
  if (seats.cap === null || seats.cap === 0) return seats.cap === 0 && seats.used > 0 ? 1 : null;
  return Math.min(seats.used / seats.cap, 1);
}

export function initials(name: string, email = ''): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return email.slice(0, 1).toUpperCase();
}

export function humanize(value: string): string {
  const text = value.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const wholeMoney = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const centsMoney = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "৳1,500" or "৳1,500.50" for BDT; other currencies keep their code ("USD 20"). */
export function formatMoney(amount: string, currency: string): string {
  const number = Number(amount);
  const value = (Number.isInteger(number) ? wholeMoney : centsMoney).format(number);
  return currency === 'BDT' ? `৳${value}` : `${currency} ${value}`;
}

const UNIT_TEXT: Record<PriceUnit, string> = { per_seat: 'per seat', per_institution: 'per institution', flat: '' };
const INTERVAL_TEXT: Record<Exclude<BillingInterval, 'free'>, string> = { monthly: 'month', yearly: 'year' };

/** "per seat / month", "per institution / year", "/ month" for a flat price, "" when free. */
export function formatCadence(unit: PriceUnit, interval: BillingInterval): string {
  if (interval === 'free') return '';
  return [UNIT_TEXT[unit], `/ ${INTERVAL_TEXT[interval]}`].filter(Boolean).join(' ');
}

export type PriceTerms = Pick<PackageTerms, 'price' | 'currency' | 'billing_interval' | 'price_unit'>;

/** "৳1,500 per seat / month", or "Free". */
export function formatPrice(terms: PriceTerms): string {
  if (terms.billing_interval === 'free') return 'Free';
  return `${formatMoney(terms.price, terms.currency)} ${formatCadence(terms.price_unit, terms.billing_interval)}`;
}
