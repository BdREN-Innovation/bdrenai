import { FileText, Paperclip } from 'lucide-react';
import type { PortalPayment } from '../types';
import { StatusChip, Table, TableMessage, Td, Th } from '@/components/ui';
import { METHOD_LABEL } from '@/features/billing/labels';
import { paymentDate, paymentReference } from '@/features/billing/payments';
import { KIND_TEXT, RECEIPT_STATUSES, paymentAnchor } from './rules';
import { formatDate, formatMoney } from '@/lib/format';
import { paymentFileUrl } from '../api';

const FILE_LINK = 'inline-flex items-center gap-1 font-semibold text-brand hover:underline';

function Files({ slug, payment }: { slug: string; payment: PortalPayment }) {
  const receipt = RECEIPT_STATUSES.has(payment.status) && payment.receipt_number;
  if (!receipt && !payment.has_attachment) return <span className="text-ink-muted">—</span>;
  return (
    <div className="flex flex-col items-start gap-1">
      {receipt ? (
        <a href={paymentFileUrl(slug, payment.id, 'receipt')} target="_blank" rel="noopener noreferrer" className={FILE_LINK}>
          <FileText aria-hidden="true" size={14} />
          Receipt{' '}
          <span className="sr-only">
            {payment.receipt_number} (opens in a new tab)
          </span>
        </a>
      ) : null}
      {payment.has_attachment ? (
        <a href={paymentFileUrl(slug, payment.id, 'attachment')} className={FILE_LINK}>
          <Paperclip aria-hidden="true" size={14} />
          Attachment{' '}
          <span className="sr-only">of the payment on {formatDate(paymentDate(payment))}</span>
        </a>
      ) : null}
    </div>
  );
}

const showsReason = (payment: PortalPayment) => (payment.status === 'failed' || payment.status === 'cancelled' || payment.status === 'rejected') && payment.failure_reason;

/** The institution's payments, newest first, with receipts and bank slips to download. */
export function PaymentHistory({ slug, payments }: { slug: string; payments: PortalPayment[] }) {
  return (
    <section aria-labelledby="payment-history" className="flex flex-col gap-3">
      <h2 id="payment-history" className="text-[15px] font-semibold text-ink">
        Payments
      </h2>
      <Table label="Payments">
        <thead>
          <tr>
            <Th>Date</Th>
            <Th>Package</Th>
            <Th className="text-right">Amount</Th>
            <Th>Method</Th>
            <Th>Status</Th>
            <Th>bKash trxID / reference</Th>
            <Th>Documents</Th>
          </tr>
        </thead>
        <tbody>
          {payments.length === 0 ? (
            <TableMessage colSpan={7}>No payments yet.</TableMessage>
          ) : (
            payments.map((payment) => (
              <tr key={payment.id} id={paymentAnchor(payment.id)} tabIndex={-1} className="scroll-mt-4 focus:bg-hover focus:outline-none">
                <Td className="tabular whitespace-nowrap">{formatDate(paymentDate(payment))}</Td>
                <Td className="max-w-56">
                  <span className="block truncate font-medium">{payment.package?.name ?? '—'}</span>
                  {payment.kind !== 'legacy' ? <span className="text-xs text-ink-muted">{KIND_TEXT[payment.kind]}</span> : null}
                </Td>
                <Td className="tabular text-right whitespace-nowrap">
                  <span className="font-semibold">{formatMoney(payment.amount, payment.currency)}</span>
                  {Number(payment.refunded_amount) > 0 ? (
                    <span className="block text-xs text-ink-muted">{formatMoney(payment.refunded_amount, payment.currency)} refunded</span>
                  ) : null}
                </Td>
                <Td className="whitespace-nowrap">{METHOD_LABEL[payment.method]}</Td>
                <Td>
                  <div className="flex flex-col items-start gap-1">
                    <StatusChip status={payment.status} />
                    {showsReason(payment) ? <span className="max-w-56 text-xs text-ink-muted">{payment.failure_reason}</span> : null}
                  </div>
                </Td>
                <Td className="max-w-48 truncate font-mono text-xs">{paymentReference(payment) || '—'}</Td>
                <Td className="text-[13px]">
                  <Files slug={slug} payment={payment} />
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Table>
    </section>
  );
}
