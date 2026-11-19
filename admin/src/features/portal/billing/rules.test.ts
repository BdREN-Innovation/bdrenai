import { describe, expect, it } from 'vitest';
import type { PaymentStatus } from '@/api/types';
import { isBkashUrl, periodText, resultOf, validateBillingSearch } from './rules';

describe('isBkashUrl', () => {
  it.each([
    ['https://payment.bkash.com/?paymentId=TR1&hash=x', true],
    ['https://sandbox.payment.bkash.com/?paymentId=TR1', true],
    ['https://tokenized.sandbox.bka.sh/v1.2.0-beta/checkout', true],
    ['http://payment.bkash.com/', false],
    ['https://bkash.com.example.org/', false],
    ['https://notbkash.com/', false],
    ['https://user:pass@payment.bkash.com/', false],
    ['/relative/path', false],
    ['javascript:alert(1)', false],
  ])('%s → %s', (url, allowed) => {
    expect(isBkashUrl(url)).toBe(allowed);
  });
});

describe('validateBillingSearch', () => {
  it('keeps a known result and a short payment id', () => {
    expect(validateBillingSearch({ payment: 'pay-1', result: 'pending' })).toEqual({ payment: 'pay-1', result: 'pending' });
  });

  it('drops unknown results and odd ids, keeping both keys', () => {
    expect(validateBillingSearch({ payment: 'x'.repeat(65), result: 'paid' })).toEqual({ payment: undefined, result: undefined });
    expect(validateBillingSearch({ payment: 42 })).toEqual({ payment: undefined, result: undefined });
  });
});

describe('periodText and resultOf', () => {
  it('shows the last day of a period whose end is exclusive', () => {
    expect(periodText('2026-11-18', '2026-12-18')).toBe('18 Nov 2026 – 17 Dec 2026');
  });

  it('maps payment statuses to banner results', () => {
    const statuses: PaymentStatus[] = ['completed', 'partially_refunded', 'pending', 'cancelled', 'failed', 'rejected'];
    expect(statuses.map(resultOf)).toEqual([
      'success',
      'success',
      'pending',
      'cancelled',
      'failed',
      'failed',
    ]);
  });
});
