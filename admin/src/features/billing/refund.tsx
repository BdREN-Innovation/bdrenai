import { useEffect, useState } from 'react';
import type { Payment } from '@/api/types';
import { Button, Checkbox, Dialog, ErrorState, Field, Input, Textarea, useToast } from '@/components/ui';
import { isAmount, remaining, toAmount } from './labels';
import { fieldErrors } from '@/api/client';
import { useRefundPayment } from '@/api/queries';
import { formatMoney } from '@/lib/format';

interface RefundDialogProps {
  payment: Payment;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function RefundDialog({ payment, open, onOpenChange }: RefundDialogProps) {
  const notify = useToast();
  const refund = useRefundPayment();
  const left = remaining(payment.amount, payment.refunded_amount);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [endSubscription, setEndSubscription] = useState(false);
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const { reset } = refund;

  useEffect(() => {
    if (!open) return;
    setAmount(String(left));
    setReason('');
    setEndSubscription(false);
    setErrors({});
    reset();
  }, [open, left, reset]);

  const money = (value: number | string) => formatMoney(String(value), payment.currency);
  const server = fieldErrors(refund.error);
  const general = refund.error && Object.keys(server).length === 0 ? refund.error : null;

  const submit = () => {
    const next: typeof errors = {};
    if (!isAmount(amount)) next.amount = 'Enter an amount above zero, with at most two decimals.';
    else if (Number(amount) > left) next.amount = `At most ${money(left)} is left to refund.`;
    if (!reason.trim()) next.reason = 'Say why the money is returned.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    refund.mutate(
      { id: payment.id, body: { amount: toAmount(amount), reason: reason.trim(), end_subscription: endSubscription } },
      {
        onSuccess: () => {
          onOpenChange(false);
          notify(`${money(amount)} refunded.`);
        },
      },
    );
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Refund payment"
      description={
        payment.method === 'bkash'
          ? `bKash returns the money to the payer's account. ${money(left)} of ${money(payment.amount)} is left to refund.`
          : `Record money you returned outside the system. ${money(left)} of ${money(payment.amount)} is left to refund.`
      }
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" loading={refund.isPending}>
            Refund
          </Button>
        </>
      }
    >
      <Field label="Amount (৳)" required error={errors.amount ?? server.amount} hint={`Up to ${money(left)}.`}>
        {(props) => (
          <Input {...props} inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} />
        )}
      </Field>
      <Field label="Reason" required error={errors.reason ?? server.reason} hint="Saved with the refund and in the audit log.">
        {(props) => <Textarea {...props} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
      </Field>
      <Checkbox
        label="End the subscription this payment paid for"
        hint="Only when this payment's period is the current one. Members lose access at once."
        checked={endSubscription}
        onChange={setEndSubscription}
      />
      {general ? <ErrorState error={general} /> : null}
    </Dialog>
  );
}
