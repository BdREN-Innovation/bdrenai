import type {
  BkashMode,
  ManualMethod,
  PaymentKind,
  PaymentMethod,
  PaymentStatus,
  PaymentTab,
  SubscriptionStatus,
  UUID,
} from '@/api/types';
import type { Option } from '@/lib/labels';
import type { Tone } from '@/components/ui';
import { SUPERADMIN_ROOT } from '@/api/client';

export const METHOD_LABEL: Record<PaymentMethod, string> = {
  bkash: 'bKash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  cash: 'Cash',
  bkash_manual: 'bKash (manual)',
  other: 'Other',
};

export const MANUAL_METHODS: Option<ManualMethod>[] = [
  { value: 'bank_transfer', label: METHOD_LABEL.bank_transfer },
  { value: 'cheque', label: METHOD_LABEL.cheque },
  { value: 'cash', label: METHOD_LABEL.cash },
  { value: 'bkash_manual', label: METHOD_LABEL.bkash_manual },
  { value: 'other', label: METHOD_LABEL.other },
];

export const KIND_LABEL: Record<PaymentKind, string> = {
  new: 'New',
  renew: 'Renewal',
  upgrade: 'Upgrade',
  legacy: 'Earlier record',
};

export const PAYMENT_STATUSES: Option<PaymentStatus>[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'refunded', label: 'Refunded' },
  { value: 'partially_refunded', label: 'Partially refunded' },
];

export const SUBSCRIPTION_STATUSES: Option<SubscriptionStatus>[] = [
  { value: 'active', label: 'Active' },
  { value: 'trial', label: 'Trial' },
  { value: 'past_due', label: 'Past due' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'expired', label: 'Expired' },
];

export const PAYMENT_TABS: { value: PaymentTab; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'bkash', label: 'bKash' },
  { value: 'manual', label: 'Manual' },
  { value: 'attention', label: 'Awaiting action' },
];

export const BKASH_MODE: Record<BkashMode, { label: string; tone: Tone }> = {
  sandbox: { label: 'Sandbox', tone: 'warning' },
  live: { label: 'Live', tone: 'success' },
  off: { label: 'Off', tone: 'neutral' },
};

const paymentPath = (id: UUID, leaf: string) => `${SUPERADMIN_ROOT}/billing/payments/${encodeURIComponent(id)}/${leaf}/`;

export const receiptUrl = (id: UUID) => paymentPath(id, 'receipt');
export const attachmentUrl = (id: UUID) => paymentPath(id, 'attachment');

/** "1500" → "1500.00": the decimal string the API takes for amounts. */
export function toAmount(value: string): string {
  return Number(value).toFixed(2);
}

export function isAmount(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value.trim()) && Number(value) > 0;
}

/** What is still refundable: amount minus completed refunds, never below zero. */
export function remaining(amount: string, refunded: string): number {
  return Math.max(Math.round((Number(amount) - Number(refunded)) * 100) / 100, 0);
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Local calendar day as YYYY-MM-DD. */
export function isoDay(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The YYYY-MM-DD part of an API date or date-time, read in local time for date-times. */
export function dayOf(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : isoDay(new Date(value));
}

export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);
  return isoDay(new Date(year, month - 1, date + days));
}

export function daysBetween(from: string, to: string): number {
  const [a, b] = [from, to].map((day) => {
    const [year, month, date] = day.split('-').map(Number);
    return Date.UTC(year, month - 1, date);
  });
  return Math.round((b - a) / 86_400_000);
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "18 Nov 2026" for a YYYY-MM-DD day. */
export function formatDay(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  return dayFormat.format(new Date(Date.UTC(year, month - 1, date)));
}

/** "+12% vs previous period", "No change", or "None in the previous period". */
export function describeChange(current: number, previous: number): string {
  if (current === previous) return 'No change vs previous period';
  if (previous === 0) return 'None in the previous period';
  const percent = Math.round(((current - previous) / previous) * 100);
  if (percent === 0) return 'About the same as previous period';
  return `${percent > 0 ? '+' : '−'}${Math.abs(percent)}% vs previous period`;
}
