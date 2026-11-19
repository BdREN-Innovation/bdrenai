import { useEffect, useState } from 'react';
import { CircleCheck, CircleHelp, CircleX, Clock, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { PaymentResult, PortalBilling, PortalPayment } from '../types';
import { IconButton } from '@/components/ui';
import { POLL_DELAYS, findPayment, resultOf } from './rules';
import { paymentFileUrl } from '../api';
import { cn } from '@/lib/cn';

export interface Returned {
  payment?: string;
}

interface BillingReads {
  data: PortalBilling | undefined;
  isError: boolean;
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}

/**
 * While the returned payment is still pending, re-reads the billing data with growing waits (`POLL_DELAYS`) until the
 * payment leaves pending or the waits run out. Returns true once polling has stopped with the payment still pending.
 */
function useConfirmation(billing: BillingReads, payment: PortalPayment | undefined): boolean {
  const [attempt, setAttempt] = useState(0);
  const waiting = payment?.status === 'pending';
  const { refetch, isFetching } = billing;

  useEffect(() => {
    if (!waiting || isFetching || attempt >= POLL_DELAYS.length) return;
    const timer = window.setTimeout(() => {
      void refetch().finally(() => setAttempt((count) => count + 1));
    }, POLL_DELAYS[attempt]);
    return () => window.clearTimeout(timer);
  }, [waiting, isFetching, attempt, refetch]);

  return waiting && attempt >= POLL_DELAYS.length;
}

/** What the banner shows: the payment's own outcome, or `checking` / `unknown` while it can't be read. */
type Outcome = PaymentResult | 'checking' | 'unknown';

const LOOK: Record<Outcome, { icon: LucideIcon; className: string; role: 'status' | 'alert' }> = {
  success: { icon: CircleCheck, className: 'bg-success-bg text-success-fg', role: 'status' },
  pending: { icon: Clock, className: 'bg-info-bg text-info-fg', role: 'status' },
  checking: { icon: Clock, className: 'bg-info-bg text-info-fg', role: 'status' },
  cancelled: { icon: CircleX, className: 'bg-neutral-bg text-neutral-fg', role: 'status' },
  unknown: { icon: CircleHelp, className: 'bg-neutral-bg text-neutral-fg', role: 'status' },
  failed: { icon: CircleX, className: 'bg-danger-bg text-danger-fg', role: 'alert' },
};

function texts(outcome: Outcome, payment: PortalPayment | undefined, stopped: boolean): { title: string; body?: string } {
  if (outcome === 'success') {
    return { title: payment?.receipt_number ? `Payment received, receipt ${payment.receipt_number}` : 'Payment received' };
  }
  if (outcome === 'cancelled') return { title: 'Payment cancelled, nothing was charged' };
  if (outcome === 'failed') return { title: 'Payment failed', body: payment?.failure_reason || 'bKash did not complete the payment.' };
  if (outcome === 'checking') return { title: 'Checking this payment…' };
  if (outcome === 'unknown') return { title: "We couldn't find this payment", body: 'Check Payments below for what your institution has paid.' };
  return {
    title: 'Payment is being confirmed',
    body: stopped
      ? "bKash hasn't confirmed it yet. It is checked again automatically within a few minutes; reload this page later to see it."
      : 'Checking with bKash…',
  };
}

function outcomeOf(billing: BillingReads, returned: Returned, payment: PortalPayment | undefined): Outcome {
  if (payment) return resultOf(payment.status);
  if (returned.payment && !billing.data && !billing.isError) return 'checking';
  return 'unknown';
}

interface PaymentBannerProps {
  slug: string;
  returned: Returned;
  billing: BillingReads;
  onDismiss: () => void;
}

/**
 * The outcome of a bKash payment after its callback sent the browser back here (`?payment=&result=`). The outcome is
 * read from the payment's own record, never from the URL's `result`, which anyone can edit.
 */
export function PaymentBanner({ slug, returned, billing, onDismiss }: PaymentBannerProps) {
  const payment = findPayment(billing.data?.payments, returned.payment);
  const stopped = useConfirmation(billing, payment);
  const outcome = outcomeOf(billing, returned, payment);
  const look = LOOK[outcome];
  const text = texts(outcome, payment, stopped);
  const Icon = look.icon;
  const receipt = outcome === 'success' && payment?.receipt_number ? paymentFileUrl(slug, payment.id, 'receipt') : null;

  return (
    <div role={look.role} aria-label="Payment result" className={cn('flex items-start gap-3 rounded-xl p-4 text-[13px]', look.className)}>
      <Icon aria-hidden="true" size={18} className="mt-0.5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="font-semibold">{text.title}</p>
        {text.body ? <p>{text.body}</p> : null}
        {receipt ? (
          <a href={receipt} target="_blank" rel="noopener noreferrer" className="self-start font-semibold underline">
            View receipt <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
      <IconButton icon={X} label="Dismiss" size="sm" onClick={onDismiss} className="-my-1 text-current hover:text-current" />
    </div>
  );
}
