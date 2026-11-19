import { useEffect, useRef } from 'react';
import type { AbandonOutcome, AbandonResult, PortalPayment } from '../types';
import { Button, Dialog, Notice } from '@/components/ui';
import { LATE_PAY, RECEIPT_STATUSES, TAKEN, canPay } from './rules';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useAbandonPayment } from '../queries';
import { abandonErrorMessage } from './errors';
import { usePortalRole } from '../sidebar';
import { ApiError } from '@/api/client';
import { paymentFileUrl } from '../api';

/** The pending bKash payment to give up: a Payments row, or the one a 409 `checkout_in_progress` names. */
export type AbandonTarget = Pick<PortalPayment, 'id' | 'amount' | 'currency' | 'package' | 'created_at'>;

/** How an attempt left the payment: the abandon result, or `settled` when it was no longer pending (409 `not_pending`). */
export type Freed = AbandonOutcome | 'settled';

/** Whether the signed-in user's role may pay, and so abandon a pending payment. */
export function useCanPay(slug: string): boolean {
  return canPay(usePortalRole(slug));
}

const TITLE: Record<AbandonOutcome, string> = {
  completed: 'Payment received',
  cancelled: 'Payment cancelled',
  failed: 'Payment failed',
};

const errorCode = (error: unknown): string | null => (error instanceof ApiError ? error.code : null);

function Outcome({ slug, answer }: { slug: string; answer: AbandonResult }) {
  const { payment, result } = answer;
  if (result === 'completed') {
    const receipt = RECEIPT_STATUSES.has(payment.status) && payment.receipt_number;
    return (
      <div className="flex flex-col gap-1 rounded-lg bg-success-bg p-3 text-[13px] text-success-fg">
        <p className="font-semibold">
          bKash had already received this payment, so it is recorded as paid{receipt ? `, receipt ${payment.receipt_number}` : ''}.
        </p>
        {payment.notes ? <p className="whitespace-pre-line">{payment.notes}</p> : null}
        {receipt ? (
          <a href={paymentFileUrl(slug, payment.id, 'receipt')} target="_blank" rel="noopener noreferrer" className="self-start font-semibold underline">
            View receipt <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
      </div>
    );
  }
  if (result === 'cancelled') {
    return (
      <p className="rounded-lg bg-neutral-bg p-3 text-[13px] font-semibold text-neutral-fg">
        Payment cancelled; you can pay again now. {LATE_PAY}
      </p>
    );
  }
  return (
    <p className="rounded-lg bg-danger-bg p-3 text-[13px] font-semibold text-danger-fg">
      Payment failed: {payment.failure_reason || 'bKash did not complete it.'} You can pay again now. {TAKEN}
    </p>
  );
}

interface AbandonDialogProps {
  slug: string;
  payment: AbandonTarget;
  onClose: () => void;
  /** Called once the payment is no longer pending, with how it ended (and its new record, unless `settled`). */
  onFreed?: (how: Freed, payment?: PortalPayment) => void;
  /**
   * Offered once the payment is cancelled or failed: starts a new payment right away. Never after `completed` or
   * `settled`, since a payment that settled elsewhere may have been paid.
   */
  onPayAgain?: () => void;
}

/**
 * "Abandon this payment": explains that bKash is asked first, then `POST billing/payments/<id>/abandon/` once (repeat
 * clicks and Enter are ignored while it runs; the dialog can't be closed until it answers). The answer stays in the
 * dialog's live region: a payment bKash had already received is shown as paid with its receipt, never as abandoned.
 */
export function AbandonDialog({ slug, payment, onClose, onFreed, onPayAgain }: AbandonDialogProps) {
  const abandon = useAbandonPayment(slug);
  const sent = useRef(false);
  const next = useRef<HTMLButtonElement>(null);
  const retry = useRef<HTMLButtonElement>(null);
  const answer = abandon.data;
  const code = errorCode(abandon.error);
  const settled = code === 'not_pending';
  const finished = answer !== undefined || settled;
  const unpaid = answer !== undefined && answer.result !== 'completed';
  const failure = abandon.error ? abandonErrorMessage(abandon.error) : null;
  const informational = code === 'payment_confirming' || settled;
  const amount = formatMoney(payment.amount, payment.currency);
  const what = payment.package ? ` for ${payment.package.name}` : '';

  useEffect(() => {
    if (finished) next.current?.focus();
    else if (failure) retry.current?.focus();
  }, [finished, failure]);

  const confirm = () => {
    if (sent.current || finished) return;
    sent.current = true;
    abandon.mutate(payment.id, {
      onSuccess: (result) => onFreed?.(result.result, result.payment),
      onError: (error) => {
        if (errorCode(error) === 'not_pending') onFreed?.('settled');
      },
      onSettled: () => {
        sent.current = false;
      },
    });
  };

  const retryLabel = code === 'payment_confirming' ? 'Check again' : code ? 'Try again' : 'Abandon payment';

  return (
    <Dialog
      open
      locked={abandon.isPending}
      onOpenChange={(open) => !open && onClose()}
      title={answer ? TITLE[answer.result] : 'Abandon this payment?'}
      description={`The bKash payment of ${amount}${what}, started at ${formatDateTime(payment.created_at)}.`}
      onSubmit={confirm}
      footer={
        finished ? (
          <>
            <Button ref={unpaid && onPayAgain ? undefined : next} variant={unpaid && onPayAgain ? 'ghost' : 'secondary'} onClick={onClose}>
              Done
            </Button>
            {unpaid && onPayAgain ? (
              <Button ref={next} variant="primary" onClick={onPayAgain}>
                Pay again now
              </Button>
            ) : null}
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose} disabled={abandon.isPending}>
              Keep the payment
            </Button>
            <Button ref={retry} type="submit" variant="danger" loading={abandon.isPending}>
              {abandon.isPending ? 'Asking bKash…' : retryLabel}
            </Button>
          </>
        )
      }
    >
      {finished ? null : (
        <div className="flex flex-col gap-2 text-[13px] text-ink">
          <p>We first ask bKash about this payment.</p>
          <ul className="flex list-disc flex-col gap-1 pl-5">
            <li>If bKash already received the money, the payment is recorded as paid and you get a receipt.</li>
            <li>Otherwise the payment is cancelled and you can pay again right away. {LATE_PAY}</li>
          </ul>
        </div>
      )}
      <div aria-live="polite" aria-atomic="true">
        {answer ? <Outcome slug={slug} answer={answer} /> : null}
        {failure && informational ? (
          <Notice tone="info" announce={false}>
            {failure}
          </Notice>
        ) : null}
      </div>
      {failure && !informational ? <Notice tone="danger">{failure}</Notice> : null}
    </Dialog>
  );
}
