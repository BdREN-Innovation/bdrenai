import type { BillingSubscription, PaymentStatus, PurchaseKind, Quote, Role } from '@/api/types';
import type { BillingSearch, Offer, PaymentResult, PortalPayment } from '../types';
import { addDays, dayOf, formatDay } from '@/features/billing/labels';

/** Who may open Billing: the backend's portal billing views allow the institution's owners and admins. */
export const BILLING_ROLES: ReadonlySet<Role> = new Set<Role>(['owner', 'admin']);

/** Whether a role in the institution may pay for packages and give up a pending bKash payment. */
export const canPay = (role: Role | undefined): boolean => role !== undefined && BILLING_ROLES.has(role);

/** A payment closed here can still be paid on a bKash page the payer already has open; the backend then records it. */
export const LATE_PAY = 'If it is still paid on bKash later, the payment is recorded and BdREN refunds it.';

/** A failed payment may still have taken money (bKash taking a different amount fails it). */
export const TAKEN = 'If bKash took money for it, BdREN refunds it.';

export const LIVE_STATUSES: ReadonlySet<BillingSubscription['status']> = new Set<BillingSubscription['status']>(['active', 'trial', 'past_due']);

export const RECEIPT_STATUSES: ReadonlySet<PaymentStatus> = new Set<PaymentStatus>(['completed', 'partially_refunded', 'refunded']);

/** Waits between re-reads while a returned payment is still pending; polling stops after the last one. */
export const POLL_DELAYS = [2_000, 4_000, 8_000, 15_000, 30_000] as const;

/** From this many days before a period ends, the dashboard asks to renew. */
export const RENEW_SOON_DAYS = 14;

const RESULTS: readonly PaymentResult[] = ['success', 'failed', 'cancelled', 'pending'];

/**
 * Search params of the Billing page, as the bKash callback sends them: `?payment=<id>&result=…`. Both keys are always
 * returned so an unknown value never leaks through from the root route's raw search.
 */
export function validateBillingSearch(search: Record<string, unknown>): BillingSearch {
  const result = RESULTS.find((value) => value === search.result);
  const payment = typeof search.payment === 'string' && search.payment.length > 0 && search.payment.length <= 64 ? search.payment : undefined;
  return { payment, result };
}

/** What a payment's current status means for the result banner. */
export function resultOf(status: PaymentStatus): PaymentResult {
  if (RECEIPT_STATUSES.has(status)) return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'pending') return 'pending';
  return 'failed';
}

/**
 * bKash's checkout page lives on bkash.com (`payment.bkash.com`, sandbox `sandbox.payment.bkash.com`); its API on bka.sh.
 * The backend passes bKash's `bkashURL` through unchanged, so the console follows only an https address on those domains.
 */
const BKASH_DOMAINS = ['bkash.com', 'bka.sh'];

export function isBkashUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  return url.protocol === 'https:' && !url.username && !url.password && BKASH_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/** Leaves the console for bKash's checkout page (an object so tests can watch it). */
export const browser = {
  open(url: string): void {
    window.location.assign(url);
  },
};

/** "30 Nov 2026": a period's last day, from the API's exclusive end. */
export const lastDayText = (end: string): string => formatDay(addDays(dayOf(end), -1));

/** "18 Nov 2026 – 17 Dec 2026": the period's first and last day (the API's end is exclusive). */
export function periodText(start: string, end: string): string {
  return `${formatDay(dayOf(start))} – ${lastDayText(end)}`;
}

/**
 * Whether a payment opened by checkout charges what the admin confirmed: the same amount, currency and number of
 * periods, over the same days. The server quotes again at checkout, so a new package version or a moved renewal
 * start since the page loaded shows up here.
 */
export function matchesQuote(payment: PortalPayment, quote: Quote): boolean {
  const { period_start: start, period_end: end } = payment;
  return (
    Number(payment.amount) === Number(quote.amount) &&
    payment.currency === quote.currency &&
    payment.periods === quote.periods &&
    start !== null &&
    end !== null &&
    dayOf(start) === dayOf(quote.period_start) &&
    dayOf(end) === dayOf(quote.period_end)
  );
}

