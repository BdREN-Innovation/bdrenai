import { describe, expect, it } from 'vitest';
import { presetRange, rangeProblem, todayIn } from './period';

describe('usage periods', () => {
  it('builds each preset from today\'s calendar day', () => {
    expect(presetRange('7d', '2026-11-18')).toEqual({ start: '2026-11-12', end: '2026-11-18' });
    expect(presetRange('30d', '2026-11-18')).toEqual({ start: '2026-10-20', end: '2026-11-18' });
    expect(presetRange('this_month', '2026-11-18')).toEqual({ start: '2026-11-01', end: '2026-11-18' });
    expect(presetRange('last_month', '2026-11-18')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(presetRange('last_month', '2026-01-05')).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(presetRange('last_month', '2028-03-31')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it("reads today in Dhaka, not in the browser's zone", () => {
    expect(todayIn('Asia/Dhaka', new Date('2026-11-18T19:30:00Z'))).toBe('2026-11-19');
    expect(todayIn('Asia/Dhaka', new Date('2026-11-18T17:30:00Z'))).toBe('2026-11-18');
  });

  it('checks a custom range the way the server does', () => {
    expect(rangeProblem({ start: '2026-11-01', end: '2026-11-18' })).toBeNull();
    expect(rangeProblem({ start: '', end: '2026-11-18' })).toBe('Choose a start date.');
    expect(rangeProblem({ start: '2026-11-19', end: '2026-11-18' })).toBe('The start date must not be after the end date.');
    expect(rangeProblem({ start: '2025-11-17', end: '2026-11-18' })).toBe('Choose a range of at most 366 days.');
    expect(rangeProblem({ start: '2025-11-18', end: '2026-11-18' })).toBeNull();
  });
});
