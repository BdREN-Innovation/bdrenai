import type { Payment } from '@/api/types';
import { StatusChip, Table, TableMessage, Td, Th, Tr } from '@/components/ui';
import { formatDate, formatMoney } from '@/lib/format';
import { METHOD_LABEL } from './labels';

/** When the money moved: completion, else the recorded payment date, else when the row was created. */
export const paymentDate = (payment: Payment) => payment.completed_at ?? payment.payment_date ?? payment.created_at;

/** The reference a person would quote: bKash trxID, else the manual reference. */
export const paymentReference = (payment: Payment) => payment.bkash?.trx_id || payment.reference || '';

interface PaymentTableProps {
  label: string;
  payments: Payment[];
  loading: boolean;
  emptyText: string;
  onOpen: (payment: Payment) => void;
  showInstitution?: boolean;
}

export function PaymentTable({ label, payments, loading, emptyText, onOpen, showInstitution = true }: PaymentTableProps) {
  const columns = showInstitution ? 8 : 7;
  return (
    <Table label={label}>
      <thead>
        <tr>
          <Th>Date</Th>
          {showInstitution ? <Th>Institution</Th> : null}
          <Th>Package</Th>
          <Th className="text-right">Amount</Th>
          <Th>Method</Th>
          <Th>Reference / trxID</Th>
          <Th>Status</Th>
          <Th>Recorded by</Th>
        </tr>
      </thead>
      <tbody>
        {payments.length === 0 ? (
          <TableMessage colSpan={columns}>{loading ? 'Loading…' : emptyText}</TableMessage>
        ) : (
          payments.map((payment) => {
            const who = payment.institution?.name ?? 'Personal account';
            return (
              <Tr
                key={payment.id}
                onOpen={() => onOpen(payment)}
                openLabel={`${['Payment', payment.receipt_number, 'from', who].filter(Boolean).join(' ')}, ${formatMoney(payment.amount, payment.currency)}`}
              >
                <Td className="tabular whitespace-nowrap">{formatDate(paymentDate(payment))}</Td>
                {showInstitution ? <Td className="max-w-56 truncate font-semibold">{who}</Td> : null}
                <Td className="max-w-56">
                  <span className="block truncate">{payment.package?.name ?? '—'}</span>
                  {payment.periods > 1 ? <span className="text-xs text-ink-muted">{payment.periods} periods</span> : null}
                </Td>
                <Td className="tabular text-right font-semibold whitespace-nowrap">{formatMoney(payment.amount, payment.currency)}</Td>
                <Td className="whitespace-nowrap">{METHOD_LABEL[payment.method]}</Td>
                <Td className="max-w-48 truncate font-mono text-xs">{paymentReference(payment) || '—'}</Td>
                <Td>
                  <StatusChip status={payment.status} />
                </Td>
                <Td className="max-w-40 truncate text-ink-muted">{payment.recorded_by?.name || payment.recorded_by?.email || '—'}</Td>
              </Tr>
            );
          })
        )}
      </tbody>
    </Table>
  );
}