/** The quote as the created payment charges it, so the dialog can show what bKash will ask for. */
export function chargedQuote(payment: PortalPayment, quote: Quote): Quote {
  return {
    ...quote,
    amount: payment.amount,
    currency: payment.currency,
    periods: payment.periods,
    period_start: payment.period_start ?? quote.period_start,
    period_end: payment.period_end ?? quote.period_end,
  };
}

/** The renew offer that pays the subscription's next period (into its scheduled package when one is set). */
export const renewOfferFor = (subscription: BillingSubscription, offers: Offer[]): Offer | undefined =>
  offers.find((offer) => offer.kind === 'renew' && (offer.package.id === subscription.package.id || offer.package.id === subscription.scheduled_package?.id));

export function daysLeft(expiresAt: string | null, now: number = Date.now()): number | null {
  if (!expiresAt) return null;
  return Math.floor((new Date(expiresAt).getTime() - now) / 86_400_000);
}

export const KIND_TEXT: Record<PurchaseKind, string> = { renew: 'Renewal', upgrade: 'Upgrade', new: 'New package' };

export const OFFER_GROUPS: { kind: PurchaseKind; title: string; description: string }[] = [
  { kind: 'renew', title: 'Renew', description: 'Pay for the next period of a package your institution has now.' },
  { kind: 'upgrade', title: 'Upgrade', description: 'Move to a bigger package. You pay its full price and a new period starts on payment.' },
  { kind: 'new', title: 'Choose a package', description: 'Your institution has no active package. Pick one to start.' },
];

/** The live subscription an upgrade replaces: one whose apps the offered package covers. */
export function replacedBy(offer: Offer, subscriptions: BillingSubscription[]): BillingSubscription | undefined {
  const apps = new Set(offer.package.apps.map((app) => app.slug));
  return subscriptions.find((sub) => LIVE_STATUSES.has(sub.status) && sub.apps.length > 0 && sub.apps.every((app) => apps.has(app.slug)));
}

/** When the paid period starts and what happens to the current one (docs/BILLING_API.md, "Pricing and periods"). */
export function timing(offer: Offer, current: string | undefined, now: number = Date.now()): string {
  const { period_start: start, period_end: end } = offer.quote;
  const ifToday = `${periodText(start, end)} if you pay today`;
  if (offer.kind === 'renew') {
    if (new Date(start).getTime() > now + 60_000) {
      return `The next period runs ${periodText(start, end)}, straight after the current one ends. Nothing changes until then.`;
    }
    return `The current period has ended. The next period starts when the payment completes: ${ifToday}.`;
  }
  if (offer.kind === 'upgrade') {
    const what = current ? `your current ${current} period` : 'your current period';
    return `You pay the full price. A new period starts when the payment completes (${ifToday}), and ${what} ends then.`;
  }
  return `The period starts when the payment completes: ${ifToday}.`;
}

/** A bKash payment still waiting for bKash, which the institution may abandon (docs/BILLING_API.md, bKash flow step 5). */
export const isAbandonable = (payment: PortalPayment): boolean => payment.status === 'pending' && payment.method === 'bkash';

/**
 * What the backend appends to `notes` (`NOT_APPLIED_NOTE` in apps/billing/services.py) when a bKash payment settles
 * after a newer purchase of the same apps: recorded as paid, but no subscription changed, and BdREN refunds it.
 */
export const isUnapplied = (payment: PortalPayment): boolean => RECEIPT_STATUSES.has(payment.status) && payment.applied === false;

export const paymentAnchor = (id: string) => `payment-${id}`;

export const findPayment = (payments: PortalPayment[] | undefined, id: string | undefined) =>
  id ? payments?.find((payment) => payment.id === id) : undefined;
