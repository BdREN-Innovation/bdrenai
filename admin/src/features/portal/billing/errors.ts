import { ApiError } from '@/api/client';
import { formatDateTime, formatMoney, formatNumber } from '@/lib/format';
import { portalErrorMessage } from '../errors';

export type BillingAction = 'checkout' | 'downgrade' | 'cancel';

const FALLBACK: Record<BillingAction, string> = {
  checkout: "We couldn't start the payment. Try again in a few minutes.",
  downgrade: "We couldn't schedule the switch. Try again in a few minutes.",
  cancel: "We couldn't cancel the scheduled switch. Try again in a few minutes.",
};

const NOT_OFFERED: Record<BillingAction, string> = {
  checkout: "This package isn't offered to your institution for this payment any more. Reload the page to see what you can pay for now.",
  downgrade: "This package can't replace your current one: it must cover the same apps and cost less per period.",
  cancel: 'This change is no longer possible. Reload the page and try again.',
};

const ERROR_TEXT: Record<string, string> = {
  bkash_unavailable: "Paying with bKash isn't available right now. Contact BdREN to pay another way.",
  package_unavailable: "This package can't be bought now. It may have been withdrawn; contact BdREN.",
  free_package: 'This package is free, so there is nothing to pay.',
  covered_by_bundle: 'Your institution already gets this app from its combined package. Renew or upgrade that package instead.',
  renewal_stopped:
    "This package is set not to renew, so its next renewal can't be changed. Paying its renewal on this page turns renewal back on; or contact BdREN.",
  institution_suspended: 'Your institution is suspended. Contact BdREN to restore access.',
  institution_inactive: 'This institution has been removed. Contact BdREN if this is a mistake.',
  not_institution_admin: "Only your institution's owners and admins can pay for or change packages.",
  bkash_error: "bKash couldn't start the payment. Nothing was charged; try again in a few minutes.",
  nothing_to_downgrade: 'Your institution has no active package for these apps, so there is nothing to switch from.',
  no_scheduled_change: 'No switch is scheduled any more, so there is nothing to cancel.',
  not_found: 'This package no longer exists. Reload the page to see the current options.',
  invalid: 'The request was incomplete. Reload the page and try again.',
  no_account: 'Your institution has no billing account yet. Contact BdREN.',
};

function seatsMessage(error: ApiError, packageName: string | undefined): string {
  const seats = error.body.seats;
  const name = packageName ?? 'This package';
  if (!seats || seats.cap === null) return `${name} allows fewer seats than your institution uses. Remove members first, or choose a bigger package.`;
  return `Your institution uses ${formatNumber(seats.used)} seats; ${name} allows ${formatNumber(seats.cap)}. Remove members until no more than ${formatNumber(seats.cap)} seats are in use, or choose a bigger package.`;
}

function inProgressMessage(error: ApiError): string {
  const payment = error.body.payment;
  if (!payment) return 'A bKash payment for your institution was started a few minutes ago. Finish it in the bKash window, or wait 10 minutes and try again.';
  const what = payment.package ? ` for ${payment.package.name}` : '';
  return `A bKash payment of ${formatMoney(payment.amount, payment.currency)}${what} was started at ${formatDateTime(payment.created_at)} and isn't finished. Finish it in the bKash window, or wait 10 minutes and try again.`;
}

/** One sentence an institution admin can act on, for an error from checkout, downgrade or cancelling a downgrade. */
export function billingErrorMessage(error: unknown, action: BillingAction, packageName?: string): string {
  if (!(error instanceof ApiError)) return portalErrorMessage(error, FALLBACK[action]);
  if (error.code === 'seats_exceed_package') return seatsMessage(error, packageName);
  if (error.code === 'checkout_in_progress') return inProgressMessage(error);
  if (error.code === 'package_not_offered') return NOT_OFFERED[action];
  return ERROR_TEXT[error.code] ?? error.body.message ?? FALLBACK[action];
}
