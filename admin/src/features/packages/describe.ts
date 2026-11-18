import type { AppRef, LimitPeriod, LimitTerms, PackageChange, PackageLimit, PackageVersion, ScalarField } from '@/api/types';
import { INTERVAL_LABEL, PRICE_UNIT_LABEL } from '@/lib/labels';
import { formatMoney, formatNumber } from '@/lib/format';

const PERIOD_TEXT: Record<LimitPeriod, string> = {
  daily: 'per day',
  weekly: 'per week',
  monthly: 'per month',
  yearly: 'per year',
  lifetime: 'in total',
};

/** "1,000 messages per month", with "(warn only)" when going over does not block. */
export function formatLimit(terms: LimitTerms, unit: string): string {
  const text = `${formatNumber(terms.limit_value)} ${unit} ${PERIOD_TEXT[terms.limit_period]}`;
  return terms.on_limit === 'warn' ? `${text} (warn only)` : text;
}

/** Groups in first-seen order, so a list already sorted by the server keeps its order. */
export function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}

const FIELD_LABEL: Record<ScalarField, string> = {
  price: 'Price',
  currency: 'Currency',
  billing_interval: 'Billing',
  price_unit: 'Price unit',
  trial_days: 'Trial days',
  seat_limit: 'Seat limit',
};

function scalarText(field: ScalarField, value: string | number | null, currency: string): string {
  if (value === null) return field === 'seat_limit' ? 'No limit' : '—';
  if (field === 'price') return formatMoney(String(value), currency);
  if (field === 'billing_interval') return INTERVAL_LABEL[value as keyof typeof INTERVAL_LABEL] ?? String(value);
  if (field === 'price_unit') return PRICE_UNIT_LABEL[value as keyof typeof PRICE_UNIT_LABEL] ?? String(value);
  return typeof value === 'number' ? formatNumber(value) : value;
}

const names = (apps: AppRef[]) => apps.map((app) => app.name).join(', ');

/** One plain line per change, shared by the review step (server preview) and version history. */
export function describeChange(change: PackageChange, currency: string): string {
  if (change.field === 'apps') {
    return [
      change.added.length > 0 ? `Apps added: ${names(change.added)}` : '',
      change.removed.length > 0 ? `Apps removed: ${names(change.removed)}` : '',
    ]
      .filter(Boolean)
      .join('; ');
  }
  if (change.field === 'limit') {
    const { name, unit, app } = change.feature;
    const label = `${name} (${app.name})`;
    if (!change.from && change.to) return `${label}: added, ${formatLimit(change.to, unit)}`;
    if (change.from && !change.to) return `${label}: removed (was ${formatLimit(change.from, unit)})`;
    if (change.from && change.to) return `${label}: ${formatLimit(change.from, unit)} → ${formatLimit(change.to, unit)}`;
    return label;
  }
  return `${FIELD_LABEL[change.field]}: ${scalarText(change.field, change.from, currency)} → ${scalarText(change.field, change.to, currency)}`;
}

const SCALARS: Exclude<ScalarField, 'currency'>[] = ['price', 'billing_interval', 'price_unit', 'trial_days', 'seat_limit'];

const sameLimit = (a: LimitTerms, b: LimitTerms) =>
  a.limit_value === b.limit_value && a.limit_period === b.limit_period && a.on_limit === b.on_limit;

const limitTerms = ({ limit_value, limit_period, on_limit }: PackageLimit): LimitTerms => ({ limit_value, limit_period, on_limit });

/** What a version changed against the one before it, in the same shape the preview endpoint returns. */
export function versionChanges(newer: PackageVersion, older: PackageVersion): PackageChange[] {
  const scalars: PackageChange[] = SCALARS.filter((field) =>
    field === 'price' ? Number(newer.price) !== Number(older.price) : newer[field] !== older[field],
  ).map((field) => ({ field, from: older[field], to: newer[field] }));

  const olderApps = new Set(older.apps.map((app) => app.slug));
  const newerApps = new Set(newer.apps.map((app) => app.slug));
  const added = newer.apps.filter((app) => !olderApps.has(app.slug));
  const removed = older.apps.filter((app) => !newerApps.has(app.slug));
  const apps: PackageChange[] = added.length + removed.length > 0 ? [{ field: 'apps', added, removed }] : [];

  const before = new Map(older.limits.map((limit) => [limit.feature.id, limit]));
  const after = new Map(newer.limits.map((limit) => [limit.feature.id, limit]));
  const changedOrAdded: PackageChange[] = newer.limits
    .filter((limit) => {
      const previous = before.get(limit.feature.id);
      return !previous || !sameLimit(previous, limit);
    })
    .map((limit) => {
      const previous = before.get(limit.feature.id);
      return { field: 'limit', feature: limit.feature, from: previous ? limitTerms(previous) : null, to: limitTerms(limit) };
    });
  const dropped: PackageChange[] = older.limits
    .filter((limit) => !after.has(limit.feature.id))
    .map((limit) => ({ field: 'limit', feature: limit.feature, from: limitTerms(limit), to: null }));

  return [...scalars, ...apps, ...changedOrAdded, ...dropped];
}
