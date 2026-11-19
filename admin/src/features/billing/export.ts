import type { Page, Payment, PaymentListParams } from '@/api/types';
import { superadmin } from '@/api/client';
import { toCsv } from '@/lib/csv';
import { KIND_LABEL, METHOD_LABEL, dayOf } from './labels';
import { paymentDate, paymentReference } from './payments';

const EXPORT_PAGE_SIZE = 100;
/** Stops a runaway export; 5,000 rows is far beyond a normal period. */
const MAX_EXPORT_PAGES = 50;

/** Every payment matching the filter, read page by page from the same list endpoint the table uses. */
export async function fetchAllPayments(params: PaymentListParams): Promise<Payment[]> {
  const rows: Payment[] = [];
  for (let page = 1; page <= MAX_EXPORT_PAGES; page++) {
    const result = await superadmin.get<Page<Payment>>('billing/payments/', { ...params, page, page_size: EXPORT_PAGE_SIZE });
    rows.push(...result.results);
    if (rows.length >= result.count || result.results.length === 0) break;
  }
  return rows;
}

const HEADER = [
  'Date',
  'Receipt number',
  'Institution',
  'Package',
  'Kind',
  'Periods',
  'Period start',
  'Period end',
  'Amount',
  'Refunded',
  'Currency',
  'Method',
  'Reference / trxID',
  'Status',
  'Payer name',
  'Recorded by',
  'Notes',
];

export function paymentsCsv(payments: Payment[]): string {
  return toCsv([
    HEADER,
    ...payments.map((payment) => [
      dayOf(paymentDate(payment)),
      payment.receipt_number ?? '',
      payment.institution?.name ?? '',
      payment.package?.name ?? '',
      KIND_LABEL[payment.kind],
      String(payment.periods),
      payment.period_start ? dayOf(payment.period_start) : '',
      payment.period_end ? dayOf(payment.period_end) : '',
      payment.amount,
      payment.refunded_amount,
      payment.currency,
      METHOD_LABEL[payment.method],
      paymentReference(payment),
      payment.status,
      payment.payer_name,
      payment.recorded_by?.email ?? '',
      payment.notes,
    ]),
  ]);
}

/** Saves text as a file through a temporary object URL. */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
