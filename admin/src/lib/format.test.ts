import { describe, expect, it } from 'vitest';
import { formatMoney, formatPrice } from './format';

describe('formatMoney', () => {
  it('shows whole amounts without cents and other amounts with two digits', () => {
    expect(formatMoney('1500.00', 'BDT')).toBe('৳1,500');
    expect(formatMoney('1500.50', 'BDT')).toBe('৳1,500.50');
    expect(formatMoney('1500.05', 'BDT')).toBe('৳1,500.05');
    expect(formatMoney('20.5', 'USD')).toBe('USD 20.50');
  });

  it('keeps the cents in a full price', () => {
    expect(formatPrice({ price: '1800.50', currency: 'BDT', billing_interval: 'monthly', price_unit: 'per_seat' })).toBe(
      '৳1,800.50 per seat / month',
    );
  });
});
