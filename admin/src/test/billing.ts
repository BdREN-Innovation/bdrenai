import type * as t from '@/api/types';
import { actor } from './fixtures';

export const sau: t.InstitutionRef = { slug: 'sau', name: 'Sylhet Agricultural University' };

export const bkashPayment: t.Payment = {
  id: 'pay-1',
  receipt_number: 'BDR-2026-000012',
  institution: sau,
  account_id: 'acc-1',
  package: { id: 'pkg-all', name: 'BdREN AI Suite', kind: 'bundle' },
  package_version: 1,
  kind: 'renew',
  method: 'bkash',
  status: 'partially_refunded',
  amount: '4500.00',
  currency: 'BDT',
  periods: 1,
  period_start: '2026-11-18T06:00:00Z',
  period_end: '2026-12-18T06:00:00Z',
  reference: 'DKI20PX90K',
  payer_name: '',
  payment_date: '2026-11-18',
  notes: '',
  has_attachment: false,
  bkash: { payment_id: 'TR0011wEp5MBG1794997089896', trx_id: 'DKI20PX90K', payer_account: '********378', status: 'Completed' },
  failure_reason: '',
  refunded_amount: '1000.00',
  refunds: [
    {
      id: 'ref-1',
      amount: '1000.00',
      reason: 'Charged for unused seats',
      method: 'bkash',
      bkash_refund_trx_id: 'RFX123',
      status: 'completed',
      created_by: actor,
      created_at: '2026-11-18T09:00:00Z',
    },
  ],
  recorded_by: { id: 'u-5', name: 'Karim Admin', email: 'karim@sau.ac.bd' },
  verified_by: null,
  verified_at: null,
  completed_at: '2026-11-18T06:00:00Z',
  created_at: '2026-11-18T05:58:00Z',
};

export const pendingManual: t.Payment = {
  ...bkashPayment,
  id: 'pay-2',
  receipt_number: null,
  method: 'bank_transfer',
  status: 'pending',
  amount: '9000.00',
  periods: 2,
  reference: 'SONALI-7781',
  payer_name: 'SAU Accounts',
  notes: 'Two months at once',
  has_attachment: true,
  bkash: null,
  refunded_amount: '0.00',
  refunds: [],
  recorded_by: actor,
  completed_at: null,
};

export const summary: t.BillingSummary = {
  collected: '13500.00',
  bkash: '4500.00',
  manual: '9000.00',
  refunds: '1000.00',
  pending: 1,
  failed: 0,
  previous: { collected: '9000.00', bkash: '4500.00', manual: '4500.00', refunds: '0.00', pending: 2, failed: 0 },
  bkash_mode: 'sandbox',
};

export const suiteSubscription: t.BillingSubscription = {
  id: 'sub-1',
  institution: sau,
  package: { id: 'pkg-all', name: 'BdREN AI Suite', kind: 'bundle' },
  version: 1,
  apps: [
    { slug: 'synapse', name: 'Synapse' },
    { slug: 'mindspear', name: 'Mindspear' },
  ],
  status: 'active',
  starts_at: '2026-10-19T06:00:00Z',
  expires_at: '2026-11-18T06:00:00Z',
  auto_renew: true,
  scheduled_package: null,
  last_payment: { id: 'pay-0', method: 'bkash', completed_at: '2026-10-19T06:00:00Z' },
};

export const quote: t.Quote = {
  package_version: 1,
  amount: '4500.00',
  currency: 'BDT',
  periods: 1,
  period_start: '2026-11-18T06:00:00Z',
  period_end: '2026-12-18T06:00:00Z',
  kind: 'renew',
};
